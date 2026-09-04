/**
 * Test harness for storefront-script.js.
 *
 * The storefront script is a single browser IIFE that self-executes and talks to
 * the network, so it cannot be imported. This lifts named functions out of the
 * source text and evaluates them against stubbed collaborators, which lets the
 * price-mapping logic be tested against real theme markup without booting the
 * whole runtime. Because the functions are read from the shipped file, the tests
 * exercise the code the storefront actually runs.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'storefront-script.js');

let cachedSource = null;

function source() {
  if (cachedSource == null) cachedSource = readFileSync(SCRIPT_PATH, 'utf8');
  return cachedSource;
}

/** Slice out `function <name>(...) { ... }` by matching braces. */
function extractFunction(src, name) {
  const signature = `function ${name}(`;
  const start = src.indexOf(signature);
  if (start < 0) throw new Error(`storefront-script.js has no function ${name}`);
  let depth = 0;
  let i = src.indexOf('{', start);
  if (i < 0) throw new Error(`function ${name} has no body`);
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`function ${name} body is unbalanced`);
}

/** Slice out a top-level `var|const|let NAME = <expr>;` declaration. */
function extractVar(src, name) {
  for (const keyword of ['var', 'const', 'let']) {
    const start = src.indexOf(`${keyword} ${name} =`);
    if (start < 0) continue;
    const end = src.indexOf(';', start);
    if (end < 0) throw new Error(`${keyword} ${name} is unterminated`);
    return src.slice(start, end + 1);
  }
  throw new Error(`storefront-script.js has no declaration of ${name}`);
}

/** Constants the price-mapping helpers close over. */
const REQUIRED_VARS = [
  'RIPX_PRICE_LEAF_SEL',
  'RIPX_COMPARE_AT_SEL',
  'RIPX_AMOUNT_TEXT_RE',
  'RIPX_CART_UI_SELECTOR',
];

/**
 * Helpers that the price-mapping functions call. Always included so individual
 * tests only name the entry points they exercise.
 */
const REQUIRED_FUNCTIONS = [
  'stripStorefrontLocalePrefix',
  'inferPriceSurfaceFromPathname',
  'getEffectivePreviewPathname',
  'getListingPriceSurfaceKeys',
  'getConfiguredShopPriceSurfaceMappings',
  'getConfiguredTestPriceSurfaceMappings',
  'resolveConfiguredPriceSurfaceSelectors',
  'appendConfiguredRegistrySelectors',
  'appendConfiguredRegistrySelectorsForSurfaces',
  'hasConfiguredPriceSurfaceMappingsForSurfaces',
  'toNumericProductId',
  'extractNumericProductIdFromText',
  'normalizeListingProductIdCandidate',
  'collectListingProductIdCandidates',
  'parsePriceFromDisplay',
  'isRipxCompareAtPriceNode',
  'containsRipxCompareAtNode',
  'findRipxAmountDescendant',
  'isLeafPricePaintNode',
  'resolveRipxPricePaintTargets',
  'writeRipxPriceNode',
  'paintPriceNode',
  'findRipxCatalogPriceNode',
  'getStableCatalogPriceForElement',
  'getProductIdForListingCard',
  'querySelectorAllWithShadowRoots',
  'getEffectivePriceConfig',
  'normalizeMergedPriceConfig',
  'normalizePriceConfigKeys',
  'normalizePriceApplicationMethod',
  'hasModeValue',
  'gidMatches',
  'parseRoundTo',
  'formatShopPrice',
  'getShopCurrency',
  'toProductGid',
];

/**
 * @param {string[]} names functions to lift out of the script
 * @param {object} [options]
 * @param {object[]} [options.shopMappings] CONFIG.priceSurfaceRegistry.shopMappings
 * @returns {Record<string, Function> & { paintEvents: object[], diagnostics: object[] }}
 */
export function loadStorefrontFunctions(names, options = {}) {
  // Absent names are skipped rather than thrown, so the suite can be pointed at
  // an older revision of the script: tests then fail on behaviour instead of
  // collapsing on a missing helper.
  const missing = [];
  const requested = Array.from(new Set([...REQUIRED_FUNCTIONS, ...names]));
  const wanted = [];
  const extracted = [];
  requested.forEach(name => {
    try {
      extracted.push(extractFunction(source(), name));
      wanted.push(name);
    } catch (error) {
      missing.push(name);
    }
  });
  const constants = REQUIRED_VARS.map(name => {
    try {
      return extractVar(source(), name);
    } catch (error) {
      missing.push(name);
      return '';
    }
  }).join('\n');
  const bodies = `${constants}\n${extracted.join('\n')}`;
  const paintEvents = [];
  const diagnostics = [];

  // Collaborators the lifted functions call but that are out of scope here:
  // cart attribute injection, assignment bookkeeping, tracing and scheduling.
  const prelude = `
    var CONFIG = __shopConfig;
    var URL_PARAMS = new URLSearchParams();
    var PREVIEW_MODE = false;
    function getLiveSearchParams() { return new URLSearchParams(window.location.search); }
    function isRipxBootstrapPathname() { return false; }
    function recordRipxPaintEvent(scope, textWrites, attrWrites) {
      __paintEvents.push({ scope: scope, textWrites: textWrites, attrWrites: attrWrites });
    }
    function recordRipxPricePaintParity() {}
    function persistRipxLiveDiagnostics(kind, detail) {
      __diagnostics.push({ kind: kind, detail: detail });
    }
    function ripxTrace() {}
    function injectPreviewCartAttributesWhenConfigMissing() {}
    function injectPriceTestCartAttributes() {}
    function getAssignmentProofFromVariant() { return null; }
    function getConfiguredCheckoutMethodProof() { return null; }
    function getActiveTestById() { return null; }
    function getExcludedProductIdsForTest() { return []; }
    function rememberRipxTargetUnitForProduct() {}
    function rememberRipxTargetUnitForVariant() {}
    function rememberRipxPriceMethodForProduct() {}
    function rememberRipxPriceMethodForVariant() {}
    function getRipxVariantIdForCard() { return ''; }
    function registerRipxAssignedPrice() {}
    function applyRipxStateToCartForms() {}
    function schedulePaintAllProductsGlobalPrices() {}
    function applyMappedPriceSelectorsByInferredProduct() {}
  `;

  const factory = new Function(
    '__shopConfig',
    '__paintEvents',
    '__diagnostics',
    `${prelude}\n${bodies}\nreturn { ${wanted.join(', ')} };`
  );

  const api = factory(
    { priceSurfaceRegistry: { shopMappings: options.shopMappings || [] } },
    paintEvents,
    diagnostics
  );
  return Object.assign(api, { paintEvents, diagnostics, missing });
}

/**
 * Lift the product-page painter out of `applyPriceTest`.
 *
 * `paintEl` is a closure inside a function that boots mutation observers, cart
 * attribute injection and variant listeners, so the enclosing function cannot be
 * called from a test. Lifting the painter with stand-ins for the handful of
 * values it closes over exercises the real product-page paint decisions, which
 * are separate from the listing painters and were wrong in a different way.
 *
 * @param {object} [options]
 * @param {string} [options.display] the price to paint
 * @param {number} [options.priceNum]
 * @returns {{ paintEl: Function, paintEvents: object[] }}
 */
export function loadPdpPainter({ display = '$70.00', priceNum = 70 } = {}) {
  const shared = [
    ...REQUIRED_VARS.map(name => extractVar(source(), name)),
    ...[
      'isRipxCompareAtPriceNode',
      'containsRipxCompareAtNode',
      'findRipxAmountDescendant',
      'isLeafPricePaintNode',
      'resolveRipxPricePaintTargets',
      'writeRipxPriceNode',
    ].map(name => extractFunction(source(), name)),
  ].join('\n');
  const paintEvents = [];
  const factory = new Function(
    '__display',
    '__priceNum',
    '__paintEvents',
    `
    ${shared}
    function recordRipxPaintEvent(scope, textWrites, attrWrites) {
      __paintEvents.push({ scope: scope, textWrites: textWrites, attrWrites: attrWrites });
    }
    function recordRipxPricePaintParity() {}
    function inCartUi(el) { return !!(el.closest && el.closest('.cart-drawer, cart-drawer')); }
    var seen = new WeakSet();
    var currentDisplay = __display;
    var priceNum = __priceNum;
    var testId = 'test-1';
    var variantIdForCart = 'variant-1';
    ${extractFunction(source(), 'paintEl')}
    return paintEl;
    `
  );
  return { paintEl: factory(display, priceNum, paintEvents), paintEvents };
}

/**
 * The selectors `applyPriceTest` builds for a Dawn product page: the mapped
 * `pdp regular` row, then its own fallbacks, which deliberately include the
 * `.price` wrapper because many themes have no dedicated amount node.
 */
export function dawnPdpPaintSelectors(productId) {
  return [
    '.price-item--regular',
    `product-info[data-product-id="${productId}"] .price`,
    `[data-product-id="${productId}"] .price`,
    '.price-item--sale',
  ];
}

/** A Dawn main-product price block, on sale so compare-at is present. */
export function dawnPdpMarkup({ productId, price = '$100.00', compareAt = '$140.00' } = {}) {
  return `
    <product-info data-product-id="${productId}">
      <div class="product__info-container">
        <div class="price price--large price--on-sale">
          <div class="price__container">
            <div class="price__regular">
              <span class="visually-hidden">Regular price</span>
              <span class="price-item price-item--regular">${price}</span>
            </div>
            <div class="price__sale">
              <span class="visually-hidden">Regular price</span>
              <span><s class="price-item price-item--regular">${compareAt}</s></span>
              <span class="visually-hidden">Sale price</span>
              <span class="price-item price-item--sale">${price}</span>
            </div>
          </div>
        </div>
      </div>
    </product-info>`;
}

/** Point window.location at a storefront path for surface-detection tests. */
export function setPathname(pathname) {
  window.history.replaceState({}, '', pathname);
}

/**
 * The mappings actually stored for the pilot shop, which is how three theme
 * packs' selectors ended up live at once. Used so tests reflect real data.
 */
export const LIVE_SHOP_MAPPINGS = Object.freeze([
  { surface: 'plp', role: 'regular', selector: '.price', priority: 10, source: 'theme_pack' },
  { surface: 'cart', role: 'regular', selector: '.price', priority: 9, source: 'theme_pack' },
  { surface: 'cart', role: 'cart_line', selector: '.price', priority: 8, source: 'theme_pack' },
  { surface: 'search', role: 'regular', selector: '.price', priority: 7, source: 'theme_pack' },
  { surface: 'home', role: 'regular', selector: '.price', priority: 6, source: 'theme_pack' },
  {
    surface: 'plp',
    role: 'regular',
    selector: '.grid-view-item .money',
    priority: 10,
    source: 'theme_pack',
  },
  {
    surface: 'global',
    role: 'regular',
    selector: '[data-product-price] .money',
    priority: 5,
    source: 'theme_pack',
  },
  {
    surface: 'plp',
    role: 'regular',
    selector: '.price-item--regular',
    priority: 10,
    source: 'theme_pack',
  },
  {
    surface: 'search',
    role: 'regular',
    selector: '.price-item--regular',
    priority: 7,
    source: 'theme_pack',
  },
  {
    surface: 'home',
    role: 'regular',
    selector: '.price-item--regular',
    priority: 18,
    source: 'merchant',
  },
  { surface: 'plp', role: 'regular', selector: 'span.price-item', priority: 0, source: 'visual' },
  {
    surface: 'pdp',
    role: 'regular',
    selector: '.price-item--regular',
    priority: 20,
    source: 'openai',
  },
  {
    surface: 'pdp',
    role: 'compare_at',
    selector: 's.price-item--regular',
    priority: 20,
    source: 'openai',
  },
  {
    surface: 'plp',
    role: 'compare_at',
    selector: 's.price-item--regular',
    priority: 20,
    source: 'openai',
  },
]);

/**
 * A Dawn product card as rendered on a homepage featured-collection section and
 * on a collection grid. `onSale` adds the sale/compare-at pair, which is the
 * shape that exposes compare-at handling.
 */
export function dawnCardMarkup({ productId, sectionId = 'template--21010091114685__featured_collection', onSale = false, price = '$100.00', compareAt = '$140.00' } = {}) {
  // Mirrors Dawn snippets/price.liquid: the regular block holds the current
  // price, the sale block holds the struck compare-at followed by the current
  // price, and screen-reader labels sit between them.
  const priceBlock = onSale
    ? `<div class="price price--on-sale">
         <div class="price__container">
           <div class="price__regular">
             <span class="visually-hidden">Regular price</span>
             <span class="price-item price-item--regular">${price}</span>
           </div>
           <div class="price__sale">
             <span class="visually-hidden">Regular price</span>
             <span><s class="price-item price-item--regular">${compareAt}</s></span>
             <span class="visually-hidden">Sale price</span>
             <span class="price-item price-item--sale">${price}</span>
           </div>
         </div>
       </div>`
    : `<div class="price">
         <div class="price__container">
           <div class="price__regular">
             <span class="visually-hidden">Regular price</span>
             <span class="price-item price-item--regular">${price}</span>
           </div>
         </div>
       </div>`;

  return wrapCard(priceBlock, sectionId, productId);
}

/**
 * A card that renders the compare-at price after the current one. Plenty of
 * themes order it this way, and it is the layout where reading an amount off the
 * price wrapper yields the pre-sale price instead of what the shopper pays.
 */
export function compareAtLastCardMarkup({ productId, price = '$80.00', compareAt = '$140.00' } = {}) {
  const priceBlock = `<div class="price price--on-sale">
       <span class="price-item price-item--sale">${price}</span>
       <s class="price-item price-item--regular">${compareAt}</s>
     </div>`;
  return wrapCard(priceBlock, 'template--21010091114685__product-grid', productId);
}

function wrapCard(priceBlock, sectionId, productId) {
  return `
    <li class="grid__item">
      <div class="card-wrapper product-card-wrapper">
        <div class="card card--standard">
          <div class="card__content">
            <h3 class="card__heading">
              <a id="CardLink-${sectionId}-${productId}"
                 class="full-unstyled-link"
                 href="/products/the-minimal-snowboard">Snowboard</a>
            </h3>
            <div class="card-information">${priceBlock}</div>
          </div>
        </div>
      </div>
    </li>`;
}
