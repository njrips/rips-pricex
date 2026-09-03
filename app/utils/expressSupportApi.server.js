import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  SUPPORT_INTERNAL_HEADER,
  supportInternalToken,
} = require('../../server/src/services/support/supportInternalAuth.js');

function expressApiBase() {
  return String(process.env.RIPSPRICEX_API_URL || 'http://127.0.0.1:3456').replace(/\/+$/, '');
}

/**
 * @param {string} path
 * @param {{ shop?: string, staffToken?: string, method?: string, body?: unknown }} [options]
 */
export async function expressSupportFetch(
  path,
  { shop, staffToken, method = 'GET', body } = {}
) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (shop) {
    headers['X-Shopify-Shop-Domain'] = shop;
    const proof = supportInternalToken(shop);
    if (proof) headers[SUPPORT_INTERNAL_HEADER] = proof;
  }
  if (staffToken) headers.Authorization = `Bearer ${staffToken}`;

  try {
    const res = await fetch(`${expressApiBase()}/api${path.startsWith('/') ? path : `/${path}`}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 503, data: { error: 'Support service is unavailable' } };
  }
}

export function supportErrorMessage(payload, fallback = 'Support request failed') {
  return (
    payload?.error ||
    payload?.message ||
    payload?.data?.error ||
    fallback
  );
}
