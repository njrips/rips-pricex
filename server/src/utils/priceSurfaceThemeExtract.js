/**
 * Deterministic extractor: turn Shopify theme Liquid/CSS into CSS selector candidates.
 * Never invents selectors — only tokens that already appear in the file.
 */

const PRICE_CLASS_HINT =
  /(price|money|amount|compare|sale|regular|unit-price|was-price|cost|cart-item__price|cart-item__old|cart-item__final)/i;

const SKIP_TOKEN = /[{}%]|^\d+$/;

const ROLE_COMPARE = /compare|was-price|old-price|compare-at/i;
const ROLE_UNIT = /unit-price|unit_price/i;
const ROLE_SALE_ONLY = /(?:^|--)sale(?:$|--)|price--on-sale|price__sale/i;

function toThemeGid(themeId) {
  const raw = String(themeId || '').trim();
  if (!raw) return '';
  if (raw.startsWith('gid://')) return raw;
  const numeric = raw.replace(/\D/g, '');
  return numeric ? `gid://shopify/OnlineStoreTheme/${numeric}` : '';
}

function isPriceRelatedFilename(filename) {
  const f = String(filename || '')
    .toLowerCase()
    .replace(/\\/g, '/');
  if (!/\.(liquid|css)$/.test(f)) return false;
  if (f.startsWith('locales/') || f.startsWith('config/')) return false;
  const base = f.split('/').pop() || '';
  return /price|cart-item|card-product|product-card|cart-drawer|predictive-search/.test(base);
}

function inferSurfacesFromFilename(filename) {
  const f = String(filename || '')
    .trim()
    .toLowerCase()
    .replace(/\\/g, '/');
  if (!f) {
    return ['pdp', 'plp', 'home', 'global'];
  }
  if (f.includes('cart')) {
    return ['cart'];
  }
  if (f.includes('search') || f.includes('predictive')) {
    return ['search'];
  }
  if (
    f.includes('card-product') ||
    f.includes('card-collection') ||
    f.includes('featured-collection') ||
    f.includes('main-collection')
  ) {
    return ['plp', 'home', 'recommendation', 'search'];
  }
  if (f.includes('templates/index.json') || f.endsWith('/index.json')) {
    return ['home'];
  }
  if (f.includes('featured-product') || (f.includes('product') && !f.includes('card'))) {
    return ['pdp', 'quickview'];
  }
  if (f.includes('price')) {
    return ['pdp', 'plp', 'search', 'home', 'recommendation', 'quickview'];
  }
  return ['pdp', 'plp', 'home', 'global'];
}

function inferRoleFromToken(token) {
  const t = String(token || '');
  if (ROLE_COMPARE.test(t)) {
    return 'compare_at';
  }
  if (ROLE_UNIT.test(t)) {
    return 'unit';
  }
  return 'regular';
}

function tokenScore(token) {
  const t = String(token || '');
  let score = 12;
  if (t.includes('--regular') || t.endsWith('__regular')) score += 48;
  if (t.includes('--compare') || t.includes('compare')) score += 40;
  if (t.includes('cart-item__price') || t.includes('cart-item__final')) score += 36;
  if (t.includes('cart-item__old')) score += 28;
  if (t === 'money' || t.endsWith('__price')) score += 22;
  if (t.includes('price-item') && t.includes('--')) score += 18;
  if (t === 'price' || t === 'price-item') score -= 8;
  if (ROLE_SALE_ONLY.test(t) && !t.includes('--regular')) score -= 16;
  return score;
}

function shouldSkipToken(token) {
  const t = String(token || '').trim();
  if (!t || t.length > 80) return true;
  if (SKIP_TOKEN.test(t)) return true;
  if (!PRICE_CLASS_HINT.test(t)) return true;
  return false;
}

function addToken(counts, token) {
  if (shouldSkipToken(token)) return;
  counts.set(token, (counts.get(token) || 0) + 1);
}

function extractTokensFromLiquid(content) {
  const raw = String(content || '').slice(0, 400_000);
  const counts = new Map();
  const classRe = /class\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = classRe.exec(raw))) {
    String(match[1] || '')
      .split(/\s+/)
      .forEach(token => addToken(counts, token));
  }
  const styleRe = /\{%-?\s*stylesheet\s*-?%\}([\s\S]*?)\{%-?\s*endstylesheet\s*-?%\}/gi;
  while ((match = styleRe.exec(raw))) {
    const cssCounts = extractTokensFromCss(match[1] || '');
    for (const [token, count] of cssCounts.entries()) {
      counts.set(token, (counts.get(token) || 0) + count);
    }
  }
  return counts;
}

function extractStrikeCompareCandidates(filename, content, surfaces) {
  const raw = String(content || '');
  const rows = [];
  const strikeRe = /<(s|del|strike)\b[^>]*class\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = strikeRe.exec(raw))) {
    const tag = String(match[1] || 's').toLowerCase();
    String(match[2] || '')
      .split(/\s+/)
      .forEach(token => {
        if (shouldSkipToken(token)) return;
        rows.push({
          selector: `${tag}.${token}`,
          role: 'compare_at',
          surfaces,
          file: filename,
          score: tokenScore(token) + 20,
          source: 'theme_file',
          token,
        });
      });
  }
  return rows;
}

function extractDataAttributeCandidates(filename, content, surfaces) {
  const raw = String(content || '');
  const rows = [];
  const attrRe = /\s(data-(?:product-)?price|data-cart-item-price)\b/gi;
  let match;
  while ((match = attrRe.exec(raw))) {
    const attr = String(match[1] || '').toLowerCase();
    if (!attr) continue;
    rows.push({
      selector: `[${attr}]`,
      role: 'regular',
      surfaces,
      file: filename,
      score: 36,
      source: 'theme_file',
      token: attr,
    });
  }
  return rows;
}

function extractTokensFromCss(content) {
  const raw = String(content || '').slice(0, 200_000);
  const counts = new Map();
  const cssRe =
    /\.([a-zA-Z0-9_-]*(?:price|money|amount|compare|cart-item)[a-zA-Z0-9_-]*)/gi;
  let match;
  while ((match = cssRe.exec(raw))) {
    addToken(counts, match[1]);
  }
  return counts;
}

function tokensToCandidates(filename, counts) {
  const surfaces = inferSurfacesFromFilename(filename);
  const rows = [];
  for (const [token, count] of counts.entries()) {
    const selector = `.${token}`;
    const role = inferRoleFromToken(token);
    const score = tokenScore(token) + Math.min(10, count);
    const candidate = {
      selector,
      role,
      surfaces,
      file: filename,
      score,
      source: 'theme_file',
      token,
    };
    rows.push(candidate);
    if (surfaces.includes('cart') && role === 'regular' && /cart-item|price--end/i.test(token)) {
      rows.push({
        ...candidate,
        role: 'cart_line',
        score: score - 2,
      });
    }
  }
  return rows;
}

function extractCandidatesFromThemeFile(filename, content) {
  const name = String(filename || '')
    .trim()
    .replace(/\\/g, '/');
  const lower = name.toLowerCase();
  if (!content) {
    return [];
  }
  const surfaces = inferSurfacesFromFilename(name);
  let rows = [];
  if (lower.endsWith('.css')) {
    rows = tokensToCandidates(name, extractTokensFromCss(content));
  } else if (lower.endsWith('.liquid')) {
    rows = [
      ...tokensToCandidates(name, extractTokensFromLiquid(content)),
      ...extractStrikeCompareCandidates(name, content, surfaces),
      ...extractDataAttributeCandidates(name, content, surfaces),
    ];
  }
  rows.sort((a, b) => b.score - a.score || a.selector.localeCompare(b.selector));
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = `${row.selector}|${row.role}|${(row.surfaces || []).join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
    if (out.length >= 28) break;
  }
  return out;
}

function extractThemeFileCandidates(files) {
  const list = Array.isArray(files) ? files : [];
  const merged = [];
  for (const file of list) {
    const filename = file?.filename || file?.path || '';
    const content = file?.content || file?.body || '';
    merged.push(...extractCandidatesFromThemeFile(filename, content));
  }
  merged.sort((a, b) => b.score - a.score || a.selector.localeCompare(b.selector));
  const perRole = new Map();
  const out = [];
  const seen = new Set();
  for (const row of merged) {
    const key = `${row.selector}|${row.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const roleKey = String(row.role || 'regular');
    const taken = perRole.get(roleKey) || 0;
    if (taken >= 12) continue;
    perRole.set(roleKey, taken + 1);
    out.push(row);
    if (out.length >= 60) break;
  }
  return out;
}

function filterThemeFileCandidatesForTarget(candidates, surface, role) {
  const surfaceKey = String(surface || '')
    .trim()
    .toLowerCase();
  const roleKey = String(role || '')
    .trim()
    .toLowerCase();
  return (Array.isArray(candidates) ? candidates : []).filter(row => {
    if (String(row.role || '') !== roleKey) return false;
    const surfaces = Array.isArray(row.surfaces) ? row.surfaces : [];
    return surfaces.includes(surfaceKey) || surfaces.includes('global');
  });
}

module.exports = {
  toThemeGid,
  isPriceRelatedFilename,
  inferSurfacesFromFilename,
  inferRoleFromToken,
  extractCandidatesFromThemeFile,
  extractThemeFileCandidates,
  filterThemeFileCandidatesForTarget,
};
