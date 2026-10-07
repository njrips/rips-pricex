/**
 * Lightweight HTML probe for price-surface auto-map (no DOM library dependency).
 * Validates class/attribute CSS selectors common in Shopify themes and discovers
 * price-like candidates from class tokens and surrounding text.
 */

const PRICE_CLASS_HINT =
  /(price|money|amount|compare|sale|regular|unit-price|was-price|cost|cart-item__price)/i;
const CURRENCY_MARK =
  '[$€£¥₹৳₱₩₺₫₦₴₽₪]|\\b(?:r\\$|usd|eur|gbp|cad|aud|nzd|sgd|hkd|chf|sek|nok|dkk|pln|czk|huf|inr|bdt|pkr|aed|sar|jpy|myr|php|zar|kr|zł|rs\\.?|tk|lei|kč|ft)';
const PRICE_TEXT_HINT = new RegExp(
  `(?:${CURRENCY_MARK}|sale|from)\\s*[-+]?\\d|[-+]?\\d[\\d.,\\s\\u00a0]*\\s*(?:${CURRENCY_MARK})(?![a-z])`,
  'i'
);
const MONEY_NUMBER_RE = /\d[\d.,'\u00a0\u202f ]*\d|\d/g;

const PREFERRED_CLASS_BONUS = Object.freeze({
  'compare-at-price': 52,
  'price-item--compare': 50,
  'price-item--regular': 55,
  'price-item__regular': 50,
  'price-item--sale': 28,
  product__price: 35,
  'cart-item__price': 35,
  money: 32,
  'price-item': 12,
  price: 10,
});

function tokenizeCssSelector(selector) {
  return String(selector || '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}

function extractSimpleClasses(part) {
  const classes = [];
  const classRe = /\.([a-zA-Z0-9_-]+)/g;
  let match;
  while ((match = classRe.exec(part))) {
    classes.push(match[1]);
  }
  return classes;
}

function extractAttrSelectors(part) {
  const attrs = [];
  const attrRe = /\[([a-zA-Z0-9_-]+)(?:=(["']?)([^"'\]]*)\2)?\]/g;
  let match;
  while ((match = attrRe.exec(part))) {
    attrs.push({
      name: match[1],
      value: match[3] !== null && match[3] !== undefined ? match[3] : null,
    });
  }
  return attrs;
}

function classTokenPresent(html, className) {
  const escaped = String(className).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`class\\s*=\\s*["'][^"']*\\b${escaped}\\b[^"']*["']`, 'i');
  return re.test(html);
}

function countClassTokenOccurrences(html, className) {
  const escaped = String(className).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`class\\s*=\\s*["'][^"']*\\b${escaped}\\b[^"']*["']`, 'gi');
  const matches = String(html || '').match(re);
  return matches ? matches.length : 0;
}

function attrPresent(html, name, value) {
  const escapedName = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (value === null || value === undefined || value === '') {
    return new RegExp(`\\[${escapedName}\\]|\\b${escapedName}\\s*=`, 'i').test(html);
  }
  const escapedValue = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `${escapedName}\\s*=\\s*["'][^"']*\\b${escapedValue}\\b[^"']*["']|${escapedName}\\s*=\\s*["']${escapedValue}["']`,
    'i'
  ).test(html);
}

function extractLeadingTag(part) {
  const trimmed = String(part || '').trim();
  const match = trimmed.match(/^([a-z][a-z0-9]*)(?=[.#[:])/i);
  return match ? match[1].toLowerCase() : '';
}

function tagAndClassPresent(html, tag, className) {
  const escapedTag = String(tag).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedClass = String(className).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `<${escapedTag}\\b[^>]*class\\s*=\\s*["'][^"']*\\b${escapedClass}\\b[^"']*["']`,
    'i'
  );
  return re.test(html);
}

function countTagAndClassOccurrences(html, tag, className) {
  const escapedTag = String(tag).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedClass = String(className).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `<${escapedTag}\\b[^>]*class\\s*=\\s*["'][^"']*\\b${escapedClass}\\b[^"']*["']`,
    'gi'
  );
  const matches = String(html || '').match(re);
  return matches ? matches.length : 0;
}

function partMatchesHtml(html, part) {
  const classes = extractSimpleClasses(part);
  const attrs = extractAttrSelectors(part);
  const tag = extractLeadingTag(part);
  if (!classes.length && !attrs.length) {
    return false;
  }
  const classesOk = tag
    ? classes.every(cls => tagAndClassPresent(html, tag, cls))
    : classes.every(cls => classTokenPresent(html, cls));
  const attrsOk = attrs.every(attr => attrPresent(html, attr.name, attr.value));
  return classesOk && attrsOk;
}

/**
 * Count how many OR-branches of a CSS selector appear to match the HTML.
 * @param {string} html
 * @param {string} selector
 * @returns {{ matchCount: number, matchedParts: string[], occurrenceCount: number }}
 */
function scoreSelectorAgainstHtml(html, selector) {
  const raw = String(html || '');
  const parts = tokenizeCssSelector(selector);
  const matchedParts = parts.filter(part => partMatchesHtml(raw, part));
  let occurrenceCount = 0;
  for (const part of matchedParts) {
    const classes = extractSimpleClasses(part);
    const tag = extractLeadingTag(part);
    if (classes.length) {
      const counts = classes.map(cls =>
        tag ? countTagAndClassOccurrences(raw, tag, cls) : countClassTokenOccurrences(raw, cls)
      );
      occurrenceCount += Math.max(...counts, 0);
    } else {
      occurrenceCount += 1;
    }
  }
  return { matchCount: matchedParts.length, matchedParts, occurrenceCount };
}

function extractSampleNearClass(html, className) {
  const escaped = String(className).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `class\\s*=\\s*["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*>([\\s\\S]{0,120}?)(?:</|$)`,
    'i'
  );
  const match = rawMatch(html, re);
  if (!match) {
    return '';
  }
  return String(match[1] || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function rawMatch(html, re) {
  try {
    return String(html || '').match(re);
  } catch {
    return null;
  }
}

function sampleTextForSelector(html, selector) {
  const parts = tokenizeCssSelector(selector);
  for (const part of parts) {
    const classes = extractSimpleClasses(part);
    // Prefer the most specific (last) class in a compound selector for sample text.
    for (let i = classes.length - 1; i >= 0; i -= 1) {
      const sample = extractSampleNearClass(html, classes[i]);
      if (sample) {
        return sample;
      }
    }
  }
  return '';
}

function looksLikePriceSample(text) {
  return PRICE_TEXT_HINT.test(String(text || ''));
}

/**
 * Discover candidate class-based selectors from HTML.
 * @param {string} html
 * @param {number} [limit=12]
 * @returns {Array<{ selector: string, sample_text: string, score: number }>}
 */
function discoverPriceCandidates(html, limit = 12) {
  const raw = String(html || '');
  const classRe = /class\s*=\s*["']([^"']+)["']/gi;
  const counts = new Map();
  let match;
  while ((match = classRe.exec(raw))) {
    const tokens = String(match[1] || '')
      .split(/\s+/)
      .map(t => t.trim())
      .filter(Boolean);
    for (const token of tokens) {
      if (!PRICE_CLASS_HINT.test(token)) {
        continue;
      }
      if (token.length > 80) {
        continue;
      }
      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }

  const candidates = [];
  for (const [token, count] of counts.entries()) {
    const selector = `.${token}`;
    const sample = extractSampleNearClass(raw, token);
    let score = Math.min(24, count * 2);
    score += PREFERRED_CLASS_BONUS[token] || 0;
    if (looksLikePriceSample(sample)) {
      score += 25;
    }
    if (/compare|was-price|unit-price/i.test(token)) {
      score -= 18;
    }
    // Penalize overly broad tokens that match everywhere.
    if (token === 'price-item' || token === 'price') {
      score -= Math.min(20, count);
    }
    candidates.push({ selector, sample_text: sample, score, match_count: count });
  }

  for (const attr of ['data-product-price', 'data-price', 'data-cart-item-price']) {
    if (attrPresent(raw, attr, null)) {
      candidates.push({
        selector: `[${attr}]`,
        sample_text: '',
        score: 34,
        match_count: 1,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.selector.localeCompare(b.selector));
  const seen = new Set();
  const out = [];
  for (const row of candidates) {
    if (seen.has(row.selector)) {
      continue;
    }
    seen.add(row.selector);
    out.push(row);
    if (out.length >= limit) {
      break;
    }
  }
  return out;
}

/**
 * Evaluate a proposed selector against HTML and return status + sample.
 * @param {string} html
 * @param {string} selector
 * @returns {{ status: 'matched'|'ambiguous'|'missing', matchCount: number, sample_text: string, score: number, occurrenceCount: number }}
 */
function evaluateSelector(html, selector) {
  const sel = String(selector || '').trim();
  if (!sel || !html) {
    return { status: 'missing', matchCount: 0, sample_text: '', score: 0, occurrenceCount: 0 };
  }
  const { matchCount, occurrenceCount } = scoreSelectorAgainstHtml(html, sel);
  if (matchCount <= 0) {
    return { status: 'missing', matchCount: 0, sample_text: '', score: 0, occurrenceCount: 0 };
  }
  const sample_text = sampleTextForSelector(html, sel);
  const score = matchCount * 10 + (looksLikePriceSample(sample_text) ? 30 : 0);
  if (occurrenceCount === 1 && looksLikePriceSample(sample_text)) {
    return {
      status: 'matched',
      matchCount,
      sample_text,
      score: score + 24,
      occurrenceCount,
    };
  }
  if (matchCount >= 1 && looksLikePriceSample(sample_text)) {
    // Many listing cards still count as matched when sample looks like money.
    return {
      status: 'matched',
      matchCount,
      sample_text,
      score: score + 12,
      occurrenceCount,
    };
  }
  if (matchCount >= 1) {
    return { status: 'ambiguous', matchCount, sample_text, score, occurrenceCount };
  }
  return { status: 'missing', matchCount: 0, sample_text: '', score: 0, occurrenceCount: 0 };
}

/**
 * Parse one number as shown on a storefront ("1,299.00", "1.299,00", "1 299", "¥1,500")
 * into minor units (×100), the unit Shopify's `/products/<handle>.js` uses.
 * @param {string} token
 * @returns {number|null}
 */
function parseMoneyNumberToCents(token) {
  const cleaned = String(token || '').replace(/['\s\u00a0\u202f]/g, '');
  if (!/\d/.test(cleaned) || cleaned.length > 16) {
    return null;
  }
  const sepIndex = Math.max(cleaned.lastIndexOf('.'), cleaned.lastIndexOf(','));
  let whole = cleaned;
  let fraction = '';
  if (sepIndex >= 0) {
    const tail = cleaned.slice(sepIndex + 1);
    if (tail.length === 1 || tail.length === 2) {
      whole = cleaned.slice(0, sepIndex);
      fraction = tail;
    }
  }
  const wholeDigits = whole.replace(/\D/g, '') || '0';
  const cents = Number(wholeDigits) * 100 + Number(fraction.padEnd(2, '0') || 0);
  return Number.isFinite(cents) ? cents : null;
}

/**
 * Every money amount (in minor units) written in a short text.
 * @param {string} text
 * @returns {number[]}
 */
function moneyCentsInText(text) {
  const out = [];
  const raw = String(text || '');
  const re = new RegExp(MONEY_NUMBER_RE.source, 'g');
  let match;
  while ((match = re.exec(raw)) && out.length < 6) {
    const cents = parseMoneyNumberToCents(match[0].trim());
    if (cents !== null) {
      out.push(cents);
    }
  }
  return out;
}

function escapeRe(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function occurrenceSamples(html, className, tag = '', limit = 40) {
  const prefix = tag ? `<${escapeRe(tag)}\\b[^>]*` : '';
  return samplesAfterOpenTag(
    html,
    `${prefix}class\\s*=\\s*["'][^"']*\\b${escapeRe(className)}\\b[^"']*["'][^>]*>`,
    limit
  );
}

function attrOccurrenceSamples(html, attr, tag = '', limit = 40) {
  const name = escapeRe(attr.name);
  const value =
    attr.value === null || attr.value === undefined || attr.value === ''
      ? `(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+))?`
      : `\\s*=\\s*["']?${escapeRe(attr.value)}["']?`;
  const open = tag ? escapeRe(tag) : '[a-z][a-z0-9-]*';
  return samplesAfterOpenTag(html, `<${open}\\b[^>]*\\s${name}${value}[^>]*>`, limit);
}

function samplesAfterOpenTag(html, openTagPattern, limit) {
  const re = new RegExp(`${openTagPattern}([\\s\\S]{0,160}?)(?:</|$)`, 'gi');
  const out = [];
  const raw = String(html || '');
  let match;
  while ((match = re.exec(raw)) && out.length < limit) {
    const text = String(match[1] || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
    if (text) {
      out.push(text);
    }
  }
  return out;
}

/**
 * Check a selector's rendered text against prices the store really charges.
 * `checked` is false when no element carried a readable amount (JS-rendered prices),
 * so callers can fall back to pattern-only scoring instead of rejecting.
 * @param {string} html
 * @param {string} selector
 * @param {Set<number>|number[]} knownCents
 * @returns {{ checked: boolean, matched: boolean, sample_text: string, hits: number, misses: number }}
 */
function anchorSelectorToPrices(html, selector, knownCents) {
  const known = knownCents instanceof Set ? knownCents : new Set(knownCents || []);
  const empty = { checked: false, matched: false, sample_text: '', hits: 0, misses: 0 };
  if (!known.size || !html) {
    return empty;
  }
  for (const part of tokenizeCssSelector(selector)) {
    const classes = extractSimpleClasses(part);
    const tag = extractLeadingTag(part);
    const sampleSets = [
      ...classes
        .slice()
        .reverse()
        .map(cls => () => occurrenceSamples(html, cls, tag)),
      ...extractAttrSelectors(part).map(attr => () => attrOccurrenceSamples(html, attr, tag)),
    ];
    for (const readSamples of sampleSets) {
      const samples = readSamples().filter(text => moneyCentsInText(text).length);
      if (!samples.length) {
        continue;
      }
      let hits = 0;
      let firstHit = '';
      for (const text of samples) {
        if (moneyCentsInText(text).some(cents => known.has(cents))) {
          hits += 1;
          firstHit = firstHit || text;
        }
      }
      return {
        checked: true,
        matched: hits > 0,
        sample_text: firstHit || samples[0],
        hits,
        misses: samples.length - hits,
      };
    }
  }
  return empty;
}

/**
 * The Shopify section holding the product form, so "You may also like" and
 * header cart prices on the same page are not mistaken for the product price.
 * Falls back to the whole document when the page has no recognisable section.
 * @param {string} html
 * @returns {string}
 */
function extractMainProductSection(html) {
  return extractSectionAroundForm(html, /<form\b[^>]*action\s*=\s*["'][^"']*\/cart\/add/gi);
}

/**
 * The cart page section holding the line items (not the header cart drawer or the
 * totals footer), so unit and line prices are not confused with the subtotal.
 * @param {string} html
 * @returns {string}
 */
function extractCartItemsSection(html) {
  return extractSectionAroundForm(
    html,
    /<form\b[^>]*action\s*=\s*["'][^"']*\/cart(?:["'?#]|\/?["'])/gi
  );
}

/**
 * Slice out the Shopify section that holds a matching form. Template sections
 * (`shopify-section-template--…`) win over header/footer group sections such as a
 * cart drawer, and the whole page is returned when nothing is recognisable.
 */
function extractSectionAroundForm(html, formRe) {
  const raw = String(html || '');
  const sections = [];
  const sectionRe = /<[a-z]+\b[^>]*\bid\s*=\s*["'](shopify-section-[^"']*)["']/gi;
  let match;
  while ((match = sectionRe.exec(raw))) {
    sections.push({ index: match.index, id: match[1] });
  }
  if (!sections.length) {
    return raw;
  }
  const re = new RegExp(formRe.source, formRe.flags.includes('g') ? formRe.flags : `${formRe.flags}g`);
  let fallback = null;
  while ((match = re.exec(raw))) {
    const at = match.index;
    let owner = -1;
    for (let i = 0; i < sections.length && sections[i].index <= at; i += 1) owner = i;
    if (owner < 0) continue;
    const slice = {
      start: sections[owner].index,
      end: sections[owner + 1] ? sections[owner + 1].index : raw.length,
    };
    if (/template--/.test(sections[owner].id)) {
      return raw.slice(slice.start, slice.end);
    }
    fallback = fallback || slice;
  }
  return fallback ? raw.slice(fallback.start, fallback.end) : raw;
}

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
]);
// Exact names only: `no-js-hidden` and similar are visible whenever JavaScript runs.
const HIDDEN_CLASS =
  /^(?:visually-hidden(?:--[a-z]+)?|sr-only|screen-reader-text|hidden|is-hidden|u-hidden|hide|d-none)$/i;
const GENERIC_PRICE_CLASS = new Set(['price', 'price-item', 'amount']);
const SAFE_CLASS = /^-?[_a-zA-Z][_a-zA-Z0-9-]*$/;
// Layout, typography and state utilities say nothing about "this is the price".
const UTILITY_CLASS =
  /^(?:h\d|small|large|bold|italic|uppercase|text-|font-|js-|is-|has-|flex|grid|col-|row|block|inline|hidden|visible|w-|h-|m[trblxy]?-|p[trblxy]?-|gap-|color-|bg-|gradient|rte|caption|subtitle|title|badge|visually-hidden|sr-only|full-unstyled|link|button)/i;
const STRIKE_TAGS = new Set(['s', 'del', 'strike']);
const MAX_STACK = 256;

function readTagAttrs(raw) {
  const attrs = { classes: [], id: '', data: [] };
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = attrRe.exec(String(raw || '')))) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    if (name === 'class') {
      attrs.classes = value.split(/\s+/).filter(Boolean);
    } else if (name === 'id') {
      attrs.id = value;
    } else if (name.startsWith('data-') && name.length <= 40) {
      attrs.data.push(name);
    }
  }
  return attrs;
}

/**
 * Walk the page like a browser would (open/close tag stack, script/style skipped) and
 * return every element whose own text shows a price. Value-first: a price is found by
 * what it says, not by what its class is called, so custom themes are covered too.
 * @param {string} html
 * @param {(text: string) => boolean} isTargetText
 * @param {{ limit?: number }} [options]
 * @returns {Array<{ tag: string, classes: string[], data: string[], text: string, hidden: boolean, path: Array<{ tag: string, classes: string[] }> }>}
 */
function findPriceElements(html, isTargetText, { limit = 60 } = {}) {
  const raw = String(html || '');
  const re =
    /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g;
  const stack = [];
  const out = [];
  let match;
  while ((match = re.exec(raw)) && out.length < limit) {
    if (match[3] !== undefined) {
      const tag = match[3].toLowerCase();
      if (match[2] === '/') {
        const at = stack.map(entry => entry.tag).lastIndexOf(tag);
        if (at >= 0) stack.length = at;
        continue;
      }
      if (VOID_TAGS.has(tag) || /\/\s*$/.test(match[4] || '') || stack.length >= MAX_STACK) {
        continue;
      }
      stack.push({ tag, ...readTagAttrs(match[4]) });
      continue;
    }
    const text = match[5] ? match[5].replace(/\s+/g, ' ').trim() : '';
    if (!text || text.length > 80 || !stack.length || !isTargetText(text)) {
      continue;
    }
    const path = stack.slice(-4).reverse();
    out.push({
      tag: path[0].tag,
      classes: path[0].classes,
      data: path[0].data,
      text,
      hidden: stack.some(entry => entry.classes.some(cls => HIDDEN_CLASS.test(cls))),
      path: path.map(entry => ({ tag: entry.tag, classes: entry.classes.slice(0, 4) })),
    });
  }
  return out;
}

function usableClasses(classes) {
  return (classes || []).filter(
    cls => SAFE_CLASS.test(cls) && cls.length <= 60 && !UTILITY_CLASS.test(cls)
  );
}

function describeElementPath(path) {
  return (path || [])
    .slice()
    .reverse()
    .map(entry => `${entry.tag}${entry.classes.map(cls => `.${cls}`).join('')}`)
    .join(' > ');
}

/**
 * Turn price-showing elements into selector candidates: the element's own classes,
 * its data attributes, or (for bare `<span>$5</span>`) the nearest classed ancestor.
 * @param {ReturnType<typeof findPriceElements>} elements
 * @param {{ role?: string }} [options]
 * @returns {Array<{ selector: string, score: number, hits: number, dom_path: string, sample_text: string }>}
 */
function candidatesFromPriceElements(elements, { role = 'regular' } = {}) {
  const bySelector = new Map();
  const add = (selector, score, element) => {
    const existing = bySelector.get(selector);
    if (existing) {
      existing.hits += 1;
      if (existing.hits <= 6) existing.score += 3;
      return;
    }
    bySelector.set(selector, {
      selector,
      score,
      hits: 1,
      dom_path: describeElementPath(element.path),
      sample_text: element.text,
    });
  };
  (Array.isArray(elements) ? elements : []).forEach(element => {
    if (element.hidden) return;
    const struck = STRIKE_TAGS.has(element.tag);
    const roleBonus =
      role === 'compare_at'
        ? (struck ? 18 : 0) + (element.classes.some(c => /compare|was|old|strike/i.test(c)) ? 14 : 0)
        : struck
          ? -30
          : 0;
    const own = usableClasses(element.classes);
    own.forEach(cls => {
      const hinted = PRICE_CLASS_HINT.test(cls) ? 12 : 0;
      const generic = GENERIC_PRICE_CLASS.has(cls.toLowerCase()) ? -12 : 0;
      add(
        struck ? `${element.tag}.${cls}` : `.${cls}`,
        40 + hinted + generic + roleBonus,
        element
      );
    });
    element.data
      .filter(name => /price|money|amount|cost/i.test(name))
      .forEach(name => add(`[${name}]`, 46 + roleBonus, element));
    if (!own.length && !element.data.length) {
      const parent = (element.path || []).slice(1).find(entry => usableClasses(entry.classes).length);
      usableClasses(parent?.classes).forEach(cls => {
        add(`.${cls}`, 30 + (PRICE_CLASS_HINT.test(cls) ? 12 : 0) + roleBonus, element);
      });
    }
  });
  return [...bySelector.values()].sort((a, b) => b.score - a.score);
}

module.exports = {
  findPriceElements,
  candidatesFromPriceElements,
  describeElementPath,
  parseMoneyNumberToCents,
  moneyCentsInText,
  anchorSelectorToPrices,
  extractMainProductSection,
  extractCartItemsSection,
  scoreSelectorAgainstHtml,
  evaluateSelector,
  discoverPriceCandidates,
  sampleTextForSelector,
  looksLikePriceSample,
  tokenizeCssSelector,
  countClassTokenOccurrences,
  extractLeadingTag,
};
