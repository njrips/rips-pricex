/**
 * Test Model
 *
 * Database operations for AB tests. Uses shop_domain for compatibility;
 * tenant_id (FK to tenants) is set when possible for referential integrity.
 */

const { query } = require('../utils/database');
const logger = require('../utils/logger');
const { getTenantByDomain } = require('./tenant');
const { MAX_TEST_NAME_LENGTH } = require('../constants');

/**
 * Safely parse JSON with error handling
 *
 * @param {string|Object} jsonString - JSON string or object to parse
 * @param {*} defaultValue - Default value if parsing fails
 * @param {string} fieldName - Field name for logging
 * @param {string} testId - Test ID for logging
 * @returns {*} Parsed JSON or default value
 */
function safeParseJSON(jsonString, defaultValue, fieldName, testId = null) {
  if (!jsonString) {
    return defaultValue;
  }

  if (typeof jsonString === 'object') {
    return jsonString;
  }

  try {
    return JSON.parse(jsonString);
  } catch (e) {
    logger.error(`Error parsing ${fieldName} JSON`, {
      testId,
      error: e.message,
      field: fieldName,
    });
    return defaultValue;
  }
}

/**
 * Safely stringify JSON for database storage
 *
 * @param {*} data - Data to stringify
 * @param {*} defaultValue - Default value if stringify fails
 * @returns {string} JSON string
 */
function safeStringifyJSON(data, defaultValue = '{}') {
  if (!data) {
    return defaultValue;
  }

  if (typeof data === 'string') {
    return data;
  }

  try {
    return JSON.stringify(data);
  } catch (e) {
    logger.error('Error stringifying JSON', { error: e.message });
    return defaultValue;
  }
}

function normalizeVariantCode(variants = []) {
  if (!Array.isArray(variants)) {
    return variants;
  }

  return variants.map((variant, index) => {
    if (!variant || typeof variant !== 'object') {
      return variant;
    }
    const next = { ...variant };
    const config = next.config && typeof next.config === 'object' ? { ...next.config } : {};

    if (next.code !== undefined && next.code !== null && config.code === undefined) {
      config.code = next.code;
    }

    if ((next.code === undefined || next.code === null) && config.code !== undefined) {
      next.code = config.code;
    }

    if (Object.keys(config).length > 0) {
      next.config = config;
    }

    // Ensure variant has id for analytics matching (templates may only have name)
    if (next.id === null || next.id === undefined || String(next.id).trim() === '') {
      next.id = next.name || `variant-${index}`;
    }

    return next;
  });
}

/**
 * Check if scheduling columns exist in tests table
 * Caches result to avoid repeated queries
 */
let schedulingColumnsExist = null;

async function checkSchedulingColumns() {
  if (schedulingColumnsExist !== null) {
    return schedulingColumnsExist;
  }

  try {
    const sql = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'tests' 
      AND column_name IN ('scheduled_start_at', 'scheduled_stop_at', 'auto_start', 'auto_stop', 'timezone')
      LIMIT 1
    `;
    const result = await query(sql);
    schedulingColumnsExist = result.rows.length > 0;
    return schedulingColumnsExist;
  } catch (error) {
    logger.warn('Could not check for scheduling columns', { error: error.message });
    schedulingColumnsExist = false;
    return false;
  }
}

class TestModel {
  /**
   * Build insert query and parameters for test creation
   *
   * @param {Object} testData - Test data
   * @param {boolean} includeScheduling - Whether to include scheduling columns
   * @returns {Object} { sql, params }
   */
  _buildInsertQuery(testData, includeScheduling = false) {
    const {
      shop_domain,
      name,
      description,
      type,
      target_type,
      target_id,
      target_ids,
      status = 'draft',
      goal,
      variants,
      segments,
      holdout_percent,
      guardrail_config,
      scheduled_start_at,
      scheduled_stop_at,
      auto_start = false,
      auto_stop = false,
      timezone = 'UTC',
    } = testData;

    const baseColumns = [
      'shop_domain',
      'name',
      'description',
      'type',
      'target_type',
      'target_id',
      'target_ids',
      'status',
      'goal',
      'variants',
    ];

    const baseValues = [
      shop_domain,
      name,
      description || null,
      type,
      target_type || null,
      target_id || null,
      Array.isArray(target_ids) && target_ids.length > 0
        ? safeStringifyJSON(target_ids, '[]')
        : null,
      status,
      safeStringifyJSON(goal, '{}'),
      safeStringifyJSON(variants, '[]'),
    ];

    if (testData.tenant_id) {
      baseColumns.push('tenant_id');
      baseValues.push(testData.tenant_id);
    }

    if (segments !== undefined) {
      baseColumns.push('segments');
      baseValues.push(safeStringifyJSON(segments || {}, '{}'));
    }

    if (holdout_percent !== undefined) {
      baseColumns.push('holdout_percent');
      baseValues.push(holdout_percent);
    }

    if (guardrail_config !== undefined) {
      baseColumns.push('guardrail_config');
      baseValues.push(guardrail_config?.enabled ? safeStringifyJSON(guardrail_config, '{}') : null);
    }

    if (includeScheduling) {
      const schedulingColumns = [
        'scheduled_start_at',
        'scheduled_stop_at',
        'auto_start',
        'auto_stop',
        'timezone',
      ];

      const schedulingValues = [
        scheduled_start_at || null,
        scheduled_stop_at || null,
        auto_start,
        auto_stop,
        timezone,
      ];

      const allColumns = [...baseColumns, ...schedulingColumns];
      const allValues = [...baseValues, ...schedulingValues];
      const placeholders = allValues.map((_, i) => `$${i + 1}`).join(', ');

      return {
        sql: `
          INSERT INTO tests (${allColumns.join(', ')}, created_at, updated_at)
          VALUES (${placeholders}, NOW(), NOW())
          RETURNING *
        `,
        params: allValues,
      };
    }

    // Without scheduling columns
    const placeholders = baseValues.map((_, i) => `$${i + 1}`).join(', ');

    return {
      sql: `
        INSERT INTO tests (${baseColumns.join(', ')}, created_at, updated_at)
        VALUES (${placeholders}, NOW(), NOW())
        RETURNING *
      `,
      params: baseValues,
    };
  }

  async createTest(testData) {
    try {
      // Validate required fields
      if (!testData.shop_domain) {
        throw new Error('shop_domain is required');
      }
      const name = typeof testData.name === 'string' ? testData.name.trim() : '';
      if (!name) {
        throw new Error('name is required');
      }
      if (name.length > MAX_TEST_NAME_LENGTH) {
        throw new Error(`name must be at most ${MAX_TEST_NAME_LENGTH} characters`);
      }
      testData.name = name;
      if (!testData.type) {
        throw new Error('type is required');
      }

      // Resolve tenant_id for referential integrity (tests.tenant_id FK to tenants)
      if (!testData.tenant_id && testData.shop_domain) {
        const tenant = await getTenantByDomain(testData.shop_domain);
        if (tenant) {
          testData.tenant_id = tenant.id;
        }
      }

      const hasSchedulingColumns = await checkSchedulingColumns();
      const { sql, params } = this._buildInsertQuery(testData, hasSchedulingColumns);

      const result = await query(sql, params);

      // Parse JSON fields in response
      const test = result.rows[0];
      test.goal = safeParseJSON(test.goal, {}, 'goal', test.id);
      test.variants = normalizeVariantCode(safeParseJSON(test.variants, [], 'variants', test.id));
      test.segments = safeParseJSON(test.segments, {}, 'segments', test.id);
      const targetIdsParsed = Array.isArray(test.target_ids)
        ? test.target_ids
        : safeParseJSON(test.target_ids, null, 'target_ids', test.id);
      test.target_ids =
        Array.isArray(targetIdsParsed) && targetIdsParsed.length > 0 ? targetIdsParsed : null;

      return test;
    } catch (error) {
      logger.error('Error in createTest', {
        error: error.message,
        code: error.code,
        detail: error.detail,
        hint: error.hint,
        stack: error.stack,
        testData: {
          name: testData?.name,
          type: testData?.type,
          shop_domain: testData?.shop_domain,
        },
      });
      throw error;
    }
  }

  /**
   * Get test by ID
   *
   * @param {string} testId - Test ID
   * @param {string} shopDomain - Shop domain
   * @returns {Promise<Object>} Test data
   */
  async getTestById(testId, shopDomain) {
    const sql = `
      SELECT * FROM tests
      WHERE id = $1
        AND LOWER(TRIM(shop_domain)) = LOWER(TRIM($2))
    `;

    const result = await query(sql, [testId, shopDomain]);

    if (result.rows.length === 0) {
      return null;
    }

    const test = result.rows[0];
    // Parse JSON fields with error handling
    test.goal = safeParseJSON(test.goal, {}, 'goal', testId);
    test.variants = normalizeVariantCode(safeParseJSON(test.variants, [], 'variants', testId));
    test.segments = safeParseJSON(test.segments, {}, 'segments', testId);
    const targetIdsParsed = Array.isArray(test.target_ids)
      ? test.target_ids
      : safeParseJSON(test.target_ids, null, 'target_ids', testId);
    test.target_ids =
      Array.isArray(targetIdsParsed) && targetIdsParsed.length > 0 ? targetIdsParsed : null;

    return test;
  }

  /**
   * Get multiple tests by IDs (batch, single query)
   *
   * @param {string[]} testIds - Test IDs
   * @param {string} shopDomain - Shop domain
   * @returns {Promise<Map<string, Object>>} Map of testId -> test
   */
  async getTestsByIds(testIds, shopDomain) {
    if (!testIds || testIds.length === 0) {
      return new Map();
    }
    const uniqueIds = [...new Set(testIds.filter(Boolean))];
    const placeholders = uniqueIds.map((_, i) => `$${i + 2}`).join(', ');
    const sql = `
      SELECT * FROM tests
      WHERE LOWER(TRIM(shop_domain)) = LOWER(TRIM($1))
        AND id IN (${placeholders})
    `;
    const params = [shopDomain, ...uniqueIds];
    const result = await query(sql, params);
    const map = new Map();
    for (const row of result.rows) {
      const idKey = String(row.id);
      const targetIdsParsed = Array.isArray(row.target_ids)
        ? row.target_ids
        : safeParseJSON(row.target_ids, null, 'target_ids', idKey);
      const test = {
        ...row,
        goal: safeParseJSON(row.goal, {}, 'goal', idKey),
        variants: normalizeVariantCode(safeParseJSON(row.variants, [], 'variants', idKey)),
        segments: safeParseJSON(row.segments, {}, 'segments', idKey),
        target_ids:
          Array.isArray(targetIdsParsed) && targetIdsParsed.length > 0 ? targetIdsParsed : null,
      };
      map.set(idKey, test);
    }
    return map;
  }

  /**
   * Get tests that should be served on storefront (running OR personalized/rollout)
   *
   * @param {string} shopDomain - Shop domain
   * @returns {Promise<Array>} List of tests
   */
  async getActiveTestsForStorefront(shopDomain) {
    try {
      const sql = `
        SELECT * FROM tests
        WHERE LOWER(TRIM(shop_domain)) = LOWER(TRIM($1))
          AND (
            status = 'running'
            OR (
              status IN ('stopped', 'completed')
              AND personalization_mode IN ('personalized', 'rollout')
              AND LOWER(COALESCE(type, '')) IN ('price', 'pricing')
            )
          )
        ORDER BY created_at DESC
      `;
      const result = await query(sql, [shopDomain]);
      return result.rows.map(test => {
        const goal = safeParseJSON(test.goal, {}, 'goal', test.id);
        const variants = normalizeVariantCode(
          safeParseJSON(test.variants, [], 'variants', test.id)
        );
        const segments = safeParseJSON(test.segments, {}, 'segments', test.id);
        const targetIds = Array.isArray(test.target_ids)
          ? test.target_ids
          : safeParseJSON(test.target_ids, null, 'target_ids', test.id);
        return {
          ...test,
          goal,
          variants,
          segments,
          target_ids: Array.isArray(targetIds) && targetIds.length > 0 ? targetIds : null,
        };
      });
    } catch (err) {
      if (err.message?.includes('personalization_mode')) {
        return this.getTestsByShop(shopDomain, 'running');
      }
      throw err;
    }
  }

  /**
   * Get all tests for a shop
   *
   * @param {string} shopDomain - Shop domain
   * @param {string} status - Optional status filter
   * @returns {Promise<Array>} List of tests
   */
  async getTestsByShop(shopDomain, status = null) {
    const normalized = (shopDomain || '').toString().toLowerCase().trim();
    let sql = `
      SELECT * FROM tests
      WHERE LOWER(TRIM(shop_domain)) = $1
    `;

    const params = [normalized || shopDomain];

    if (status) {
      sql += ' AND status = $2';
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC';

    const result = await query(sql, params);

    return result.rows.map(test => {
      // Parse JSON fields with error handling
      const goal = safeParseJSON(test.goal, {}, 'goal', test.id);
      const variants = normalizeVariantCode(safeParseJSON(test.variants, [], 'variants', test.id));
      const segments = safeParseJSON(test.segments, {}, 'segments', test.id);
      const targetIds = Array.isArray(test.target_ids)
        ? test.target_ids
        : safeParseJSON(test.target_ids, null, 'target_ids', test.id);

      return {
        ...test,
        goal,
        variants,
        segments,
        target_ids: Array.isArray(targetIds) && targetIds.length > 0 ? targetIds : null,
      };
    });
  }

  /**
   * Update test status
   *
   * @param {string} testId - Test ID
   * @param {string} shopDomain - Shop domain
   * @param {string} status - New status
   * @returns {Promise<Object>} Updated test
   */
  async updateTestStatus(testId, shopDomain, status) {
    const updates = ['status = $1', 'updated_at = NOW()'];
    const params = [status, testId, shopDomain];

    if (status === 'running') {
      updates.push('started_at = COALESCE(started_at, NOW())');
    } else if (status === 'stopped' || status === 'completed') {
      updates.push('stopped_at = NOW()');
    }

    const sql = `
      UPDATE tests
      SET ${updates.join(', ')}
      WHERE id = $2
        AND LOWER(TRIM(shop_domain)) = LOWER(TRIM($3))
      RETURNING *
    `;

    const result = await query(sql, params);

    if (result.rows.length === 0) {
      return null;
    }

    const test = result.rows[0];
    // Parse JSON fields with error handling
    test.goal = safeParseJSON(test.goal, {}, 'goal', testId);
    test.variants = normalizeVariantCode(safeParseJSON(test.variants, [], 'variants', testId));

    return test;
  }

  /**
   * Update test
   *
   * @param {string} testId - Test ID
   * @param {string} shopDomain - Shop domain
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated test
   */
  async updateTest(testId, shopDomain, updates) {
    if (!updates || Object.keys(updates).length === 0) {
      throw new Error('No fields to update');
    }

    // Only update columns that exist on tests table (ignore frontend-only fields like pricePerProduct)
    const ALLOWED_UPDATE_COLUMNS = new Set([
      'goal',
      'variants',
      'segments',
      'guardrail_config',
      'target_ids',
      'rollout_schedule',
      'name',
      'description',
      'type',
      'target_type',
      'target_id',
      'status',
      'holdout_percent',
      'scheduled_start_at',
      'scheduled_stop_at',
      'auto_start',
      'auto_stop',
      'timezone',
      'winner_variant_index',
      'winner_variant_id',
      'personalization_mode',
      'rollout_percent',
      'rollout_started_at',
      'started_at',
      'stopped_at',
    ]);

    const fields = [];
    const values = [];
    let paramIndex = 1;

    // Handle JSON fields and regular fields
    Object.keys(updates).forEach(key => {
      if (!ALLOWED_UPDATE_COLUMNS.has(key)) {
        return;
      }
      if (
        key === 'goal' ||
        key === 'variants' ||
        key === 'segments' ||
        key === 'guardrail_config' ||
        key === 'target_ids' ||
        key === 'rollout_schedule'
      ) {
        // Use ::jsonb cast for JSONB columns so pg passes string correctly
        const jsonbCast = key === 'rollout_schedule' ? '::jsonb' : '';
        fields.push(`${key} = $${paramIndex}${jsonbCast}`);
        const fallback = key === 'variants' ? '[]' : '{}';
        const val =
          key === 'guardrail_config'
            ? updates[key]?.enabled
              ? updates[key]
              : null
            : key === 'target_ids'
              ? Array.isArray(updates[key]) && updates[key].length > 0
                ? updates[key]
                : null
              : key === 'rollout_schedule'
                ? Array.isArray(updates[key]) && updates[key].length > 0
                  ? updates[key]
                  : null
                : updates[key];
        values.push(
          key === 'guardrail_config' && val === null
            ? null
            : key === 'target_ids'
              ? val === null
                ? null
                : safeStringifyJSON(val, '[]')
              : key === 'rollout_schedule'
                ? val === null
                  ? null
                  : safeStringifyJSON(val, '[]')
                : safeStringifyJSON(val, fallback)
        );
      } else {
        // Scalar column
        let val = updates[key];
        if (key === 'name' && val !== undefined && val !== null) {
          const trimmed = typeof val === 'string' ? val.trim() : String(val).trim();
          if (trimmed.length > MAX_TEST_NAME_LENGTH) {
            throw new Error(`name must be at most ${MAX_TEST_NAME_LENGTH} characters`);
          }
          val = trimmed;
        }
        fields.push(`${key} = $${paramIndex}`);
        values.push(val !== undefined ? val : null);
      }
      paramIndex++;
    });

    if (fields.length === 0) {
      throw new Error('No valid fields to update');
    }

    fields.push('updated_at = NOW()');

    const sql = `
      UPDATE tests
      SET ${fields.join(', ')}
      WHERE id = $${paramIndex}
        AND LOWER(TRIM(shop_domain)) = LOWER(TRIM($${paramIndex + 1}))
      RETURNING *
    `;

    values.push(testId, shopDomain);

    try {
      const result = await query(sql, values);

      if (result.rows.length === 0) {
        return null;
      }

      const test = result.rows[0];
      // Parse JSON fields with error handling
      test.goal = safeParseJSON(test.goal, {}, 'goal', testId);
      test.variants = normalizeVariantCode(safeParseJSON(test.variants, [], 'variants', testId));
      test.segments = safeParseJSON(test.segments, {}, 'segments', testId);
      const targetIdsParsed = Array.isArray(test.target_ids)
        ? test.target_ids
        : safeParseJSON(test.target_ids, null, 'target_ids', testId);
      test.target_ids =
        Array.isArray(targetIdsParsed) && targetIdsParsed.length > 0 ? targetIdsParsed : null;

      return test;
    } catch (error) {
      logger.error('Error in updateTest', {
        error: error.message,
        code: error.code,
        testId,
        shopDomain,
        fields: Object.keys(updates),
      });
      throw error;
    }
  }

  /**
   * Delete test
   *
   * @param {string} testId - Test ID
   * @param {string} shopDomain - Shop domain
   * @returns {Promise<boolean>} Success
   */
  async deleteTest(testId, shopDomain) {
    const sql = `
      DELETE FROM tests
      WHERE id = $1
        AND LOWER(TRIM(shop_domain)) = LOWER(TRIM($2))
    `;

    const result = await query(sql, [testId, shopDomain]);
    return result.rowCount > 0;
  }

  /**
   * Get test by ID only (for admin; no shop filter)
   */
  async getTestByIdForAdmin(testId) {
    const sql = 'SELECT * FROM tests WHERE id = $1';
    const result = await query(sql, [testId]);
    if (result.rows.length === 0) {
      return null;
    }
    const test = result.rows[0];
    test.goal = safeParseJSON(test.goal, {}, 'goal', testId);
    test.variants = normalizeVariantCode(safeParseJSON(test.variants, [], 'variants', testId));
    test.segments = safeParseJSON(test.segments, {}, 'segments', testId);
    return test;
  }
}

// Export functions for convenience
const model = new TestModel();

module.exports = {
  createTest: data => model.createTest(data),
  getTestById: (id, shop) => model.getTestById(id, shop),
  getTestByIdForAdmin: id => model.getTestByIdForAdmin(id),
  getTestsByIds: (ids, shop) => model.getTestsByIds(ids, shop),
  getTestsByShop: (shop, status) => model.getTestsByShop(shop, status),
  getActiveTestsForStorefront: shop => model.getActiveTestsForStorefront(shop),
  updateTestStatus: (id, shop, status) => model.updateTestStatus(id, shop, status),
  updateTest: (id, shop, updates) => model.updateTest(id, shop, updates),
  deleteTest: (id, shop) => model.deleteTest(id, shop),
};
