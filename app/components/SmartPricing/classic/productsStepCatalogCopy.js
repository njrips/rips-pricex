import { productGroupKey, variantIdentity } from './productsStepReadiness';

/** Unique Shopify products represented in opportunity variant rows. */
export function countCatalogProducts(opportunities = []) {
  const keys = new Set((opportunities || []).map(productGroupKey));
  return keys.size;
}

/** Prefer the server snapshot count; fall back to what is loaded client-side. */
export function resolveCatalogLoadedProductCount(catalogLoadedProductCount, opportunities = []) {
  const fromServer = Number(catalogLoadedProductCount);
  if (Number.isFinite(fromServer) && fromServer > 0) return fromServer;
  return countCatalogProducts(opportunities);
}

/** Active products in the loaded store catalog (before “in other tests” split). */
export function resolveStoreCatalogProductCount({
  catalogLoadedProductCount = null,
  availableProductCount = 0,
  withheldCount = 0,
  opportunities = [],
} = {}) {
  const fromServer = Number(catalogLoadedProductCount);
  const available = Number(availableProductCount) || 0;
  const withheld = Number(withheldCount) || 0;
  const fromRows = countCatalogProducts(opportunities);
  const reconciled = Math.max(
    Number.isFinite(fromServer) && fromServer > 0 ? fromServer : 0,
    available + withheld,
    fromRows
  );
  return reconciled > 0 ? reconciled : 0;
}

/**
 * Active products that never became rows: not sold on the Online Store, gift
 * cards, or no usable price. Counted so the totals on the step add up.
 */
export function countIneligibleProducts({
  storeProductCount = 0,
  availableProductCount = 0,
  withheldCount = 0,
} = {}) {
  const store = Number(storeProductCount) || 0;
  if (store <= 0) return 0;
  return Math.max(0, store - (Number(availableProductCount) || 0) - (Number(withheldCount) || 0));
}

/** Why the ineligible count on the step is not offered. */
export function buildIneligibleDetail(ineligibleCount = 0) {
  const n = Number(ineligibleCount) || 0;
  if (n <= 0) return '';
  return `${n} product${n === 1 ? ' is' : 's are'} ineligible: not published to the Online Store, sold out, not available for sale, ${
    n === 1 ? 'a gift card, or no price' : 'gift cards, or have no price'
  }.`;
}

/**
 * One line for the products step and picker: store total, available, and in-other-tests.
 */
export function buildStoreCatalogStatusText({
  storeProductCount = 0,
  availableProductCount = 0,
  withheldCount = 0,
  catalogTruncated = false,
} = {}) {
  const store = Number(storeProductCount) || 0;
  const available = Number(availableProductCount) || 0;
  const withheld = Number(withheldCount) || 0;
  if (store <= 0 && available <= 0 && withheld <= 0) return '';

  const total = store > 0 ? store : available + withheld;
  const headline = `${total} total product${total === 1 ? '' : 's'}`;

  const parts = [`${available} eligible`];
  if (withheld > 0) {
    parts.push(`${withheld} in active tests`);
  }
  const untestable = countIneligibleProducts({
    storeProductCount: store,
    availableProductCount: available,
    withheldCount: withheld,
  });
  if (untestable > 0) {
    parts.push(`${untestable} ineligible`);
  }

  let line = `${headline} · ${parts.join(' · ')}`;
  if (catalogTruncated && store > 0) {
    line += '. Search in Browse products for products beyond this list';
  }
  return line;
}

export function buildCatalogTruncatedHelp({
  catalogTruncated = false,
  catalogLoadedProductCount = 0,
} = {}) {
  if (!catalogTruncated) return '';
  const loaded = Number(catalogLoadedProductCount);
  if (!Number.isFinite(loaded) || loaded <= 0) {
    return 'Your catalog is larger than one load can show. Search in Browse products to find products beyond this list.';
  }
  return `Your shop has more than ${loaded} active products. Search in Browse products to find products beyond what Priceify loaded.`;
}

export function buildWithheldSummary(withheldCount = 0) {
  const n = Number(withheldCount) || 0;
  if (n <= 0) return '';
  return `${n} product${n === 1 ? '' : 's'} in other tests`;
}

/** Multi-line: render it where line breaks are kept. */
export function buildWithheldDetail(withheldByOtherTests = null) {
  const withheldCount = Number(withheldByOtherTests?.total) || 0;
  if (withheldCount <= 0) return '';
  const one = withheldCount === 1;
  const lines = [
    `${withheldCount} product${one ? ' is' : 's are'} running in other tests:`,
  ];
  const experiments = (withheldByOtherTests?.experiments || []).filter(row => row?.title);
  if (experiments.length) {
    experiments.slice(0, 3).forEach(row => {
      const n = Number(row.products) || 0;
      const state = row.live ? 'Running' : 'Paused';
      lines.push(
        n > 0
          ? `• ${row.title} (${n} product${n === 1 ? '' : 's'} · ${state})`
          : `• ${row.title} (${state})`
      );
    });
    if (experiments.length > 3) lines.push(`• +${experiments.length - 3} more`);
  } else {
    (withheldByOtherTests?.tests || [])
      .map(row => row?.name)
      .filter(Boolean)
      .slice(0, 3)
      .forEach(name => lines.push(`• ${name}`));
  }
  lines.push(
    one
      ? 'To include this item, stop or complete its active test first.'
      : 'To include these items, stop or complete their active tests first.'
  );
  return lines.join('\n');
}

/**
 * Step-level empty catalog (no rows to pick or price).
 */
export function buildProductsStepEmptyMessage({
  loading = false,
  loadError = '',
  availableProductCount = 0,
  withheldCount = 0,
  catalogTruncated = false,
  storeProductCount = 0,
} = {}) {
  if (loading || loadError) return '';
  if (availableProductCount > 0) return '';
  // Active products that never became rows: not on the Online Store, sold out
  // with "continue selling" off, unavailable for sale, gift cards, or no price. On a store where that
  // is every product, "no active products" was simply untrue.
  const untestable = Math.max(0, (Number(storeProductCount) || 0) - (Number(withheldCount) || 0));
  const untestableText =
    untestable > 0
      ? `${untestable} active product${untestable === 1 ? '' : 's'} can’t be tested because ${
          untestable === 1 ? 'it is' : 'they are'
        } not published to the Online Store, sold out, not available for sale, gift cards, or have no price. Add a product to the Online Store sales channel in Shopify admin, restock it, or turn on “Continue selling when out of stock” to test it.`
      : '';
  if (withheldCount > 0) {
    return [
      `No products available to pick here. ${withheldCount} product${
        withheldCount === 1 ? ' is' : 's are'
      } in another test — end ${withheldCount === 1 ? 'that test' : 'those tests'} to add ${
        withheldCount === 1 ? 'it' : 'them'
      }.`,
      untestableText,
    ]
      .filter(Boolean)
      .join(' ');
  }
  if (catalogTruncated) {
    return 'No products appear in this snapshot. Open Browse products and search your catalog to find products to test.';
  }
  if (untestableText) return `No products available to pick here. ${untestableText}`;
  return 'No active products found in your catalog.';
}

/**
 * Product picker empty list — matches the step when the whole catalog is empty;
 * otherwise explains filters or search.
 */
export function buildProductPickerEmptyMessage({
  opportunities = [],
  matchedCount = 0,
  productSearch = '',
  activeGroupValue = '',
  withheldCount = 0,
  catalogTruncated = false,
  catalogSearching = false,
  hasRemoteSearch = false,
  remoteSearchHint = null,
  storeProductCount = 0,
} = {}) {
  const available = countCatalogProducts(opportunities);
  if (available === 0) {
    return buildProductsStepEmptyMessage({
      availableProductCount: 0,
      withheldCount,
      catalogTruncated,
      storeProductCount,
    });
  }
  if (matchedCount > 0) return '';

  const q = String(productSearch || '').trim();
  if (q && hasRemoteSearch && q.length >= 3) {
    if (catalogSearching) return '';
    const hintQuery = String(remoteSearchHint?.query || '').trim();
    if (hintQuery && hintQuery.toLowerCase() === q.toLowerCase()) {
      if (remoteSearchHint?.status === 'error') {
        return 'Could not search your catalog just now. Try again in a moment.';
      }
      if (remoteSearchHint?.status === 'empty') {
        return `No products in your catalog matched "${q}". Try another title or SKU.`;
      }
    }
    return 'No products match that search in the loaded list. Search above checks your whole catalog when you type at least three characters.';
  }
  if (q) {
    return 'No products match that search in the loaded list. Try a shorter name or clear the filter on the left.';
  }
  if (activeGroupValue) {
    return 'No products here can be added. They are in other tests, not published to the Online Store, sold out, not available for sale, gift cards, or have no price.';
  }
  return 'No products to show. Try All products or search above.';
}

/** Labels on the products step selection card. */
export function buildManualSelectionCountLabel(selectedCount = 0, availableProductCount = 0) {
  const selected = Number(selectedCount) || 0;
  const available = Number(availableProductCount) || 0;
  return `${selected} of ${available} products selected`;
}

export function buildAllProductsSelectionCountLabel({
  availableProductCount = 0,
  maxSelection = 500,
} = {}) {
  const available = Number(availableProductCount) || 0;
  if (available > maxSelection) {
    return `Top ${maxSelection} of ${available} products`;
  }
  return `All ${available} products`;
}

/** Why the "All products" scope stops short, and which products it keeps. */
export function buildAllProductsCapHelp({ availableProductCount = 0, maxSelection = 500 } = {}) {
  const available = Number(availableProductCount) || 0;
  if (available <= maxSelection) return '';
  const leftOut = available - maxSelection;
  return `One test covers up to ${maxSelection} products, so this test takes the ${maxSelection} with the best mix of traffic and sales and leaves ${leftOut} out. Once it launches, those ${maxSelection} are held, so a second All products test picks up the other ${leftOut}.`;
}

export function shouldShowCatalogTruncatedHelp({
  catalogTruncatedHelp = '',
  availableProductCount = 0,
  loading = false,
  loadError = '',
} = {}) {
  if (!catalogTruncatedHelp || loading || loadError) return false;
  // Nothing pickable — the empty / withheld copy already explains why.
  return Number(availableProductCount) > 0;
}

/**
 * Why some picked products did not make it into the test.
 *
 * The server leaves out a variant it can no longer find in the store's
 * catalog: deleted in Shopify, set to draft or archived, taken off the Online
 * Store, or sold out. A draft saved before that happened still lists it, and
 * dropping it without a word read as the app losing part of the selection.
 * `lookupRows` (catalog rows and saved plans) name the products; a variant
 * neither names is counted on its own.
 */
export function buildUnavailableSelectionNotice(missingIds = [], lookupRows = []) {
  const missing = new Set((missingIds || []).map(variantIdentity).filter(Boolean));
  if (!missing.size) return '';
  const byVariant = new Map();
  (lookupRows || []).forEach(row => {
    const key = variantIdentity(row?.variant_id);
    if (key && missing.has(key) && !byVariant.has(key)) byVariant.set(key, row);
  });
  const products = new Map();
  missing.forEach(key => {
    const row = byVariant.get(key);
    const productKey = row ? productGroupKey(row) || key : key;
    if (!products.has(productKey)) {
      const title = String(
        row?.product_title || row?.metadata?.product_title || row?.title || ''
      )
        .split(' — ')[0]
        .trim();
      products.set(productKey, title);
    }
  });
  const titles = [...products.values()].filter(Boolean);
  const count = products.size;
  const named =
    titles.length === count && count <= 3
      ? titles.map(title => `"${title}"`).join(', ')
      : `${count} product${count === 1 ? '' : 's'}`;
  const verb = count === 1 ? 'is' : 'are';
  return `${named} ${verb} no longer available in your Shopify store (deleted, set to draft, unpublished or sold out), so ${count === 1 ? 'it was' : 'they were'} left out of this test.`;
}
