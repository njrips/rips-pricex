import { productGroupKey } from './productsStepReadiness';

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

  const headline =
    store > 0
      ? `${store} active product${store === 1 ? '' : 's'} in your store`
      : `${available + withheld} active product${available + withheld === 1 ? '' : 's'} in your store`;

  const parts = [];
  if (available > 0 || withheld > 0 || store > 0) {
    parts.push(`${available} available to add`);
  }
  if (withheld > 0) {
    parts.push(`${withheld} in other tests`);
  }
  // The store count includes gift cards and products with no price above zero,
  // which never become rows. Left unsaid, the line does not add up.
  const untestable = store > 0 ? store - available - withheld : 0;
  if (untestable > 0) {
    parts.push(`${untestable} can’t be tested (gift cards or no price)`);
  }

  let line = parts.length ? `${headline} · ${parts.join(' · ')}` : headline;
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

export function buildWithheldDetail(withheldByOtherTests = null) {
  const withheldCount = Number(withheldByOtherTests?.total) || 0;
  if (withheldCount <= 0) return '';
  const withheldSummary = buildWithheldSummary(withheldCount);
  const experiments = (withheldByOtherTests?.experiments || []).filter(row => row?.title);
  if (experiments.length) {
    const shown = experiments
      .slice(0, 3)
      .map(row => {
        const n = Number(row.products) || 0;
        const state = row.live ? 'running' : 'paused';
        return n > 0
          ? `${row.title} (${n} product${n === 1 ? '' : 's'}, ${state})`
          : `${row.title} (${state})`;
      })
      .join('; ');
    const more = experiments.length - 3;
    const single = experiments.length === 1;
    return `${withheldSummary}: ${shown}${more > 0 ? `; and ${more} more` : ''}. End ${
      single ? 'that test' : 'those tests'
    } on the Tests page to reuse ${withheldCount === 1 ? 'it' : 'them'} here.`;
  }
  const withheldTestNames = (withheldByOtherTests?.tests || [])
    .slice(0, 2)
    .map(row => row?.name)
    .filter(Boolean)
    .join(', ');
  return `${withheldSummary}: ${
    withheldCount === 1 ? 'it is' : 'they are'
  } in another test${
    withheldTestNames ? ` (${withheldTestNames})` : ''
  }. End that test to reuse ${withheldCount === 1 ? 'it' : 'them'} here.`;
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
} = {}) {
  if (loading || loadError) return '';
  if (availableProductCount > 0) return '';
  if (withheldCount > 0) {
    return `No products available to pick here. ${withheldCount} product${
      withheldCount === 1 ? ' is' : 's are'
    } in another test — end ${withheldCount === 1 ? 'that test' : 'those tests'} to add ${
      withheldCount === 1 ? 'it' : 'them'
    }.`;
  }
  if (catalogTruncated) {
    return 'No products appear in this snapshot. Open Browse products and search your catalog to find products to test.';
  }
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
} = {}) {
  const available = countCatalogProducts(opportunities);
  if (available === 0) {
    return buildProductsStepEmptyMessage({
      availableProductCount: 0,
      withheldCount,
      catalogTruncated,
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
    return 'No products in this collection or category in the loaded catalog.';
  }
  return 'No products to show. Try All products or search above.';
}

/** Labels on the products step selection card. */
export function buildManualSelectionCountLabel(selectedCount = 0, availableProductCount = 0) {
  const selected = Number(selectedCount) || 0;
  const available = Number(availableProductCount) || 0;
  return `${selected} of ${available} products`;
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
  return `One test covers up to ${maxSelection} products, so this test takes the ${maxSelection} with the best mix of traffic, margin and sales and leaves ${leftOut} out. Once it launches, those ${maxSelection} are held, so a second All products test picks up the other ${leftOut}.`;
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
