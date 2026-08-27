const { query } = require('../utils/database');

const PUBLIC_ID_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function normalizeShopDomain(shopDomain) {
  return String(shopDomain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0];
}

function expandStaffShopFilter(shop) {
  const value = normalizeShopDomain(shop);
  if (!value) return '';
  if (value.includes('.')) return value;
  return `${value}.myshopify.com`;
}

function generatePublicId() {
  let suffix = '';
  for (let i = 0; i < 4; i += 1) {
    suffix += PUBLIC_ID_ALPHABET[Math.floor(Math.random() * PUBLIC_ID_ALPHABET.length)];
  }
  return `PX-${suffix}`;
}

function isPublicIdFormat(value) {
  return /^PX-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(
    String(value || '')
      .trim()
      .toUpperCase()
  );
}

function escapeLikePattern(value) {
  return String(value || '').replace(/[\\%_]/g, '\\$&');
}

function mapTicketRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    public_id: row.public_id,
    shop_domain: row.shop_domain,
    category: row.category,
    subject: row.subject,
    status: row.status,
    reply_email: row.reply_email || null,
    diagnostics: row.diagnostics && typeof row.diagnostics === 'object' ? row.diagnostics : {},
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_message_preview:
      row.last_message_body != null
        ? String(row.last_message_body)
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 120)
        : undefined,
    last_message_author: row.last_message_author || undefined,
    messages: Array.isArray(row.messages) ? row.messages : undefined,
  };
}

function mapMessageRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    ticket_id: row.ticket_id,
    author: row.author,
    body: row.body,
    created_at: row.created_at,
  };
}

async function insertTicket({
  shopDomain,
  publicId,
  category,
  subject,
  status = 'open',
  replyEmail = null,
  diagnostics = {},
}) {
  const domain = normalizeShopDomain(shopDomain);
  const { rows } = await query(
    `INSERT INTO support_tickets
       (public_id, shop_domain, category, subject, status, reply_email, diagnostics)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING *`,
    [
      publicId,
      domain,
      category,
      subject,
      status,
      replyEmail || null,
      JSON.stringify(diagnostics || {}),
    ]
  );
  return mapTicketRow(rows[0]);
}

async function insertMessage({ ticketId, author, body }) {
  const { rows } = await query(
    `INSERT INTO support_ticket_messages (ticket_id, author, body)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [ticketId, author, body]
  );
  return mapMessageRow(rows[0]);
}

async function listTicketsForShop(shopDomain, { limit = 50 } = {}) {
  const domain = normalizeShopDomain(shopDomain);
  if (!domain) return [];
  const { rows } = await query(
    `SELECT t.*,
       lm.body AS last_message_body,
       lm.author AS last_message_author
     FROM support_tickets t
     LEFT JOIN LATERAL (
       SELECT body, author
       FROM support_ticket_messages
       WHERE ticket_id = t.id
       ORDER BY created_at DESC
       LIMIT 1
     ) lm ON true
     WHERE t.shop_domain = $1
     ORDER BY t.updated_at DESC
     LIMIT $2`,
    [domain, Math.min(Math.max(Number(limit) || 50, 1), 100)]
  );
  return rows.map(mapTicketRow);
}

const STAFF_STATUS_FILTER = new Set([
  'open',
  'waiting_merchant',
  'waiting_staff',
  'resolved',
  'closed',
]);

function normalizeStaffStatusFilter(status) {
  return String(status || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => STAFF_STATUS_FILTER.has(value));
}

async function listTicketsForStaff({ status = '', shop = '', q = '', limit = 50 } = {}) {
  const params = [];
  const where = [];
  let idx = 1;

  const statusList = normalizeStaffStatusFilter(status);
  if (statusList.length === 1) {
    where.push(`t.status = $${idx}`);
    params.push(statusList[0]);
    idx += 1;
  } else if (statusList.length > 1) {
    where.push(`t.status = ANY($${idx}::text[])`);
    params.push(statusList);
    idx += 1;
  }

  const shopFilter = expandStaffShopFilter(shop);
  if (shopFilter) {
    where.push(`t.shop_domain = $${idx}`);
    params.push(shopFilter);
    idx += 1;
  }

  const rawSearch = String(q || '').trim();
  if (isPublicIdFormat(rawSearch)) {
    where.push(`t.public_id = $${idx}`);
    params.push(rawSearch.toUpperCase());
    idx += 1;
  } else if (rawSearch) {
    where.push(
      `(lower(t.public_id) LIKE $${idx} ESCAPE E'\\\\' OR lower(t.shop_domain) LIKE $${idx} ESCAPE E'\\\\' OR lower(t.subject) LIKE $${idx} ESCAPE E'\\\\')`
    );
    params.push(`%${escapeLikePattern(rawSearch.toLowerCase())}%`);
    idx += 1;
  }

  const sql = `SELECT t.*,
       lm.body AS last_message_body,
       lm.author AS last_message_author
     FROM support_tickets t
     LEFT JOIN LATERAL (
       SELECT body, author
       FROM support_ticket_messages
       WHERE ticket_id = t.id
       ORDER BY created_at DESC
       LIMIT 1
     ) lm ON true
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY t.updated_at DESC
     LIMIT $${idx}`;
  params.push(Math.min(Math.max(Number(limit) || 50, 1), 200));
  const { rows } = await query(sql, params);
  return rows.map(mapTicketRow);
}

function buildTicketLookup(publicId, shopDomain = null) {
  const id = String(publicId || '')
    .trim()
    .toUpperCase();
  if (!id) return null;
  const shop = shopDomain ? normalizeShopDomain(shopDomain) : '';
  if (shop) {
    return {
      sql: `SELECT * FROM support_tickets WHERE public_id = $1 AND shop_domain = $2`,
      params: [id, shop],
    };
  }
  return {
    sql: `SELECT * FROM support_tickets WHERE public_id = $1`,
    params: [id],
  };
}

async function getTicketByPublicId(publicId, { shopDomain = null } = {}) {
  const lookup = buildTicketLookup(publicId, shopDomain);
  if (!lookup) return null;
  const { rows } = await query(lookup.sql, lookup.params);
  return mapTicketRow(rows[0]);
}

async function listMessagesForTicket(ticketId) {
  const { rows } = await query(
    `SELECT * FROM support_ticket_messages
     WHERE ticket_id = $1
     ORDER BY created_at ASC`,
    [ticketId]
  );
  return rows.map(mapMessageRow);
}

async function updateTicketStatus(ticketId, status) {
  const { rows } = await query(
    `UPDATE support_tickets
     SET status = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [ticketId, status]
  );
  return mapTicketRow(rows[0]);
}

async function touchTicket(ticketId) {
  await query(`UPDATE support_tickets SET updated_at = NOW() WHERE id = $1`, [ticketId]);
}

async function countTicketsCreatedSince(shopDomain, since) {
  const domain = normalizeShopDomain(shopDomain);
  if (!domain) return 0;
  const { rows } = await query(
    `SELECT COUNT(*)::int AS count
     FROM support_tickets
     WHERE shop_domain = $1 AND created_at >= $2`,
    [domain, since]
  );
  return Number(rows[0]?.count || 0);
}

async function countMerchantMessagesSince(shopDomain, since) {
  const domain = normalizeShopDomain(shopDomain);
  if (!domain) return 0;
  const { rows } = await query(
    `SELECT COUNT(*)::int AS count
     FROM support_ticket_messages m
     JOIN support_tickets t ON t.id = m.ticket_id
     WHERE t.shop_domain = $1 AND m.author = 'merchant' AND m.created_at >= $2`,
    [domain, since]
  );
  return Number(rows[0]?.count || 0);
}

async function deleteTicketsForShop(shopDomain) {
  const domain = normalizeShopDomain(shopDomain);
  if (!domain) return 0;
  const { rowCount } = await query(`DELETE FROM support_tickets WHERE shop_domain = $1`, [domain]);
  return Number(rowCount || 0);
}

module.exports = {
  PUBLIC_ID_ALPHABET,
  normalizeShopDomain,
  expandStaffShopFilter,
  generatePublicId,
  isPublicIdFormat,
  escapeLikePattern,
  normalizeStaffStatusFilter,
  buildTicketLookup,
  insertTicket,
  insertMessage,
  listTicketsForShop,
  listTicketsForStaff,
  getTicketByPublicId,
  listMessagesForTicket,
  updateTicketStatus,
  touchTicket,
  countTicketsCreatedSince,
  countMerchantMessagesSince,
  deleteTicketsForShop,
};
