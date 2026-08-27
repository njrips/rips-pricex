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
