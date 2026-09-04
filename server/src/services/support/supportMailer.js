const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });

const logger = require('../../utils/logger');
const { summarizeDiagnostics } = require('./supportDiagnostics');

const DEFAULT_STAFF_NOTIFY_EMAIL = 'ripon@echologyx.com';

const TICKET_CATEGORY_LABELS = {
  setup: 'Setup / checkout',
  launch: 'Launch',
  preview: 'Preview / QR',
  live: 'Live prices',
  offers: 'Offers',
  billing: 'Billing / plan',
  privacy: 'Privacy / delete',
  other: 'Other',
};

const TICKET_STATUS_LABELS = {
  open: 'Open',
  waiting_merchant: 'Waiting on merchant',
  waiting_staff: 'Waiting on you',
  resolved: 'Resolved',
  closed: 'Closed',
};

function normalizeNotifyEmail(value) {
  const email = String(value || '')
    .trim()
    .toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return email;
}

function supportInbox() {
  return normalizeNotifyEmail(process.env.RIPSPRICEX_SUPPORT_EMAIL) || DEFAULT_STAFF_NOTIFY_EMAIL;
}

function supportNotifyAddressing() {
  const extras = String(process.env.RIPSPRICEX_SUPPORT_EMAIL || '')
    .split(',')
    .map(normalizeNotifyEmail)
    .filter((email) => email && email !== DEFAULT_STAFF_NOTIFY_EMAIL);
  return {
    to: DEFAULT_STAFF_NOTIFY_EMAIL,
    bcc: [...new Set(extras)],
  };
}

function supportNotifyRecipients() {
  const { to, bcc } = supportNotifyAddressing();
  return [to, ...bcc];
}

function isTicketNotifySuppressed() {
  return String(process.env.RIPSPRICEX_SUPPORT_MAIL_STUB || '').trim().toLowerCase() === 'true';
}

function ticketCategoryLabel(category) {
  const key = String(category || '').toLowerCase();
  return TICKET_CATEGORY_LABELS[key] || String(category || 'Other');
}

function ticketStatusLabel(status) {
  const key = String(status || '').toLowerCase();
  return TICKET_STATUS_LABELS[key] || String(status || 'Open');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ticketNotifyKindLabel(kind) {
  switch (String(kind || '')) {
    case 'created':
      return 'New ticket';
    case 'merchant_reply':
      return 'Merchant reply';
    case 'staff_reply':
      return 'Staff reply';
    case 'status':
      return 'Status updated';
    default:
      return 'Ticket updated';
  }
}

function isAbsoluteHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function staffTicketUrl(publicId) {
  const base = String(process.env.SHOPIFY_APP_URL || process.env.APP_URL || '')
    .trim()
    .replace(/\/+$/, '');
  const path = `/staff/support/${encodeURIComponent(publicId)}`;
  return base ? `${base}${path}` : path;
}

function ticketThreadId(publicId) {
  const id = String(publicId || '')
    .trim()
    .toUpperCase();
  return id ? `<priceify-ticket-${id}@echologyx.com>` : '';
}

function ticketMailHeaders(publicId, kind) {
  const root = ticketThreadId(publicId);
  if (!root) return {};
  if (kind === 'created') return { messageId: root };
  const stamp = `${kind || 'update'}-${Date.now()}`;
  const id = String(publicId || '')
    .trim()
    .toUpperCase();
  return {
    messageId: `<priceify-ticket-${id}-${stamp}@echologyx.com>`,
    inReplyTo: root,
    references: root,
  };
}

const DEFAULT_SMTP_FROM = 'abtesting-noreply@echologyx.com';

function firstEnv(...keys) {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) return value;
  }
  return '';
}

function isSupportMailerConfigured() {
  const resendKey = firstEnv('RESEND_API_KEY');
  const resendFrom = firstEnv('RESEND_FROM', 'RIPSPRICEX_SUPPORT_EMAIL');
  if (resendKey && resendFrom) return true;
  return Boolean(smtpConfig());
}

function formatFromAddress(from) {
  const raw = String(from || DEFAULT_SMTP_FROM).trim() || DEFAULT_SMTP_FROM;
  if (raw.includes('<')) return raw;
  return `Priceify <${raw}>`;
}

function staffLoginCodeEmail({ code, expiresMinutes = 1 } = {}) {
  const digits = String(code || '').replace(/\D/g, '');
  const minutes = Number(expiresMinutes) || 1;
  const unit = minutes === 1 ? 'minute' : 'minutes';
  const text = [
    `Your sign-in code is ${digits}.`,
    '',
    `It expires in ${minutes} ${unit}.`,
    'If you did not request this, you can ignore this email.',
  ].join('\n');
  return {
    subject: 'Your Priceify staff sign-in code',
    text,
    html: [
      '<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#faf7f2;font-family:Inter,Arial,sans-serif;color:#1c1917;line-height:1.5">',
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #eadfd4;border-radius:16px">',
      '<tr><td style="padding:24px 28px">',
      '<p style="margin:0 0 8px;color:#fc4c02;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase">Priceify staff</p>',
      '<p style="margin:0 0 16px">Your sign-in code is</p>',
      `<p style="margin:0 0 16px;letter-spacing:0.2em;font-size:28px;font-weight:700">${digits}</p>`,
      `<p style="margin:0 0 16px">It expires in ${minutes} ${unit}.</p>`,
      '<p style="margin:0;color:#57534e">If you did not request this, you can ignore this email.</p>',
      '</td></tr></table>',
      '</body></html>',
    ].join(''),
  };
}

async function sendStaffLoginCode(to, code, expiresMinutes = 1) {
  const mail = staffLoginCodeEmail({ code, expiresMinutes });
  return sendSupportMail({ to, subject: mail.subject, text: mail.text, html: mail.html });
}

function smtpConfig() {
  const host = firstEnv('SMTP_HOST', 'MAIL_HOST', 'RIPSPRICEX_SUPPORT_SMTP_HOST');
  const user = firstEnv('SMTP_USER', 'MAIL_USER', 'RIPSPRICEX_SUPPORT_SMTP_USER');
  const pass = firstEnv('SMTP_PASS', 'MAIL_PASS', 'RIPSPRICEX_SUPPORT_SMTP_PASS');
  if (!host || !user || !pass) return null;
  const port = Number(firstEnv('SMTP_PORT', 'MAIL_PORT', 'RIPSPRICEX_SUPPORT_SMTP_PORT') || '587');
  const secureFlag = firstEnv('SMTP_SECURE', 'RIPSPRICEX_SUPPORT_SMTP_SECURE').toLowerCase();
  const secure = secureFlag === 'true' || port === 465;
  return {
    host,
    port,
    secure,
    requireTLS: (port === 587 || port === 25) && !secure,
    user,
    pass,
    from: formatFromAddress(
      firstEnv('SMTP_FROM', 'MAIL_FROM', 'RIPSPRICEX_SUPPORT_SMTP_FROM') || DEFAULT_SMTP_FROM
    ),
  };
}

async function sendViaResend({ to, bcc, replyTo, subject, text, html, messageId, inReplyTo, references }) {
  const key = String(process.env.RESEND_API_KEY || '').trim();
  if (!key) return false;
  const from = String(process.env.RESEND_FROM || process.env.RIPSPRICEX_SUPPORT_EMAIL || '').trim();
  if (!from) return false;
  const payload = { from, to: Array.isArray(to) ? to : [to], subject, text };
  if (html) payload.html = html;
  if (bcc && bcc.length) payload.bcc = bcc;
  if (replyTo) payload.reply_to = replyTo;
  if (messageId || inReplyTo || references) {
    payload.headers = {
      ...(messageId ? { 'Message-ID': messageId } : {}),
      ...(inReplyTo ? { 'In-Reply-To': inReplyTo } : {}),
      ...(references ? { References: references } : {}),
    };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend ${res.status} ${detail}`.trim());
  }
  return true;
}

async function sendViaSmtp({ to, bcc, replyTo, subject, text, html, messageId, inReplyTo, references }) {
  const smtp = smtpConfig();
  if (!smtp) return false;
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch {
    logger.warn('support mailer: SMTP configured but nodemailer is not installed');
    return false;
  }
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: smtp.requireTLS,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    auth: { user: smtp.user, pass: smtp.pass },
  });
  await transporter.sendMail({
    from: smtp.from,
    to,
    bcc: bcc && bcc.length ? bcc.join(', ') : undefined,
    replyTo: replyTo || undefined,
    subject,
    text,
    html,
    messageId: messageId || undefined,
    inReplyTo: inReplyTo || undefined,
    references: references || undefined,
  });
  return true;
}

function normalizeMailRecipients(to) {
  const list = Array.isArray(to) ? to : String(to || '').split(',');
  return [...new Set(list.map(normalizeNotifyEmail).filter(Boolean))];
}

async function sendSupportMail({
  to,
  bcc,
  replyTo,
  subject,
  text,
  html,
  messageId,
  inReplyTo,
  references,
} = {}) {
  const dests = normalizeMailRecipients(to);
  const copies = normalizeMailRecipients(bcc).filter((email) => !dests.includes(email));
  if (!dests.length) return { sent: false, reason: 'no_recipient' };
  const extras = { bcc: copies, replyTo: normalizeNotifyEmail(replyTo), messageId, inReplyTo, references };
  try {
    if (await sendViaResend({ to: dests, subject, text, html, ...extras })) {
      return { sent: true, via: 'resend' };
    }
    if (await sendViaSmtp({ to: dests.join(', '), subject, text, html, ...extras })) {
      return { sent: true, via: 'smtp' };
    }
    logger.info('support ticket mail skipped (no mailer)', { to: dests, subject });
    return { sent: false, reason: 'no_mailer' };
  } catch (err) {
    logger.warn('support ticket mail failed', { message: err.message, subject });
    return { sent: false, reason: err.message };
  }
}

function ticketNotifyEmail({ kind, ticket = {}, body = '', previousStatus = '' } = {}) {
  const id = String(ticket.public_id || '').trim();
  const event = ticketNotifyKindLabel(kind);
  const subjectLine = String(ticket.subject || '').trim() || 'Priceify support';
  const url = staffTicketUrl(id);
  const absoluteUrl = isAbsoluteHttpUrl(url);
  const category = ticketCategoryLabel(ticket.category);
  const status = ticketStatusLabel(ticket.status);
  const previous = previousStatus ? ticketStatusLabel(previousStatus) : '';
  const message = String(body || '').trim();
  const diagnosticRows = kind === 'created' ? summarizeDiagnostics(ticket.diagnostics) : [];
  const text = [
    `${event}: ${id}`,
    `Shop: ${ticket.shop_domain || ''}`,
    `Category: ${category}`,
    `Subject: ${subjectLine}`,
    previous && kind === 'status' ? `Status: ${previous} → ${status}` : `Status: ${status}`,
    `Reply-to: ${ticket.reply_email || 'none'}`,
    '',
    message,
    diagnosticRows.length ? '' : null,
    ...diagnosticRows.map(([label, value]) => `${label}: ${value}`),
    '',
    absoluteUrl ? `Open in staff queue: ${url}` : 'Open this ticket in the Priceify staff queue.',
  ]
    .filter((line) => line != null)
    .join('\n');
  const statusRow =
    previous && kind === 'status'
      ? `${escapeHtml(previous)} → ${escapeHtml(status)}`
      : escapeHtml(status);
  const html = [
    '<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#faf7f2;font-family:Inter,Arial,sans-serif;color:#1c1917;line-height:1.5">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #eadfd4;border-radius:16px">',
    '<tr><td style="padding:24px 28px">',
    '<p style="margin:0 0 8px;color:#fc4c02;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase">Priceify staff</p>',
    `<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:0.04em;color:#fc4c02">${escapeHtml(id)}</p>`,
    `<p style="margin:0 0 16px;font-size:22px;font-weight:700;letter-spacing:-0.4px">${escapeHtml(event)}</p>`,
    `<p style="margin:0 0 16px;font-weight:650">${escapeHtml(subjectLine)}</p>`,
    '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;color:#57534e">',
    `<tr><td style="padding:0 0 6px">Shop</td><td style="padding:0 0 6px;color:#1c1917">${escapeHtml(ticket.shop_domain || '')}</td></tr>`,
    `<tr><td style="padding:0 0 6px">Category</td><td style="padding:0 0 6px;color:#1c1917">${escapeHtml(category)}</td></tr>`,
    `<tr><td style="padding:0 0 6px">Status</td><td style="padding:0 0 6px;color:#1c1917">${statusRow}</td></tr>`,
    `<tr><td style="padding:0 0 6px">Reply-to</td><td style="padding:0 0 6px;color:#1c1917">${escapeHtml(ticket.reply_email || 'none')}</td></tr>`,
    ...diagnosticRows.map(
      ([label, value]) =>
        `<tr><td style="padding:0 0 6px">${escapeHtml(label)}</td><td style="padding:0 0 6px;color:#1c1917">${escapeHtml(value)}</td></tr>`
    ),
    '</table>',
    message
      ? `<p style="margin:16px 0 0;white-space:pre-wrap;color:#1c1917">${escapeHtml(message)}</p>`
      : '',
    absoluteUrl
      ? `<p style="margin:20px 0 0"><a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 16px;border-radius:999px;background:#fc4c02;color:#fff;font-weight:650;text-decoration:none">Open ticket</a></p>`
      : '<p style="margin:20px 0 0;color:#57534e">Open this ticket in the Priceify staff queue.</p>',
    '</td></tr></table>',
    '</body></html>',
  ].join('');
  return {
    subject: `[${id}] ${event}: ${subjectLine}`,
    text,
    html,
    replyTo: normalizeNotifyEmail(ticket.reply_email),
    ...ticketMailHeaders(id, kind),
  };
}

function enqueueTicketNotify(run) {
  setImmediate(() => {
    Promise.resolve()
      .then(run)
      .catch((err) => logger.warn('support ticket notify failed', { message: err.message }));
  });
}

async function sendTicketNotifyNow({ kind, ticket, body = '', previousStatus = '' } = {}) {
  const mail = ticketNotifyEmail({ kind, ticket, body, previousStatus });
  const addressing = supportNotifyAddressing();
  const result = await sendSupportMail({
    to: addressing.to,
    bcc: addressing.bcc,
    replyTo: mail.replyTo,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    messageId: mail.messageId,
    inReplyTo: mail.inReplyTo,
    references: mail.references,
  });
  if (!result.sent) {
    logger.info('support ticket notify skipped', {
      public_id: ticket?.public_id,
      kind,
      mail: result.reason,
    });
  } else {
    logger.info('support ticket notify sent', {
      public_id: ticket?.public_id,
      kind,
      via: result.via,
    });
  }
  return result;
}

async function notifyTicketEvent({ kind, ticket, body = '', previousStatus = '' } = {}) {
  if (isTicketNotifySuppressed()) return { sent: false, reason: 'suppressed' };
  enqueueTicketNotify(() => sendTicketNotifyNow({ kind, ticket, body, previousStatus }));
  return { sent: false, reason: 'queued' };
}

async function notifyNewTicket(ticket, firstMessage) {
  return notifyTicketEvent({ kind: 'created', ticket, body: firstMessage });
}

async function notifyStaffReply(ticket, body) {
  const inbox = await notifyTicketEvent({ kind: 'staff_reply', ticket, body });
  if (!ticket.reply_email) return inbox;
  if (isTicketNotifySuppressed()) return { sent: inbox.sent, inbox, merchant: { sent: false, reason: 'suppressed' } };
  enqueueTicketNotify(() =>
    sendSupportMail({
      to: ticket.reply_email,
      subject: `[${ticket.public_id}] Update on your Priceify support request`,
      text: [
        `Ticket ${ticket.public_id}`,
        '',
        body,
        '',
        'Reply in Shopify Admin → Priceify → Help.',
      ].join('\n'),
    })
  );
  return { sent: inbox.sent, inbox, merchant: { sent: false, reason: 'queued' } };
}

async function notifyMerchantReply(ticket, body) {
  return notifyTicketEvent({ kind: 'merchant_reply', ticket, body });
}

async function notifyStatusChange(ticket, previousStatus) {
  if (!ticket || String(ticket.status || '') === String(previousStatus || '')) {
    return { sent: false, reason: 'unchanged' };
  }
  return notifyTicketEvent({ kind: 'status', ticket, previousStatus });
}

module.exports = {
  DEFAULT_STAFF_NOTIFY_EMAIL,
  supportInbox,
  supportNotifyAddressing,
  supportNotifyRecipients,
  staffTicketUrl,
  firstEnv,
  escapeHtml,
  formatFromAddress,
  isSupportMailerConfigured,
  staffLoginCodeEmail,
  ticketNotifyEmail,
  sendStaffLoginCode,
  sendSupportMail,
  smtpConfig,
  notifyNewTicket,
  notifyStaffReply,
  notifyMerchantReply,
  notifyStatusChange,
  notifyTicketEvent,
};
