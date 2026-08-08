/**
 * RipsPriceX API client — shop from Shopify session; talks to Express Smart Pricing API.
 */
import axios from 'axios';

const DEFAULT_API = 'http://127.0.0.1:3456/api';

function resolveApiBase() {
  if (typeof window !== 'undefined' && window.__RIPSPRICEX_API_BASE__) {
    return String(window.__RIPSPRICEX_API_BASE__).replace(/\/+$/, '');
  }
  try {
    const fromEnv =
      typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL
        ? String(import.meta.env.VITE_API_URL).trim()
        : '';
    if (fromEnv) return fromEnv.replace(/\/+$/, '');
  } catch {
    // ignore
  }
  return DEFAULT_API;
}

export function getApiBaseUrl() {
  return resolveApiBase();
}

export function getShopDomain() {
  if (typeof window === 'undefined') return '';
  if (window.__RIPSPRICEX_SHOP__) return String(window.__RIPSPRICEX_SHOP__);
  try {
    const params = new URLSearchParams(window.location.search);
    const shop = params.get('shop');
    if (shop) return shop.toLowerCase();
  } catch {
    // ignore
  }
  return '';
}

export function setShopContext(shop, apiBase) {
  if (typeof window === 'undefined') return;
  if (shop) window.__RIPSPRICEX_SHOP__ = String(shop).toLowerCase();
  if (apiBase) {
    const base = String(apiBase).replace(/\/+$/, '');
    window.__RIPSPRICEX_API_BASE__ = base.endsWith('/api') ? base : `${base}/api`;
  }
}

const apiClient = axios.create({
  timeout: 60000,
});

apiClient.interceptors.request.use((config) => {
  config.baseURL = resolveApiBase();
  const shop = getShopDomain();
  config.headers = config.headers || {};
  if (shop) {
    config.headers['X-Shopify-Shop-Domain'] = shop;
  }
  if (!config.headers['X-Request-ID']) {
    config.headers['X-Request-ID'] =
      `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  }
  // Attach domain/shop query for RipX-compatible handlers
  config.params = {
    ...(config.params || {}),
    ...(shop ? { domain: shop, shop } : {}),
  };
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const apiMsg =
      error.response?.data?.error ??
      (typeof error.response?.data?.message === 'string' ? error.response.data.message : null);
    const details = error.response?.data?.details;
    if (Array.isArray(details) && details.length) {
      error.details = details;
      error.isValidation = true;
      error.message = details.map((d) => (typeof d === 'string' ? d : d?.message || String(d))).join('; ');
    } else if (typeof apiMsg === 'string') {
      error.message = apiMsg;
    }
    if (error.response?.status === 402) {
      error.isPaymentRequired = true;
      error.upgradeUrl = error.response?.data?.upgradeUrl;
    }
    return Promise.reject(error);
  },
);

export function unwrapData(response) {
  const body = response?.data ?? response;
  if (body && typeof body === 'object' && 'success' in body) {
    const { success, message, ...rest } = body;
    return rest;
  }
  return body;
}

function withDomainParams(params = {}) {
  const shop = getShopDomain();
  const next = { ...params };
  if (shop) {
    if (!next.domain) next.domain = shop;
    if (!next.shop) next.shop = shop;
  }
  return next;
}

export function apiGet(endpoint, params = {}, config = {}) {
  return apiClient.get(endpoint, { ...config, params: withDomainParams(params) });
}

export function apiPost(endpoint, data, config = {}) {
  const params = withDomainParams(config.params || {});
  return apiClient.post(endpoint, data, { ...config, params });
}

export function apiPut(endpoint, data, config = {}) {
  const params = withDomainParams(config.params || {});
  return apiClient.put(endpoint, data, { ...config, params });
}

export function apiPatch(endpoint, data, config = {}) {
  const params = withDomainParams(config.params || {});
  return apiClient.patch(endpoint, data, { ...config, params });
}

export function apiDelete(endpoint, config = {}) {
  const params = withDomainParams(config.params || {});
  return apiClient.delete(endpoint, { ...config, params });
}

export default apiClient;
