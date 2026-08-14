/**
 * Price Preview Bootstrap
 *
 * This module is intentionally separate from the generic Shopify preview bootstrap.
 * Price tests need a stricter, less fragile runner because the storefront runtime must
 * patch add-to-cart forms before Shopify navigates away from the product page.
 *
 * Design goals:
 * - Do not rewrite Shopify's full HTML with document.write.
 * - Bootstrap on the app-proxy URL, then clean the address bar to the real PDP
 *   path after mount (simple/customer preview) via history.replaceState.
 * - Fetch and mount the product page in this controlled app-proxy document.
 * - Inject RipX before theme scripts so add-to-cart forms are patched early.
 *
 * CSP must allow Shopify CDN stylesheets/fonts (and theme eval) after mount — a tight
 * style-src without https: blocks theme CSS and looks like a blank page.
 */

/** Permissive CSP for the mounted storefront document (mirrors preview-document). */
const PRICE_PREVIEW_BOOTSTRAP_CSP =
  "default-src 'self' https: http:; script-src 'self' https: http: 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https: http:; img-src 'self' data: blob: https: http:; font-src 'self' data: https: http:; frame-src 'self' https: http:; connect-src 'self' https: http:; worker-src 'self' blob: https: http:; base-uri 'self'";

const {
  fetchStorefrontPreviewHtml,
  resolveStorefrontPasswordForPreviewRequest,
} = require('../utils/storefrontPasswordPreview');
const { resolvePublicAppUrl } = require('../utils/storefrontScriptRuntime');

function buildPreviewContextScript(targetUrl) {
  return `
function buildPreviewCtx() {
  try {
    var tu = new URL(${JSON.stringify(targetUrl)}, window.location.origin);
    return {
      preview: tu.searchParams.get('ab_preview') === '1',
      testId: tu.searchParams.get('ab_preview_test') || null,
      testType: tu.searchParams.get('ab_preview_test_type') || null,
      variantId: tu.searchParams.get('ab_preview_variant') || null,
      variantName: tu.searchParams.get('ab_preview_variant_name') || null,
      tenantDomain: tu.searchParams.get('ab_preview_domain') || null,
      simple: tu.searchParams.get('ab_preview_simple') === '1',
      sessionId: tu.searchParams.get('ab_preview_session') || null,
      persistedAtMs: Date.now()
    };
  } catch (_e) {
    return { preview: true, persistedAtMs: Date.now() };
  }
}

function persistPreviewCtx(targetWindow) {
  var ctx = buildPreviewCtx();
  try {
    window.sessionStorage.setItem('__ripx_preview_ctx_v1__', JSON.stringify(ctx));
  } catch (_eTopSession) {}
  try {
    window.name = '__ripx_preview_ctx_v1__:' + JSON.stringify(ctx);
  } catch (_eTopName) {}
  try {
    if (targetWindow && targetWindow.sessionStorage) {
      targetWindow.sessionStorage.setItem('__ripx_preview_ctx_v1__', JSON.stringify(ctx));
    }
  } catch (_eFrameSession) {}
  try {
    if (targetWindow) targetWindow.name = '__ripx_preview_ctx_v1__:' + JSON.stringify(ctx);
  } catch (_eFrameName) {}
  return ctx;
}
`;
}

function buildPricePreviewHtml({
  targetUrl,
  appProxyScriptUrl,
  directScriptUrl,
  prefetchedHtml = null,
  prefetchError = null,
}) {
  const previewContextScript = buildPreviewContextScript(targetUrl);
  const simplePreview = (() => {
    try {
      return new URL(targetUrl).searchParams.get('ab_preview_simple') === '1';
    } catch (_e) {
      return false;
    }
  })();
  const safePrefetchedHtml =
    typeof prefetchedHtml === 'string' && prefetchedHtml.trim() ? prefetchedHtml : null;
  // Never JSON-embed raw HTML in a <script> tag — product pages contain </script> and
  // would terminate the bootstrap script (blank/garbled page). Use base64 instead.
  const prefetchedHtmlBase64 = safePrefetchedHtml
    ? Buffer.from(safePrefetchedHtml, 'utf8').toString('base64')
    : '';
  const safePrefetchError =
    prefetchError !== null && prefetchError !== undefined ? String(prefetchError).trim() : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>RipX price preview</title>
    <style>
      html, body {
        margin: 0;
        min-height: 100%;
        background: #f6f6f7;
      }
      .ripx-price-preview-bar {
        align-items: center;
        background: rgba(17, 24, 39, 0.92);
        border-radius: 999px;
        bottom: 14px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.22);
        color: #fff;
        display: flex;
        font: 12px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        gap: 10px;
        left: 50%;
        max-width: calc(100vw - 28px);
        padding: 8px 12px;
        position: fixed;
        transform: translateX(-50%);
        z-index: 2147483647;
      }
      .ripx-price-preview-dot {
        background: #f59e0b;
        border-radius: 999px;
        height: 8px;
        width: 8px;
      }
      .ripx-price-preview-dot.ready {
        background: #22c55e;
      }
      .ripx-price-preview-bar button {
        background: rgba(255, 255, 255, 0.14);
        border: 1px solid rgba(255, 255, 255, 0.22);
        border-radius: 999px;
        color: #fff;
        cursor: pointer;
        font: inherit;
        padding: 4px 9px;
      }
    </style>
  </head>
  <body>
    <div class="ripx-price-preview-bar" id="ripx-price-preview-bar" style="${simplePreview ? 'display:none' : ''}">
      <span class="ripx-price-preview-dot" id="ripx-price-preview-dot"></span>
      <span id="ripx-price-preview-status">Loading price preview...</span>
      <button type="button" id="ripx-price-preview-retry">Retry</button>
      <button type="button" id="ripx-price-preview-open">Open product</button>
    </div>
    <script>
      (function () {
        var target = ${JSON.stringify(targetUrl)};
        var appProxyScriptUrl = ${JSON.stringify(appProxyScriptUrl)};
        var directScriptUrl = ${JSON.stringify(directScriptUrl || '')};
        var simplePreview = ${JSON.stringify(simplePreview)};
        var prefetchedHtmlBase64 = ${JSON.stringify(prefetchedHtmlBase64)};
        var prefetchedHtml = null;
        if (prefetchedHtmlBase64) {
          try {
            prefetchedHtml = decodeURIComponent(
              Array.prototype.map
                .call(atob(prefetchedHtmlBase64), function (c) {
                  return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
                })
                .join('')
            );
          } catch (_ePrefetchDecode) {
            prefetchedHtml = null;
          }
        }
        var prefetchError = ${JSON.stringify(safePrefetchError)};
        var statusEl = document.getElementById('ripx-price-preview-status');
        var dotEl = document.getElementById('ripx-price-preview-dot');
        var retryButton = document.getElementById('ripx-price-preview-retry');
        var openButton = document.getElementById('ripx-price-preview-open');
        var injectionAttempt = 0;
        var mounted = false;
        var lastError = null;

        ${previewContextScript}

        function ensureStatusBar(forceShow) {
          // Simple preview hides chrome on success; still show it for errors so
          // failures are not a permanent blank gray page.
          if (simplePreview && !forceShow) return;
          if (statusEl && document.documentElement.contains(statusEl)) {
            if (forceShow && statusEl.parentElement) statusEl.parentElement.style.display = 'flex';
            return;
          }
          if (!document.body) return;
          var style = document.getElementById('ripx-price-preview-style');
          if (!style) {
            style = document.createElement('style');
            style.id = 'ripx-price-preview-style';
            style.textContent =
              '.ripx-price-preview-bar{align-items:center;background:rgba(17,24,39,.92);border-radius:999px;bottom:14px;box-shadow:0 10px 30px rgba(0,0,0,.22);color:#fff;display:flex;font:12px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;gap:10px;left:50%;max-width:calc(100vw - 28px);padding:8px 12px;position:fixed;transform:translateX(-50%);z-index:2147483647}.ripx-price-preview-dot{background:#f59e0b;border-radius:999px;height:8px;width:8px}.ripx-price-preview-dot.ready{background:#22c55e}.ripx-price-preview-bar button{background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.22);border-radius:999px;color:#fff;cursor:pointer;font:inherit;padding:4px 9px}';
            (document.head || document.documentElement).appendChild(style);
          }
          var bar = document.getElementById('ripx-price-preview-bar');
          if (!bar) {
            bar = document.createElement('div');
            bar.className = 'ripx-price-preview-bar';
            bar.id = 'ripx-price-preview-bar';
            bar.innerHTML =
              '<span class="ripx-price-preview-dot" id="ripx-price-preview-dot"></span>' +
              '<span id="ripx-price-preview-status">Loading price preview...</span>' +
              '<button type="button" id="ripx-price-preview-retry">Retry</button>' +
              '<button type="button" id="ripx-price-preview-open">Open product</button>';
            document.body.appendChild(bar);
          }
          if (forceShow) bar.style.display = 'flex';
          statusEl = document.getElementById('ripx-price-preview-status');
          dotEl = document.getElementById('ripx-price-preview-dot');
          retryButton = document.getElementById('ripx-price-preview-retry');
          openButton = document.getElementById('ripx-price-preview-open');
          if (retryButton) retryButton.onclick = reloadPreview;
          if (openButton) {
            openButton.onclick = function () {
              try { window.open(target, '_blank', 'noopener'); } catch (_e) {}
            };
          }
        }

        function setStatus(message, ready, forceShow) {
          ensureStatusBar(!!forceShow);
          if (statusEl) statusEl.textContent = message;
          if (dotEl) dotEl.className = 'ripx-price-preview-dot' + (ready ? ' ready' : '');
        }

        function isPasswordPageHtml(htmlText) {
          try {
            var lower = String(htmlText || '').toLowerCase();
            return (
              lower.indexOf('storefront_password') !== -1 ||
              lower.indexOf('this store is password protected') !== -1 ||
              lower.indexOf('enter store password') !== -1
            );
          } catch (_e) {
            return false;
          }
        }

        function showFatalError(titleText, bodyText, options) {
          try {
            var opts = options || {};
            var body = document.body || document.documentElement;
            if (!body) return;
            body.innerHTML = '';
            document.title = titleText || 'RipX price preview';
            var wrap = document.createElement('main');
            wrap.style.cssText =
              'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:560px;margin:12vh auto;padding:24px;border:1px solid #ddd;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.08);background:#fff;';
            var title = document.createElement('h1');
            title.textContent = titleText || 'Preview unavailable';
            title.style.cssText = 'font-size:22px;margin:0 0 10px;';
            var text = document.createElement('p');
            text.textContent = bodyText || 'The storefront preview could not be loaded.';
            text.style.cssText = 'line-height:1.5;color:#555;margin:0 0 18px;';
            wrap.appendChild(title);
            wrap.appendChild(text);
            if (opts.showPasswordButton) {
              var openPw = document.createElement('button');
              openPw.textContent = 'Open storefront password page';
              openPw.style.cssText =
                'padding:10px 14px;border:0;border-radius:9px;background:#111827;color:white;cursor:pointer;margin-right:10px;';
              openPw.onclick = function () {
                try {
                  window.location.replace('/password');
                } catch (_e) {
                  window.location.href = '/password';
                }
              };
              wrap.appendChild(openPw);
            }
            var retry = document.createElement('button');
            retry.textContent = 'Retry preview';
            retry.style.cssText =
              'padding:10px 14px;border:0;border-radius:9px;background:#111827;color:white;cursor:pointer;margin-right:10px;';
            retry.onclick = reloadPreview;
            var openProduct = document.createElement('button');
            openProduct.textContent = 'Open product URL';
            openProduct.style.cssText =
              'padding:10px 14px;border:1px solid #ccc;border-radius:9px;background:white;cursor:pointer;';
            openProduct.onclick = function () {
              try {
                window.open(target, '_blank', 'noopener');
              } catch (_eOpen) {}
            };
            wrap.appendChild(retry);
            wrap.appendChild(openProduct);
            body.appendChild(wrap);
          } catch (_eHelp) {
            setStatus(titleText || 'Preview unavailable', false, true);
          }
        }

        function showPasswordHelp() {
          showFatalError(
            'Storefront password required',
            'This Shopify store is password protected. Enter the storefront password once, then reopen this preview link.',
            { showPasswordButton: true }
          );
        }

        function showNotFoundHelp() {
          showFatalError(
            'Product not available on Online Store',
            'Shopify returned 404 for this product URL. The product may be unpublished (not on the Online Store sales channel), deleted, or the handle is wrong. Publish it in Shopify Admin → Products, then retry.'
          );
        }

        function startStatusBarWatchdog() {
          try {
            window.setInterval(function () {
              ensureStatusBar();
              if (hasRipxRuntime()) {
                if (statusEl) statusEl.textContent = 'RipX price preview ready';
                if (dotEl) dotEl.className = 'ripx-price-preview-dot ready';
              }
            }, 1500);
          } catch (_eWatchdog) {}
        }

        function hasRipxRuntime() {
          try {
            var cfg = window.AB_TEST_RUNTIME_CONFIG || {};
            return !!(window.RipX && window.RipX.version && cfg.apiUrl && String(cfg.apiUrl).trim());
          } catch (_e) {
            return false;
          }
        }

        function hasRipxVersionOnly() {
          try {
            return !!(window.RipX && window.RipX.version);
          } catch (_e) {
            return false;
          }
        }

        function mirrorRuntimeForConsole() {
          try {
            window.__RIPX_BOOTSTRAP_OK__ = {
              ok: true,
              mountedAt: Date.now(),
              href: String(window.location.href || ''),
              source: 'price-preview-bootstrap',
              runtimeReadyAt: Date.now()
            };
          } catch (_e2) {}
        }

        function cleanSimplePreviewAddressBar() {
          // Cosmetic only: stay on the mounted bootstrap document, but show the
          // regular /products/... URL after preview context is seeded.
          if (!simplePreview || !history || typeof history.replaceState !== 'function') return;
          try {
            var clean = new URL(target, window.location.origin);
            [
              'ab_preview',
              'ab_preview_simple',
              'ab_preview_test',
              'ab_preview_test_type',
              'ab_preview_variant',
              'ab_preview_variant_name',
              'ab_preview_domain',
              'ab_preview_reset',
              'ab_preview_session',
              'storefront_password'
            ].forEach(function (key) {
              clean.searchParams.delete(key);
            });
            if (
              clean.hostname &&
              String(clean.hostname).toLowerCase() !== String(window.location.hostname || '').toLowerCase()
            ) {
              return;
            }
            history.replaceState(
              history.state || null,
              document.title || '',
              clean.pathname + clean.search + clean.hash
            );
            window.__RIPX_SIMPLE_PREVIEW_CLEAN_URL__ = {
              cleaned: true,
              at: Date.now(),
              href: clean.toString(),
              source: 'price-preview-bootstrap'
            };
          } catch (_eClean) {}
        }

        function buildPriceBootstrapUrl(urlValue) {
          try {
            var parsed = new URL(urlValue || target, window.location.origin);
            if (String(parsed.hostname || '').toLowerCase() !== String(window.location.hostname || '').toLowerCase()) {
              return parsed.toString();
            }
            var path = String(parsed.pathname || '').toLowerCase();
            if (path.indexOf('/apps/ripspricex/price-preview-bootstrap-v1') === 0) return parsed.toString();
            return 'https://' + parsed.hostname + '/apps/ripspricex/price-preview-bootstrap-v1?url=' + encodeURIComponent(parsed.toString());
          } catch (_e) {
            return target;
          }
        }

        function installNavigationGuard() {
          if (simplePreview) return;
          document.addEventListener('click', function (event) {
            var anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
            if (!anchor) return;
            var href = anchor.getAttribute('href') || '';
            if (!href || href.indexOf('#') === 0 || /^mailto:|^tel:|^javascript:/i.test(href)) return;
            try {
              var next = new URL(href, target);
              if (String(next.hostname || '').toLowerCase() !== String(window.location.hostname || '').toLowerCase()) return;
              var nextPath = String(next.pathname || '').replace(/\\/+$/, '').toLowerCase() || '/';
              var cartToggle = anchor.closest(
                '[data-cart-drawer], [data-cart-toggle], [data-drawer-trigger], [aria-controls*="Cart"], [aria-controls*="cart"], cart-drawer, #cart-icon-bubble, .header__icon--cart'
              );
              // Cart drawer triggers often use href="/cart" as a no-JS fallback. Let the
              // theme handler own those clicks; intercepting them causes an instant cart-page redirect.
              if (nextPath === '/cart' || cartToggle) return;
              event.preventDefault();
              window.location.assign(buildPriceBootstrapUrl(next.toString()));
            } catch (_e) {}
          }, true);
        }

        function buildDebugStatus() {
          var scripts = [];
          try {
            scripts = Array.prototype.slice.call(document.scripts || []).map(function (script) {
              return script && script.src ? script.src : '';
            }).filter(Boolean);
          } catch (_eScripts) {}
          return {
            href: String(window.location.href || ''),
            target: target,
            mounted: mounted,
            ripxVersion: window.RipX ? window.RipX.version || null : null,
            runtimeConfigApiUrl:
              window.AB_TEST_RUNTIME_CONFIG && window.AB_TEST_RUNTIME_CONFIG.apiUrl
                ? String(window.AB_TEST_RUNTIME_CONFIG.apiUrl)
                : null,
            lastError: lastError,
            previewCtx: (function () {
              try { return window.sessionStorage.getItem('__ripx_preview_ctx_v1__'); } catch (_e) { return null; }
            })(),
            ripxScripts: scripts.filter(function (src) {
              return src.indexOf('/apps/ripspricex/script.js') !== -1 || src.indexOf('/api/track/script.js') !== -1;
            })
          };
        }

        window.RipXPricePreview = {
          debugStatus: buildDebugStatus,
          retry: reloadPreview
        };

        function appendScriptFromParsed(scriptEl) {
          var nextScript = document.createElement('script');
          try {
            Array.prototype.slice.call(scriptEl.attributes || []).forEach(function (attr) {
              nextScript.setAttribute(attr.name, attr.value);
            });
          } catch (_eAttrs) {}
          if (!nextScript.src) nextScript.text = scriptEl.textContent || '';
          (document.head || document.body || document.documentElement).appendChild(nextScript);
        }

        function isRipxStorefrontScriptSrc(src) {
          var value = String(src || '').toLowerCase();
          if (!value) return false;
          return (
            value.indexOf('/apps/ripspricex/script.js') !== -1 ||
            value.indexOf('/apps/ripx/script.js') !== -1 ||
            value.indexOf('/api/track/script.js') !== -1 ||
            value.indexOf('ripspricex-app-embed-loader') !== -1 ||
            value.indexOf('ripx-app-embed-loader') !== -1
          );
        }

        function filterThemeScriptsWithoutRipx(scriptNodes) {
          return (scriptNodes || []).filter(function (scriptEl) {
            try {
              var src = scriptEl && scriptEl.getAttribute ? scriptEl.getAttribute('src') : '';
              return !isRipxStorefrontScriptSrc(src);
            } catch (_eFilter) {
              return true;
            }
          });
        }

        function injectRipxRuntimeThenScripts(scriptNodes) {
          injectionAttempt += 1;
          persistPreviewCtx(window);
          var themeScripts = filterThemeScriptsWithoutRipx(scriptNodes);

          if (hasRipxRuntime()) {
            mirrorRuntimeForConsole();
            setStatus('RipX price preview ready', true);
            try {
              themeScripts.forEach(appendScriptFromParsed);
            } catch (_eScriptsReady) {}
            return;
          }

          try {
            window.__RIPX_PRICE_PREVIEW_FRAME__ = true;
            var existing = Array.prototype.slice.call(document.scripts || []).some(function (script) {
              return script && script.src && isRipxStorefrontScriptSrc(script.src);
            });
            if (!existing || hasRipxVersionOnly()) {
              if (existing && hasRipxVersionOnly()) {
                try {
                  Array.prototype.slice.call(document.scripts || []).forEach(function (scriptNode) {
                    if (
                      scriptNode &&
                      scriptNode.src &&
                      isRipxStorefrontScriptSrc(scriptNode.src) &&
                      scriptNode.parentNode
                    ) {
                      scriptNode.parentNode.removeChild(scriptNode);
                    }
                  });
                } catch (_eRemoveScript) {}
              }
              // Prefer direct public script when available — app proxy often hits the
              // storefront password wall and can serve a stale embedded apiUrl.
              var primarySrc = directScriptUrl
                ? directScriptUrl + '&price_preview_frame=1'
                : appProxyScriptUrl + '&price_preview_frame=1';
              var secondarySrc =
                directScriptUrl && appProxyScriptUrl
                  ? appProxyScriptUrl + '&price_preview_frame=1'
                  : '';
              var script = document.createElement('script');
              script.src = primarySrc;
              script.async = false;
              script.onload = function () {
                mirrorRuntimeForConsole();
                setStatus('RipX price preview ready', true);
                cleanSimplePreviewAddressBar();
                try {
                  themeScripts.forEach(appendScriptFromParsed);
                } catch (_eScriptsAfterRipx) {}
              };
              script.onerror = function () {
                if (secondarySrc && script.src !== secondarySrc) {
                  lastError = 'direct_script_failed_trying_app_proxy';
                  setStatus('Direct RipX script failed; trying app proxy...', false, true);
                  var fallback = document.createElement('script');
                  fallback.src = secondarySrc;
                  fallback.async = false;
                  fallback.onload = script.onload;
                  fallback.onerror = function () {
                    lastError = 'ripx_script_failed';
                    setStatus('RipX runtime failed to load', false, true);
                  };
                  (document.head || document.documentElement || document.body).appendChild(fallback);
                  return;
                }
                lastError = 'ripx_script_failed';
                setStatus('RipX runtime failed to load', false, true);
              };
              (document.head || document.documentElement || document.body).appendChild(script);
            }
          } catch (_injectErr) {
            lastError = _injectErr && _injectErr.message ? _injectErr.message : 'inject_failed';
            setStatus('Could not inject RipX runtime', false, true);
          }
        }

        function mountFetchedDocument(htmlText) {
          if (!htmlText || typeof htmlText !== 'string') throw new Error('empty_html');
          if (typeof DOMParser === 'undefined') throw new Error('domparser_missing');

          var parsed = new DOMParser().parseFromString(htmlText, 'text/html');
          var scriptNodes = Array.prototype.slice.call(parsed.querySelectorAll('script'));
          scriptNodes.forEach(function (scriptEl) {
            if (scriptEl && scriptEl.parentNode) scriptEl.parentNode.removeChild(scriptEl);
          });

          var base = parsed.createElement('base');
          try {
            var baseUrl = new URL(target);
            base.href = baseUrl.origin + '/';
          } catch (_eBase) {
            base.href = '/';
          }
          (parsed.head || parsed.documentElement).insertBefore(base, (parsed.head || parsed.documentElement).firstChild);

          var importedRoot = document.importNode(parsed.documentElement, true);
          document.replaceChild(importedRoot, document.documentElement);
          mounted = true;
          persistPreviewCtx(window);
          cleanSimplePreviewAddressBar();
          installNavigationGuard();
          injectRipxRuntimeThenScripts(scriptNodes);
        }

        function handleFetchedHtml(htmlText, statusCode) {
          if (isPasswordPageHtml(htmlText)) {
            lastError = 'password_required';
            showPasswordHelp();
            return;
          }
          if (statusCode === 404) {
            lastError = 'target_fetch_failed_404';
            showNotFoundHelp();
            return;
          }
          mountFetchedDocument(htmlText);
        }

        function loadPreview() {
          injectionAttempt = 0;
          lastError = null;
          persistPreviewCtx(window);
          if (prefetchedHtml) {
            setStatus('Loading product preview...', false, !simplePreview);
            try {
              handleFetchedHtml(prefetchedHtml, 200);
            } catch (err) {
              lastError = err && err.message ? err.message : 'prefetch_mount_failed';
              showFatalError(
                'Could not mount product preview',
                'The storefront HTML was fetched but could not be rendered. Retry, or open the product URL directly.'
              );
            }
            return;
          }
          if (prefetchError === 'password_required') {
            lastError = 'password_required';
            showPasswordHelp();
            return;
          }
          if (prefetchError === 'fetch_failed_404' || prefetchError === '404') {
            lastError = 'target_fetch_failed_404';
            showNotFoundHelp();
            return;
          }
          setStatus('Loading product preview...', false, !simplePreview);
          fetch(target, { method: 'GET', credentials: 'include', redirect: 'follow' })
            .then(function (response) {
              var status = response && response.status ? response.status : 0;
              return response.text().then(function (htmlText) {
                return { status: status, ok: !!(response && response.ok), htmlText: htmlText };
              });
            })
            .then(function (result) {
              if (!result) throw new Error('target_fetch_failed');
              if (isPasswordPageHtml(result.htmlText)) {
                lastError = 'password_required';
                showPasswordHelp();
                return;
              }
              if (!result.ok) {
                lastError = 'target_fetch_failed_' + (result.status || 'unknown');
                if (result.status === 404) {
                  showNotFoundHelp();
                  return;
                }
                showFatalError(
                  'Could not load product preview',
                  'The storefront returned HTTP ' +
                    (result.status || 'error') +
                    '. Unlock the storefront password if needed, confirm the product is published, then retry.'
                );
                return;
              }
              handleFetchedHtml(result.htmlText, result.status);
            })
            .catch(function (err) {
              lastError = err && err.message ? err.message : 'target_fetch_failed';
              showFatalError(
                'Could not load product preview',
                'Network error while loading the product page. Check the storefront password and product URL, then retry.'
              );
            });
        }

        function reloadPreview() {
          window.location.replace(buildPriceBootstrapUrl(target));
        }

        if (retryButton) retryButton.onclick = reloadPreview;
        if (openButton) {
          openButton.onclick = function () {
            try { window.open(target, '_blank', 'noopener'); } catch (_e) {}
          };
        }

        persistPreviewCtx(null);
        window.__RIPX_PRICE_PREVIEW_FRAME__ = true;
        startStatusBarWatchdog();
        loadPreview();
      })();
    </script>
  </body>
</html>`;
}

function createPricePreviewBootstrapHandlers({ validatePreviewBootstrapRequest, SCRIPT_VERSION }) {
  /**
   * Main isolated price-preview route.
   *
   * The generic preview bootstrap is shared by all test types. This price-only route
   * mounts the product document directly and injects RipX before theme scripts.
   */
  async function servePricePreviewBootstrap(req, res) {
    const validated = await validatePreviewBootstrapRequest(req, res, 'price-preview-bootstrap');
    if (!validated) {
      return;
    }

    const { normalizedShop, targetUrl } = validated;
    const previewScriptBust = Date.now();
    const appProxyScriptUrl =
      `https://${normalizedShop}/apps/ripspricex/script.js?v=${SCRIPT_VERSION}` +
      `&ripx_preview_bust=${previewScriptBust}`;
    // Prefer the host this bootstrap request arrived on (live tunnel), not a stale APP_URL.
    const publicAppUrl = resolvePublicAppUrl(req);
    const directScriptUrl = publicAppUrl
      ? `${String(publicAppUrl).replace(/\/+$/, '')}/api/track/script.js?shop=${encodeURIComponent(
          normalizedShop
        )}&v=${SCRIPT_VERSION}&ripx_preview_bust=${previewScriptBust}`
      : '';

    const storefrontPassword = resolveStorefrontPasswordForPreviewRequest(
      typeof req.query.storefront_password === 'string' ? req.query.storefront_password : '',
      req.get('host') || ''
    );
    let prefetchedHtml = null;
    let prefetchError = null;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);
      const prefetchResult = await fetchStorefrontPreviewHtml(
        targetUrl,
        storefrontPassword,
        controller.signal
      );
      clearTimeout(timeoutId);
      if (prefetchResult.ok) {
        prefetchedHtml = prefetchResult.html;
      } else {
        const reason = prefetchResult.reason || 'fetch_failed';
        const status = prefetchResult.status;
        prefetchError = reason === 'fetch_failed' && status === 404 ? 'fetch_failed_404' : reason;
      }
    } catch (error) {
      prefetchError = error?.name === 'AbortError' ? 'timeout' : 'fetch_error';
    }

    res.set('Cache-Control', 'no-store');
    res.set('Content-Security-Policy', PRICE_PREVIEW_BOOTSTRAP_CSP);
    return res.type('html').send(
      buildPricePreviewHtml({
        targetUrl,
        appProxyScriptUrl,
        directScriptUrl,
        prefetchedHtml,
        prefetchError,
      })
    );
  }

  return {
    servePricePreviewBootstrap,
  };
}

module.exports = {
  PRICE_PREVIEW_BOOTSTRAP_CSP,
  buildPricePreviewHtml,
  createPricePreviewBootstrapHandlers,
};
