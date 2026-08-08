/**
 * Dev/staging helpers for password-protected Shopify storefront previews.
 * Live merchant stores are typically public; defaults are disabled in production unless configured.
 *
 * Unlock strategy mirrors Shopify CLI (`storefront-session.ts`):
 * 1) Seed `_shopify_essential` via HEAD to the storefront
 * 2) POST `/password` with password-only body + that cookie
 * 3) Fallbacks: classic form_type body, then theme authenticity_token form
 * Success requires a redirect away from `/password` and/or a `storefront_digest` cookie,
 * then a verified follow-up fetch that is not still the password gate.
 */

/** @deprecated Kept for tests/docs only — never auto-injected (stores use different passwords). */
const DEV_STOREFRONT_PASSWORD_FALLBACK = 'sp';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CLI_UA = 'Shopify CLI; v=3.80.0';

/**
 * Dev default only when RIPX_DEV_STOREFRONT_PASSWORD is explicitly configured.
 * Do not hardcode "sp" — that caused false "password was not accepted" on shops
 * whose storefront password is different (e.g. ripx-plus).
 *
 * @param {string} [_requestHost]
 * @returns {string}
 */
function getDevStorefrontPasswordDefault(_requestHost = '') {
  return String(process.env.RIPX_DEV_STOREFRONT_PASSWORD || '').trim();
}

/**
 * @param {string} queryPassword
 * @param {string} [requestHost]
 * @returns {string}
 */
function resolveStorefrontPasswordForPreviewRequest(queryPassword, requestHost = '') {
  const explicit =
    queryPassword !== null && queryPassword !== undefined ? String(queryPassword).trim() : '';
  if (explicit) {
    return explicit;
  }
  return getDevStorefrontPasswordDefault(requestHost);
}

function collectSetCookies(response, jar) {
  const setCookies =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : response.headers.get('set-cookie')
        ? [response.headers.get('set-cookie')]
        : [];
  for (const value of setCookies) {
    const crumb = String(value || '')
      .split(';')[0]
      .trim();
    if (!crumb || !crumb.includes('=')) {
      continue;
    }
    const name = crumb.slice(0, crumb.indexOf('='));
    const next = jar.filter(entry => !entry.startsWith(`${name}=`));
    next.push(crumb);
    jar.length = 0;
    jar.push(...next);
  }
}

function cookieHeader(jar) {
  return Array.isArray(jar) && jar.length ? jar.join('; ') : '';
}

function getCookieValue(jar, name) {
  const prefix = `${name}=`;
  const hit = (jar || []).find(entry => entry.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : '';
}

function extractAuthenticityToken(html) {
  const raw = String(html || '');
  const patterns = [
    /name=["']authenticity_token["'][^>]*value=["']([^"']+)["']/i,
    /value=["']([^"']+)["'][^>]*name=["']authenticity_token["']/i,
    /<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) {
      return String(match[1]).trim();
    }
  }
  return '';
}

function isPasswordRedirectLocation(location, storeOrigin) {
  if (!location) {
    return false;
  }
  try {
    const redirectUrl = new URL(String(location), storeOrigin);
    const path = String(redirectUrl.pathname || '').toLowerCase();
    return path === '/password' || path.endsWith('/password');
  } catch {
    return /\/password\/?(\?|$)/i.test(String(location));
  }
}

/**
 * Shopify CLI treats a same-origin 302 as success, but failed unlocks can also 302
 * back to `/password`. Require a redirect that leaves the password gate.
 *
 * @param {Response} response
 * @param {string} storeOrigin
 * @returns {boolean}
 */
function redirectsAwayFromPasswordGate(response, storeOrigin) {
  const status = Number(response?.status || 0);
  if (status < 300 || status >= 400) {
    return false;
  }
  const location = response.headers.get('location') || '';
  if (!location) {
    return false;
  }
  try {
    const redirectUrl = new URL(location, storeOrigin);
    if (redirectUrl.origin !== new URL(storeOrigin).origin) {
      return false;
    }
    return !isPasswordRedirectLocation(location, storeOrigin);
  } catch {
    return false;
  }
}

/**
 * True when the response is still the Shopify password gate (not a normal storefront page
 * that merely links to /password somewhere in HTML/JS).
 *
 * @param {string} html
 * @param {string} [responseUrl]
 * @returns {boolean}
 */
function isLikelyShopifyPasswordPage(html, responseUrl = '') {
  const lowerHtml = String(html || '').toLowerCase();
  let pathname = '';
  try {
    pathname = new URL(String(responseUrl || '').trim()).pathname.toLowerCase();
  } catch {
    pathname = String(responseUrl || '')
      .trim()
      .toLowerCase();
  }
  const onPasswordPath =
    pathname === '/password' ||
    pathname.endsWith('/password') ||
    /\/password\/?(\?|$)/.test(pathname);

  const hasPasswordForm =
    /name=["']form_type["'][^>]*value=["']storefront_password["']/i.test(html || '') ||
    /value=["']storefront_password["'][^>]*name=["']form_type["']/i.test(html || '') ||
    (/name=["']password["']/i.test(html || '') &&
      (/id=["']password["']/i.test(html || '') || /enter store password/i.test(html || '')));

  const hasPasswordCopy =
    lowerHtml.includes('this store is password protected') ||
    lowerHtml.includes('enter store password') ||
    lowerHtml.includes('storefront password');

  // Require a strong signal. Do NOT treat any HTML that merely mentions "/password"
  // (theme links, scripts, footers) as the password gate — that caused false
  // "password was not accepted" after a successful unlock.
  if (onPasswordPath && (hasPasswordForm || hasPasswordCopy || lowerHtml.includes('<form'))) {
    return true;
  }
  if (hasPasswordForm && hasPasswordCopy) {
    return true;
  }
  return false;
}

/**
 * @param {URL} parsedUrl
 * @param {AbortSignal} [signal]
 * @returns {Promise<string[]>}
 */
async function seedStorefrontCookieJar(parsedUrl, signal) {
  const jar = [];
  const seedUrl = new URL('/?_fd=0&pb=0', parsedUrl.origin);
  const headRes = await fetch(seedUrl.toString(), {
    method: 'HEAD',
    redirect: 'manual',
    signal,
    headers: {
      'User-Agent': CLI_UA,
      Accept: '*/*',
      'Cache-Control': 'no-cache',
    },
  });
  collectSetCookies(headRes, jar);

  if (!getCookieValue(jar, '_shopify_essential')) {
    const getRes = await fetch(parsedUrl.origin + '/', {
      method: 'GET',
      redirect: 'manual',
      signal,
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    collectSetCookies(getRes, jar);
    // Drain body so the socket can close cleanly.
    await getRes.text().catch(() => '');
  }

  return jar;
}

/**
 * @param {URL} passwordUrl
 * @param {URLSearchParams|string} body
 * @param {string[]} jar
 * @param {AbortSignal} [signal]
 * @param {Record<string, string>} [extraHeaders]
 * @returns {Promise<Response>}
 */
async function postStorefrontPassword(passwordUrl, body, jar, signal, extraHeaders = {}) {
  return fetch(passwordUrl.toString(), {
    method: 'POST',
    redirect: 'manual',
    signal,
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent': extraHeaders['User-Agent'] || CLI_UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: passwordUrl.origin,
      Referer: passwordUrl.toString(),
      'Cache-Control': 'no-cache',
      ...(cookieHeader(jar) ? { Cookie: cookieHeader(jar) } : {}),
      ...extraHeaders,
    },
    body: typeof body === 'string' ? body : body.toString(),
  });
}

/**
 * @param {URL} parsedUrl
 * @param {string[]} jar
 * @param {AbortSignal} [signal]
 * @returns {Promise<boolean>}
 */
async function verifyStorefrontUnlocked(parsedUrl, jar, signal) {
  if (!jar.length) {
    return false;
  }
  const probeUrl = new URL('/', parsedUrl.origin);
  const probeRes = await fetch(probeUrl.toString(), {
    method: 'GET',
    redirect: 'follow',
    signal,
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent': BROWSER_UA,
      Cookie: cookieHeader(jar),
    },
  });
  if (!probeRes.ok) {
    return false;
  }
  const html = await probeRes.text().catch(() => '');
  return !isLikelyShopifyPasswordPage(html, probeRes.url || probeUrl.toString());
}

/**
 * Submit Shopify storefront password and return unlock result.
 *
 * @param {URL} parsedUrl - Store URL (must be *.myshopify.com)
 * @param {string} password
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ ok: boolean, cookie: string, reason?: string, retryAfterSeconds?: number }>}
 */
async function unlockShopifyStorefrontSession(parsedUrl, password, signal) {
  const rawPassword = typeof password === 'string' ? password.trim() : '';
  if (!rawPassword || !/\.myshopify\.com$/i.test(parsedUrl.hostname || '')) {
    return { ok: false, cookie: '', reason: 'missing_password' };
  }

  const passwordUrl = new URL('/password', parsedUrl.origin);

  try {
    const jar = await seedStorefrontCookieJar(parsedUrl, signal);
    const strategies = [];

    // 1) Shopify CLI: password-only body + _shopify_essential cookie
    strategies.push({
      name: 'cli_essential',
      body: new URLSearchParams({ password: rawPassword }),
      headers: { 'User-Agent': CLI_UA },
    });

    // 2) Classic password check used by CLI isStorefrontPasswordCorrect
    strategies.push({
      name: 'form_type',
      body: (() => {
        const params = new URLSearchParams();
        params.append('form_type', 'storefront_password');
        params.append('utf8', '✓');
        params.append('password', rawPassword);
        return params;
      })(),
      headers: { 'User-Agent': CLI_UA },
      // Intentionally omit seeded cookies for this attempt (matches CLI check).
      freshJar: true,
    });

    // 3) Theme password form: authenticity_token + password (no form_type on modern themes)
    const themeJar = [...jar];
    const themePage = await fetch(passwordUrl.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': BROWSER_UA,
        ...(cookieHeader(themeJar) ? { Cookie: cookieHeader(themeJar) } : {}),
      },
    });
    collectSetCookies(themePage, themeJar);
    const themeHtml = await themePage.text().catch(() => '');
    const authenticityToken = extractAuthenticityToken(themeHtml);
    if (authenticityToken) {
      const themeBody = new URLSearchParams();
      themeBody.set('authenticity_token', authenticityToken);
      themeBody.set('password', rawPassword);
      strategies.push({
        name: 'theme_token',
        body: themeBody,
        headers: { 'User-Agent': BROWSER_UA },
        jar: themeJar,
      });
    }

    let sawRateLimit = false;
    let retryAfterSeconds;

    for (const strategy of strategies) {
      const attemptJar = strategy.freshJar ? [] : strategy.jar ? [...strategy.jar] : [...jar];
      const postRes = await postStorefrontPassword(
        passwordUrl,
        strategy.body,
        attemptJar,
        signal,
        strategy.headers
      );

      if (postRes.status === 429) {
        sawRateLimit = true;
        const retryAfter = Number(postRes.headers.get('retry-after') || 0);
        if (Number.isFinite(retryAfter) && retryAfter > 0) {
          retryAfterSeconds = retryAfter;
        }
        continue;
      }

      collectSetCookies(postRes, attemptJar);

      const unlockedByRedirect = redirectsAwayFromPasswordGate(postRes, parsedUrl.origin);
      const hasDigest = Boolean(getCookieValue(attemptJar, 'storefront_digest'));

      if (unlockedByRedirect || hasDigest) {
        // Prefer following the success redirect to capture any additional cookies.
        if (postRes.status >= 300 && postRes.status < 400) {
          const location = postRes.headers.get('location');
          if (location && !isPasswordRedirectLocation(location, parsedUrl.origin)) {
            const followRes = await fetch(new URL(location, passwordUrl).toString(), {
              method: 'GET',
              redirect: 'manual',
              signal,
              headers: {
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'User-Agent': BROWSER_UA,
                Referer: passwordUrl.toString(),
                Cookie: cookieHeader(attemptJar),
              },
            });
            collectSetCookies(followRes, attemptJar);
            await followRes.text().catch(() => '');
          }
        }

        const verified = await verifyStorefrontUnlocked(parsedUrl, attemptJar, signal);
        if (verified) {
          return { ok: true, cookie: cookieHeader(attemptJar), reason: strategy.name };
        }
      }
    }

    if (sawRateLimit) {
      return {
        ok: false,
        cookie: '',
        reason: 'rate_limited',
        retryAfterSeconds,
      };
    }

    return { ok: false, cookie: '', reason: 'invalid_password' };
  } catch {
    return { ok: false, cookie: '', reason: 'unlock_failed' };
  }
}

/**
 * Submit Shopify storefront password and return a Cookie header for follow-up fetches.
 * Returns empty string unless unlock is verified (do not return seed cookies alone).
 *
 * @param {URL} parsedUrl - Store URL (must be *.myshopify.com)
 * @param {string} password
 * @param {AbortSignal} signal
 * @returns {Promise<string>}
 */
async function getShopifyStorefrontPasswordCookie(parsedUrl, password, signal) {
  const result = await unlockShopifyStorefrontSession(parsedUrl, password, signal);
  return result.ok ? result.cookie : '';
}

/**
 * Fetch a storefront preview page, optionally authenticating with the storefront password first.
 *
 * @param {string} targetUrl
 * @param {string} [storefrontPassword]
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ ok: true, html: string } | { ok: false, reason: string, status?: number, retryAfterSeconds?: number }>}
 */
/**
 * @param {string} targetUrl
 * @param {string} [storefrontPassword]
 * @param {AbortSignal} [signal]
 * @param {{ cookie?: string }} [options] - Reuse an already-unlocked Cookie header (avoids repeat password POSTs).
 */
async function fetchStorefrontPreviewHtml(
  targetUrl,
  storefrontPassword = '',
  signal,
  options = {}
) {
  const parsedTarget = new URL(String(targetUrl || '').trim());
  const headers = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent': BROWSER_UA,
  };
  const cookieOverride =
    options && typeof options.cookie === 'string' ? String(options.cookie).trim() : '';
  if (cookieOverride) {
    headers.Cookie = cookieOverride;
  } else {
    const password =
      storefrontPassword !== null && storefrontPassword !== undefined
        ? String(storefrontPassword).trim()
        : '';
    if (password) {
      const unlock = await unlockShopifyStorefrontSession(parsedTarget, password, signal);
      if (unlock.ok && unlock.cookie) {
        headers.Cookie = unlock.cookie;
      } else if (unlock.reason === 'rate_limited') {
        return {
          ok: false,
          reason: 'rate_limited',
          retryAfterSeconds: unlock.retryAfterSeconds,
        };
      }
    }
  }
  const fetchRes = await fetch(parsedTarget.toString(), {
    method: 'GET',
    redirect: 'follow',
    signal,
    headers,
  });
  if (!fetchRes.ok) {
    return { ok: false, reason: 'fetch_failed', status: fetchRes.status };
  }
  const contentType = String(fetchRes.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('text/html')) {
    return { ok: false, reason: 'not_html', status: fetchRes.status };
  }
  const html = await fetchRes.text();
  if (isLikelyShopifyPasswordPage(html, fetchRes.url || parsedTarget.toString())) {
    return { ok: false, reason: 'password_required', status: fetchRes.status };
  }
  return { ok: true, html };
}

module.exports = {
  DEV_STOREFRONT_PASSWORD_FALLBACK,
  getDevStorefrontPasswordDefault,
  resolveStorefrontPasswordForPreviewRequest,
  getShopifyStorefrontPasswordCookie,
  unlockShopifyStorefrontSession,
  isLikelyShopifyPasswordPage,
  fetchStorefrontPreviewHtml,
  extractAuthenticityToken,
  redirectsAwayFromPasswordGate,
};
