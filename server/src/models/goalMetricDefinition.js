const { query } = require('../utils/database');

const BUILT_IN_DEFINITIONS = [
  {
    id: 'builtin-add-to-cart',
    name: 'Add to cart',
    event_name: 'add_to_cart',
    description: 'Visitor adds a product to cart. Strong early signal for product and price tests.',
    category: 'commerce',
    aggregation: 'count',
    direction: 'increase',
    metric_role: 'secondary',
    trigger_type: 'custom_event',
    trigger_config: { method: 'RipX.trackEvent', value: 'optional cart value' },
    tags: ['commerce', 'cart'],
    builtin: true,
  },
  {
    id: 'builtin-page-view',
    name: 'Page view',
    event_name: 'page_view',
    description:
      'Visitor lands on any storefront page. Useful as a baseline exposure or awareness metric.',
    category: 'engagement',
    aggregation: 'count',
    direction: 'increase',
    metric_role: 'secondary',
    trigger_type: 'url_match',
    trigger_config: { url_pattern: '*' },
    tags: ['page', 'engagement'],
    builtin: true,
  },
  {
    id: 'builtin-product-page-view',
    name: 'Product page view',
    event_name: 'product_page_view',
    description: 'Visitor views a product detail page during an experiment.',
    category: 'commerce',
    aggregation: 'count',
    direction: 'increase',
    metric_role: 'secondary',
    trigger_type: 'url_match',
    trigger_config: { url_pattern: '*/products/*' },
    tags: ['commerce', 'product', 'page'],
    builtin: true,
  },
  {
    id: 'builtin-collection-page-view',
    name: 'Collection page view',
    event_name: 'collection_page_view',
    description: 'Visitor views a collection or listing page.',
    category: 'commerce',
    aggregation: 'count',
    direction: 'increase',
    metric_role: 'secondary',
    trigger_type: 'url_match',
    trigger_config: { url_pattern: '*/collections/*' },
    tags: ['commerce', 'collection', 'page'],
    builtin: true,
  },
  {
    id: 'builtin-link-click',
    name: 'Link click',
    event_name: 'link_click',
    description:
      'Visitor clicks a normal storefront link. Useful for navigation and content tests.',
    category: 'engagement',
    aggregation: 'count',
    direction: 'increase',
    metric_role: 'secondary',
    trigger_type: 'css_click',
    trigger_config: {
      selector: 'a[href]:not([href^="#"]):not([href^="javascript:"])',
      parameter_name: 'element_id',
    },
    tags: ['click', 'navigation', 'engagement'],
    builtin: true,
  },
  {
    id: 'builtin-outbound-link-click',
    name: 'Outbound link click',
    event_name: 'outbound_link_click',
    description: 'Visitor clicks a link that leaves the storefront domain.',
    category: 'engagement',
    aggregation: 'count',
    direction: 'increase',
    metric_role: 'secondary',
    trigger_type: 'css_click',
    trigger_config: {
      selector: 'a[href]',
      link_kind: 'outbound',
      parameter_name: 'element_id',
    },
    tags: ['click', 'outbound', 'engagement'],
    builtin: true,
  },
  {
    id: 'builtin-file-download',
    name: 'File download',
    event_name: 'file_download',
    description:
      'Visitor clicks a link to download a PDF, document, spreadsheet, archive, or media file.',
    category: 'engagement',
    aggregation: 'count',
    direction: 'increase',
    metric_role: 'secondary',
    trigger_type: 'css_click',
    trigger_config: {
      selector: 'a[href]',
      link_kind: 'file_download',
      parameter_name: 'element_id',
    },
    tags: ['download', 'file', 'engagement'],
    builtin: true,
  },
  {
    id: 'builtin-cta-click',
    name: 'CTA click',
    event_name: 'cta_click',
    description: 'Visitor clicks a button, tracked CTA, or primary action element.',
    category: 'engagement',
    aggregation: 'count',
    direction: 'increase',
    metric_role: 'secondary',
    trigger_type: 'css_click',
    trigger_config: {
      selector: 'a.button, button, [role="button"], [data-ripx-track], [data-ripx-cta]',
      parameter_name: 'element_id',
    },
    tags: ['click', 'cta', 'engagement'],
    builtin: true,
  },
  {
    id: 'builtin-scroll-depth-50',
    name: 'Scroll depth 50%',
    event_name: 'scroll_depth_50',
    description:
      'Visitor scrolls at least halfway down the page. Good for measuring content engagement.',
    category: 'engagement',
    aggregation: 'count',
    direction: 'increase',
    metric_role: 'secondary',
    trigger_type: 'custom_javascript',
    trigger_config: {
      custom_javascript:
        'try {\n  const doc = document.documentElement;\n  const pageHeight = Math.max(doc.scrollHeight, document.body.scrollHeight || 0);\n  const viewport = window.innerHeight || doc.clientHeight || 0;\n  const scrollTop = window.scrollY || doc.scrollTop || 0;\n  const scrollable = Math.max(pageHeight - viewport, 1);\n  const percent = Math.round((scrollTop / scrollable) * 100);\n  return percent >= 50 ? { value: percent, metadata: { scroll_percent: percent } } : false;\n} catch (error) {\n  return false;\n}',
      custom_javascript_interval_ms: 750,
      custom_javascript_max_wait_ms: 120000,
      parameter_name: 'scroll_percent',
    },
    tags: ['scroll', 'engagement'],
    builtin: true,
  },
  {
    id: 'builtin-scroll-depth-90',
    name: 'Scroll depth 90%',
    event_name: 'scroll_depth_90',
    description:
      'Visitor reaches near the bottom of the page. Useful for long-form or landing page tests.',
    category: 'engagement',
    aggregation: 'count',
    direction: 'increase',
    metric_role: 'secondary',
    trigger_type: 'custom_javascript',
    trigger_config: {
      custom_javascript:
        'try {\n  const doc = document.documentElement;\n  const pageHeight = Math.max(doc.scrollHeight, document.body.scrollHeight || 0);\n  const viewport = window.innerHeight || doc.clientHeight || 0;\n  const scrollTop = window.scrollY || doc.scrollTop || 0;\n  const scrollable = Math.max(pageHeight - viewport, 1);\n  const percent = Math.round((scrollTop / scrollable) * 100);\n  return percent >= 90 ? { value: percent, metadata: { scroll_percent: percent } } : false;\n} catch (error) {\n  return false;\n}',
      custom_javascript_interval_ms: 750,
      custom_javascript_max_wait_ms: 120000,
      parameter_name: 'scroll_percent',
    },
    tags: ['scroll', 'engagement'],
    builtin: true,
  },
  {
    id: 'builtin-view-search-results',
    name: 'View search results',
    event_name: 'view_search_results',
    description: 'Visitor lands on a search results page with a query parameter.',
    category: 'engagement',
    aggregation: 'count',
    direction: 'increase',
    metric_role: 'secondary',
    trigger_type: 'custom_javascript',
    trigger_config: {
      custom_javascript:
        "try {\n  const params = new URLSearchParams(context.query || window.location.search);\n  const keys = ['q', 's', 'search', 'query', 'keyword'];\n  const key = keys.find(name => params.get(name));\n  return key ? { value: 1, metadata: { search_term: params.get(key), search_parameter: key } } : false;\n} catch (error) {\n  return false;\n}",
      custom_javascript_interval_ms: 750,
      custom_javascript_max_wait_ms: 10000,
      parameter_name: 'search_term',
    },
    tags: ['search', 'engagement'],
    builtin: true,
  },
  {
    id: 'builtin-search-submit',
    name: 'Search submit',
    event_name: 'search_submit',
    description: 'Visitor submits a storefront search form.',
    category: 'engagement',
    aggregation: 'count',
    direction: 'increase',
    metric_role: 'secondary',
    trigger_type: 'form_submit',
    trigger_config: {
      selector: 'form[action*="search"], form[role="search"], form.search, form[action="/search"]',
    },
    tags: ['search', 'form', 'engagement'],
    builtin: true,
  },
  {
    id: 'builtin-view-cart',
    name: 'View cart',
    event_name: 'view_cart',
    description: 'Visitor views the cart page or drawer route before checkout.',
    category: 'commerce',
    aggregation: 'count',
    direction: 'increase',
    metric_role: 'secondary',
    trigger_type: 'url_match',
    trigger_config: { url_pattern: '*/cart*' },
    tags: ['commerce', 'cart', 'funnel'],
    builtin: true,
  },
  {
    id: 'builtin-view-item',
    name: 'View item',
    event_name: 'view_item',
    description: 'Visitor views a product detail page using the GA4 ecommerce event name.',
    category: 'commerce',
    aggregation: 'count',
    direction: 'increase',
    metric_role: 'secondary',
    trigger_type: 'url_match',
    trigger_config: { url_pattern: '*/products/*' },
    tags: ['commerce', 'product', 'ga4'],
    builtin: true,
  },
  {
    id: 'builtin-select-item',
    name: 'Select item',
    event_name: 'select_item',
    description: 'Visitor clicks a product card, product link, or item tile in a list.',
    category: 'commerce',
    aggregation: 'count',
    direction: 'increase',
    metric_role: 'secondary',
    trigger_type: 'css_click',
    trigger_config: {
      selector:
        'a[href*="/products/"], [data-product-id], [data-product-handle], .product-card a, .card__heading a',
      parameter_name: 'element_id',
    },
    tags: ['commerce', 'product', 'click', 'ga4'],
    builtin: true,
  },
  {
    id: 'builtin-view-promotion',
    name: 'View promotion',
    event_name: 'view_promotion',
    description: 'Visitor sees a promotional banner, offer block, or campaign module.',
    category: 'commerce',
    aggregation: 'count',
    direction: 'increase',
    metric_role: 'secondary',
    trigger_type: 'element_visibility',
    trigger_config: {
      selector:
        '[data-ripx-promotion], [data-promo-id], .announcement-bar, .promo-banner, .hero-banner',
      visibility_threshold: 50,
      visibility_min_duration_ms: 1000,
      visibility_frequency: 'once_per_element',
      observe_dom_changes: true,
    },
    tags: ['commerce', 'promotion', 'visibility', 'ga4'],
    builtin: true,
  },
  {
    id: 'builtin-select-promotion',
    name: 'Select promotion',
    event_name: 'select_promotion',
    description: 'Visitor clicks a promotional banner, offer block, or campaign CTA.',
    category: 'commerce',
    aggregation: 'count',
    direction: 'increase',
    metric_role: 'secondary',
    trigger_type: 'css_click',
    trigger_config: {
      selector:
        '[data-ripx-promotion] a, [data-promo-id] a, .announcement-bar a, .promo-banner a, .hero-banner a',
      parameter_name: 'element_id',
    },
    tags: ['commerce', 'promotion', 'click', 'ga4'],
    builtin: true,
  },
  {
    id: 'builtin-begin-checkout',
    name: 'Begin checkout',
    event_name: 'begin_checkout',
    description: 'Visitor clicks checkout from cart, drawer, or checkout call-to-action.',
    category: 'checkout',
    aggregation: 'count',
    direction: 'increase',
    metric_role: 'secondary',
    trigger_type: 'css_click',
    trigger_config: {
      selector:
        'a[href*="/checkout"], button[name="checkout"], [data-checkout-button], [data-ripx-checkout]',
      parameter_name: 'element_id',
    },
    tags: ['checkout', 'funnel', 'ga4'],
    builtin: true,
  },
  {
    id: 'builtin-checkout-start',
    name: 'Checkout started',
    event_name: 'checkout_start',
    description: 'Visitor begins checkout after cart evaluation.',
    category: 'checkout',
    aggregation: 'count',
    direction: 'increase',
    metric_role: 'secondary',
    trigger_type: 'custom_event',
    trigger_config: { method: 'RipX.trackEvent' },
    tags: ['checkout', 'funnel'],
    builtin: true,
  },
  {
    id: 'builtin-form-start',
    name: 'Form start',
    event_name: 'form_start',
    description:
      'Visitor begins interacting with a form before submit. Useful for form friction tests.',
    category: 'engagement',
    aggregation: 'count',
    direction: 'increase',
    metric_role: 'secondary',
    trigger_type: 'form_start',
    trigger_config: { selector: 'form' },
    tags: ['form', 'engagement', 'ga4'],
    builtin: true,
  },
  {
    id: 'builtin-newsletter-signup',
    name: 'Newsletter signup',
    event_name: 'newsletter_signup',
    description: 'Visitor submits an email signup or lead capture form.',
    category: 'lead',
    aggregation: 'count',
    direction: 'increase',
    metric_role: 'secondary',
    trigger_type: 'form_submit',
    trigger_config: {
      selector:
        'form[action*="contact"], form[action*="newsletter"], form.newsletter, form.contact-form',
    },
    tags: ['lead', 'crm'],
    builtin: true,
  },
  {
    id: 'builtin-form-submit',
    name: 'Form submit',
    event_name: 'form_submit',
    description: 'Visitor completes a form that matters to the experiment.',
    category: 'engagement',
    aggregation: 'count',
    direction: 'increase',
    metric_role: 'secondary',
    trigger_type: 'form_submit',
    trigger_config: { selector: 'form' },
    tags: ['form', 'engagement'],
    builtin: true,
  },
  {
    id: 'builtin-support-click',
    name: 'Support click',
    event_name: 'support_click',
    description: 'Visitor clicks support, chat, or contact help. Useful as a guardrail.',
    category: 'guardrail',
    aggregation: 'count',
    direction: 'decrease',
    metric_role: 'guardrail',
    trigger_type: 'custom_event',
    trigger_config: { method: 'RipX.trackEvent' },
    tags: ['support', 'friction'],
    builtin: true,
  },
];

function parseJson(value, fallback) {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (_) {
      return fallback;
    }
  }
  return value;
}

function mapRow(row) {
  return {
    ...row,
    trigger_config: parseJson(row.trigger_config, {}),
    tags: parseJson(row.tags, []),
    builtin: Boolean(row.builtin),
  };
}

function normalizeObservedEventNames(eventNames = []) {
  return Array.from(
    new Set(
      (Array.isArray(eventNames) ? eventNames : []).map(name => String(name).trim()).filter(Boolean)
    )
  );
}

function mapObservedRows(rows = []) {
  return new Map(
    rows.map(row => [
      row.event_name,
      {
        observed_count: Number(row.count || 0),
        last_seen_at: row.last_seen_at || null,
        test_breakdown: parseJson(row.test_breakdown, []),
      },
    ])
  );
}

/** RipsPriceX: shop_domain scoped events only (no tenants / rollup tables). */
async function getObservedCounts(shopDomain, eventNames = []) {
  const scopedEventNames = normalizeObservedEventNames(eventNames);
  const params = [shopDomain];
  let eventFilter = '';
  if (scopedEventNames.length) {
    params.push(scopedEventNames);
    eventFilter = `AND e.event_name = ANY($${params.length}::text[])`;
  }

  try {
    const sql = `
      WITH event_totals AS (
        SELECT e.event_name, COUNT(*)::int AS count, MAX(e.created_at) AS last_seen_at
        FROM events e
        WHERE e.shop_domain = $1
          AND e.event_name IS NOT NULL
          AND e.event_name <> ''
          ${eventFilter}
        GROUP BY e.event_name
      ),
      event_tests AS (
        SELECT
          e.event_name,
          e.test_id,
          COALESCE(t.name, 'Unknown test') AS test_name,
          COUNT(*)::int AS count,
          MAX(e.created_at) AS last_seen_at
        FROM events e
        LEFT JOIN tests t ON t.id = e.test_id
        WHERE e.shop_domain = $1
          AND e.event_name IS NOT NULL
          AND e.event_name <> ''
          ${eventFilter}
        GROUP BY e.event_name, e.test_id, t.name
      )
      SELECT
        et.event_name,
        et.count,
        et.last_seen_at,
        COALESCE(
          json_agg(
            json_build_object(
              'test_id', event_tests.test_id,
              'test_name', event_tests.test_name,
              'count', event_tests.count,
              'last_seen_at', event_tests.last_seen_at
            )
            ORDER BY event_tests.count DESC
          ) FILTER (WHERE event_tests.test_id IS NOT NULL),
          '[]'::json
        ) AS test_breakdown
      FROM event_totals et
      LEFT JOIN event_tests ON event_tests.event_name = et.event_name
      GROUP BY et.event_name, et.count, et.last_seen_at
    `;
    const result = await query(sql, params);
    return mapObservedRows(result.rows);
  } catch (err) {
    // Table missing / query shape issues should not break the Goals picker catalog.
    return new Map();
  }
}

async function refreshGoalMetricEventRollups() {
  return { allTimeRows: 0, dailyRows: 0, shopDomain: null };
}

async function listGoalMetricDefinitions(shopDomain) {
  const result = await query(
    `
      SELECT
        id,
        shop_domain,
        name,
        event_name,
        description,
        category,
        aggregation,
        direction,
        metric_role,
        trigger_type,
        trigger_config,
        tags,
        created_at,
        updated_at,
        false AS builtin
      FROM goal_metric_definitions
      WHERE shop_domain = $1
      ORDER BY created_at DESC
    `,
    [shopDomain]
  );

  const customByEvent = new Set(result.rows.map(row => row.event_name));
  const observedEventNames = [
    ...BUILT_IN_DEFINITIONS.map(item => item.event_name),
    ...customByEvent,
  ];
  const observed = await getObservedCounts(shopDomain, observedEventNames);
  const customDefinitions = result.rows.map(row => ({
    ...mapRow(row),
    ...(observed.get(row.event_name) || {
      observed_count: 0,
      last_seen_at: null,
      test_breakdown: [],
    }),
  }));
  const builtIns = BUILT_IN_DEFINITIONS.filter(item => !customByEvent.has(item.event_name)).map(
    item => ({
      shop_domain: shopDomain,
      ...item,
      ...(observed.get(item.event_name) || {
        observed_count: 0,
        last_seen_at: null,
        test_breakdown: [],
      }),
    })
  );

  return [...builtIns, ...customDefinitions];
}

async function upsertGoalMetricDefinition(shopDomain, definition) {
  const tags = Array.isArray(definition.tags)
    ? definition.tags
        .map(tag => String(tag).trim())
        .filter(Boolean)
        .slice(0, 8)
    : [];
  const result = await query(
    `
      INSERT INTO goal_metric_definitions (
        shop_domain,
        name,
        event_name,
        description,
        category,
        aggregation,
        direction,
        metric_role,
        trigger_type,
        trigger_config,
        tags
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (shop_domain, event_name) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        aggregation = EXCLUDED.aggregation,
        direction = EXCLUDED.direction,
        metric_role = EXCLUDED.metric_role,
        trigger_type = EXCLUDED.trigger_type,
        trigger_config = EXCLUDED.trigger_config,
        tags = EXCLUDED.tags,
        updated_at = NOW()
      RETURNING *, false AS builtin
    `,
    [
      shopDomain,
      definition.name,
      definition.event_name,
      definition.description || null,
      definition.category || 'custom',
      definition.aggregation || 'count',
      definition.direction || 'increase',
      definition.metric_role || 'secondary',
      definition.trigger_type || 'custom_event',
      JSON.stringify(definition.trigger_config || {}),
      JSON.stringify(tags),
    ]
  );

  return mapRow(result.rows[0]);
}

async function deleteGoalMetricDefinition(shopDomain, id) {
  const result = await query(
    `
      DELETE FROM goal_metric_definitions
      WHERE shop_domain = $1 AND id = $2
      RETURNING id
    `,
    [shopDomain, id]
  );
  return result.rowCount > 0;
}

module.exports = {
  BUILT_IN_DEFINITIONS,
  listGoalMetricDefinitions,
  upsertGoalMetricDefinition,
  deleteGoalMetricDefinition,
  refreshGoalMetricEventRollups,
};
