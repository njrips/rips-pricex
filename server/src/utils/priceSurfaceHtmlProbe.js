/**
 * Lightweight HTML probe for price-surface auto-map (no DOM library dependency).
 * Validates class/attribute CSS selectors common in Shopify themes and discovers
 * price-like candidates from class tokens and surrounding text.
 */

const PRICE_CLASS_HINT =
  /(price|money|amount|compare|sale|regular|unit-price|was-price|cost|cart-item__price)/i;
const PRICE_TEXT_HINT =
  /(?:[$€£¥₹৳]|usd|eur|gbp|cad|aud|sale|from)\s*[-+]?\d|[-+]?\d[\d,]*(?:\.\d{2})?\s*(?:[$€£¥₹৳]|usd|eur|gbp|cad|aud)/i;

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

module.exports = {
  scoreSelectorAgainstHtml,
  evaluateSelector,
  discoverPriceCandidates,
  sampleTextForSelector,
  looksLikePriceSample,
  tokenizeCssSelector,
  countClassTokenOccurrences,
  extractLeadingTag,
};
