/**
 * Preview URL utilities
 *
 * Single source of truth for A/B test preview link creation.
 * Params must match storefront script (ab_preview*, ab_visual_editor) and backend /api/track/preview.
 */

/** Query param names used by storefront and backend */
export const PREVIEW_PARAMS = {
  PREVIEW: 'ab_preview',
  TEST_ID: 'ab_preview_test',
  TEST_TYPE: 'ab_preview_test_type',
  VARIANT_ID: 'ab_preview_variant',
  VARIANT_NAME: 'ab_preview_variant_name',
  TENANT_DOMAIN: 'ab_preview_domain',
  SIMPLE: 'ab_preview_simple',
  RESET_SESSION: 'ab_preview_reset',
  SESSION_ID: 'ab_preview_session',
  VISUAL_EDITOR: 'ab_visual_editor',
  VISUAL_PICKER: 'ab_visual_picker',
  PRICE_SURFACE_PICK: 'ab_price_surface_pick',
};

const PREVIEW_VALUE = '1';
const TEMP_PREVIEW_HOST_SUFFIXES = ['.trycloudflare.com', '.ngrok-free.app', '.ngrok.io'];
const LEGACY_PREVIEW_BOOTSTRAP_PATHS = new Set(['/ripx-preview-test.html']);

function normalizePreviewHostname(input) {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return '';
  try {
    const url =
      raw.startsWith('http://') || raw.startsWith('https://')
        ? new URL(raw)
        : new URL(`https://${raw}`);
    return String(url.hostname || '')
      .trim()
      .toLowerCase();
  } catch {
    return '';
  }
}

function isShopifyPreviewDomain(domain) {
  const hostname = normalizePreviewHostname(domain);
  return /\.myshopify\.com$/i.test(hostname);
}

function isAllowedOverrideForDomain(candidate, domain) {
  if (!candidate) return false;
  if (!isShopifyPreviewDomain(domain)) return true;
  const candidateHost = normalizePreviewHostname(candidate);
  const domainHost = normalizePreviewHostname(domain);
  if (!candidateHost || !domainHost) return false;
  return candidateHost === domainHost;
}

function isTemporaryPreviewHost(hostname) {
  const host = typeof hostname === 'string' ? hostname.trim().toLowerCase() : '';
  return !!host && TEMP_PREVIEW_HOST_SUFFIXES.some(suffix => host.endsWith(suffix));
}

function getCurrentTemporaryPreviewOrigin() {
  if (typeof window === 'undefined' || !window.location?.origin || !window.location?.hostname) {
    return null;
  }
  if (!isTemporaryPreviewHost(window.location.hostname)) return null;
  try {
    return new URL(window.location.origin);
  } catch {
    return null;
  }
}

function hasLegacyPreviewBootstrapPath(input) {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return false;
  try {
    const url =
      raw.startsWith('http://') || raw.startsWith('https://')
        ? new URL(raw)
        : new URL(`https://${raw}`);
    const pathname = (url.pathname || '').trim().toLowerCase();
    return LEGACY_PREVIEW_BOOTSTRAP_PATHS.has(pathname);
  } catch {
    return false;
  }
}

/**
 * Normalize a base URL or domain for preview.
 * - If input looks like a full URL (has protocol), return as-is (with trailing slash stripped).
 * - If input is a domain (no protocol), return https://domain/
 * @param {string} input - Full URL or domain (e.g. 'https://store.com' or 'store.com')
 * @returns {string|null} Normalized URL or null if invalid/empty
 */
/**
 * Shopify PDP variant id from a URL or path (`?variant=123456`).
 * Kept across preview normalization so multi-SKU previews open the right SKU.
 */
export function extractShopifyVariantParam(input) {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return '';
  try {
    const url =
      raw.startsWith('http://') || raw.startsWith('https://')
        ? new URL(raw)
        : new URL(raw.startsWith('/') ? `https://preview.local${raw}` : `https://${raw}`);
    const variant = String(url.searchParams.get('variant') || '').trim();
    return /^\d+$/.test(variant) ? variant : '';
  } catch {
    const match = raw.match(/[?&]variant=(\d+)/i);
    return match?.[1] || '';
  }
}

export function normalizePreviewBaseUrl(input) {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return null;
  const withoutProtocol = raw
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .split('/')[0];
  if (!withoutProtocol) return null;
  try {
    const url =
      raw.startsWith('http://') || raw.startsWith('https://')
        ? new URL(raw)
        : new URL(`https://${withoutProtocol}`);
    const currentTemporaryOrigin = getCurrentTemporaryPreviewOrigin();
    if (
      currentTemporaryOrigin &&
      isTemporaryPreviewHost(url.hostname) &&
      url.hostname.toLowerCase() !== currentTemporaryOrigin.hostname.toLowerCase()
    ) {
      url.protocol = currentTemporaryOrigin.protocol;
      url.host = currentTemporaryOrigin.host;
    }
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '') || `${url.origin}/`;
  } catch {
    return null;
  }
}

/**
 * Build a preview URL with standard query params.
 * Uses URL and URLSearchParams for correct encoding of variant names/ids.
 *
 * @param {Object} options
 * @param {string} options.baseUrl - Full page URL (e.g. https://store.com/page)
 * @param {string} options.testId - Test UUID
 * @param {string} [options.variantId] - Variant id or fallback identifier
 * @param {string} [options.variantName] - Human-readable variant name
 * @param {string} [options.tenantDomain] - Saved test domain used for preview API lookups
 * @param {boolean} [options.visualEditor=false] - Add ab_visual_editor=1 for visual editor iframe
 * @param {boolean} [options.visualPicker=false] - Add ab_visual_picker=1 for picker mode
 * @param {boolean} [options.simplePreview=false] - Add ab_preview_simple=1 for no-shell preview
 * @param {boolean} [options.usePreviewLaunch=false] - TestWizard only: open via /api/track/preview-launch
 * @param {boolean} [options.resetPreviewSession=false] - Clear prior tab preview state before seeding this URL
 * @param {string} [options.previewSessionId] - Optional preview session nonce for diagnostics/cache boundaries
 * @param {string} [options.testType] - Optional test type hint (`shipping`, `price`, etc.) for storefront preview bootstrap
 * @returns {string|null} Full preview URL or null if baseUrl/testId invalid
 */
export function buildPreviewUrl({
  baseUrl,
  testId,
  variantId,
  variantName,
  tenantDomain,
  testType,
  visualEditor = false,
  visualPicker = false,
  simplePreview = false,
  resetPreviewSession = false,
  previewSessionId,
}) {
  const shopifyVariant = extractShopifyVariantParam(baseUrl);
  const normalized = normalizePreviewBaseUrl(baseUrl);
  if (!normalized) return null;
  const tid = testId !== null && testId !== undefined && testId !== '' ? String(testId).trim() : '';
  if (!tid) return null;

  try {
    const url = new URL(normalized);
    // Re-apply Shopify catalog variant after normalize strips search params.
    if (shopifyVariant) {
      url.searchParams.set('variant', shopifyVariant);
    }
    url.searchParams.set(PREVIEW_PARAMS.PREVIEW, PREVIEW_VALUE);
    url.searchParams.set(PREVIEW_PARAMS.TEST_ID, tid);
    if (variantId !== null && variantId !== undefined && String(variantId).trim())
      url.searchParams.set(PREVIEW_PARAMS.VARIANT_ID, String(variantId).trim());
    if (variantName !== null && variantName !== undefined && String(variantName).trim())
      url.searchParams.set(PREVIEW_PARAMS.VARIANT_NAME, String(variantName).trim());
    if (tenantDomain !== null && tenantDomain !== undefined && String(tenantDomain).trim()) {
      url.searchParams.set(PREVIEW_PARAMS.TENANT_DOMAIN, String(tenantDomain).trim());
    }
    const normalizedTestType = String(testType || '')
      .trim()
      .toLowerCase();
    if (normalizedTestType) {
      url.searchParams.set(PREVIEW_PARAMS.TEST_TYPE, normalizedTestType);
    }
    if (visualEditor) url.searchParams.set(PREVIEW_PARAMS.VISUAL_EDITOR, PREVIEW_VALUE);
    if (visualPicker) url.searchParams.set(PREVIEW_PARAMS.VISUAL_PICKER, PREVIEW_VALUE);
    if (simplePreview) url.searchParams.set(PREVIEW_PARAMS.SIMPLE, PREVIEW_VALUE);
    if (resetPreviewSession) url.searchParams.set(PREVIEW_PARAMS.RESET_SESSION, PREVIEW_VALUE);
    if (
      previewSessionId !== null &&
      previewSessionId !== undefined &&
      String(previewSessionId).trim()
    ) {
      url.searchParams.set(PREVIEW_PARAMS.SESSION_ID, String(previewSessionId).trim());
    }
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Build a preview-document URL that proxies the target page while preserving preview params.
 * Useful for Shopify previews where the raw storefront page may not load the RipX runtime reliably.
 *
 * @param {Object} options
 * @param {string} options.apiBaseUrl - API base URL (e.g. /api or https://host/api)
 * @param {string} options.previewUrl - Full preview page URL built by buildPreviewUrl()
 * @param {boolean} [options.visualEditor=false] - Add ab_visual_editor=1 to preview-document
 * @param {boolean} [options.visualPicker=false] - Add ab_visual_picker=1 to preview-document
 * @param {boolean} [options.priceSurfacePick=false] - Add ab_price_surface_pick=1 to preview-document
 * @param {string} [options.storefrontPassword] - Optional Shopify storefront password for dev/password-protected stores
 * @param {string} [options.parentOrigin] - App origin that will embed the preview iframe
 * @returns {string|null}
 */
export function buildPreviewDocumentUrl({
  apiBaseUrl,
  previewUrl,
  visualEditor = false,
  visualPicker = false,
  priceSurfacePick = false,
  storefrontPassword,
  parentOrigin,
}) {
  const directPreviewUrl = typeof previewUrl === 'string' ? previewUrl.trim() : '';
  if (!directPreviewUrl) return null;

  const apiBase =
    (typeof apiBaseUrl === 'string' ? apiBaseUrl.trim() : '').replace(/\/+$/, '') || '/api';
  const previewDocPath = `${apiBase}/track/preview-document`;
  const isRelative = typeof window !== 'undefined' && apiBase && !/^https?:\/\//i.test(apiBase);

  try {
    const previewDoc = isRelative
      ? new URL(
          previewDocPath,
          typeof window !== 'undefined' && window.location?.origin
            ? window.location.origin
            : 'https://preview.invalid'
        )
      : /^https?:\/\//i.test(previewDocPath)
        ? new URL(previewDocPath)
        : new URL(previewDocPath, 'https://preview.invalid');
    previewDoc.searchParams.set('url', directPreviewUrl);
    if (visualEditor) {
      previewDoc.searchParams.set(PREVIEW_PARAMS.VISUAL_EDITOR, PREVIEW_VALUE);
    }
    if (visualPicker) {
      previewDoc.searchParams.set(PREVIEW_PARAMS.VISUAL_PICKER, PREVIEW_VALUE);
    }
    if (priceSurfacePick) {
      previewDoc.searchParams.set(PREVIEW_PARAMS.PRICE_SURFACE_PICK, PREVIEW_VALUE);
    }
    if (storefrontPassword !== null && storefrontPassword !== undefined) {
      const password = String(storefrontPassword).trim();
      if (password) {
        previewDoc.searchParams.set('storefront_password', password);
      }
    }
    const explicitParentOrigin =
      typeof parentOrigin === 'string' && parentOrigin.trim()
        ? parentOrigin.trim()
        : typeof window !== 'undefined' && window.location?.origin
          ? window.location.origin
          : '';
    if (explicitParentOrigin) {
      previewDoc.searchParams.set('parent_origin', explicitParentOrigin);
    }

    const directUrl = new URL(directPreviewUrl);
    [
      PREVIEW_PARAMS.PREVIEW,
      PREVIEW_PARAMS.TEST_ID,
      PREVIEW_PARAMS.TEST_TYPE,
      PREVIEW_PARAMS.VARIANT_ID,
      PREVIEW_PARAMS.VARIANT_NAME,
      PREVIEW_PARAMS.TENANT_DOMAIN,
      PREVIEW_PARAMS.SIMPLE,
      PREVIEW_PARAMS.RESET_SESSION,
      PREVIEW_PARAMS.SESSION_ID,
      PREVIEW_PARAMS.VISUAL_PICKER,
      PREVIEW_PARAMS.VISUAL_EDITOR,
      PREVIEW_PARAMS.PRICE_SURFACE_PICK,
    ].forEach(key => {
      const value = directUrl.searchParams.get(key);
      if (value !== undefined && value !== null && value !== '') {
        previewDoc.searchParams.set(key, value);
      }
    });
    return previewDoc.toString();
  } catch {
    return null;
  }
}

/**
 * Build a storefront tab URL for click-to-select picker mode.
 * Uses preview-document when possible so RipX can post selectors back to the wizard.
 *
 * @param {Object} options
 * @param {string} options.baseUrl - Storefront page URL or domain
 * @param {string} [options.testId] - Optional saved test id for preview assignment
 * @param {string} [options.variantId]
 * @param {string} [options.variantName]
 * @param {string} [options.tenantDomain]
 * @param {string} options.apiBaseUrl
 * @param {string} [options.storefrontPassword]
 * @param {string} [options.parentOrigin]
 * @param {boolean} [options.priceSurfacePick=false]
 * @returns {string|null}
 */
export function buildVisualPickerLaunchUrl({
  baseUrl,
  testId,
  variantId,
  variantName,
  tenantDomain,
  apiBaseUrl,
  storefrontPassword,
  parentOrigin,
  priceSurfacePick = false,
  resetPreviewSession = false,
  previewSessionId,
}) {
  const normalized = normalizePreviewBaseUrl(baseUrl);
  if (!normalized) {
    return null;
  }

  let directPreviewUrl = '';
  const tid = testId !== null && testId !== undefined && testId !== '' ? String(testId).trim() : '';
  const includeVisualEditor = !priceSurfacePick;
  if (tid) {
    directPreviewUrl =
      buildPreviewUrl({
        baseUrl: normalized,
        testId: tid,
        variantId,
        variantName,
        tenantDomain,
        visualEditor: includeVisualEditor,
        visualPicker: true,
        resetPreviewSession,
        previewSessionId,
      }) || '';
  } else {
    try {
      const url = new URL(normalized);
      if (includeVisualEditor) {
        url.searchParams.set(PREVIEW_PARAMS.VISUAL_EDITOR, PREVIEW_VALUE);
      }
      url.searchParams.set(PREVIEW_PARAMS.VISUAL_PICKER, PREVIEW_VALUE);
      directPreviewUrl = url.toString();
    } catch {
      directPreviewUrl = '';
    }
  }

  if (!directPreviewUrl) {
    return null;
  }

  if (priceSurfacePick) {
    try {
      const withMode = new URL(directPreviewUrl);
      withMode.searchParams.set(PREVIEW_PARAMS.PRICE_SURFACE_PICK, PREVIEW_VALUE);
      directPreviewUrl = withMode.toString();
    } catch {
      // keep direct preview URL
    }
  }

  return (
    buildPreviewDocumentUrl({
      apiBaseUrl,
      previewUrl: directPreviewUrl,
      visualEditor: includeVisualEditor,
      visualPicker: true,
      priceSurfacePick,
      storefrontPassword,
      parentOrigin,
    }) || directPreviewUrl
  );
}

/**
 * Build a client-side preview launch URL that stores preview context in window.name
 * before redirecting to the actual storefront URL. This helps Shopify password pages
 * that drop deep-link query params before the storefront runtime initializes.
 *
 * @param {Object} options
 * @param {string} options.apiBaseUrl - API base URL (e.g. /api or https://host/api)
 * @param {string} options.previewUrl - Full preview page URL built by buildPreviewUrl()
 * @param {string} [options.storefrontPassword] - Optional Shopify storefront password (open preview only)
 * @returns {string|null}
 */
export function buildPreviewLaunchUrl({ apiBaseUrl, previewUrl, storefrontPassword }) {
  const directPreviewUrl = typeof previewUrl === 'string' ? previewUrl.trim() : '';
  if (!directPreviewUrl) return null;

  const apiBase =
    (typeof apiBaseUrl === 'string' ? apiBaseUrl.trim() : '').replace(/\/+$/, '') || '/api';
  const launchPath = `${apiBase}/track/preview-launch`;
  const isRelative = typeof window !== 'undefined' && apiBase && !/^https?:\/\//i.test(apiBase);

  try {
    const launchUrl = isRelative
      ? new URL(
          launchPath,
          typeof window !== 'undefined' && window.location?.origin
            ? window.location.origin
            : 'https://preview.invalid'
        )
      : /^https?:\/\//i.test(launchPath)
        ? new URL(launchPath)
        : new URL(launchPath, 'https://preview.invalid');
    launchUrl.searchParams.set('url', directPreviewUrl);

    const directUrl = new URL(directPreviewUrl);
    [
      PREVIEW_PARAMS.PREVIEW,
      PREVIEW_PARAMS.TEST_ID,
      PREVIEW_PARAMS.TEST_TYPE,
      PREVIEW_PARAMS.VARIANT_ID,
      PREVIEW_PARAMS.VARIANT_NAME,
      PREVIEW_PARAMS.TENANT_DOMAIN,
      PREVIEW_PARAMS.SIMPLE,
      PREVIEW_PARAMS.RESET_SESSION,
      PREVIEW_PARAMS.SESSION_ID,
    ].forEach(key => {
      const value = directUrl.searchParams.get(key);
      if (value !== undefined && value !== null && value !== '') {
        launchUrl.searchParams.set(key, value);
      }
    });
    const password =
      storefrontPassword !== null && storefrontPassword !== undefined
        ? String(storefrontPassword).trim()
        : '';
    if (password) {
      launchUrl.searchParams.set('storefront_password', password);
    }
    return launchUrl.toString();
  } catch {
    return null;
  }
}

/**
 * Build a Shopify App Proxy bootstrap URL so the storefront script is guaranteed
 * to load before redirecting to the final preview page.
 *
 * @param {Object} options
 * @param {string} options.previewUrl - Full preview page URL built by buildPreviewUrl()
 * @returns {string|null}
 */
export function buildShopifyPreviewBootstrapUrl({ previewUrl, storefrontPassword } = {}) {
  const directPreviewUrl = typeof previewUrl === 'string' ? previewUrl.trim() : '';
  if (!directPreviewUrl) return null;
  try {
    const directUrl = new URL(directPreviewUrl);
    const host = String(directUrl.hostname || '').trim();
    if (!host || !/\.myshopify\.com$/i.test(host)) return null;
    const bootstrap = new URL(`https://${host}/apps/ripspricex/preview-bootstrap-v2`);
    bootstrap.searchParams.set('url', directPreviewUrl);
    const password =
      storefrontPassword !== null && storefrontPassword !== undefined
        ? String(storefrontPassword).trim()
        : '';
    if (password) {
      bootstrap.searchParams.set('storefront_password', password);
    }
    [
      PREVIEW_PARAMS.PREVIEW,
      PREVIEW_PARAMS.TEST_ID,
      PREVIEW_PARAMS.TEST_TYPE,
      PREVIEW_PARAMS.VARIANT_ID,
      PREVIEW_PARAMS.VARIANT_NAME,
      PREVIEW_PARAMS.TENANT_DOMAIN,
      PREVIEW_PARAMS.SIMPLE,
      PREVIEW_PARAMS.RESET_SESSION,
      PREVIEW_PARAMS.SESSION_ID,
    ].forEach(key => {
      const value = directUrl.searchParams.get(key);
      if (value !== undefined && value !== null && value !== '') {
        bootstrap.searchParams.set(key, value);
      }
    });
    return bootstrap.toString();
  } catch {
    return null;
  }
}

/**
 * Build the isolated Shopify price-preview bootstrap URL.
 *
 * Price previews use this route instead of the generic HTML-rewriting bootstrap
 * because price tests must keep RipX loaded while add-to-cart flows mutate the cart.
 *
 * @param {Object} options
 * @param {string} options.previewUrl - Full preview page URL built by buildPreviewUrl()
 * @returns {string|null}
 */
export function buildShopifyPricePreviewBootstrapUrl({ previewUrl, storefrontPassword } = {}) {
  const directPreviewUrl = typeof previewUrl === 'string' ? previewUrl.trim() : '';
  if (!directPreviewUrl) return null;
  try {
    const directUrl = new URL(directPreviewUrl);
    const host = String(directUrl.hostname || '').trim();
    if (!host || !/\.myshopify\.com$/i.test(host)) return null;
    const bootstrap = new URL(`https://${host}/apps/ripspricex/price-preview-bootstrap-v1`);
    bootstrap.searchParams.set('url', directPreviewUrl);
    [
      PREVIEW_PARAMS.PREVIEW,
      PREVIEW_PARAMS.TEST_ID,
      PREVIEW_PARAMS.TEST_TYPE,
      PREVIEW_PARAMS.VARIANT_ID,
      PREVIEW_PARAMS.VARIANT_NAME,
      PREVIEW_PARAMS.TENANT_DOMAIN,
      PREVIEW_PARAMS.SIMPLE,
      PREVIEW_PARAMS.RESET_SESSION,
      PREVIEW_PARAMS.SESSION_ID,
    ].forEach(key => {
      const value = directUrl.searchParams.get(key);
      if (value !== undefined && value !== null && value !== '') {
        bootstrap.searchParams.set(key, value);
      }
    });
    const password =
      storefrontPassword !== null && storefrontPassword !== undefined
        ? String(storefrontPassword).trim()
        : '';
    if (password) {
      bootstrap.searchParams.set('storefront_password', password);
    }
    return bootstrap.toString();
  } catch {
    return null;
  }
}

/**
 * Whether a preview URL points to a Shopify store host.
 *
 * @param {string} previewUrl
 * @returns {boolean}
 */
export function isShopifyPreviewUrl(previewUrl) {
  const directPreviewUrl = typeof previewUrl === 'string' ? previewUrl.trim() : '';
  if (!directPreviewUrl) return false;
  try {
    const host = String(new URL(directPreviewUrl).hostname || '').trim();
    return /\.myshopify\.com$/i.test(host);
  } catch {
    return false;
  }
}

const STOREFRONT_PASSWORD_STORAGE_PREFIX = 'ripx_storefront_password:';

/** @deprecated Not auto-injected; use VITE_RIPX_DEV_STOREFRONT_PASSWORD or the local password field. */
export const DEV_STOREFRONT_PASSWORD_FALLBACK = 'sp';

function readViteDevFlag() {
  try {
    // Avoid a bare `import.meta` token so Jest (CJS) can parse this module.
    // eslint-disable-next-line no-new-func
    return Boolean(
      // eslint-disable-next-line no-new-func
      Function(
        'try { return !!(import.meta && import.meta.env && import.meta.env.DEV); } catch (e) { return false; }'
      )()
    );
  } catch {
    return false;
  }
}

function readViteDevStorefrontPassword() {
  try {
    // eslint-disable-next-line no-new-func
    const fromMeta = String(
      // eslint-disable-next-line no-new-func
      Function(
        'try { return (import.meta && import.meta.env && import.meta.env.VITE_RIPX_DEV_STOREFRONT_PASSWORD) || ""; } catch (e) { return ""; }'
      )() || ''
    ).trim();
    if (fromMeta) return fromMeta;
  } catch {
    // ignore
  }
  if (typeof process !== 'undefined' && process.env?.VITE_RIPX_DEV_STOREFRONT_PASSWORD) {
    return String(process.env.VITE_RIPX_DEV_STOREFRONT_PASSWORD).trim();
  }
  return '';
}

/**
 * True for local/dev admin surfaces where storefront password entry is allowed.
 * Includes localhost, Vite DEV, and common Shopify-app tunnels — not production merchant hosts.
 *
 * @returns {boolean}
 */
export function isLocalDevStorefrontPasswordUiEnabled() {
  if (typeof window === 'undefined') {
    return false;
  }
  const host = String(window.location?.hostname || '')
    .trim()
    .toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost')) {
    return true;
  }
  if (
    host.endsWith('.trycloudflare.com') ||
    host.endsWith('.ngrok-free.app') ||
    host.endsWith('.ngrok.io') ||
    host.endsWith('.loca.lt') ||
    host.endsWith('.echologyx.com')
  ) {
    return true;
  }
  return readViteDevFlag();
}

/**
 * Optional local-dev default from Vite env only (never hardcode a shared password).
 * Production merchant installs do not use this.
 *
 * @returns {string}
 */
export function getDevStorefrontPasswordDefault() {
  if (!isLocalDevStorefrontPasswordUiEnabled()) {
    return '';
  }
  return readViteDevStorefrontPassword();
}

/**
 * Session-scoped storage key for a Shopify storefront password (never sent to clipboard helpers).
 * @param {string} domain
 * @returns {string}
 */
export function storefrontPasswordStorageKey(domain) {
  const host = normalizePreviewHostname(domain);
  return host ? `${STOREFRONT_PASSWORD_STORAGE_PREFIX}${host}` : '';
}

/**
 * @param {string} domain
 * @returns {string}
 */
export function loadPersistedStorefrontPassword(domain) {
  if (typeof window === 'undefined' || !window.sessionStorage) return '';
  const key = storefrontPasswordStorageKey(domain);
  if (!key) return '';
  try {
    return String(window.sessionStorage.getItem(key) || '').trim();
  } catch {
    return '';
  }
}

/**
 * @param {string} domain
 * @param {string} password
 */
export function persistStorefrontPassword(domain, password) {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  const key = storefrontPasswordStorageKey(domain);
  if (!key) return;
  const trimmed = typeof password === 'string' ? password.trim() : '';
  try {
    if (trimmed) {
      window.sessionStorage.setItem(key, trimmed);
    } else {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // ignore quota / private mode
  }
}

/**
 * Resolve storefront password for preview-document URLs: explicit value first, then sessionStorage per host.
 *
 * @param {string} domain - Shop host used for persistence lookup
 * @param {string} [explicitPassword] - In-memory password from wizard state
 * @param {string[]} [fallbackDomains] - Alternate hosts (e.g. route vs shop_domain) when keys differ
 * @returns {string}
 */
export function resolveStorefrontPasswordForPreview(
  domain,
  explicitPassword,
  fallbackDomains = []
) {
  const explicit =
    explicitPassword !== null && explicitPassword !== undefined
      ? String(explicitPassword).trim()
      : '';
  if (explicit) {
    return explicit;
  }
  const envDefault = getDevStorefrontPasswordDefault();
  const seen = new Set();
  const candidates = [domain, ...(Array.isArray(fallbackDomains) ? fallbackDomains : [])];
  for (const candidate of candidates) {
    const host = normalizePreviewHostname(candidate);
    if (!host || seen.has(host)) {
      continue;
    }
    seen.add(host);
    const loaded = loadPersistedStorefrontPassword(host);
    if (!loaded) {
      continue;
    }
    // Migrate away from the old hard-coded "sp" default when env has the real password.
    if (
      loaded === DEV_STOREFRONT_PASSWORD_FALLBACK &&
      envDefault &&
      envDefault !== DEV_STOREFRONT_PASSWORD_FALLBACK
    ) {
      try {
        persistStorefrontPassword(host, envDefault);
      } catch {
        // ignore
      }
      return envDefault;
    }
    return loaded;
  }
  return envDefault;
}

export function stripPreviewDocumentSecretParams(previewDocumentUrl) {
  const raw = typeof previewDocumentUrl === 'string' ? previewDocumentUrl.trim() : '';
  if (!raw) return '';
  try {
    const url = new URL(
      raw,
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'https://preview.invalid'
    );
    url.searchParams.delete('storefront_password');
    return url.toString();
  } catch {
    return raw.replace(/([?&])storefront_password=[^&]*/i, '$1').replace(/[?&]$/, '');
  }
}

/**
 * Ensure preview opens through Shopify bootstrap route.
 * Useful as a final safeguard right before window.open.
 * Existing price-preview bootstrap URLs are left untouched so the generic bootstrap does not wrap
 * the stricter price runner and lose its early cart-script injection behavior.
 *
 * @param {string} previewUrl
 * @returns {string}
 */
export function ensureShopifyPreviewBootstrapUrl(previewUrl) {
  const directPreviewUrl = typeof previewUrl === 'string' ? previewUrl.trim() : '';
  if (!directPreviewUrl) return '';
  try {
    const parsed = new URL(directPreviewUrl);
    if (parsed.searchParams.get(PREVIEW_PARAMS.SIMPLE) === PREVIEW_VALUE) {
      return parsed.toString();
    }
    const host = String(parsed.hostname || '').trim();
    if (!host || !/\.myshopify\.com$/i.test(host)) return directPreviewUrl;
    const p = String(parsed.pathname || '').toLowerCase();
    if (
      p.indexOf('/apps/ripspricex/preview-bootstrap') === 0 ||
      p.indexOf('/apps/ripspricex/preview-bootstrap-v2') === 0 ||
      p.indexOf('/apps/ripspricex/price-preview-bootstrap') === 0
    )
      return parsed.toString();
    return `https://${host}/apps/ripspricex/preview-bootstrap-v2?url=${encodeURIComponent(parsed.toString())}`;
  } catch {
    return directPreviewUrl;
  }
}

/**
 * Resolve default base URL for preview from domain(s) and optional override.
 * Order: override URL (if valid) > domain as https://domain/
 *
 * @param {Object} options
 * @param {string} [options.overrideUrl] - User-entered or saved preview URL
 * @param {string} [options.domain] - Domain (e.g. shop_domain or current store)
 * @param {string} [options.path] - Path to append (e.g. '/' or '/products/')
 * @returns {string|null}
 */
export function getDefaultPreviewBaseUrl({ overrideUrl, domain, path = '/' }) {
  const override = typeof overrideUrl === 'string' ? overrideUrl.trim() : '';
  if (
    override &&
    !hasLegacyPreviewBootstrapPath(override) &&
    isAllowedOverrideForDomain(override, domain)
  ) {
    const normalized = normalizePreviewBaseUrl(override);
    if (normalized) return normalized;
  }
  const d =
    typeof domain === 'string'
      ? domain
          .trim()
          .replace(/^https?:\/\//i, '')
          .replace(/\/+$/, '')
      : '';
  if (!d) return null;
  const p = path && path.startsWith('/') ? path : `/${path || ''}`;
  return `https://${d}${p}`;
}

/**
 * Resolve the best base URL for preview from multiple candidates.
 * Order: variantUrl (if valid) > overrideUrl (if valid) > domain + path.
 * Use this so wizard and editor share the same resolution logic.
 *
 * @param {Object} options
 * @param {string} [options.variantUrl] - Per-variant URL (e.g. variant.config.url)
 * @param {string} [options.overrideUrl] - User-entered or saved URL (e.g. visual_editor_preview_url)
 * @param {string} [options.domain] - Domain only (e.g. shop_domain, getPreviewDomain(), getShopDomain())
 * @param {string} [options.path] - Path when using domain (e.g. '/' or '/products/')
 * @returns {string|null}
 */
export function resolvePreviewBaseUrl({ variantUrl, overrideUrl, domain, path = '/' }) {
  const variant = typeof variantUrl === 'string' ? variantUrl.trim() : '';
  if (
    variant &&
    !hasLegacyPreviewBootstrapPath(variant) &&
    isAllowedOverrideForDomain(variant, domain)
  ) {
    const n = normalizePreviewBaseUrl(variant);
    if (n) return n;
  }
  const override = typeof overrideUrl === 'string' ? overrideUrl.trim() : '';
  if (
    override &&
    !hasLegacyPreviewBootstrapPath(override) &&
    isAllowedOverrideForDomain(override, domain)
  ) {
    const n = normalizePreviewBaseUrl(override);
    if (n) return n;
  }
  return getDefaultPreviewBaseUrl({ domain, path });
}
