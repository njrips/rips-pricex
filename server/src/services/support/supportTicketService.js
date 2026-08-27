const { SCRIPT_VERSION } = require('../../utils/storefrontScriptRuntime');
const { getShopEntitlement } = require('../billing/entitlementService');
const {
  resolveSmartPricingCheckoutReadiness,
} = require('../smartPricing/smartPricingCheckoutReadinessService');
const { listInboxPlans } = require('../../models/smartPricingInboxStore');
const {
  generatePublicId,
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
  normalizeShopDomain,
} = require('../../models/supportTicket');
const { getShopSession } = require('../../models/shopSession');
const { countRunningPriceTests } = require('../smartPricing/smartPricingLaunchGuardService');
const {
  sanitizeDiagnostics,
  pickRecentPlans,
  pickReadinessSnapshot,
} = require('./supportDiagnostics');
const {
  notifyNewTicket,
  notifyStaffReply,
  notifyMerchantReply,
  notifyStatusChange,
} = require('./supportMailer');
const {
  presentMessage,
  presentMerchantTicket,
  presentStaffTicket,
} = require('./supportTicketPresenters');
const {
  TICKET_CATEGORIES,
  TICKET_STATUSES,
  CREATE_LIMIT_PER_HOUR,
  REPLY_LIMIT_PER_HOUR,
  BODY_MAX_CHARS,
  isPublicIdFormat,
  normalizeCategory,
  normalizeStatus,
  normalizeSubject,
  normalizeBody,
  normalizeReplyEmail,
  isCreateRateLimited,
  validateCreateInput,
} = require('./supportTicketValidation');

const UNIQUE_VIOLATION = '23505';

async function assertCanCreateTicket(shopDomain) {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const count = await countTicketsCreatedSince(shopDomain, since);
  if (isCreateRateLimited(count, CREATE_LIMIT_PER_HOUR)) {
    const error = new Error('Too many support tickets in the last hour. Try again later.');
    error.status = 429;
    throw error;
  }
}

async function buildDiagnostics(shopDomain) {
  const domain = normalizeShopDomain(shopDomain);
  const entitlement = await getShopEntitlement(domain).catch(() => ({
    entitled: false,
    planHandle: null,
    status: 'unknown',
  }));
  const session = await getShopSession(domain).catch(() => null);
  const accessToken = session?.access_token || null;
  const runningPriceTests = await countRunningPriceTests(domain).catch(() => 0);
  const readiness = await resolveSmartPricingCheckoutReadiness(domain, {
    runningPriceTests,
    accessToken,
  }).catch(() => null);
  const inbox = await listInboxPlans(domain).catch(() => ({ plans: [] }));
  const sessionScopes = String(session?.scope || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 24);

  return sanitizeDiagnostics({
    shop: domain,
    plan_handle: entitlement.planHandle || null,
    entitled: entitlement.entitled === true,
    entitlement_status: entitlement.status || null,
    ...pickReadinessSnapshot(readiness),
    running_price_tests: runningPriceTests,
    has_offline_session: Boolean(accessToken),
    session_scopes: sessionScopes,
    recent_plans: pickRecentPlans(inbox.plans),
    storefront_script_version: SCRIPT_VERSION,
    created_at: new Date().toISOString(),
  });
}

async function createTicketWithPublicId(payload) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await insertTicket({
        ...payload,
        publicId: generatePublicId(),
      });
    } catch (err) {
      lastError = err;
      if (err && err.code === UNIQUE_VIOLATION) continue;
      throw err;
    }
  }
  throw lastError || new Error('Could not allocate a ticket id');
}

async function createMerchantTicket(shopDomain, input = {}) {
  const { domain, category, subject, body, replyEmail } = validateCreateInput(
    normalizeShopDomain(shopDomain),
    input
  );

  await assertCanCreateTicket(domain);
  const diagnostics = await buildDiagnostics(domain);
  const ticket = await createTicketWithPublicId({
    shopDomain: domain,
    category,
    subject,
    status: 'open',
    replyEmail,
    diagnostics,
  });
  const message = await insertMessage({
    ticketId: ticket.id,
    author: 'merchant',
    body,
  });
  await notifyNewTicket(ticket, body);
  return {
    ticket: presentMerchantTicket({ ...ticket, messages: [message] }, { includeMessages: true }),
    messages: [presentMessage(message)],
  };
}

async function addMerchantMessage(shopDomain, publicId, bodyRaw) {
  const ticket = await getTicketByPublicId(publicId, { shopDomain });
  if (!ticket) {
    const error = new Error('Ticket not found');
    error.status = 404;
    throw error;
  }
  if (ticket.status === 'closed') {
    const error = new Error('This ticket is closed');
    error.status = 400;
    throw error;
  }
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const replyCount = await countMerchantMessagesSince(normalizeShopDomain(shopDomain), since);
  if (isCreateRateLimited(replyCount, REPLY_LIMIT_PER_HOUR)) {
    const error = new Error('Too many support replies in the last hour. Try again later.');
    error.status = 429;
    throw error;
  }
  const body = normalizeBody(bodyRaw);
  if (!body) {
    const error = new Error('Message is required');
    error.status = 400;
    throw error;
  }
  const message = await insertMessage({ ticketId: ticket.id, author: 'merchant', body });
  const updated =
    (await updateTicketStatus(ticket.id, 'waiting_staff')) || { ...ticket, status: 'waiting_staff' };
  await notifyMerchantReply(updated, body);
  return {
    ticket: presentMerchantTicket(updated),
    message: presentMessage(message),
  };
}

async function getMerchantTicket(shopDomain, publicId) {
  const ticket = await getTicketByPublicId(publicId, { shopDomain });
  if (!ticket) return null;
  const messages = await listMessagesForTicket(ticket.id);
  return presentMerchantTicket({ ...ticket, messages }, { includeMessages: true });
}

async function listMerchantTickets(shopDomain) {
  const tickets = await listTicketsForShop(shopDomain);
  return tickets.map((ticket) => presentMerchantTicket(ticket));
}

async function addStaffMessage(publicId, bodyRaw) {
  const ticket = await getTicketByPublicId(publicId);
  if (!ticket) {
    const error = new Error('Ticket not found');
    error.status = 404;
    throw error;
  }
  if (ticket.status === 'closed') {
    const error = new Error('This ticket is closed. Reopen it before replying.');
    error.status = 400;
    throw error;
  }
  const body = normalizeBody(bodyRaw);
  if (!body) {
    const error = new Error('Message is required');
    error.status = 400;
    throw error;
  }
  const message = await insertMessage({ ticketId: ticket.id, author: 'staff', body });
  const updated =
    (await updateTicketStatus(ticket.id, 'waiting_merchant')) || {
      ...ticket,
      status: 'waiting_merchant',
    };
  await notifyStaffReply(updated, body);
  return {
    ticket: presentStaffTicket(updated),
    message: presentMessage(message),
  };
}

async function setStaffTicketStatus(publicId, statusRaw) {
  const status = normalizeStatus(statusRaw);
  if (!status) {
    const error = new Error('Invalid status');
    error.status = 400;
    throw error;
  }
  const ticket = await getTicketByPublicId(publicId);
  if (!ticket) {
    const error = new Error('Ticket not found');
    error.status = 404;
    throw error;
  }
  const previousStatus = ticket.status;
  const updated = await updateTicketStatus(ticket.id, status);
  if (!updated) await touchTicket(ticket.id);
  const next = updated || ticket;
  if (updated && previousStatus !== next.status) {
    await notifyStatusChange(next, previousStatus);
  }
  return presentStaffTicket(next);
}

async function getStaffTicket(publicId) {
  const ticket = await getTicketByPublicId(publicId);
  if (!ticket) return null;
  const messages = await listMessagesForTicket(ticket.id);
  return presentStaffTicket({ ...ticket, messages }, { includeMessages: true });
}

async function listStaffTickets(filters = {}) {
  const tickets = await listTicketsForStaff(filters);
  return tickets.map((ticket) => presentStaffTicket(ticket, { includeDiagnostics: false }));
}

module.exports = {
  TICKET_CATEGORIES,
  TICKET_STATUSES,
  CREATE_LIMIT_PER_HOUR,
  REPLY_LIMIT_PER_HOUR,
  BODY_MAX_CHARS,
  isPublicIdFormat,
  normalizeCategory,
  normalizeStatus,
  normalizeSubject,
  normalizeBody,
  normalizeReplyEmail,
  assertCanCreateTicket,
  buildDiagnostics,
  createMerchantTicket,
  addMerchantMessage,
  getMerchantTicket,
  listMerchantTickets,
  addStaffMessage,
  setStaffTicketStatus,
  getStaffTicket,
  listStaffTickets,
  listTicketsForStaff,
  presentMerchantTicket,
  presentStaffTicket,
  deleteTicketsForShop,
};
