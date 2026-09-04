(function () {
  if (window.__RIPX_APP_EMBED_LOADER__) return;
  window.__RIPX_APP_EMBED_LOADER__ = true;

  var CONFIG_ID = 'ripx-app-embed-config';
  var PREVIEW_STORAGE_KEY = '__ripx_preview_ctx_v1__';
  var ensureTimer = null;
  var attemptCount = 0;
  var maxAttempts = 30;

  function readConfig() {
    try {
      var el = document.getElementById(CONFIG_ID);
      if (!el) return {};
      return JSON.parse(el.textContent || '{}') || {};
    } catch (_e) {
      return {};
    }
  }

  var config = readConfig();
  var shopHost = String(config.shopHost || window.location.hostname || '').trim();
  var version = String(config.version || '').trim() || '1.0.64';
  var directScriptBaseUrl = String(config.directScriptBaseUrl || '').trim();

  function hasRuntimeConfig() {
    try {
      var cfg = window.AB_TEST_RUNTIME_CONFIG || {};
      return !!(cfg.apiUrl && String(cfg.apiUrl).trim());
    } catch (_e) {
      return false;
    }
  }

  function hasRipxVersion() {
    return !!(window.RipX && window.RipX.version);
  }

  function hasRipx() {
    return hasRipxVersion() && hasRuntimeConfig();
  }

  function reportInitFailure(reason) {
    try {
      if (!directScriptBaseUrl || !shopHost) return;
      var endpoint = String(directScriptBaseUrl).replace(/\/+$/, '') + '/api/track/client-error';
      var payload = {
        error: 'ripx_storefront_init_failed',
        url: String(window.location.href || ''),
        shop_domain: shopHost,
        metadata: {
          reason: String(reason || 'unknown'),
          primarySrc: buildPrimarySrc(),
          fallbackConfigured: !!directScriptBaseUrl,
          preview: hasPreviewCtx(),
          attemptCount: attemptCount,
          version: version,
        },
      };
      var body = JSON.stringify(payload);
      if (navigator && typeof navigator.sendBeacon === 'function') {
        var blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon(endpoint, blob);
        return;
      }
      if (typeof window.fetch === 'function') {
        window.fetch(endpoint, {
          method: 'POST',
          mode: 'cors',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: body,
        });
      }
    } catch (_e) {}
  }

  var COOKIE = '__ripx_preview_ctx_v1';
  function cookieWrite(payload) {
    try {
      if (!payload) {
        document.cookie = COOKIE + '=; Max-Age=0; path=/; SameSite=Lax';
        return;
      }
      var encoded = encodeURIComponent(JSON.stringify(payload));
      if (!encoded || encoded.length > 3500) return;
      document.cookie =
        COOKIE +
        '=' +
        encoded +
        '; Max-Age=7200; path=/; SameSite=Lax' +
        (location.protocol === 'https:' ? '; Secure' : '');
    } catch (_eC) {}
  }
  function cookieRead() {
    try {
      var prefix = COOKIE + '=';
      var parts = String(document.cookie || '').split(';');
      for (var i = 0; i < parts.length; i += 1) {
        var part = String(parts[i] || '').trim();
        if (part.indexOf(prefix) !== 0) continue;
        var parsed = JSON.parse(decodeURIComponent(part.slice(prefix.length) || ''));
        return parsed && typeof parsed === 'object' ? parsed : null;
      }
    } catch (_eR) {}
    return null;
  }
  function clearPreviewCaches() {
    cookieWrite(null);
    try {
      if (window.sessionStorage) {
        window.sessionStorage.removeItem(PREVIEW_STORAGE_KEY);
        window.sessionStorage.removeItem('__ripx_price_af_hint_v1__');
        for (var i = window.sessionStorage.length - 1; i >= 0; i -= 1) {
          var key = window.sessionStorage.key(i);
          if (key && key.indexOf('ripx_preview_variant_cache_') === 0) {
            window.sessionStorage.removeItem(key);
          }
        }
      }
    } catch (_eReset) {}
    try {
      if (String(window.name || '').indexOf(PREVIEW_STORAGE_KEY + ':') === 0) window.name = '';
    } catch (_eN) {}
  }
  function readPreviewCtx() {
    try {
      var raw = window.sessionStorage && window.sessionStorage.getItem(PREVIEW_STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (_e) {}
    return cookieRead();
  }
  function writePreviewCtx(ctx) {
    try {
      if (!ctx) return;
      var payload = Object.assign({}, ctx, { persistedAtMs: Date.now() });
      delete payload.launchTargetUrl;
      try {
        if (window.sessionStorage) {
          window.sessionStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(payload));
        }
      } catch (_eS) {}
      cookieWrite(payload);
      try {
        window.name = PREVIEW_STORAGE_KEY + ':' + JSON.stringify(payload);
      } catch (_eN) {}
    } catch (_eW) {}
  }
  function seedPreviewCtxFromUrl() {
    try {
      if (!window.location || !window.location.search) return readPreviewCtx();
      var params = new URLSearchParams(window.location.search || '');
      var previewFlag = params.get('ab_preview') === '1';
      var testId = params.get('ab_preview_test') || null;
      var variantId = params.get('ab_preview_variant') || null;
      var variantName = params.get('ab_preview_variant_name') || null;
      if (!(previewFlag || testId || variantId || variantName)) return readPreviewCtx();
      if (params.get('ab_preview_reset') === '1') clearPreviewCaches();
      var ctx = {
        preview: previewFlag || !!testId,
        testId: testId,
        testType: params.get('ab_preview_test_type') || null,
        variantId: variantId,
        variantName: variantName,
        tenantDomain: params.get('ab_preview_domain') || null,
        simple: params.get('ab_preview_simple') === '1',
        sessionId: params.get('ab_preview_session') || null,
        persistedAtMs: Date.now(),
      };
      writePreviewCtx(ctx);
      return ctx;
    } catch (_e) {
      return null;
    }
  }

  function hasPreviewCtx() {
    var ctx = readPreviewCtx();
    return !!(ctx && (ctx.preview || ctx.testId || ctx.variantId || ctx.variantName));
  }

  function withPreviewBust(src) {
    if (!src) return '';
    try {
      var parsed = new URL(src, window.location.origin);
      if (hasPreviewCtx()) parsed.searchParams.set('ripx_preview_bust', String(Date.now()));
      return parsed.toString();
    } catch (_e) {
      return src;
    }
  }

  function scriptPath(value) {
    return String(value || '').split('?')[0];
  }
  function forScripts(fn) {
    Array.prototype.slice.call(document.scripts || []).forEach(fn);
  }
  function hasScriptTagFor(src) {
    if (!src) return false;
    var n = scriptPath(src);
    var found = false;
    try {
      forScripts(function (s) {
        if (scriptPath(s && s.src) === n) found = true;
      });
    } catch (_e) {}
    return found;
  }
  function removeScriptTagsFor(src) {
    if (!src) return;
    var n = scriptPath(src);
    try {
      forScripts(function (s) {
        if (scriptPath(s && s.src) === n && s.parentNode) s.parentNode.removeChild(s);
      });
    } catch (_e) {}
  }
  function setStatus(obj) {
    try {
      window.__RIPX_APP_EMBED_LOADER_STATUS__ = obj;
    } catch (_e) {}
  }
  function appendScript(src, isFallback, forceReload) {
    if (!src) return;
    if (forceReload) removeScriptTagsFor(src);
    else if (hasScriptTagFor(src)) return;
    var tag = document.createElement('script');
    tag.src = src;
    tag.async = false;
    tag.setAttribute('fetchpriority', 'high');
    tag.onload = function () {
      if (hasRipx()) {
        setStatus({
          ok: true,
          version: window.RipX.version,
          source: isFallback ? 'direct' : 'app_proxy',
          preview: hasPreviewCtx(),
          at: Date.now(),
        });
        stopEnsure();
      }
    };
    tag.onerror = function () {
      setStatus({
        ok: false,
        failedSrc: src,
        fallback: !!isFallback,
        preview: hasPreviewCtx(),
        at: Date.now(),
      });
      if (!isFallback && directScriptBaseUrl)
        appendScript(withPreviewBust(buildDirectSrc()), true, forceReload === true);
    };
    (document.head || document.documentElement || document.body).appendChild(tag);
  }

  function buildPrimarySrc() {
    if (!shopHost) return '';
    return 'https://' + shopHost + '/apps/ripspricex/script.js?v=' + encodeURIComponent(version);
  }

  function buildDirectSrc() {
    if (!directScriptBaseUrl || !shopHost) return '';
    return (
      directScriptBaseUrl.replace(/\/+$/, '') +
      '/api/track/script.js?shop=' +
      encodeURIComponent(shopHost) +
      '&v=' +
      encodeURIComponent(version)
    );
  }

  function stopEnsure() {
    if (ensureTimer) {
      clearInterval(ensureTimer);
      ensureTimer = null;
    }
  }

  function ensureLoaded() {
    if (hasRipx()) {
      setStatus({ ok: true, version: window.RipX.version, at: Date.now() });
      stopEnsure();
      return;
    }
    var runtimePresentWithoutConfig = hasRipxVersion() && !hasRuntimeConfig();
    attemptCount += 1;
    appendScript(withPreviewBust(buildPrimarySrc()), false, runtimePresentWithoutConfig);
    if (directScriptBaseUrl)
      appendScript(withPreviewBust(buildDirectSrc()), true, runtimePresentWithoutConfig);
    if (attemptCount >= maxAttempts) {
      stopEnsure();
      reportInitFailure('runtime_missing_after_retries');
      setStatus({
        ok: false,
        reason: 'runtime_missing_after_retries',
        preview: hasPreviewCtx(),
        hasEmbedConfig: !!document.getElementById(CONFIG_ID),
        primarySrc: buildPrimarySrc(),
        fallbackConfigured: !!directScriptBaseUrl,
        at: Date.now(),
      });
    }
  }

  seedPreviewCtxFromUrl();
  ensureLoaded();
  ensureTimer = setInterval(ensureLoaded, hasPreviewCtx() ? 1000 : 3000);
  window.addEventListener('pageshow', function () {
    if (!hasRipx()) ensureLoaded();
  });
})();
