export const HELP_FAQ_ITEMS = [
  {
    q: 'Checkout is not ready / Launch is blocked',
    a: 'Open Setup and work the checklist in order: enable the theme app embed, ensure cart transform, ensure the checkout discount function, then map PDP price selectors under Settings → Price surfaces. Re-check readiness on Setup. Offer tests need the checkout discount; price tests also need cart transform and mapped selectors.',
  },
  {
    q: 'Shoppers do not see the offer under the product price',
    a: 'Offer tests apply the discount at checkout. On the product page, assigned shoppers see a sale cutout (catalog price struck through plus the offer price) and the offer message — or the offer amount if you left the message empty — directly under that cutout on live and Preview (Dawn and Horizon-style themes). If several offer tests target the same product, shoppers see the newest one. Enable the theme app embed and map the PDP price selector under Settings → Price surfaces if your theme uses a custom price block.',
  },
  {
    q: 'Preview, QR, or copy link is wrong',
    a: 'Preview opens the storefront product page with a preview query so you see that variation only. Offer tests show the sale cutout and the assigned message or offer amount under the product price. If either is missing, confirm the theme embed is enabled and the PDP price selector is mapped, then retry Preview from the Variations tab.',
  },
  {
    q: 'I edited audience or metrics on a live test',
    a: 'Saving audience or metrics updates the plan. Visitors already assigned stay on the targeting from launch until you pause and relaunch. Draft and queued experiments pick up the new targeting on start.',
  },
  {
    q: 'Pause, resume, or apply a winner',
    a: 'Pause stops new assignments. Resume continues the same test. Apply winner writes the winning price to the catalog when you confirm — it does not happen automatically. Check the Activity tab for those events.',
  },
  {
    q: 'Create is locked',
    a: 'Create and Launch unlock with an active Smart Pricing plan. Open Settings → Plan to subscribe or confirm entitlement.',
  },
  {
    q: 'How do I contact support?',
    a: 'Use New ticket on this page. We attach shop diagnostics automatically and give you a ticket id (PX-…). Only this shop can open that id. If support replies, the ticket shows Waiting on you — open it here and add a follow-up. If the app is not installed, use the public Contact page or the App Store listing.',
  },
  {
    q: 'What happens to tickets if I uninstall?',
    a: 'Uninstall deletes this shop’s support tickets and messages. File a new ticket after you reinstall.',
  },
];

export const TICKET_CATEGORY_OPTIONS = [
  { value: 'setup', label: 'Setup / checkout' },
  { value: 'launch', label: 'Launch' },
  { value: 'preview', label: 'Preview / QR' },
  { value: 'live', label: 'Live prices' },
  { value: 'offers', label: 'Offers' },
  { value: 'billing', label: 'Billing / plan' },
  { value: 'privacy', label: 'Privacy / delete' },
  { value: 'other', label: 'Other' },
];

export function isPublicIdFormat(value) {
  return /^PX-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(String(value || '').trim().toUpperCase());
}

export function ticketCategoryLabel(category) {
  const match = TICKET_CATEGORY_OPTIONS.find((option) => option.value === category);
  return match ? match.label : String(category || '');
}

export function formatTicketTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

export function ticketStatusLabel(status, { staff = false } = {}) {
  switch (String(status || '').toLowerCase()) {
    case 'open':
      return 'Open';
    case 'waiting_merchant':
      return staff ? 'Waiting on merchant' : 'Waiting on you';
    case 'waiting_staff':
      return staff ? 'Waiting on you' : 'Waiting on support';
    case 'resolved':
      return 'Resolved';
    case 'closed':
      return 'Closed';
    default:
      return String(status || 'Open');
  }
}

export function pickAttentionTicket(tickets) {
  const list = Array.isArray(tickets) ? tickets : [];
  const waiting = list.find(
    (ticket) => String(ticket?.status || '').toLowerCase() === 'waiting_merchant' && ticket.public_id,
  );
  return waiting?.public_id || null;
}

/** List-level prompt: hide when that ticket is already open. */
export function attentionTicketToPrompt(tickets, selectedId) {
  const id = pickAttentionTicket(tickets);
  if (!id) return null;
  if (String(selectedId || '').trim().toUpperCase() === String(id).toUpperCase()) {
    return null;
  }
  return id;
}

export function shouldAutoOpenAttention({ ticketId, view } = {}) {
  if (String(ticketId || '').trim()) return false;
  return String(view || '').trim().toLowerCase() !== 'all';
}

export function merchantTicketLookupError(status, fallback = 'Ticket not found') {
  if (Number(status) === 404) return 'That ticket is not on this shop.';
  if (Number(status) === 400) return 'Invalid ticket id';
  return fallback;
}

export function ticketMerchantHint(status) {
  switch (String(status || '').toLowerCase()) {
    case 'waiting_merchant':
      return 'Support replied. Add a follow-up if you still need help.';
    case 'waiting_staff':
      return 'We have your latest message and will reply here.';
    case 'resolved':
      return 'Marked resolved. Reply if something is still wrong.';
    case 'closed':
      return 'This ticket is closed.';
    default:
      return 'We have your ticket and will reply here.';
  }
}
