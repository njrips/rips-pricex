const { sanitizeDiagnostics } = require('./supportDiagnostics');

function presentMessage(message) {
  if (!message) return null;
  return {
    id: message.id,
    author: message.author,
    body: message.body,
    created_at: message.created_at,
  };
}

function presentMerchantTicket(ticket, { includeMessages = false } = {}) {
  if (!ticket) return null;
  const out = {
    public_id: ticket.public_id,
    category: ticket.category,
    subject: ticket.subject,
    status: ticket.status,
    reply_email: ticket.reply_email || null,
    created_at: ticket.created_at,
    updated_at: ticket.updated_at,
  };
  if (ticket.last_message_preview !== undefined) {
    out.last_message_preview = ticket.last_message_preview;
    out.last_message_author = ticket.last_message_author || null;
  }
  if (includeMessages) {
    out.messages = Array.isArray(ticket.messages)
      ? ticket.messages.map(presentMessage).filter(Boolean)
      : [];
  }
  return out;
}

function presentStaffTicket(ticket, { includeMessages = false, includeDiagnostics = true } = {}) {
  if (!ticket) return null;
  const out = {
    public_id: ticket.public_id,
    shop_domain: ticket.shop_domain,
    category: ticket.category,
    subject: ticket.subject,
    status: ticket.status,
    reply_email: ticket.reply_email || null,
    created_at: ticket.created_at,
    updated_at: ticket.updated_at,
  };
  if (includeDiagnostics) {
    out.diagnostics = sanitizeDiagnostics(ticket.diagnostics || {});
  }
  if (ticket.last_message_preview !== undefined) {
    out.last_message_preview = ticket.last_message_preview;
    out.last_message_author = ticket.last_message_author || null;
  }
  if (includeMessages) {
    out.messages = Array.isArray(ticket.messages)
      ? ticket.messages.map(presentMessage).filter(Boolean)
      : [];
  }
  return out;
}

module.exports = {
  presentMessage,
  presentMerchantTicket,
  presentStaffTicket,
};
