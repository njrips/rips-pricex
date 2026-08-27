const { isPublicIdFormat, normalizeShopDomain } = require('../../models/supportTicket');

const TICKET_CATEGORIES = Object.freeze([
  'setup',
  'launch',
  'preview',
  'live',
  'offers',
  'billing',
  'privacy',
  'other',
]);

const TICKET_STATUSES = Object.freeze([
  'open',
  'waiting_merchant',
  'waiting_staff',
  'resolved',
  'closed',
]);

const CREATE_LIMIT_PER_HOUR = 5;
const REPLY_LIMIT_PER_HOUR = 20;
const BODY_MAX_CHARS = 8000;
const SUBJECT_MAX_CHARS = 200;

function normalizeCategory(value) {
  const category = String(value || '')
    .trim()
    .toLowerCase();
  return TICKET_CATEGORIES.includes(category) ? category : '';
}

function normalizeStatus(value) {
  const status = String(value || '')
    .trim()
    .toLowerCase();
  return TICKET_STATUSES.includes(status) ? status : '';
}

function normalizeSubject(value) {
  return String(value || '')
    .trim()
    .slice(0, SUBJECT_MAX_CHARS);
}

function normalizeBody(value) {
  return String(value || '')
    .trim()
    .slice(0, BODY_MAX_CHARS);
}

function normalizeReplyEmail(value) {
  const email = String(value || '')
    .trim()
    .slice(0, 255);
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function isCreateRateLimited(count, limit = CREATE_LIMIT_PER_HOUR) {
  return Number(count) >= Number(limit);
}

function validateCreateInput(shopDomain, input = {}) {
  const domain = normalizeShopDomain(shopDomain);
  if (!domain) {
    const error = new Error('Shop domain required');
    error.status = 401;
    throw error;
  }
  const category = normalizeCategory(input.category);
  const subject = normalizeSubject(input.subject);
  const body = normalizeBody(input.body);
  const rawEmail = String(input.reply_email || input.replyEmail || '').trim();
  const replyEmail = rawEmail ? normalizeReplyEmail(rawEmail) : null;
  if (!category) {
    const error = new Error('Choose a category');
    error.status = 400;
    throw error;
  }
  if (!subject) {
    const error = new Error('Subject is required');
    error.status = 400;
    throw error;
  }
  if (!body) {
    const error = new Error('Describe the problem');
    error.status = 400;
    throw error;
  }
  if (rawEmail && !replyEmail) {
    const error = new Error('Reply email is not valid');
    error.status = 400;
    throw error;
  }
  return {
    domain,
    category,
    subject,
    body,
    replyEmail,
  };
}

module.exports = {
  TICKET_CATEGORIES,
  TICKET_STATUSES,
  CREATE_LIMIT_PER_HOUR,
  REPLY_LIMIT_PER_HOUR,
  BODY_MAX_CHARS,
  SUBJECT_MAX_CHARS,
  isPublicIdFormat,
  normalizeCategory,
  normalizeStatus,
  normalizeSubject,
  normalizeBody,
  normalizeReplyEmail,
  isCreateRateLimited,
  validateCreateInput,
};
