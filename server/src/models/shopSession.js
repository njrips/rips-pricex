/**
 * Shop Session Model
 *
 * Stores Shopify access tokens per shop for API usage.
 */

const { query } = require('../utils/database');
const logger = require('../utils/logger');

function normalizeShopDomain(domain) {
  if (!domain || typeof domain !== 'string') {
    return '';
  }
  return domain.trim().toLowerCase();
}

async function upsertShopSession({ shopDomain, accessToken, scope }) {
  const normalized = normalizeShopDomain(shopDomain);
  if (!normalized) {
    throw new Error('shopDomain is required');
  }
  // Prefer shop_domain unique index; also keep legacy `shop` column in sync when present
  const sql = `
    INSERT INTO shop_sessions (shop_domain, shop, access_token, scope, installed_at, updated_at)
    VALUES ($1, $1, $2, $3, NOW(), NOW())
    ON CONFLICT (shop_domain)
    DO UPDATE SET
      shop = EXCLUDED.shop_domain,
      access_token = EXCLUDED.access_token,
      scope = EXCLUDED.scope,
      updated_at = NOW()
    RETURNING *
  `;

  try {
    const result = await query(sql, [normalized, accessToken, scope || null]);
    return result.rows[0];
  } catch (error) {
    // Fallback if unique constraint name differs
    logger.warn('shop_sessions upsert conflict path failed, trying update/insert', {
      message: error.message,
    });
    const existing = await query(`SELECT id FROM shop_sessions WHERE shop_domain = $1 OR shop = $1 LIMIT 1`, [
      normalized,
    ]);
    if (existing.rows[0]) {
      const updated = await query(
        `UPDATE shop_sessions SET access_token = $2, scope = $3, shop_domain = $1, shop = $1, updated_at = NOW()
         WHERE id = $4 RETURNING *`,
        [normalized, accessToken, scope || null, existing.rows[0].id]
      );
      return updated.rows[0];
    }
    const inserted = await query(
      `INSERT INTO shop_sessions (shop_domain, shop, access_token, scope, installed_at, updated_at)
       VALUES ($1, $1, $2, $3, NOW(), NOW()) RETURNING *`,
      [normalized, accessToken, scope || null]
    );
    return inserted.rows[0];
  }
}

async function getShopSession(shopDomain) {
  const normalized = normalizeShopDomain(shopDomain);
  if (!normalized) {
    return null;
  }
  const sql = `
    SELECT * FROM shop_sessions
    WHERE shop_domain = $1
  `;

  const result = await query(sql, [normalized]);
  return result.rows[0] || null;
}

async function deleteShopSession(shopDomain) {
  const normalized = normalizeShopDomain(shopDomain);
  if (!normalized) {
    return false;
  }
  const sql = `
    DELETE FROM shop_sessions
    WHERE shop_domain = $1
  `;
  const result = await query(sql, [normalized]);
  return result.rowCount > 0;
}

module.exports = {
  upsertShopSession,
  getShopSession,
  deleteShopSession,
};
