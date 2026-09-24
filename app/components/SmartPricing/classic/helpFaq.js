/** Shared vocabulary (Global naming principles). */
export const HELP_GLOSSARY_TERMS = [
  { term: 'Test', definition: 'A single price or offer comparison you run in Priceify.' },
  {
    term: 'Price test',
    definition: 'Changes the actual price shown to shoppers, without a crossed-out original.',
  },
  {
    term: 'Offer test',
    definition: 'Shows a sale price with the original price crossed out.',
  },
  { term: 'Control', definition: 'The current price your store already uses.' },
  {
    term: 'Variation',
    definition: 'A different price or offer you’re testing against control.',
  },
  {
    term: 'Revenue per visitor',
    definition: 'Revenue generated divided by number of visitors who saw the test.',
  },
  {
    term: 'Confidence',
    definition: 'How sure the maths is that one variation is better than another.',
  },
  {
    term: 'Minimum visitors per variation',
    definition:
      'The number of visitors each variation must see before results are calculated.',
  },
  {
    term: 'Revenue guardrail',
    definition:
      'Per-test limit on revenue-per-visitor drop vs control. After about 100 visitors per variation, Priceify pauses the test if a variation falls more than your threshold below control.',
  },
  {
    term: 'Results settings',
    definition:
      'Shop-wide confidence level and minimum visitors per variation (Settings → Results settings).',
  },
  {
    term: 'Price locations',
    definition:
      'The pages where prices appear (product, collection, cart, search, home).',
  },
  {
    term: 'Theme selector',
    definition: 'The CSS selector Priceify uses to find a price on your theme.',
  },
];

export const HELP_FAQ_ITEMS = [
  {
    q: 'Checkout is not ready / Launch is blocked',
    a: 'Open Store setup and work the checklist in order: complete Theme connection, install Checkout pricing functions (one button covers dynamic cart prices and checkout discounts), then map price locations under Settings → Price locations. Refresh status on Store setup when you change something. Offer tests need checkout discounts; price tests also need Checkout pricing functions and mapped price locations. Store setup reads your live theme, so a step already done shows as enabled rather than asking you to confirm it.',
  },
  {
    q: 'Shoppers do not see the offer under the product price',
    a: 'Offer tests apply the discount at checkout. On the product page, assigned shoppers see a sale cutout (catalog price struck through plus the offer price) and the offer message — or the offer amount if you left the message empty — directly under that cutout on live and Preview (Dawn and Horizon-style themes). If several offer tests target the same product, shoppers see the newest one. Finish Theme connection on Store setup and map price locations under Settings if your theme uses a custom price block.',
  },
  {
    q: 'Preview, QR, or copy link is wrong',
    a: 'Preview and Open land on the storefront product page (not an app URL). Each click clears the previous preview bucket for that browser, then keeps the new variation in session storage and a session cookie so theme navigation stays on that arm. Price tests keep the anti-flicker guard on the PDP. Offer tests show the sale cutout and the assigned message or offer amount under the product price. If either is missing, confirm Theme connection on Store setup and price locations in Settings, then retry Preview from the test Overview tab.',
  },
  {
    q: 'How does sample size and significance work?',
    a: 'A result needs two floors per variation: a minimum number of visitors and a minimum number of conversions. Visitors alone cannot settle a price test, because the comparison is between conversion rates and revenue per visitor, and both are driven by order counts — 5,000 visitors at a 0.4% conversion rate is 20 orders, and a lift measured on 20 orders usually disappears as the test continues. Review shows a 2–8 week collection range only when measured or modeled traffic makes that window realistic, timed from whichever floor takes longer to reach; otherwise it shows the traffic needed instead of a multi-year forecast. Broadening a low-traffic audience yourself will shorten collection, but nothing lowers either floor to manufacture a shorter answer. Results are read with a sequential boundary so checking them early does not inflate false positives. Open Guides from a Settings info icon for the full explanation.',
  },
  {
    q: 'How does AI price Suggest work?',
    a: 'On Products, AI suggested mode fills test-variation prices inside your min–max band, then clamps them to shop max price change and a cost-aware min-margin floor. Control stays at the catalog price. Variations are spread across the full band rather than bunched together, because prices a point or two apart cannot be told apart at real store traffic. Every cell stays editable before launch. Open the info icon next to AI Price Suggestions for the full calculation.',
  },
  {
    q: 'What does Suggest send to the AI?',
    a: 'Per product you selected: its title, current price, margin percent, units sold in the last 30 days, its opportunity score, and Priceify’s own read on how hard it can be pushed. Plus your variation names, the min–max band you typed, the test metric, and your shop price safety limits (max price change and minimum margin). Nothing about a shopper is sent: no customer details, orders, or visitor data. Your shop domain and your Shopify product ids are not sent either, and nothing is stored or reused, so each click asks fresh. The reply is re-checked against your own catalog prices and limits before it becomes a price, so a suggestion cannot exceed your guardrails even if the model ignores them.',
  },
  {
    q: 'The prices filled in but the banner says they are not from AI',
    a: 'Suggest always fills the table, and says where the numbers came from. An even spread across your band is used instead of the model when the band is set in dollars (one flat cash uplift cannot be expressed as one percentage across products at different prices), when AI is unavailable or switched off, when the reply comes back unusable, and for any product past the first 40 in one request. If only some prices fell back, the banner says how many. Prices from the even spread respect the same guardrails and are just as launchable — you can edit any of them, or click Re-suggest to try again.',
  },
  {
    q: 'I edited audience or metrics on a live test',
    a: 'Saving audience or metrics updates the plan. Visitors already assigned stay on the targeting from launch until you pause and relaunch. Draft and queued tests pick up the new targeting on start.',
  },
  {
    q: 'Pause, resume, or apply a winner',
    a: 'Pause stops new assignments. Resume continues the same test. Apply winner is available as soon as a result clears its sample floors, and you should still review effect size and guardrails before using it. A price is written automatically only for conversion-rate results that an exact boundary confirms, after 14 days and with a healthy traffic split; revenue per visitor always waits for your manual review. A control decision leaves the catalog price unchanged. Offer tests end that product without changing catalog prices. Check the History tab for those events.',
  },
  {
    q: 'One product finished but the others have not — do I have to end the whole test?',
    a: 'No. Every product in a test is its own measurement and finishes on its own schedule. On the Overview tab, Product performance by variation lists each product; use Apply winner on a row when it is ready, or Apply ready products when several are ready. Apply on a row writes that product’s price and stops only that product; Apply ready products does every finished one at once and leaves the rest running. Products where control won, or offer tests, finish without a catalog change. You are emailed once per product the first time it reaches a decision, and if automatic writes are on there is a review window — three days by default — before Priceify applies anything itself.',
  },
  {
    q: 'Create is locked',
    a: 'Finish setup to start your first test. Subscribe or confirm your Priceify plan under Settings → Plan & usage, then complete Store setup (Theme connection, Checkout pricing functions, and price locations).',
  },
  {
    q: 'Where is the revenue guardrail?',
    a: 'On each test — Audience & goals when you create it, and Settings on the test after launch. It is not in Results settings. Choose 3%–50% (default 10%); after about 100 visitors per variation, Priceify pauses if revenue per visitor drops further below control than your threshold. Max price change and margin limits are enforced on Products & prices, not here.',
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

/**
 * Help is two jobs, so it is two tabs: reading an answer and talking to us.
 * Anything needing the merchant still shows on both, above the tab content.
 */
export const HELP_TABS = [
  { id: 'answers', label: 'Answers' },
  { id: 'tickets', label: 'Support tickets' },
];

/**
 * Which half of Help to show.
 *
 * Reading a ticket is not something you opt into by picking a tab — the loader
 * sends you straight to a reply support is waiting on. So an open ticket wins
 * over whatever `tab` says, and the two can never disagree on screen.
 */
export function resolveHelpTab(tabParam, { hasSelectedTicket = false } = {}) {
  if (hasSelectedTicket) return 'tickets';
  return String(tabParam || '').trim().toLowerCase() === 'tickets' ? 'tickets' : 'answers';
}

/** Tickets the merchant has to answer, counted for the tab label. */
export function countTicketsAwaitingMerchant(tickets) {
  const list = Array.isArray(tickets) ? tickets : [];
  return list.filter(
    (ticket) => String(ticket?.status || '').toLowerCase() === 'waiting_merchant',
  ).length;
}

/** Case-insensitive match of a query against a question and its answer. */
export function filterHelpFaq(items, query) {
  const list = Array.isArray(items) ? items : [];
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return list;
  return list.filter((item) => `${item?.q || ''} ${item?.a || ''}`.toLowerCase().includes(needle));
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
