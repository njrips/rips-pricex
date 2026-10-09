const KEEP_PARAMS = ['shop', 'host', 'embedded', 'id_token', 'locale', 'session'];

export function withEmbeddedSearch(request, path, extra = {}) {
  const url = new URL(request.url);
  const params = new URLSearchParams();
  for (const key of KEEP_PARAMS) {
    const value = url.searchParams.get(key);
    if (value) params.set(key, value);
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value != null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Keeps the Shopify embed params that are already on this browser URL.
 * Internal `/app` links otherwise drop `shop` and `host` on the next page.
 */
export function preserveEmbeddedSearch(path) {
  if (typeof window === 'undefined') return path;
  const raw = String(path || '');
  const hashIndex = raw.indexOf('#');
  const hash = hashIndex >= 0 ? raw.slice(hashIndex) : '';
  const withoutHash = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const queryIndex = withoutHash.indexOf('?');
  const pathname = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const params = new URLSearchParams(queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : '');
  const current = new URLSearchParams(window.location.search);
  for (const key of KEEP_PARAMS) {
    if (!params.has(key)) {
      const value = current.get(key);
      if (value) params.set(key, value);
    }
  }
  const qs = params.toString();
  return `${pathname}${qs ? `?${qs}` : ''}${hash}`;
}

export function withCurrentEmbeddedSearch(searchParams, path, extra = {}) {
  const source =
    searchParams instanceof URLSearchParams
      ? searchParams
      : new URLSearchParams(searchParams || '');
  return withEmbeddedSearch({ url: `https://admin.example${path}?${source.toString()}` }, path, extra);
}

/** App Bridge session bounce / App Bridge HTML thrown from authenticate.admin. */
export function isShopifySessionBounce(error) {
  if (!error || typeof error !== 'object') return false;
  const status = Number(error.status);
  if (status === 401 || status === 410) return true;
  const data = typeof error.data === 'string' ? error.data : '';
  return (
    data.includes('shopifycloud/app-bridge') || data.includes('data-api-key=')
  );
}

/**
 * Shopify's boundary.error() renders ErrorResponse bodies as HTML. Redirects and
 * other empty responses fall back to the placeholder "Handling response", which is
 * what merchants see when navigation is still in flight.
 */
export function shouldRenderShopifyBoundaryHtml(error) {
  if (!error || typeof error !== 'object') return false;
  if (isShopifySessionBounce(error)) return true;
  const data = typeof error.data === 'string' ? error.data.trim() : '';
  return Boolean(data && data.includes('<'));
}

export function isShopifyRedirectResponse(error) {
  if (!error || typeof error !== 'object') return false;
  const status = Number(error.status);
  return status >= 300 && status < 400;
}
