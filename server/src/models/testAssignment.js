/**
 * Test Assignment Model
 *
 * Tracks which variant each user is assigned to
 */

const { query } = require('../utils/database');

class TestAssignmentModel {
  /**
   * Get user's variant assignment for a test
   *
   * @param {string} testId - Test ID
   * @param {string} userId - User ID
   * @param {string} shopDomain - Shop domain
   * @returns {Promise<Object|null>} Assignment or null
   */
  async getTestAssignment(testId, userId, shopDomain) {
    const sql = `
      SELECT * FROM test_assignments
      WHERE test_id = $1 AND user_id = $2 AND shop_domain = $3
    `;

    const result = await query(sql, [testId, userId, shopDomain]);
    return result.rows[0] || null;
  }

  /**
   * Save test assignment
   *
   * @param {Object} assignment - Assignment data
   * @returns {Promise<Object>} Saved assignment
   */
  async saveTestAssignment(assignment) {
    const {
      test_id,
      user_id,
      shop_domain,
      variant_id,
      variant_name,
      assigned_at,
      device,
      country,
    } = assignment;

    const sqlWithSegment = `
      INSERT INTO test_assignments (
        test_id, user_id, shop_domain, variant_id,
        variant_name, assigned_at, device, country
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (test_id, user_id, shop_domain)
      DO UPDATE SET
        variant_id = EXCLUDED.variant_id,
        variant_name = EXCLUDED.variant_name,
        assigned_at = EXCLUDED.assigned_at,
        device = COALESCE(EXCLUDED.device, test_assignments.device),
        country = COALESCE(EXCLUDED.country, test_assignments.country)
      RETURNING *
    `;

    const sqlWithoutSegment = `
      INSERT INTO test_assignments (
        test_id, user_id, shop_domain, variant_id,
        variant_name, assigned_at
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (test_id, user_id, shop_domain)
      DO UPDATE SET
        variant_id = EXCLUDED.variant_id,
        variant_name = EXCLUDED.variant_name,
        assigned_at = EXCLUDED.assigned_at
      RETURNING *
    `;

    try {
      const result = await query(sqlWithSegment, [
        test_id,
        user_id,
        shop_domain,
        variant_id,
        variant_name,
        assigned_at,
        device || null,
        country || null,
      ]);
      return result.rows[0];
    } catch (err) {
      if (err.message?.includes('device') || err.message?.includes('country')) {
        const result = await query(sqlWithoutSegment, [
          test_id,
          user_id,
          shop_domain,
          variant_id,
          variant_name,
          assigned_at,
        ]);
        return result.rows[0];
      }
      throw err;
    }
  }

  /**
   * Get assignments for a user across multiple tests (batch, single query)
   *
   * @param {string} userId - User ID
   * @param {string} shopDomain - Shop domain
   * @param {string[]} testIds - Test IDs to fetch
   * @returns {Promise<Map<string, Object>>} Map of testId -> assignment
   */
  async getTestAssignmentsBatch(userId, shopDomain, testIds) {
    if (!testIds || testIds.length === 0) {
      return new Map();
    }
    const uniqueIds = [...new Set(testIds.filter(Boolean))];
    const placeholders = uniqueIds.map((_, i) => `$${i + 3}`).join(', ');
    const sql = `
      SELECT * FROM test_assignments
      WHERE user_id = $1 AND shop_domain = $2 AND test_id IN (${placeholders})
    `;
    const params = [userId, shopDomain, ...uniqueIds];
    const result = await query(sql, params);
    const map = new Map();
    for (const row of result.rows) {
      map.set(row.test_id, row);
    }
    return map;
  }

  /**
   * Get assignment statistics for a test
   *
   * @param {string} testId - Test ID
   * @param {string} shopDomain - Shop domain
   * @returns {Promise<Array>} Assignment stats by variant
   */
  async getAssignmentStats(testId, shopDomain) {
    const normalized = (shopDomain || '').toString().toLowerCase().trim();
    const sql = `
      SELECT 
        variant_id,
        variant_name,
        COUNT(*) as assignment_count
      FROM test_assignments
      WHERE test_id = $1 AND LOWER(TRIM(shop_domain)) = LOWER(TRIM($2))
      GROUP BY variant_id, variant_name
    `;

    const result = await query(sql, [testId, normalized || shopDomain]);
    return result.rows;
  }
}

const model = new TestAssignmentModel();

module.exports = {
  getTestAssignment: (testId, userId, shop) => model.getTestAssignment(testId, userId, shop),
  getTestAssignmentsBatch: (userId, shop, testIds) =>
    model.getTestAssignmentsBatch(userId, shop, testIds),
  saveTestAssignment: assignment => model.saveTestAssignment(assignment),
  getAssignmentStats: (testId, shop) => model.getAssignmentStats(testId, shop),
};
