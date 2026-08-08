/**
 * Analytics Model
 *
 * Database operations for test analytics
 */

const { query } = require('../utils/database');
const logger = require('../utils/logger');

const CHECKOUT_EVENT_NAME_PREFIX = 'checkout_';

function normalizeShopDomain(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function normalizeAnalyticsEventName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
}

function buildFunnelTransitions(steps = [], byVariant = {}, semantics = {}) {
  const transitionsByVariant = {};
  Object.entries(byVariant || {}).forEach(([variantId, counts]) => {
    transitionsByVariant[variantId] = steps.slice(1).map((step, index) => {
      const fromStep = steps[index];
      const fromCount = Number(counts?.[fromStep?.id]) || 0;
      const toCount = Number(counts?.[step?.id]) || 0;
      const dropOff = Math.max(0, fromCount - toCount);
      return {
        fromStepId: fromStep?.id || null,
        fromStepLabel: fromStep?.label || fromStep?.id || 'Previous step',
        toStepId: step?.id || null,
        toStepLabel: step?.label || step?.id || 'Next step',
        fromCount,
        toCount,
        transitionRate: fromCount > 0 ? (toCount / fromCount) * 100 : 0,
        dropOff,
        dropOffRate: fromCount > 0 ? (dropOff / fromCount) * 100 : 0,
        semantics: semantics.ordered ? 'ordered_transition' : 'independent_step_reach_ratio',
      };
    });
  });
  return transitionsByVariant;
}

function buildCustomEventTypeCondition(safeNames = []) {
  const includesCheckoutEvents = safeNames.some(eventName =>
    String(eventName || '').startsWith(CHECKOUT_EVENT_NAME_PREFIX)
  );
  if (!includesCheckoutEvents) {
    return "e.event_type = 'custom'";
  }
  return `(e.event_type = 'custom' OR (e.event_type = 'conversion' AND ${buildCheckoutEventNamePrefixCondition('e')}))`;
}

function buildCheckoutEventNamePrefixCondition(alias = 'e') {
  return `LEFT(${alias}.event_name, ${CHECKOUT_EVENT_NAME_PREFIX.length}) = '${CHECKOUT_EVENT_NAME_PREFIX}'`;
}

function buildPrimaryConversionCondition(alias = 'e') {
  return `(${alias}.event_name IS NULL OR NOT (${buildCheckoutEventNamePrefixCondition(alias)}))`;
}

class AnalyticsModel {
  /**
   * Track a conversion event
   * Deduplicates by order_id when present (storefront + webhook can both fire)
   *
   * @param {Object} eventData - Event data
   * @returns {Promise<Object|null>} Saved event or null if duplicate
   */
  async trackEvent(eventData) {
    const {
      test_id,
      variant_id,
      user_id,
      shop_domain,
      event_type = 'conversion',
      event_name = null,
      event_value = 0,
      metadata,
    } = eventData;

    const normalizedShopDomain = normalizeShopDomain(shop_domain);
    const normalizedEventName = normalizeAnalyticsEventName(event_name);
    const normalizedEventValue = Number(event_value);
    const meta =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
    const orderId = meta.order_id != null ? String(meta.order_id) : null; // eslint-disable-line eqeqeq

    const hasEventName = normalizedEventName.length > 0;
    const columns = [
      'test_id',
      'variant_id',
      'user_id',
      'shop_domain',
      'event_type',
      'event_value',
      'metadata',
    ];
    const values = [
      test_id,
      variant_id,
      user_id,
      normalizedShopDomain,
      event_type,
      Number.isFinite(normalizedEventValue) ? normalizedEventValue : 0,
      JSON.stringify(meta),
    ];

    if (hasEventName) {
      columns.splice(6, 0, 'event_name');
      values.splice(6, 0, normalizedEventName);
    }

    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    const dedupeConflictClause =
      event_type === 'conversion' && orderId
        ? `
      ON CONFLICT (test_id, user_id, (metadata->>'order_id'))
      WHERE event_type = 'conversion' AND metadata ? 'order_id' AND metadata->>'order_id' <> ''
      DO UPDATE SET
        event_value = GREATEST(events.event_value, EXCLUDED.event_value),
        metadata = COALESCE(events.metadata, '{}'::jsonb) || COALESCE(EXCLUDED.metadata, '{}'::jsonb)`
        : '';
    const sql = `
      INSERT INTO events (${columns.join(', ')})
      VALUES (${placeholders})
      ${dedupeConflictClause}
      RETURNING *
    `;

    const result = await query(sql, values);
    return result.rows[0] || null;
  }

  /**
   * Get analytics for a test
   *
   * @param {string} testId - Test ID
   * @param {string} shopDomain - Shop domain
   * @param {Object} options - Optional filters: { device, country }
   * @returns {Promise<Array>} Analytics by variant
   */
  async getTestAnalytics(testId, shopDomain, options = {}) {
    const { conversionWindowDays, conversionUrl, start_date, end_date } = options;

    const runQuery = async (device, country) => {
      const params = [testId, (shopDomain || '').toLowerCase().trim()];
      let paramIndex = 3;

      let visitorWhere = 'ta.test_id = $1 AND LOWER(TRIM(ta.shop_domain)) = LOWER(TRIM($2))';
      if (device) {
        visitorWhere += ` AND ta.device = $${paramIndex}`;
        params.push(device);
        paramIndex += 1;
      }
      if (country) {
        visitorWhere += ` AND ta.country = $${paramIndex}`;
        params.push(country);
        paramIndex += 1;
      }
      if (start_date) {
        visitorWhere += ` AND ta.assigned_at >= $${paramIndex}`;
        params.push(start_date);
        paramIndex += 1;
      }
      if (end_date) {
        visitorWhere += ` AND ta.assigned_at < $${paramIndex}`;
        params.push(end_date);
        paramIndex += 1;
      }

      const visitorsSql = `
      SELECT 
        ta.variant_id,
        ta.variant_name,
        COUNT(DISTINCT ta.user_id) as visitors
      FROM test_assignments ta
      WHERE ${visitorWhere}
      GROUP BY ta.variant_id, ta.variant_name
    `;

      const convJoin =
        'JOIN test_assignments ta ON ta.test_id = e.test_id AND ta.user_id = e.user_id AND LOWER(TRIM(ta.shop_domain)) = LOWER(TRIM(e.shop_domain)) AND ta.variant_id = e.variant_id';
      const conversionParams = [testId, (shopDomain || '').toLowerCase().trim()];
      let convIdx = 3;
      let convExtra = '';
      if (device) {
        convExtra += ` AND ta.device = $${convIdx}`;
        conversionParams.push(device);
        convIdx += 1;
      }
      if (country) {
        convExtra += ` AND ta.country = $${convIdx}`;
        conversionParams.push(country);
        convIdx += 1;
      }
      if (start_date) {
        convExtra += ` AND ta.assigned_at >= $${convIdx} AND e.created_at >= $${convIdx}`;
        conversionParams.push(start_date);
        convIdx += 1;
      }
      if (end_date) {
        convExtra += ` AND ta.assigned_at < $${convIdx} AND e.created_at < $${convIdx}`;
        conversionParams.push(end_date);
        convIdx += 1;
      }
      if (conversionWindowDays && conversionWindowDays > 0) {
        convExtra += ` AND e.created_at >= ta.assigned_at AND e.created_at <= ta.assigned_at + ($${convIdx} || ' days')::interval`;
        conversionParams.push(conversionWindowDays);
        convIdx += 1;
      }
      if (conversionUrl && String(conversionUrl).trim()) {
        const patterns = conversionUrl
          .split(',')
          .map(p => p.trim())
          .filter(Boolean);
        if (patterns.length > 0) {
          const conditions = patterns.map((p, _i) => {
            conversionParams.push(`%${p}%`);
            return `(e.metadata->>'conversion_url')::text ILIKE $${conversionParams.length}`;
          });
          convExtra += ` AND (${conditions.join(' OR ')})`;
        }
      }

      const conversionsSql = `
      SELECT 
        e.variant_id,
        COUNT(DISTINCT e.user_id) as conversions,
        COALESCE(SUM(e.event_value), 0) as revenue
      FROM events e
      ${convJoin}
      WHERE e.test_id = $1 
        AND LOWER(TRIM(e.shop_domain)) = LOWER(TRIM($2))
        AND e.event_type = 'conversion'
        AND ${buildPrimaryConversionCondition('e')}
        ${convExtra}
      GROUP BY e.variant_id
    `;

      const [visitorsResult, conversionsResult] = await Promise.all([
        query(visitorsSql, params),
        query(conversionsSql, conversionParams),
      ]);

      const variantMap = {};
      visitorsResult.rows.forEach(row => {
        variantMap[row.variant_id] = {
          variant_id: row.variant_id,
          variant_name: row.variant_name,
          visitors: parseInt(row.visitors, 10) || 0,
          conversions: 0,
          revenue: 0,
        };
      });

      conversionsResult.rows.forEach(row => {
        if (variantMap[row.variant_id]) {
          variantMap[row.variant_id].conversions = parseInt(row.conversions, 10) || 0;
          variantMap[row.variant_id].revenue = parseFloat(row.revenue) || 0;
        }
      });

      return Object.values(variantMap);
    };

    const { device, country } = options;
    try {
      return runQuery(device, country);
    } catch (err) {
      if (
        (device || country) &&
        (err.message?.includes('device') || err.message?.includes('country'))
      ) {
        return runQuery(null, null);
      }
      throw err;
    }
  }

  /**
   * Get available segment values for breakdown (device, country)
   *
   * @param {string} testId - Test ID
   * @param {string} shopDomain - Shop domain
   * @returns {Promise<Object>} { devices: string[], countries: string[] }
   */
  async getSegmentBreakdownOptions(testId, shopDomain) {
    try {
      const devicesSql = `
        SELECT DISTINCT device FROM test_assignments
        WHERE test_id = $1 AND LOWER(TRIM(shop_domain)) = LOWER(TRIM($2)) AND device IS NOT NULL AND device != ''
        ORDER BY device
      `;
      const countriesSql = `
        SELECT DISTINCT country FROM test_assignments
        WHERE test_id = $1 AND LOWER(TRIM(shop_domain)) = LOWER(TRIM($2)) AND country IS NOT NULL AND country != ''
        ORDER BY country
      `;
      const [devicesResult, countriesResult] = await Promise.all([
        query(devicesSql, [testId, shopDomain]),
        query(countriesSql, [testId, shopDomain]),
      ]);
      return {
        devices: devicesResult.rows.map(r => r.device).filter(Boolean),
        countries: countriesResult.rows.map(r => r.country).filter(Boolean),
      };
    } catch (err) {
      return { devices: [], countries: [] };
    }
  }

  /**
   * Get event count by type
   *
   * @param {string} testId - Test ID
   * @param {string} shopDomain - Shop domain
   * @param {string} eventType - Event type
   * @returns {Promise<number>} Event count
   */
  async getEventCount(testId, shopDomain, eventType) {
    const sql = `
      SELECT COUNT(*) as count
      FROM events
      WHERE test_id = $1 
        AND LOWER(TRIM(shop_domain)) = LOWER(TRIM($2))
        AND event_type = $3
    `;

    const result = await query(sql, [testId, normalizeShopDomain(shopDomain), eventType]);
    return parseInt(result.rows[0].count, 10) || 0;
  }

  /**
   * Get secondary/custom event metrics per variant
   *
   * @param {string} testId - Test ID
   * @param {string} shopDomain - Shop domain
   * @param {string[]} eventNames - Custom event names to aggregate
   * @param {Object} options - Optional filters: { device, country }
   * @returns {Promise<Object>} { eventName: { variant_id: { count, sum } } }
   */
  async getSecondaryEventMetrics(testId, shopDomain, eventNames = [], options = {}) {
    if (!eventNames || eventNames.length === 0) {
      return {};
    }

    const { device, country } = options;
    const safeNames = Array.from(
      new Set(eventNames.map(eventName => normalizeAnalyticsEventName(eventName)).filter(Boolean))
    );

    const result = Object.fromEntries(safeNames.map(eventName => [eventName, {}]));
    if (!safeNames.length) {
      return result;
    }

    const params = [testId, normalizeShopDomain(shopDomain), safeNames];
    const conditions = [
      'e.test_id = $1',
      'LOWER(TRIM(e.shop_domain)) = LOWER(TRIM($2))',
      buildCustomEventTypeCondition(safeNames),
      'e.event_name = ANY($3::text[])',
    ];
    let joinClause = '';

    if (device || country) {
      joinClause =
        'JOIN test_assignments ta ON ta.test_id = e.test_id AND ta.user_id = e.user_id AND LOWER(TRIM(ta.shop_domain)) = LOWER(TRIM(e.shop_domain)) AND ta.variant_id = e.variant_id';
      if (device) {
        conditions.push(`ta.device = $${params.length + 1}`);
        params.push(device);
      }
      if (country) {
        conditions.push(`ta.country = $${params.length + 1}`);
        params.push(country);
      }
    }

    const sql = `
      SELECT
        e.event_name,
        e.variant_id,
        COUNT(DISTINCT e.user_id) as count,
        COALESCE(SUM(e.event_value), 0) as sum
      FROM events e
      ${joinClause}
      WHERE ${conditions.join(' AND ')}
      GROUP BY e.event_name, e.variant_id
    `;

    try {
      const q = await query(sql, params);
      q.rows.forEach(row => {
        if (!result[row.event_name]) {
          result[row.event_name] = {};
        }
        result[row.event_name][row.variant_id] = {
          count: parseInt(row.count, 10) || 0,
          sum: parseFloat(row.sum) || 0,
        };
      });
    } catch (err) {
      return result;
    }

    return result;
  }

  /**
   * Get collection health stats for configured custom event goals.
   *
   * @param {string} testId - Test ID
   * @param {string} shopDomain - Shop domain
   * @param {string[]} eventNames - Custom event names to summarize
   * @param {Object} options - Optional filters: { device, country }
   * @returns {Promise<Object>} { eventName: { totalEvents, uniqueUsers, sum, firstSeen, lastSeen, byVariant, sources } }
   */
  async getEventCollectionStats(testId, shopDomain, eventNames = [], options = {}) {
    const safeNames = Array.from(
      new Set(
        (eventNames || []).map(eventName => normalizeAnalyticsEventName(eventName)).filter(Boolean)
      )
    );
    const result = Object.fromEntries(
      safeNames.map(eventName => [
        eventName,
        {
          totalEvents: 0,
          uniqueUsers: 0,
          sum: 0,
          firstSeen: null,
          lastSeen: null,
          byVariant: {},
          sources: [],
          trend: [],
        },
      ])
    );
    if (!safeNames.length) {
      return result;
    }

    const { device, country } = options;
    const params = [testId, normalizeShopDomain(shopDomain), safeNames];
    const conditions = [
      'e.test_id = $1',
      'LOWER(TRIM(e.shop_domain)) = LOWER(TRIM($2))',
      buildCustomEventTypeCondition(safeNames),
      'e.event_name = ANY($3::text[])',
    ];
    const joinClause =
      'LEFT JOIN test_assignments ta ON ta.test_id = e.test_id AND ta.user_id = e.user_id AND LOWER(TRIM(ta.shop_domain)) = LOWER(TRIM(e.shop_domain)) AND ta.variant_id = e.variant_id';
    if (device) {
      conditions.push(`ta.device = $${params.length + 1}`);
      params.push(device);
    }
    if (country) {
      conditions.push(`ta.country = $${params.length + 1}`);
      params.push(country);
    }

    const statsSql = `
      SELECT
        e.event_name,
        e.variant_id,
        COUNT(*) as total_events,
        COUNT(DISTINCT e.user_id) as unique_users,
        COALESCE(SUM(e.event_value), 0) as sum,
        MIN(e.created_at) as first_seen,
        MAX(e.created_at) as last_seen
      FROM events e
      ${joinClause}
      WHERE ${conditions.join(' AND ')}
      GROUP BY e.event_name, e.variant_id
    `;
    const totalsSql = `
      SELECT
        e.event_name,
        COUNT(*) as total_events,
        COUNT(DISTINCT e.user_id) as unique_users,
        COALESCE(SUM(e.event_value), 0) as sum,
        MIN(e.created_at) as first_seen,
        MAX(e.created_at) as last_seen
      FROM events e
      ${joinClause}
      WHERE ${conditions.join(' AND ')}
      GROUP BY e.event_name
    `;
    const sourcesSql = `
      SELECT
        e.event_name,
        COALESCE(NULLIF(e.metadata->>'source', ''), 'unknown') as source,
        COALESCE(NULLIF(e.metadata->>'trigger_type', ''), 'manual') as trigger_type,
        COUNT(*) as count
      FROM events e
      ${joinClause}
      WHERE ${conditions.join(' AND ')}
      GROUP BY e.event_name, source, trigger_type
      ORDER BY count DESC
    `;
    const trendSql = `
      SELECT
        e.event_name,
        TO_CHAR(DATE_TRUNC('day', e.created_at), 'YYYY-MM-DD') as bucket,
        COUNT(*) as total_events,
        COUNT(DISTINCT e.user_id) as unique_users,
        COALESCE(SUM(e.event_value), 0) as sum
      FROM events e
      ${joinClause}
      WHERE ${conditions.join(' AND ')}
      GROUP BY e.event_name, bucket
      ORDER BY bucket ASC, e.event_name ASC
    `;

    try {
      const [statsResult, totalsResult, sourcesResult, trendResult] = await Promise.all([
        query(statsSql, params),
        query(totalsSql, params),
        query(sourcesSql, params),
        query(trendSql, params),
      ]);

      statsResult.rows.forEach(row => {
        const eventName = row.event_name;
        if (!result[eventName]) {
          return;
        }
        const variantId = row.variant_id || 'unknown';
        const variantStats = {
          totalEvents: parseInt(row.total_events, 10) || 0,
          uniqueUsers: parseInt(row.unique_users, 10) || 0,
          sum: parseFloat(row.sum) || 0,
          firstSeen: row.first_seen || null,
          lastSeen: row.last_seen || null,
        };
        result[eventName].byVariant[variantId] = variantStats;
      });

      totalsResult.rows.forEach(row => {
        const eventName = row.event_name;
        if (!result[eventName]) {
          return;
        }
        result[eventName].totalEvents = parseInt(row.total_events, 10) || 0;
        result[eventName].uniqueUsers = parseInt(row.unique_users, 10) || 0;
        result[eventName].sum = parseFloat(row.sum) || 0;
        result[eventName].firstSeen = row.first_seen || null;
        result[eventName].lastSeen = row.last_seen || null;
      });

      sourcesResult.rows.forEach(row => {
        const eventName = row.event_name;
        if (!result[eventName]) {
          return;
        }
        result[eventName].sources.push({
          source: row.source || 'unknown',
          triggerType: row.trigger_type || 'manual',
          count: parseInt(row.count, 10) || 0,
        });
      });

      trendResult.rows.forEach(row => {
        const eventName = row.event_name;
        if (!result[eventName]) {
          return;
        }
        result[eventName].trend.push({
          date: row.bucket,
          totalEvents: parseInt(row.total_events, 10) || 0,
          uniqueUsers: parseInt(row.unique_users, 10) || 0,
          sum: parseFloat(row.sum) || 0,
        });
      });
    } catch (err) {
      return result;
    }

    return result;
  }

  /**
   * Get checkout-specific event breakdowns from normalized metadata.
   *
   * @param {string} testId - Test ID
   * @param {string} shopDomain - Shop domain
   * @param {Object} options - Optional filters: { device, country, start_date, end_date }
   * @returns {Promise<Array>} Checkout event rows grouped by event, variant, section, and action metadata
   */
  async getCheckoutEventBreakdown(testId, shopDomain, options = {}) {
    const params = [testId, normalizeShopDomain(shopDomain)];
    const conditions = [
      'e.test_id = $1',
      'LOWER(TRIM(e.shop_domain)) = LOWER(TRIM($2))',
      buildCheckoutEventNamePrefixCondition('e'),
      "(e.event_type = 'custom' OR e.event_type = 'conversion')",
    ];
    const joinClause =
      'LEFT JOIN test_assignments ta ON ta.test_id = e.test_id AND ta.user_id = e.user_id AND LOWER(TRIM(ta.shop_domain)) = LOWER(TRIM(e.shop_domain)) AND ta.variant_id = e.variant_id';

    if (options.device) {
      conditions.push(`ta.device = $${params.length + 1}`);
      params.push(options.device);
    }
    if (options.country) {
      conditions.push(`ta.country = $${params.length + 1}`);
      params.push(options.country);
    }
    if (options.start_date) {
      conditions.push(`e.created_at >= $${params.length + 1}`);
      params.push(options.start_date);
    }
    if (options.end_date) {
      conditions.push(`e.created_at < $${params.length + 1}`);
      params.push(options.end_date);
    }

    const sql = `
      SELECT
        e.event_name,
        e.variant_id,
        COALESCE(NULLIF(e.metadata->>'checkout_phase', ''), 'experience') AS checkout_phase,
        NULLIF(e.metadata->>'checkout_section_id', '') AS checkout_section_id,
        NULLIF(e.metadata->>'checkout_section_type', '') AS checkout_section_type,
        NULLIF(e.metadata->>'diagnostic_reason', '') AS diagnostic_reason,
        NULLIF(e.metadata->>'checkout_customization_type', '') AS checkout_customization_type,
        NULLIF(e.metadata->>'checkout_method_action', '') AS checkout_method_action,
        NULLIF(e.metadata->>'checkout_product_id', '') AS checkout_product_id,
        NULLIF(e.metadata->>'checkout_merchandise_id', '') AS checkout_merchandise_id,
        NULLIF(e.metadata->>'checkout_product_source_mode', '') AS checkout_product_source_mode,
        NULLIF(e.metadata->>'checkout_product_strategy', '') AS checkout_product_strategy,
        NULLIF(e.metadata->>'checkout_product_action', '') AS checkout_product_action,
        NULLIF(e.metadata->>'checkout_product_failure_reason', '') AS checkout_product_failure_reason,
        NULLIF(e.metadata->>'checkout_product_analytics_key', '') AS checkout_product_analytics_key,
        NULLIF(e.metadata->>'checkout_product_rank', '') AS checkout_product_rank,
        COUNT(*)::integer AS total_events,
        COUNT(DISTINCT e.user_id)::integer AS unique_users,
        COALESCE(SUM(e.event_value), 0)::float AS sum,
        MIN(e.created_at) AS first_seen,
        MAX(e.created_at) AS last_seen
      FROM events e
      ${joinClause}
      WHERE ${conditions.join(' AND ')}
      GROUP BY
        e.event_name,
        e.variant_id,
        checkout_phase,
        checkout_section_id,
        checkout_section_type,
        diagnostic_reason,
        checkout_customization_type,
        checkout_method_action,
        checkout_product_id,
        checkout_merchandise_id,
        checkout_product_source_mode,
        checkout_product_strategy,
        checkout_product_action,
        checkout_product_failure_reason,
        checkout_product_analytics_key,
        checkout_product_rank
      ORDER BY total_events DESC, e.event_name ASC
    `;

    try {
      const result = await query(sql, params);
      return result.rows.map(row => ({
        eventName: row.event_name,
        variantId: row.variant_id,
        checkoutPhase: row.checkout_phase || 'experience',
        checkoutSectionId: row.checkout_section_id || null,
        checkoutSectionType: row.checkout_section_type || null,
        diagnosticReason: row.diagnostic_reason || null,
        checkoutCustomizationType: row.checkout_customization_type || null,
        checkoutMethodAction: row.checkout_method_action || null,
        checkoutProductId: row.checkout_product_id || null,
        checkoutMerchandiseId: row.checkout_merchandise_id || null,
        checkoutProductSourceMode: row.checkout_product_source_mode || null,
        checkoutProductStrategy: row.checkout_product_strategy || null,
        checkoutProductAction: row.checkout_product_action || null,
        checkoutProductFailureReason: row.checkout_product_failure_reason || null,
        checkoutProductAnalyticsKey: row.checkout_product_analytics_key || null,
        checkoutProductRank: parseInt(row.checkout_product_rank, 10) || null,
        totalEvents: parseInt(row.total_events, 10) || 0,
        uniqueUsers: parseInt(row.unique_users, 10) || 0,
        sum: parseFloat(row.sum) || 0,
        firstSeen: row.first_seen || null,
        lastSeen: row.last_seen || null,
      }));
    } catch (error) {
      logger.warn('Checkout event breakdown query failed', {
        testId,
        shopDomain: normalizeShopDomain(shopDomain),
        error: error?.message || String(error),
      });
      return [];
    }
  }

  /**
   * Get funnel metrics per variant (visitors → events → conversion)
   * Supports custom funnel_steps from test goal: [{ id, label, type, event_name? }]
   *
   * @param {string} testId - Test ID
   * @param {string} shopDomain - Shop domain
   * @param {Object} options - { device, country, start_date, end_date, funnel_steps? }
   * @returns {Promise<Object>} { steps, byVariant: { variant_id: { stepId: count } } }
   */
  async getFunnelMetrics(testId, shopDomain, options = {}) {
    const defaultSteps = [
      { id: 'visitors', label: 'Visitors', type: 'visitors' },
      { id: 'add_to_cart', label: 'Add to Cart', type: 'event', event_name: 'add_to_cart' },
      { id: 'conversion', label: 'Purchase', type: 'conversion' },
    ];
    const rawSteps =
      options.funnel_steps && Array.isArray(options.funnel_steps) && options.funnel_steps.length > 0
        ? options.funnel_steps
        : defaultSteps;
    const warnings = [];
    const steps = rawSteps
      .map((step, index) => ({
        ...step,
        id: String(step?.id || `step_${index + 1}`),
        label: step?.label || step?.name || step?.id || `Step ${index + 1}`,
        type: step?.type || (index === 0 ? 'visitors' : 'event'),
      }))
      .filter(step => {
        if (step.type === 'event' && !step.event_name) {
          warnings.push({
            code: 'missing_event_name',
            stepId: step.id,
            message: `${step.label} is missing an event key and cannot be counted.`,
          });
          return false;
        }
        if (!['visitors', 'event', 'conversion'].includes(step.type)) {
          warnings.push({
            code: 'unsupported_step_type',
            stepId: step.id,
            message: `${step.label} uses unsupported funnel step type "${step.type}".`,
          });
          return false;
        }
        return true;
      });

    const { device, country, start_date, end_date, conversionWindowDays, conversionUrl } = options;
    const normalizedShopDomain = normalizeShopDomain(shopDomain);
    const params = [testId, normalizedShopDomain];
    let paramIndex = 3;

    let visitorWhere = 'ta.test_id = $1 AND LOWER(TRIM(ta.shop_domain)) = LOWER(TRIM($2))';
    if (device) {
      visitorWhere += ` AND ta.device = $${paramIndex}`;
      params.push(device);
      paramIndex += 1;
    }
    if (country) {
      visitorWhere += ` AND ta.country = $${paramIndex}`;
      params.push(country);
      paramIndex += 1;
    }
    if (start_date) {
      visitorWhere += ` AND ta.assigned_at >= $${paramIndex}`;
      params.push(start_date);
      paramIndex += 1;
    }
    if (end_date) {
      visitorWhere += ` AND ta.assigned_at < $${paramIndex}`;
      params.push(end_date);
      paramIndex += 1;
    }

    const visitorsSql = `
      SELECT variant_id, variant_name, COUNT(DISTINCT user_id) as count
      FROM test_assignments ta
      WHERE ${visitorWhere}
      GROUP BY variant_id, variant_name
    `;

    const eventSteps = steps.filter(s => s.type === 'event' && s.event_name);
    const conversionStep = steps.find(s => s.type === 'conversion');
    const conversionStepId = conversionStep?.id || 'conversion';
    const requestedFunnelMode = ['ordered', 'sequence'].includes(
      String(options.funnel_mode || options.mode || '').toLowerCase()
    )
      ? 'ordered'
      : 'step_reach';
    const applyVisitorStepAliases = byVariantMap => {
      const visitorSteps = steps.filter(step => step.type === 'visitors');
      Object.keys(byVariantMap || {}).forEach(variantId => {
        const variant = byVariantMap[variantId];
        const visitorCount = Number(variant.visitors) || 0;
        visitorSteps.forEach(step => {
          variant[step.id] = visitorCount;
        });
      });
    };

    const buildOrderedFunnelParams = orderedSteps => {
      const p = [...params];
      orderedSteps.forEach(step => {
        if (step.type === 'event') {
          p.push(normalizeAnalyticsEventName(step.event_name));
        }
        if (start_date) {
          p.push(start_date);
        }
        if (end_date) {
          p.push(end_date);
        }
        if (step.type === 'conversion' && conversionWindowDays && conversionWindowDays > 0) {
          p.push(conversionWindowDays);
        }
        if (step.type === 'conversion' && conversionUrl && String(conversionUrl).trim()) {
          String(conversionUrl)
            .split(',')
            .map(pattern => pattern.trim())
            .filter(Boolean)
            .forEach(pattern => p.push(`%${pattern}%`));
        }
      });
      return p;
    };

    const buildOrderedFunnelSql = orderedSteps => {
      let idx = params.length + 1;
      const ctes = [
        `assigned AS (
          SELECT user_id, variant_id, assigned_at
          FROM test_assignments ta
          WHERE ${visitorWhere}
        )`,
      ];

      orderedSteps.forEach((step, stepIndex) => {
        const source = stepIndex === 0 ? 'assigned' : `step_${stepIndex}`;
        const timestampFloor = stepIndex === 0 ? 's.assigned_at' : 's.reached_at';
        const conditions = [
          'e.test_id = $1',
          'LOWER(TRIM(e.shop_domain)) = LOWER(TRIM($2))',
          'e.user_id = s.user_id',
          'e.variant_id = s.variant_id',
          `e.created_at >= ${timestampFloor}`,
        ];
        if (step.type === 'event') {
          conditions.push(
            buildCustomEventTypeCondition([normalizeAnalyticsEventName(step.event_name)])
          );
          conditions.push(`e.event_name = $${idx}`);
          idx += 1;
        } else {
          conditions.push("e.event_type = 'conversion'");
          conditions.push(buildPrimaryConversionCondition('e'));
        }
        if (start_date) {
          conditions.push(`e.created_at >= $${idx}`);
          idx += 1;
        }
        if (end_date) {
          conditions.push(`e.created_at < $${idx}`);
          idx += 1;
        }
        if (step.type === 'conversion' && conversionWindowDays && conversionWindowDays > 0) {
          conditions.push(`e.created_at <= s.assigned_at + ($${idx} || ' days')::interval`);
          idx += 1;
        }
        if (step.type === 'conversion' && conversionUrl && String(conversionUrl).trim()) {
          const urlConditions = String(conversionUrl)
            .split(',')
            .map(pattern => pattern.trim())
            .filter(Boolean)
            .map(() => {
              const condition = `(e.metadata->>'conversion_url')::text ILIKE $${idx}`;
              idx += 1;
              return condition;
            });
          if (urlConditions.length > 0) {
            conditions.push(`(${urlConditions.join(' OR ')})`);
          }
        }

        ctes.push(`step_${stepIndex + 1} AS (
          SELECT s.user_id, s.variant_id, s.assigned_at, MIN(e.created_at) AS reached_at
          FROM ${source} s
          JOIN events e ON ${conditions.join(' AND ')}
          GROUP BY s.user_id, s.variant_id, s.assigned_at
        )`);
      });

      const unions = orderedSteps.map((step, stepIndex) => {
        const escapedStepId = String(step.id).replace(/'/g, "''");
        return `SELECT '${escapedStepId}' AS step_id, variant_id, COUNT(DISTINCT user_id) AS count FROM step_${
          stepIndex + 1
        } GROUP BY variant_id`;
      });

      return `WITH ${ctes.join(', ')} ${unions.join(' UNION ALL ')}`;
    };

    if (requestedFunnelMode === 'ordered') {
      const orderedSteps = steps.filter(s => s.type === 'event' || s.type === 'conversion');
      const orderedResults = await Promise.all([
        query(visitorsSql, params),
        orderedSteps.length > 0
          ? query(buildOrderedFunnelSql(orderedSteps), buildOrderedFunnelParams(orderedSteps))
          : Promise.resolve({ rows: [] }),
      ]);
      const byVariant = {};
      const variantNames = {};
      orderedResults[0].rows.forEach(row => {
        byVariant[row.variant_id] = { visitors: parseInt(row.count, 10) || 0 };
        variantNames[row.variant_id] = row.variant_name;
      });
      applyVisitorStepAliases(byVariant);
      orderedResults[1].rows.forEach(row => {
        if (byVariant[row.variant_id]) {
          byVariant[row.variant_id][row.step_id] = parseInt(row.count, 10) || 0;
        }
      });
      Object.keys(byVariant).forEach(vid => {
        const v = byVariant[vid];
        steps.forEach(s => {
          if (s.type !== 'visitors' && v[s.id] === undefined) {
            v[s.id] = 0;
          }
        });
      });

      const semantics = {
        counting: 'distinct_users_reaching_each_step_in_order',
        ordered: true,
        visitorDate: 'test_assignments.assigned_at',
        eventDate: 'events.created_at',
      };
      return {
        steps,
        byVariant,
        transitionsByVariant: buildFunnelTransitions(steps, byVariant, semantics),
        variantNames,
        warnings,
        mode: 'ordered_sequence',
        stepLatency: {
          available: false,
          reason:
            'Latency diagnostics require persisted per-user step timestamps; ordered counts are active.',
        },
        semantics,
      };
    }

    const queries = [{ key: 'visitors', sql: visitorsSql, params }];
    eventSteps.forEach(step => {
      const p = [testId, normalizedShopDomain, normalizeAnalyticsEventName(step.event_name)];
      const cond = [
        'e.test_id = $1',
        'LOWER(TRIM(e.shop_domain)) = LOWER(TRIM($2))',
        buildCustomEventTypeCondition([normalizeAnalyticsEventName(step.event_name)]),
        'e.event_name = $3',
      ];
      if (device) {
        cond.push(`ta.device = $${p.length + 1}`);
        p.push(device);
      }
      if (country) {
        cond.push(`ta.country = $${p.length + 1}`);
        p.push(country);
      }
      if (start_date) {
        cond.push(`ta.assigned_at >= $${p.length + 1}`);
        cond.push(`e.created_at >= $${p.length + 1}`);
        p.push(start_date);
      }
      if (end_date) {
        cond.push(`ta.assigned_at < $${p.length + 1}`);
        cond.push(`e.created_at < $${p.length + 1}`);
        p.push(end_date);
      }
      queries.push({
        key: step.id,
        sql: `SELECT e.variant_id, COUNT(DISTINCT e.user_id) as count FROM events e
          JOIN test_assignments ta ON ta.test_id = e.test_id AND ta.user_id = e.user_id AND LOWER(TRIM(ta.shop_domain)) = LOWER(TRIM(e.shop_domain)) AND ta.variant_id = e.variant_id
          WHERE ${cond.join(' AND ')} GROUP BY e.variant_id`,
        params: p,
      });
    });
    if (conversionStep) {
      const p = [testId, normalizedShopDomain];
      const cond = [
        'e.test_id = $1',
        'LOWER(TRIM(e.shop_domain)) = LOWER(TRIM($2))',
        "e.event_type = 'conversion'",
        buildPrimaryConversionCondition('e'),
      ];
      if (device) {
        cond.push(`ta.device = $${p.length + 1}`);
        p.push(device);
      }
      if (country) {
        cond.push(`ta.country = $${p.length + 1}`);
        p.push(country);
      }
      if (start_date) {
        cond.push(`ta.assigned_at >= $${p.length + 1}`);
        cond.push(`e.created_at >= $${p.length + 1}`);
        p.push(start_date);
      }
      if (end_date) {
        cond.push(`ta.assigned_at < $${p.length + 1}`);
        cond.push(`e.created_at < $${p.length + 1}`);
        p.push(end_date);
      }
      if (conversionWindowDays && conversionWindowDays > 0) {
        cond.push(
          `e.created_at >= ta.assigned_at AND e.created_at <= ta.assigned_at + ($${p.length + 1} || ' days')::interval`
        );
        p.push(conversionWindowDays);
      }
      if (conversionUrl && String(conversionUrl).trim()) {
        const patterns = String(conversionUrl)
          .split(',')
          .map(pattern => pattern.trim())
          .filter(Boolean);
        if (patterns.length > 0) {
          const urlConditions = patterns.map(pattern => {
            p.push(`%${pattern}%`);
            return `(e.metadata->>'conversion_url')::text ILIKE $${p.length}`;
          });
          cond.push(`(${urlConditions.join(' OR ')})`);
        }
      }
      queries.push({
        key: conversionStepId,
        sql: `SELECT e.variant_id, COUNT(DISTINCT e.user_id) as count FROM events e
          JOIN test_assignments ta ON ta.test_id = e.test_id AND ta.user_id = e.user_id AND LOWER(TRIM(ta.shop_domain)) = LOWER(TRIM(e.shop_domain)) AND ta.variant_id = e.variant_id
          WHERE ${cond.join(' AND ')} GROUP BY e.variant_id`,
        params: p,
      });
    }

    const results = await Promise.all(queries.map(q => query(q.sql, q.params)));

    const byVariant = {};
    const variantNames = {};
    results[0].rows.forEach(row => {
      byVariant[row.variant_id] = { visitors: parseInt(row.count, 10) || 0 };
      variantNames[row.variant_id] = row.variant_name;
    });
    applyVisitorStepAliases(byVariant);
    for (let i = 1; i < results.length; i++) {
      const key = queries[i].key;
      results[i].rows.forEach(row => {
        if (byVariant[row.variant_id]) {
          byVariant[row.variant_id][key] = parseInt(row.count, 10) || 0;
        }
      });
    }
    Object.keys(byVariant).forEach(vid => {
      const v = byVariant[vid];
      steps.forEach(s => {
        if (s.type === 'visitors') {
          return;
        }
        const k = s.id;
        if (v[k] === undefined) {
          v[k] = 0;
        }
      });
    });

    const semantics = {
      counting: 'distinct_users_per_step',
      ordered: false,
      visitorDate: 'test_assignments.assigned_at',
      eventDate: 'events.created_at',
    };
    return {
      steps,
      byVariant,
      transitionsByVariant: buildFunnelTransitions(steps, byVariant, semantics),
      variantNames,
      warnings,
      mode: 'step_reach',
      stepLatency: {
        available: false,
        reason: 'Latency diagnostics are only meaningful for ordered funnel paths.',
      },
      semantics,
    };
  }

  /**
   * List events for a test with pagination and filters
   *
   * @param {string} testId - Test ID
   * @param {string} shopDomain - Shop domain
   * @param {Object} options - { limit, offset, event_type, event_name, variant_id, start_date, end_date }
   * @returns {Promise<{ events: Array, total: number }>}
   */
  async getEventsList(testId, shopDomain, options = {}) {
    const {
      limit = 50,
      offset = 0,
      event_type,
      event_name,
      variant_id,
      start_date,
      end_date,
      device,
      country,
    } = options;
    const conditions = ['e.test_id = $1', 'LOWER(TRIM(e.shop_domain)) = LOWER(TRIM($2))'];
    const params = [testId, normalizeShopDomain(shopDomain)];
    let idx = 3;
    let joinClause = '';
    if (device || country) {
      joinClause =
        'JOIN test_assignments ta ON ta.test_id = e.test_id AND ta.user_id = e.user_id AND LOWER(TRIM(ta.shop_domain)) = LOWER(TRIM(e.shop_domain)) AND ta.variant_id = e.variant_id';
      if (device) {
        conditions.push(`ta.device = $${idx}`);
        params.push(device);
        idx += 1;
      }
      if (country) {
        conditions.push(`ta.country = $${idx}`);
        params.push(country);
        idx += 1;
      }
    }
    if (event_type) {
      conditions.push(`e.event_type = $${idx}`);
      params.push(event_type);
      idx += 1;
    }
    if (event_name) {
      conditions.push(`e.event_name = $${idx}`);
      params.push(normalizeAnalyticsEventName(event_name));
      idx += 1;
    }
    if (variant_id) {
      conditions.push(`e.variant_id = $${idx}`);
      params.push(variant_id);
      idx += 1;
    }
    if (start_date) {
      conditions.push(`e.created_at >= $${idx}`);
      params.push(start_date);
      idx += 1;
    }
    if (end_date) {
      conditions.push(`e.created_at < $${idx}`);
      params.push(end_date);
      idx += 1;
    }

    const countExpression = joinClause ? 'COUNT(DISTINCT e.id)' : 'COUNT(*)';
    const listDistinct = joinClause ? 'DISTINCT' : '';
    const countSql = `
      SELECT ${countExpression} as total FROM events e
      ${joinClause}
      WHERE ${conditions.join(' AND ')}
    `;
    const listSql = `
      SELECT ${listDistinct} e.id, e.test_id, e.variant_id, e.user_id, e.event_type, e.event_name,
             e.event_value, e.metadata, e.created_at
      FROM events e
      ${joinClause}
      WHERE ${conditions.join(' AND ')}
      ORDER BY e.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
    params.push(limit, offset);

    const [countResult, listResult] = await Promise.all([
      query(countSql, params.slice(0, -2)),
      query(listSql, params),
    ]);
    const total = parseInt(countResult.rows[0]?.total || 0, 10);
    const events = listResult.rows.map(row => ({
      id: row.id,
      test_id: row.test_id,
      variant_id: row.variant_id,
      user_id: row.user_id,
      event_type: row.event_type,
      event_name: row.event_name,
      event_value: parseFloat(row.event_value) || 0,
      metadata: row.metadata,
      created_at: row.created_at,
    }));
    return { events, total };
  }

  /**
   * Get distinct event types and names for a test (for filters)
   */
  async getEventTypesForTest(testId, shopDomain, options = {}) {
    const { start_date, end_date, device, country, variant_id } = options;
    const conditions = ['e.test_id = $1', 'LOWER(TRIM(e.shop_domain)) = LOWER(TRIM($2))'];
    const params = [testId, normalizeShopDomain(shopDomain)];
    let idx = 3;
    let joinClause = '';
    if (device || country) {
      joinClause =
        'JOIN test_assignments ta ON ta.test_id = e.test_id AND ta.user_id = e.user_id AND LOWER(TRIM(ta.shop_domain)) = LOWER(TRIM(e.shop_domain)) AND ta.variant_id = e.variant_id';
      if (device) {
        conditions.push(`ta.device = $${idx}`);
        params.push(device);
        idx += 1;
      }
      if (country) {
        conditions.push(`ta.country = $${idx}`);
        params.push(country);
        idx += 1;
      }
    }
    if (variant_id) {
      conditions.push(`e.variant_id = $${idx}`);
      params.push(variant_id);
      idx += 1;
    }
    if (start_date) {
      conditions.push(`e.created_at >= $${idx}`);
      params.push(start_date);
      idx += 1;
    }
    if (end_date) {
      conditions.push(`e.created_at < $${idx}`);
      params.push(end_date);
    }

    const sql = `
      SELECT DISTINCT e.event_type, e.event_name
      FROM events e
      ${joinClause}
      WHERE ${conditions.join(' AND ')}
      ORDER BY event_type, event_name NULLS LAST
    `;
    const result = await query(sql, params);
    const types = [...new Set(result.rows.map(r => r.event_type).filter(Boolean))];
    const names = [...new Set(result.rows.map(r => r.event_name).filter(Boolean))];
    return { types, names };
  }

  async getAssignmentCohorts(testId, shopDomain, options = {}) {
    const granularity = options.granularity === 'day' ? 'day' : 'week';
    const params = [testId, normalizeShopDomain(shopDomain)];
    const assignmentWhere = [
      'ta.test_id = $1',
      'LOWER(TRIM(ta.shop_domain)) = LOWER(TRIM($2))',
      'ta.assigned_at IS NOT NULL',
    ];
    const conversionWhere = [
      'e.test_id = $1',
      'LOWER(TRIM(e.shop_domain)) = LOWER(TRIM($2))',
      "e.event_type = 'conversion'",
      buildPrimaryConversionCondition('e'),
    ];
    if (options.device) {
      params.push(options.device);
      assignmentWhere.push(`ta.device = $${params.length}`);
      conversionWhere.push(`ta.device = $${params.length}`);
    }
    if (options.country) {
      params.push(options.country);
      assignmentWhere.push(`ta.country = $${params.length}`);
      conversionWhere.push(`ta.country = $${params.length}`);
    }
    if (options.start_date) {
      params.push(options.start_date);
      assignmentWhere.push(`ta.assigned_at >= $${params.length}`);
      conversionWhere.push(`e.created_at >= $${params.length}`);
    }
    if (options.end_date) {
      params.push(options.end_date);
      assignmentWhere.push(`ta.assigned_at < $${params.length}`);
      conversionWhere.push(`e.created_at < $${params.length}`);
    }

    const sql = `
      WITH assignment_cohorts AS (
        SELECT
          date_trunc('${granularity}', ta.assigned_at AT TIME ZONE 'UTC')::date AS cohort_period,
          ta.variant_id,
          MAX(ta.variant_name) AS variant_name,
          COUNT(DISTINCT ta.user_id)::integer AS visitors
        FROM test_assignments ta
        WHERE ${assignmentWhere.join(' AND ')}
        GROUP BY date_trunc('${granularity}', ta.assigned_at AT TIME ZONE 'UTC')::date, ta.variant_id
      ),
      conversion_cohorts AS (
        SELECT
          date_trunc('${granularity}', ta.assigned_at AT TIME ZONE 'UTC')::date AS cohort_period,
          e.variant_id,
          COUNT(DISTINCT e.user_id)::integer AS conversions,
          COALESCE(SUM(e.event_value), 0)::float AS revenue
        FROM events e
        INNER JOIN test_assignments ta
          ON ta.test_id = e.test_id
          AND ta.user_id = e.user_id
          AND LOWER(TRIM(ta.shop_domain)) = LOWER(TRIM(e.shop_domain))
          AND ta.variant_id = e.variant_id
        WHERE ${conversionWhere.join(' AND ')}
        GROUP BY date_trunc('${granularity}', ta.assigned_at AT TIME ZONE 'UTC')::date, e.variant_id
      )
      SELECT
        ac.cohort_period,
        ac.variant_id,
        ac.variant_name,
        ac.visitors,
        COALESCE(cc.conversions, 0)::integer AS conversions,
        COALESCE(cc.revenue, 0)::float AS revenue
      FROM assignment_cohorts ac
      LEFT JOIN conversion_cohorts cc
        ON cc.cohort_period = ac.cohort_period
        AND cc.variant_id = ac.variant_id
      ORDER BY ac.cohort_period ASC, ac.variant_name ASC
    `;

    const result = await query(sql, params);
    return result.rows.map(row => {
      const visitors = parseInt(row.visitors, 10) || 0;
      const conversions = parseInt(row.conversions, 10) || 0;
      const revenue = parseFloat(row.revenue) || 0;
      const period =
        row.cohort_period instanceof Date
          ? row.cohort_period.toISOString().split('T')[0]
          : String(row.cohort_period).split('T')[0];
      return {
        cohortPeriod: period,
        variantId: row.variant_id,
        variantName: row.variant_name || row.variant_id,
        visitors,
        conversions,
        revenue,
        conversionRate: visitors > 0 ? (conversions / visitors) * 100 : 0,
        revenuePerVisitor: visitors > 0 ? revenue / visitors : 0,
      };
    });
  }

  /**
   * Batch get variant metrics for multiple tests (visitors, conversions, revenue)
   * Used by dashboard to enrich tests list in a single query pair
   *
   * @param {string[]} testIds - Test IDs
   * @param {string} shopDomain - Shop domain (normalized)
   * @returns {Promise<Map<string, Array>>} Map of testId -> [{ variant_id, variant_name, visitors, conversions, revenue }]
   */
  async getBatchVariantMetrics(testIds, shopDomain) {
    if (!testIds || testIds.length === 0) {
      return new Map();
    }
    const domain = (shopDomain || '').toString().toLowerCase().trim();
    const placeholders = testIds.map((_, i) => `$${i + 2}`).join(', ');
    const params = [domain, ...testIds];

    const visitorsSql = `
      SELECT ta.test_id, ta.variant_id, ta.variant_name,
        COUNT(DISTINCT ta.user_id)::int as visitors
      FROM test_assignments ta
      WHERE LOWER(TRIM(ta.shop_domain)) = LOWER(TRIM($1))
        AND ta.test_id IN (${placeholders})
      GROUP BY ta.test_id, ta.variant_id, ta.variant_name
    `;
    const conversionsSql = `
      SELECT e.test_id, e.variant_id,
        COUNT(DISTINCT e.user_id)::int as conversions,
        COALESCE(SUM(e.event_value), 0)::float as revenue
      FROM events e
      INNER JOIN test_assignments ta
        ON ta.test_id = e.test_id AND ta.user_id = e.user_id
        AND LOWER(TRIM(ta.shop_domain)) = LOWER(TRIM(e.shop_domain))
        AND ta.variant_id = e.variant_id
      WHERE LOWER(TRIM(e.shop_domain)) = LOWER(TRIM($1))
        AND e.test_id IN (${placeholders})
        AND e.event_type = 'conversion'
        AND ${buildPrimaryConversionCondition('e')}
      GROUP BY e.test_id, e.variant_id
    `;

    const [visitorsResult, conversionsResult] = await Promise.all([
      query(visitorsSql, params),
      query(conversionsSql, params),
    ]);

    const byTest = new Map();
    visitorsResult.rows.forEach(row => {
      const tid = row.test_id;
      if (!byTest.has(tid)) {
        byTest.set(tid, new Map());
      }
      const vMap = byTest.get(tid);
      const vid =
        row.variant_id !== null && row.variant_id !== undefined ? String(row.variant_id) : null;
      const vname =
        row.variant_name !== null && row.variant_name !== undefined
          ? String(row.variant_name)
          : null;
      const entry = {
        variant_id: vid,
        variant_name: vname,
        visitors: parseInt(row.visitors, 10) || 0,
        conversions: 0,
        revenue: 0,
      };
      vMap.set(vid, entry);
      if (vname && vid !== vname) {
        vMap.set(vname, entry);
      }
    });
    conversionsResult.rows.forEach(row => {
      const tid = row.test_id;
      const vMap = byTest.get(tid);
      if (!vMap) {
        return;
      }
      const vid =
        row.variant_id !== null && row.variant_id !== undefined ? String(row.variant_id) : null;
      const entry = vMap.get(vid);
      if (entry) {
        entry.conversions = parseInt(row.conversions, 10) || 0;
        entry.revenue = parseFloat(row.revenue) || 0;
      }
    });

    const result = new Map();
    byTest.forEach((vMap, tid) => {
      const seen = new Set();
      const arr = [];
      vMap.forEach(v => {
        const key = v.variant_id ?? v.variant_name ?? '';
        if (key && !seen.has(key)) {
          seen.add(key);
          arr.push(v);
        }
      });
      result.set(tid, arr);
    });
    return result;
  }
}

const model = new AnalyticsModel();

module.exports = {
  trackEvent: data => model.trackEvent(data),
  getTestAnalytics: (testId, shop, opts) => model.getTestAnalytics(testId, shop, opts),
  getBatchVariantMetrics: (testIds, shop) => model.getBatchVariantMetrics(testIds, shop),
  getSegmentBreakdownOptions: (testId, shop) => model.getSegmentBreakdownOptions(testId, shop),
  getEventCount: (testId, shop, type) => model.getEventCount(testId, shop, type),
  getSecondaryEventMetrics: (testId, shop, names, opts) =>
    model.getSecondaryEventMetrics(testId, shop, names, opts),
  getEventCollectionStats: (testId, shop, names, opts) =>
    model.getEventCollectionStats(testId, shop, names, opts),
  getCheckoutEventBreakdown: (testId, shop, opts) =>
    model.getCheckoutEventBreakdown(testId, shop, opts),
  getFunnelMetrics: (testId, shop, opts) => model.getFunnelMetrics(testId, shop, opts),
  getEventsList: (testId, shop, opts) => model.getEventsList(testId, shop, opts),
  getEventTypesForTest: (testId, shop, opts) => model.getEventTypesForTest(testId, shop, opts),
  getAssignmentCohorts: (testId, shop, opts) => model.getAssignmentCohorts(testId, shop, opts),
};
