/**
 * RipX Storefront Integration Script
 * @version 1.0.0
 *
 * Multi-platform: works on Shopify and standalone sites.
 * 1. Get variant assignments for users
 * 2. Apply test variations (prices, content, etc.)
 * 3. Track conversion events
 *
 * Shopify: Load via app proxy or GET /api/track/script.js?shop=xxx.myshopify.com
 * Standalone: Load via GET /api/track/script.js?site=example.com
 *
 * Best practices: Load the Shopify app embed in <head>. For tests that need anti-flicker, the
 * primary app-proxy runtime should be parser-discovered early enough for its bootstrap to run
 * before body paint.
 * Standalone preview: /track/preview and /track/preview-storefront-test use the same tenant param as ping
 * (shop_domain for .myshopify.com, else site=).
 * Graceful degradation: If the assignment API fails (network error, 5xx, or 503 maintenance),
 * getVariant/getVariantCachePromise return null or {} so the page shows the control variant
 * and does not break. Track (conversion/event) failures are logged but do not throw.
 * Do not cache the script per-user; assignment is fetched per session/page as needed.
 * The server sends short Cache-Control for script.js (activeTests are embedded); hard-refresh or wait for max-age after starting/stopping tests.
 *
 * Debug: Set window.__RIPX_DEBUG__ = true before the script loads to enable console logs (no PII).
 * Runtime toggle: call window.RipX.setDebug(true) / window.RipX.setDebug(false) from console.
 * Step trace (preview/price/ATC): RipX.setTrace(true) or ?ab_preview_trace=1 — logs [RipX:trace] S0…Sn.
 * Dump trail: RipX.debugTrace() | guide: RipX.printDebugGuide() | steps on window.__RIPX_TRACE_STEPS__.
 * With debug on, cart/add interception logs [RipX] lines: path matched, patched vs unchanged body, near-miss paths, missing line state.
 * Version: Exposed as window.RipX.version / window.ABTestTracker.version for support.
 */

(function () {
  'use strict';

  // Prevent double execution if snippet is accidentally included twice.
  // Use a stale-loading escape hatch so a previously crashed boot can recover.
  var nowMs = Date.now();
  var loadingAt = Number(window.__RIPX_LOADING_AT__ || 0);
  if (window.__RIPX_LOADED__) {
    return;
  }
  if (window.__RIPX_LOADING__ && loadingAt > 0 && nowMs - loadingAt < 15000) {
    return;
  }
  window.__RIPX_LOADING__ = true;
  window.__RIPX_LOADING_AT__ = nowMs;

  // Configuration
  const DEFAULT_CONFIG = {
    apiUrl: '',
    cookieName: 'ab_test_user_id',
    cookieExpiry: 365, // days
    shopDomain: null,
    activeTests: [],
    featureFlagUrl: '',
    heatmapCollection: { enabled: true, sampleRate: 1 },
  };

  const CONFIG = Object.assign({}, DEFAULT_CONFIG, window.AB_TEST_RUNTIME_CONFIG || {});
  const hasValidConfig = !!(CONFIG.apiUrl && CONFIG.apiUrl.trim());

  /** Polyfill CSS.escape for older browsers (selector building in visual editor). */
  if (typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
    window.CSS = window.CSS || {};
    if (!window.CSS.escape) {
      window.CSS.escape = function (val) {
        var s = String(val);
        return s.replace(/\\/g, '\\\\').replace(/([^\w-])/g, '\\$1');
      };
    }
  }
  const consentRequired = !!CONFIG.consentRequired;
  const SCRIPT_VERSION = (CONFIG.version && String(CONFIG.version)) || '1.0.0';
  const RIPX_SCRIPT_STARTED_AT_MS = Date.now();
  const RIPX_PRICE_AF_HINT_STORAGE_KEY = '__ripx_price_af_hint_v1__';
  const DEBUG_STORAGE_KEY = '__RIPX_DEBUG__';
  function coerceBooleanFlag(value) {
    if (value === true || value === false) return value;
    var raw = String(value == null ? '' : value)
      .trim()
      .toLowerCase();
    if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
    return null;
  }
  function readStoredDebugFlag() {
    try {
      var fromWindow = coerceBooleanFlag(window.__RIPX_DEBUG__);
      if (fromWindow !== null) return fromWindow;
    } catch (eW) {}
    try {
      var fromLocalStorage =
        window.localStorage && coerceBooleanFlag(window.localStorage.getItem(DEBUG_STORAGE_KEY));
      if (fromLocalStorage !== null) return fromLocalStorage;
    } catch (eLs) {}
    return false;
  }
  function persistDebugFlag(enabled) {
    try {
      if (!window.localStorage) return;
      if (enabled) window.localStorage.setItem(DEBUG_STORAGE_KEY, '1');
      else window.localStorage.removeItem(DEBUG_STORAGE_KEY);
    } catch (ePersist) {}
  }
  var DEBUG = readStoredDebugFlag();
  function setDebugEnabled(enabled, persist) {
    DEBUG = !!enabled;
    try {
      window.__RIPX_DEBUG__ = DEBUG;
    } catch (eWin) {}
    if (persist !== false) persistDebugFlag(DEBUG);
    return DEBUG;
  }
  const TRACE_STORAGE_KEY = '__RIPX_TRACE__';
  const TRACE_MAX_STEPS = 100;
  var _ripxTraceSteps = [];
  var _ripxTraceForce = (function readStoredTraceFlag() {
    try {
      var fromWindow = coerceBooleanFlag(window.__RIPX_TRACE__);
      if (fromWindow !== null) return fromWindow;
    } catch (_eTw) {}
    try {
      var fromLs =
        window.localStorage && coerceBooleanFlag(window.localStorage.getItem(TRACE_STORAGE_KEY));
      if (fromLs !== null) return fromLs;
    } catch (_eTls) {}
    try {
      var sp = new URLSearchParams(window.location.search || '');
      if (sp.get('ab_preview_trace') === '1') return true;
    } catch (_eTsp) {}
    return false;
  })();
  function setTraceEnabled(enabled, persist) {
    _ripxTraceForce = !!enabled;
    try {
      window.__RIPX_TRACE__ = _ripxTraceForce;
    } catch (_eTw2) {}
    try {
      if (persist !== false && window.localStorage) {
        if (_ripxTraceForce) window.localStorage.setItem(TRACE_STORAGE_KEY, '1');
        else window.localStorage.removeItem(TRACE_STORAGE_KEY);
      }
    } catch (_eTp) {}
    return _ripxTraceForce;
  }
  function isRipxTraceConsoleEnabled() {
    // Always record steps on __RIPX_TRACE_STEPS__. Print to console only when explicitly enabled
    // (avoids flooding merchant consoles / Jest harnesses). Preview still shows a one-line tip.
    return !!(DEBUG || _ripxTraceForce);
  }
  var _ripxNativeFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
  const ANTI_FLICKER_MAX_MS = 1400;
  const ANTI_FLICKER_PRICE_MAX_MS = 1200;
  const LIVE_VARIANT_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
  var _ripxTiming = {
    scriptStartMs: RIPX_SCRIPT_STARTED_AT_MS,
    scriptStartIso: new Date(RIPX_SCRIPT_STARTED_AT_MS).toISOString(),
    marks: {},
  };
  function markRipxTiming(name, detail) {
    var key = String(name || '').trim();
    if (!key) return;
    var now = Date.now();
    _ripxTiming.marks[key] = {
      atMs: now,
      atIso: new Date(now).toISOString(),
      sinceScriptStartMs: Math.max(0, now - RIPX_SCRIPT_STARTED_AT_MS),
      detail: detail || null,
    };
    try {
      window.__RIPX_TIMING__ = JSON.parse(JSON.stringify(_ripxTiming));
    } catch (_eTiming) {}
  }
  function markRipxTimingOnce(name, detail) {
    var key = String(name || '').trim();
    if (!key || (_ripxTiming.marks && _ripxTiming.marks[key])) return;
    markRipxTiming(key, detail);
  }
  markRipxTiming('script_start');
  var antiFlickerState = {
    active: false,
    pending: 0,
    timeoutId: null,
    installedAt: 0,
    timeoutMs: 0,
    lastReleaseReason: null,
    lastReleasedAt: 0,
  };
  /** Backend may send type "pricing"; treat same as "price" for storefront logic. */
  function testTypeIsPrice(test) {
    if (!test || test.type === undefined || test.type === null) return false;
    var ty = String(test.type).toLowerCase();
    return ty === 'price' || ty === 'pricing';
  }
  function testTypeIsOffer(test) {
    if (!test || test.type === undefined || test.type === null) return false;
    var ty = String(test.type).toLowerCase();
    return ty === 'offer';
  }
  function testTypeIsShipping(test) {
    if (!test || test.type === undefined || test.type === null) return false;
    var ty = String(test.type).toLowerCase();
    return ty === 'shipping';
  }
  function getTemplateKeyForTest(test) {
    if (!test || typeof test !== 'object') return '';
    return String(test.templateKey || test.template_key || '')
      .toLowerCase()
      .trim();
  }
  function testTypeIsThemeFamily(test) {
    if (!test || typeof test !== 'object') return false;
    var ty = String(test.type || '')
      .toLowerCase()
      .trim();
    if (ty === 'theme') return true;
    var tk = getTemplateKeyForTest(test);
    return tk === 'theme' || tk === 'template';
  }
  function getNormalizedTargetType(test) {
    var tt = String((test && (test.targetType || test.target_type)) || '')
      .toLowerCase()
      .trim();
    if ((!tt || tt === 'all') && (testTypeIsPrice(test) || testTypeIsShipping(test))) {
      return 'all-products';
    }
    return tt;
  }
  function normalizeThemeMode(rawMode, fallbackMode) {
    var fallback = String(fallbackMode || 'asset_flag')
      .toLowerCase()
      .trim();
    if (
      fallback !== 'template_switch' &&
      fallback !== 'section_variant' &&
      fallback !== 'asset_flag' &&
      fallback !== 'theme_redirect'
    ) {
      fallback = 'asset_flag';
    }
    var mode = String(rawMode || fallback)
      .toLowerCase()
      .trim();
    if (
      mode !== 'template_switch' &&
      mode !== 'section_variant' &&
      mode !== 'asset_flag' &&
      mode !== 'theme_redirect'
    ) {
      return fallback;
    }
    return mode;
  }
  function variantConfigLooksTheme(config) {
    if (!config || typeof config !== 'object') return false;
    return (
      config.themeMode !== undefined ||
      config.theme_mode !== undefined ||
      config.themeTemplateHandle !== undefined ||
      config.theme_template_handle !== undefined ||
      config.themeId !== undefined ||
      config.theme_id !== undefined ||
      config.sectionId !== undefined ||
      config.section_id !== undefined ||
      config.bodyClass !== undefined ||
      config.body_class !== undefined ||
      config.template !== undefined
    );
  }
  function getAntiFlickerModeForTest(test) {
    if (!test || typeof test !== 'object') return 'balanced';
    var raw = String(test.antiFlickerMode || test.anti_flicker_mode || '')
      .toLowerCase()
      .trim();
    return raw === 'strict' ? 'strict' : 'balanced';
  }
  function getAntiFlickerTimeoutForTest(test) {
    var parsed = Number(test && (test.antiFlickerTimeoutMs || test.anti_flicker_timeout_ms));
    if (isFinite(parsed) && parsed > 0) {
      return Math.max(300, Math.min(2000, Math.round(parsed)));
    }
    return testTypeIsPrice(test) ? ANTI_FLICKER_PRICE_MAX_MS : ANTI_FLICKER_MAX_MS;
  }
  function getAntiFlickerGuardModeForTests(tests) {
    var hasStrict = false;
    var hasPrice = false;
    (tests || []).forEach(function (test) {
      if (!shouldUseAntiFlickerForTest(test)) return;
      if (getAntiFlickerModeForTest(test) === 'strict') hasStrict = true;
      if (testTypeIsPrice(test)) hasPrice = true;
    });
    if (hasStrict) return 'strict';
    if (hasPrice) return 'price';
    return 'strict';
  }
  var DEFAULT_PRICE_ANTI_FLICKER_SELECTORS = [
    '.price',
    '.money',
    '[data-product-price]',
    '[data-price]',
    '.price-item',
    '.price-item--regular',
    '.price-item__regular',
    '.product-price',
  ];
  function sanitizeAntiFlickerSelector(selector) {
    var value = String(selector || '').trim();
    if (!value || value.length > 300) return '';
    if (value.indexOf('{') !== -1 || value.indexOf('}') !== -1) return '';
    for (var i = 0; i < value.length; i += 1) {
      if (value.charCodeAt(i) < 32) return '';
    }
    return value;
  }
  function collectPriceAntiFlickerSelectors(tests) {
    var seen = {};
    var selectors = [];
    function add(selector) {
      var safe = sanitizeAntiFlickerSelector(selector);
      if (!safe || seen[safe]) return;
      seen[safe] = true;
      selectors.push(safe);
    }
    DEFAULT_PRICE_ANTI_FLICKER_SELECTORS.forEach(add);
    (tests || []).forEach(function (test) {
      if (!testTypeIsPrice(test)) return;
      (test.priceSurfaceMappings || []).forEach(function (mapping) {
        if (mapping && mapping.enabled !== false) add(mapping.selector);
      });
    });
    var registry = CONFIG.priceSurfaceRegistry || {};
    (registry.shopMappings || []).forEach(function (mapping) {
      if (mapping && mapping.enabled !== false) add(mapping.selector);
    });
    return selectors.slice(0, 80);
  }
  function buildPriceAntiFlickerCss(tests) {
    return collectPriceAntiFlickerSelectors(tests)
      .map(function (selector) {
        return 'html[data-ripx-af="price"] ' + selector + '{opacity:0 !important;}';
      })
      .join('');
  }
  function isPriceAntiFlickerSurface(test) {
    if (!testTypeIsPrice(test)) return false;
    try {
      if (shouldRunPriceTestOnCurrentPage(test)) return true;
      var path = String((window.location && window.location.pathname) || '').toLowerCase();
      if (path.indexOf('/products/') !== -1 && path.length > '/products/'.length + 1) return true;
      return isProductListingSurface() || isCartSurface() || hasCartUiInDom();
    } catch (_ePriceAf) {
      return false;
    }
  }
  function shouldUseAntiFlickerForTest(test) {
    var mode = getAntiFlickerModeForTest(test);
    // strict: include all test types; balanced: only hide price surfaces that would visibly repaint.
    if (mode === 'strict') return true;
    if (testTypeIsPrice(test)) return isPriceAntiFlickerSurface(test);
    return false;
  }
  function hasAntiFlickerEligibleTests(tests) {
    return (tests || []).some(function (test) {
      return shouldUseAntiFlickerForTest(test);
    });
  }
  function getAntiFlickerTimeoutForTests(tests) {
    var eligible = (tests || []).filter(function (test) {
      return shouldUseAntiFlickerForTest(test);
    });
    if (!eligible.length) return ANTI_FLICKER_MAX_MS;
    return eligible.reduce(function (max, test) {
      return Math.max(max, getAntiFlickerTimeoutForTest(test));
    }, 0);
  }
  function updatePriceAntiFlickerBootstrapHint(tests) {
    try {
      if (!window.sessionStorage) return;
      var guardMode = getAntiFlickerGuardModeForTests(tests || []);
      var hasPriceGuard = guardMode === 'price' && hasAntiFlickerEligibleTests(tests || []);
      if (!hasPriceGuard) {
        window.sessionStorage.removeItem(RIPX_PRICE_AF_HINT_STORAGE_KEY);
        return;
      }
      window.sessionStorage.setItem(
        RIPX_PRICE_AF_HINT_STORAGE_KEY,
        JSON.stringify({
          shopHost: String((window.location && window.location.hostname) || ''),
          shopDomain: String(CONFIG.shopDomain || ''),
          version: SCRIPT_VERSION,
          expiresAtMs: Date.now() + 30 * 60 * 1000,
          timeoutMs: getAntiFlickerTimeoutForTests(tests || []),
          selectors: collectPriceAntiFlickerSelectors(tests || []),
        })
      );
    } catch (_ePriceAfHint) {}
  }
  function installAntiFlickerGuard(timeoutMs, mode, tests) {
    if (antiFlickerState.active || typeof document === 'undefined') return;
    antiFlickerState.active = true;
    antiFlickerState.pending = 0;
    antiFlickerState.installedAt = Date.now();
    antiFlickerState.timeoutMs = timeoutMs || ANTI_FLICKER_MAX_MS;
    antiFlickerState.mode = mode === 'price' ? 'price' : 'strict';
    antiFlickerState.lastReleaseReason = null;
    var styleId = 'ripx-anti-flicker-style';
    var styleEl = document.getElementById(styleId);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      (document.head || document.documentElement || document.body).appendChild(styleEl);
    }
    styleEl.textContent =
      'html[data-ripx-af="strict"] body{opacity:0 !important;}' +
      buildPriceAntiFlickerCss(tests || []);
    if (document.documentElement) {
      var existing = document.documentElement.getAttribute('data-ripx-af');
      document.documentElement.setAttribute('data-ripx-af', existing || antiFlickerState.mode);
    }
    antiFlickerState.timeoutId = setTimeout(function () {
      releaseAntiFlickerGuard('timeout');
    }, antiFlickerState.timeoutMs);
    markRipxTiming('anti_flicker_installed', {
      mode: antiFlickerState.mode,
      timeoutMs: antiFlickerState.timeoutMs,
    });
  }
  function getAntiFlickerDiagnostics() {
    return {
      active: !!antiFlickerState.active,
      pending: antiFlickerState.pending || 0,
      installedAt: antiFlickerState.installedAt || null,
      timeoutMs: antiFlickerState.timeoutMs || 0,
      mode: antiFlickerState.mode || null,
      lastReleaseReason: antiFlickerState.lastReleaseReason || null,
      lastReleasedAt: antiFlickerState.lastReleasedAt || null,
      htmlHidden: !!(
        document &&
        document.documentElement &&
        typeof document.documentElement.getAttribute === 'function' &&
        document.documentElement.getAttribute('data-ripx-af')
      ),
    };
  }
  function releaseInlinePriceAntiFlickerGuard(releasedBy) {
    try {
      if (
        document.documentElement &&
        document.documentElement.getAttribute('data-ripx-af') === 'price'
      ) {
        document.documentElement.removeAttribute('data-ripx-af');
      }
      if (window.__RIPX_INLINE_PRICE_AF__ && window.__RIPX_INLINE_PRICE_AF__.active) {
        window.__RIPX_INLINE_PRICE_AF__.active = false;
        window.__RIPX_INLINE_PRICE_AF__.releasedBy = releasedBy || 'runtime';
        window.__RIPX_INLINE_PRICE_AF__.releasedAt = Date.now();
      }
      if (window.__RIPX_INLINE_PREVIEW_AF__ && window.__RIPX_INLINE_PREVIEW_AF__.active) {
        window.__RIPX_INLINE_PREVIEW_AF__.active = false;
        window.__RIPX_INLINE_PREVIEW_AF__.releasedBy = releasedBy || 'runtime';
        window.__RIPX_INLINE_PREVIEW_AF__.releasedAt = Date.now();
      }
    } catch (_eInlinePriceRelease) {}
  }
  var _ripxPriceReapplyQueuedAfterAf = false;
  var _ripxReapplyPriceTestsImpl = null;
  var _ripxPreviewFocusProductId = null;

  function flushQueuedPriceReapply(reason) {
    var releaseReason = reason || 'queued';
    setTimeout(function () {
      function tryRun(attempt) {
        try {
          var fn =
            typeof _ripxReapplyPriceTestsImpl === 'function'
              ? _ripxReapplyPriceTestsImpl
              : window.RipX && typeof window.RipX.reapplyPriceTests === 'function'
                ? window.RipX.reapplyPriceTests
                : null;
          if (typeof fn === 'function') {
            ripxTrace('S12', 'reapply price tests', {
              reason: releaseReason,
              attempt: attempt || 1,
              via: _ripxReapplyPriceTestsImpl ? 'impl' : 'api',
            });
            fn();
            return;
          }
          if ((attempt || 1) < 3) {
            setTimeout(
              function () {
                tryRun((attempt || 1) + 1);
              },
              40 * (attempt || 1)
            );
            return;
          }
          ripxTrace('S12', 'reapply skipped — not wired yet', { reason: releaseReason }, 'warn');
          persistRipxLiveDiagnostics('price_reapply_not_wired', { reason: releaseReason });
        } catch (_eAfReapply) {
          ripxTrace(
            'S12',
            'reapply failed',
            { reason: releaseReason, message: _eAfReapply && _eAfReapply.message },
            'warn'
          );
        }
      }
      tryRun(1);
    }, 0);
  }

  function releaseAntiFlickerGuard(reason) {
    var releaseReason = reason || 'manual';
    if (antiFlickerState.active) {
      var installedAt = antiFlickerState.installedAt || 0;
      var pendingAtRelease = antiFlickerState.pending || 0;
      antiFlickerState.active = false;
      antiFlickerState.pending = 0;
      antiFlickerState.lastReleaseReason = releaseReason;
      antiFlickerState.lastReleasedAt = Date.now();
      if (antiFlickerState.timeoutId) {
        clearTimeout(antiFlickerState.timeoutId);
        antiFlickerState.timeoutId = null;
      }
      if (document.documentElement) document.documentElement.removeAttribute('data-ripx-af');
      persistRipxLiveDiagnostics('anti_flicker_release', {
        reason: releaseReason,
        pendingAtRelease: pendingAtRelease,
        timeoutMs: antiFlickerState.timeoutMs || 0,
        durationMs: installedAt ? Date.now() - installedAt : null,
      });
      markRipxTiming('anti_flicker_released', {
        reason: releaseReason,
        pendingAtRelease: pendingAtRelease,
        durationMs: installedAt ? Date.now() - installedAt : null,
      });
      ripxTrace('S5', 'anti-flicker released', {
        reason: releaseReason,
        pendingAtRelease: pendingAtRelease,
        reapplyQueued: !!_ripxPriceReapplyQueuedAfterAf,
      });
    }
    releaseInlinePriceAntiFlickerGuard('runtime_' + releaseReason);
    // Price reapply often races anti-flicker; flush any queued pass after prices are visible.
    if (_ripxPriceReapplyQueuedAfterAf) {
      _ripxPriceReapplyQueuedAfterAf = false;
      flushQueuedPriceReapply(releaseReason);
    }
  }
  function markAntiFlickerPending() {
    if (!antiFlickerState.active) return;
    antiFlickerState.pending += 1;
  }
  function markAntiFlickerDone() {
    if (!antiFlickerState.active) return;
    antiFlickerState.pending = Math.max(0, antiFlickerState.pending - 1);
    if (antiFlickerState.pending === 0) releaseAntiFlickerGuard('done');
  }
  function debugLog() {
    if (DEBUG && typeof console !== 'undefined' && console.log) {
      console.log.apply(console, ['[RipX]'].concat(Array.prototype.slice.call(arguments)));
    }
  }

  /**
   * Step-by-step console trail for preview price paint + ATC.
   * Always recorded on window.__RIPX_TRACE_STEPS__; printed when DEBUG/TRACE/preview.
   */
  function ripxTrace(step, message, detail, level) {
    var entry = {
      t: Date.now(),
      iso: new Date().toISOString(),
      step: String(step || '?'),
      message: String(message || ''),
      detail:
        detail && typeof detail === 'object' ? detail : detail != null ? { value: detail } : null,
      level: level === 'warn' || level === 'error' ? level : 'info',
    };
    _ripxTraceSteps.push(entry);
    if (_ripxTraceSteps.length > TRACE_MAX_STEPS) _ripxTraceSteps.shift();
    try {
      window.__RIPX_TRACE_STEPS__ = _ripxTraceSteps.slice();
      window.__RIPX_TRACE_LAST__ = entry;
    } catch (_eTs) {}
    if (entry.level === 'warn' || entry.level === 'error') {
      try {
        persistRipxLiveDiagnostics('trace:' + entry.step, {
          message: entry.message,
          detail: entry.detail,
          level: entry.level,
        });
      } catch (_eTd) {}
    }
    if (!isRipxTraceConsoleEnabled()) return entry;
    if (typeof console === 'undefined') return entry;
    var args = ['[RipX:trace]', entry.step, entry.message];
    if (entry.detail) args.push(entry.detail);
    try {
      if (entry.level === 'error' && console.error) console.error.apply(console, args);
      else if (entry.level === 'warn' && console.warn) console.warn.apply(console, args);
      else if (console.log) console.log.apply(console, args);
    } catch (_eCl) {}
    return entry;
  }

  function getRipxTraceSnapshot() {
    return {
      enabled: isRipxTraceConsoleEnabled(),
      force: !!_ripxTraceForce,
      debug: !!DEBUG,
      previewFocusProductId: _ripxPreviewFocusProductId || null,
      steps: _ripxTraceSteps.slice(),
      last: _ripxTraceSteps.length ? _ripxTraceSteps[_ripxTraceSteps.length - 1] : null,
    };
  }

  function dumpRipxTrace(options) {
    var opts = options && typeof options === 'object' ? options : {};
    var snap = getRipxTraceSnapshot();
    if (opts.log !== false && typeof console !== 'undefined') {
      try {
        if (console.groupCollapsed)
          console.groupCollapsed('[RipX] debugTrace (' + snap.steps.length + ' steps)');
        if (console.table && snap.steps.length) {
          console.table(
            snap.steps.map(function (s) {
              return {
                step: s.step,
                level: s.level,
                message: s.message,
                iso: s.iso,
              };
            })
          );
        } else if (console.log) {
          console.log(snap.steps);
        }
        if (console.log) {
          console.log('focusProduct', snap.previewFocusProductId);
          console.log('guide', RIPX_DEBUG_GUIDE_LINES);
          console.log('next: RipX.debugStatus() then RipX.debugPaintStats() / RipX.debugCart()');
        }
        if (console.groupEnd) console.groupEnd();
      } catch (_eDump) {}
    }
    return snap;
  }

  var RIPX_DEBUG_GUIDE_LINES = [
    'S0  RipX.setDebug(true); RipX.setTrace(true); location.reload()',
    'S1  Check [RipX:trace] lines in console (or RipX.debugTrace())',
    'S2  RipX.debugStatus() — paint count, product id, AF, cart attrs, interpret',
    'S3  document.querySelectorAll(\'[data-ripx-price="1"]\').length',
    'S4  document.documentElement.getAttribute("data-ripx-af") // null = visible',
    'S5  RipX.reapplyPriceTests && RipX.reapplyPriceTests()',
    'S6  Click Add to cart → RipX.debugCart()',
    'S7  RipX.qa() — live diagnostics event trail',
    'Tip Add ?ab_preview_trace=1 to preview URL to force the step trail',
  ];

  function printRipxDebugGuide() {
    if (typeof console === 'undefined') return RIPX_DEBUG_GUIDE_LINES;
    try {
      if (console.groupCollapsed) console.groupCollapsed('[RipX] preview debug guide');
      RIPX_DEBUG_GUIDE_LINES.forEach(function (line) {
        if (console.log) console.log(line);
      });
      if (console.groupEnd) console.groupEnd();
    } catch (_eG) {}
    return RIPX_DEBUG_GUIDE_LINES;
  }

  function rememberPreviewFocusProductId(productId) {
    if (!productId) return;
    try {
      if (typeof PREVIEW_MODE !== 'undefined' && !PREVIEW_MODE) return;
    } catch (_e) {
      return;
    }
    if (!_ripxPreviewFocusProductId) {
      _ripxPreviewFocusProductId = productId;
      ripxTrace('S2', 'preview focus product locked', { productId: productId });
    }
  }

  function isPreviewFocusProduct(productId) {
    if (!productId) return false;
    try {
      if (typeof PREVIEW_MODE === 'undefined' || !PREVIEW_MODE) return true;
    } catch (_e) {
      return true;
    }
    if (!_ripxPreviewFocusProductId) return true;
    try {
      return gidMatches(_ripxPreviewFocusProductId, productId);
    } catch (_eGid) {
      return String(_ripxPreviewFocusProductId) === String(productId);
    }
  }
  function getShippingDebugStorageKey() {
    return '__ripx_shipping_debug_trail_v1__';
  }
  function readShippingDebugTrail() {
    try {
      if (!window.sessionStorage) return [];
      var raw = window.sessionStorage.getItem(getShippingDebugStorageKey());
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_e) {
      return [];
    }
  }
  function writeShippingDebugTrail(trail) {
    try {
      if (!window.sessionStorage) return;
      window.sessionStorage.setItem(getShippingDebugStorageKey(), JSON.stringify(trail.slice(-80)));
    } catch (_e) {}
  }
  function recordShippingDebugStep(step, details) {
    var entry = {
      at: new Date().toISOString(),
      step: String(step || 'unknown'),
      path: window.location ? window.location.pathname : null,
      preview: Boolean(PREVIEW_MODE),
      testId:
        (_ripxCartAttributeState && _ripxCartAttributeState._ripx_price_test) ||
        PREVIEW_TEST_ID ||
        null,
      variant: (_ripxCartAttributeState && _ripxCartAttributeState._ripx_variant) || null,
      hasLineState: Boolean(getRipxLinePropertiesPayload(_ripxCartAttributeState)),
      details: details || {},
    };
    var trail = readShippingDebugTrail();
    trail.push(entry);
    writeShippingDebugTrail(trail);
    if (DEBUG) debugLog('shipping trace:', entry.step, entry);
    return entry;
  }
  function clearShippingDebugTrail() {
    try {
      if (window.sessionStorage) window.sessionStorage.removeItem(getShippingDebugStorageKey());
    } catch (_e) {}
  }
  async function debugShippingFlow(options) {
    var opts = options && typeof options === 'object' ? options : {};
    var cartSnapshot = await debugCartSnapshot({ log: false });
    var desiredProps = getRipxLinePropertiesPayload(_ripxCartAttributeState);
    var lineState = _ripxCartAttributeState || null;
    var debugTestId = (lineState && lineState.testId) || PREVIEW_TEST_ID || null;
    var cartEmpty = !cartSnapshot || !cartSnapshot.ok || Number(cartSnapshot.itemCount || 0) === 0;
    var assignmentInjected = Boolean(
      lineState && (lineState._ripx_price_test || lineState.testId || debugTestId)
    );
    var cartHasAssignment =
      Array.isArray(cartSnapshot && cartSnapshot.items) &&
      cartSnapshot.items.some(function (item) {
        return item && item.priceTest && item.assignedVariant;
      });
    var primaryBlocker = null;
    if (!assignmentInjected) {
      primaryBlocker = {
        code: 'assignment_missing',
        title: 'Shipping assignment not injected',
        detail: 'Reload the preview product page or open the RipX preview link again.',
      };
    } else if (cartEmpty) {
      primaryBlocker = {
        code: 'cart_empty',
        title: 'Cart is empty',
        detail:
          'Add the product to cart first, then run debug again on /cart or after add-to-cart.',
      };
    } else if (!cartHasAssignment) {
      primaryBlocker = {
        code: 'cart_props_missing',
        title: 'Cart line missing RipX properties',
        detail:
          'A line is in cart but _ripx_price_test / _ripx_variant are missing. Try add-to-cart again or open /cart and wait a few seconds.',
      };
    }
    var out = {
      ok: true,
      scriptVersion: SCRIPT_VERSION,
      location: window.location ? window.location.href : null,
      preview: Boolean(PREVIEW_MODE),
      previewTestId: PREVIEW_TEST_ID || null,
      lineState: lineState,
      desiredLineProperties: desiredProps,
      cart: cartSnapshot,
      trail: readShippingDebugTrail(),
      assignmentInjected: assignmentInjected,
      cartEmpty: cartEmpty,
      shippingAssignmentReady: cartHasAssignment,
      checkoutHandoffReady: (readShippingDebugTrail() || []).some(function (entry) {
        return (
          entry &&
          (entry.step === 'cart_repair_already_complete' ||
            entry.step === 'cart_repair_succeeded' ||
            entry.step === 'cart_level_attrs_synced' ||
            entry.step === 'checkout_handoff_repair_result')
        );
      }),
      nextChecks: [
        'Run this on the storefront product/cart page before checkout.',
        'After add-to-cart, cart.items[].properties should include _ripx_price_test and _ripx_variant.',
        'If trail shows cart_repair_already_complete, cart assignment is ready for checkout.',
        'Before checkout navigation, trail should include checkout_handoff_started.',
        'In backend logs, checkout rate loading should show POST /api/track/shipping-carrier-rates.',
        'If checkout still shows native Standard, run RipX Diagnostics > Run live debug, then Apply shipping.',
        'In RipX app: Diagnostics tab > Run live debug to probe carrier callback and list stale Shopify carriers.',
        debugTestId
          ? 'Carrier debug trace: GET /api/track/shipping-carrier-rates/debug?test_id=' +
            debugTestId
          : 'Carrier debug trace: GET /api/track/shipping-carrier-rates/debug?test_id=<test_id>',
      ],
      debugEndpoints: {
        carrierTrace: debugTestId
          ? '/api/track/shipping-carrier-rates/debug?test_id=' + debugTestId
          : null,
        liveDebug: debugTestId ? '/api/tests/' + debugTestId + '/shipping/live-debug' : null,
        simulateHide: debugTestId ? '/api/tests/' + debugTestId + '/shipping/simulate-hide' : null,
        dcConfigCompare: debugTestId
          ? '/api/tests/' + debugTestId + '/shipping/dc-config-compare'
          : null,
      },
      primaryBlocker: primaryBlocker,
    };
    if (opts.log !== false && typeof console !== 'undefined') {
      if (console.groupCollapsed) console.groupCollapsed('[RipX] shipping debug flow');
      if (console.log) console.log(out);
      if (console.table) console.table(out.trail || []);
      if (console.groupEnd) console.groupEnd();
    }
    return out;
  }
  function buildSimulateHidePayload(deliveryOptions, overrides) {
    var opts = overrides && typeof overrides === 'object' ? overrides : {};
    var lineState = _ripxCartAttributeState || {};
    var testId =
      opts.testId || lineState.testId || lineState._ripx_price_test || PREVIEW_TEST_ID || null;
    var variantId =
      opts.variantId ||
      lineState.variantId ||
      lineState._ripx_variant ||
      lineState.variantName ||
      null;
    return {
      test_id: testId,
      variant_id: variantId,
      variantIndex: opts.variantIndex !== undefined ? opts.variantIndex : null,
      delivery_options: Array.isArray(deliveryOptions) ? deliveryOptions : [],
      simulate_endpoint: testId ? '/api/tests/' + testId + '/shipping/simulate-hide' : null,
      compare_endpoint: testId ? '/api/tests/' + testId + '/shipping/dc-config-compare' : null,
      note: 'Paste checkout shipping option shapes as { handle, title, code, cost: { amount, currencyCode } } then POST to simulate_endpoint.',
    };
  }
  async function debugCartSnapshot(options) {
    var opts = options && typeof options === 'object' ? options : {};
    try {
      if (typeof fetch !== 'function') {
        return { ok: false, error: 'fetch_unavailable' };
      }
      var res = await fetch('/cart.js', { method: 'GET', credentials: 'same-origin' });
      if (!res || !res.ok) {
        return { ok: false, error: 'cart_fetch_failed', status: res ? res.status : null };
      }
      var cart = await res.json();
      var items = Array.isArray(cart && cart.items)
        ? cart.items.map(function (item, idx) {
            var p = item && item.properties ? item.properties : {};
            var priceMethod =
              p._ripx_price_method ||
              p._ripx_price_application_method ||
              p.__ripx_price_application_method ||
              null;
            var targetUnit = p._ripx_target_unit || null;
            var hasSellingPlan = !!(item && item.selling_plan_allocation);
            var assignedVariant = p._ripx_variant || null;
            var transformEligible =
              !hasSellingPlan &&
              String(priceMethod || '').toLowerCase() === 'direct_price_override' &&
              targetUnit !== null &&
              targetUnit !== '';
            var transformBlockReason = transformEligible
              ? null
              : hasSellingPlan
                ? 'selling_plan_line'
                : String(priceMethod || '').toLowerCase() !== 'direct_price_override'
                  ? 'not_direct_price_override'
                  : targetUnit === null || targetUnit === ''
                    ? assignedVariant && String(assignedVariant).toLowerCase() === 'control'
                      ? 'control_variant_has_no_target_price'
                      : 'missing_ripx_target_unit'
                    : 'not_eligible';
            return {
              row: idx + 1,
              key: item && item.key ? item.key : null,
              variantId: item && item.variant_id ? item.variant_id : null,
              title:
                item && (item.product_title || item.title)
                  ? item.product_title || item.title
                  : null,
              quantity: item && item.quantity ? item.quantity : 0,
              priceMethod: priceMethod,
              targetUnit: targetUnit,
              priceTest: p._ripx_price_test || null,
              assignedVariant: assignedVariant,
              hasSellingPlan: hasSellingPlan,
              transformEligible: transformEligible,
              transformBlockReason: transformBlockReason,
            };
          })
        : [];
      if (opts.log !== false && typeof console !== 'undefined') {
        if (console.groupCollapsed) console.groupCollapsed('[RipX] cart debug snapshot');
        if (console.table) console.table(items);
        if (console.log) console.log('cart', cart);
        if (console.groupEnd) console.groupEnd();
      }
      var cartAttributes =
        cart && cart.attributes && typeof cart.attributes === 'object' ? cart.attributes : {};
      return {
        ok: true,
        itemCount: items.length,
        currency: cart && cart.currency ? cart.currency : null,
        attributes: {
          _ripx_price_test:
            cartAttributes._ripx_price_test || cartAttributes.ripx_price_test || null,
          _ripx_variant: cartAttributes._ripx_variant || cartAttributes.ripx_variant || null,
        },
        items: items,
        cart: opts.includeRaw ? cart : undefined,
      };
    } catch (err) {
      return { ok: false, error: err && (err.message || String(err)) };
    }
  }

  function ensureRipxPaintScopeStats(scope) {
    var key = scope && String(scope).trim() ? String(scope).trim() : 'unknown';
    if (!_ripxPaintStats.byScope[key]) {
      _ripxPaintStats.byScope[key] = {
        attempts: 0,
        textWrites: 0,
        attrWrites: 0,
        mutations: 0,
        unchanged: 0,
      };
    }
    return _ripxPaintStats.byScope[key];
  }

  function recordRipxPaintEvent(scope, textWrites, attrWrites) {
    var textCount = Number(textWrites) || 0;
    var attrCount = Number(attrWrites) || 0;
    var mutations = Math.max(0, textCount + attrCount);
    var bucket = ensureRipxPaintScopeStats(scope);
    bucket.attempts += 1;
    bucket.textWrites += textCount;
    bucket.attrWrites += attrCount;
    bucket.mutations += mutations;
    if (mutations === 0) bucket.unchanged += 1;
    _ripxPaintStats.totals.attempts += 1;
    _ripxPaintStats.totals.textWrites += textCount;
    _ripxPaintStats.totals.attrWrites += attrCount;
    _ripxPaintStats.totals.mutations += mutations;
    if (mutations === 0) _ripxPaintStats.totals.unchanged += 1;
    _ripxPaintStats.lastEventAt = Date.now();
  }

  function recordRipxPaintScheduleEvent(kind) {
    var k = kind && String(kind).trim() ? String(kind).trim() : '';
    if (!k) return;
    if (!_ripxPaintStats.schedules[k]) _ripxPaintStats.schedules[k] = 0;
    _ripxPaintStats.schedules[k] += 1;
    _ripxPaintStats.lastEventAt = Date.now();
  }

  function getRipxPaintStatsSnapshot() {
    var now = Date.now();
    var byScope = {};
    var scopeKeys = Object.keys(_ripxPaintStats.byScope || {});
    for (var i = 0; i < scopeKeys.length; i++) {
      var key = scopeKeys[i];
      var bucket = _ripxPaintStats.byScope[key] || {};
      byScope[key] = {
        attempts: Number(bucket.attempts) || 0,
        textWrites: Number(bucket.textWrites) || 0,
        attrWrites: Number(bucket.attrWrites) || 0,
        mutations: Number(bucket.mutations) || 0,
        unchanged: Number(bucket.unchanged) || 0,
      };
    }
    var totals = _ripxPaintStats.totals || {};
    var schedules = {};
    var scheduleKeys = Object.keys(_ripxPaintStats.schedules || {});
    for (var j = 0; j < scheduleKeys.length; j++) {
      var sk = scheduleKeys[j];
      schedules[sk] = Number(_ripxPaintStats.schedules[sk]) || 0;
    }
    var attempts = Number(totals.attempts) || 0;
    var mutations = Number(totals.mutations) || 0;
    return {
      sinceMs: Number(_ripxPaintStats.since) || now,
      sinceIso: new Date(Number(_ripxPaintStats.since) || now).toISOString(),
      elapsedMs: Math.max(0, now - (Number(_ripxPaintStats.since) || now)),
      lastEventAtMs:
        _ripxPaintStats.lastEventAt != null ? Number(_ripxPaintStats.lastEventAt) || null : null,
      lastEventAtIso:
        _ripxPaintStats.lastEventAt != null
          ? new Date(Number(_ripxPaintStats.lastEventAt)).toISOString()
          : null,
      totals: {
        attempts: attempts,
        textWrites: Number(totals.textWrites) || 0,
        attrWrites: Number(totals.attrWrites) || 0,
        mutations: mutations,
        unchanged: Number(totals.unchanged) || 0,
        mutationRate: attempts > 0 ? Math.round((mutations / attempts) * 1000) / 1000 : 0,
      },
      schedules: schedules,
      byScope: byScope,
      parity: {
        checked: Number(_ripxPaintParityAudit.checked) || 0,
        ok: Number(_ripxPaintParityAudit.ok) || 0,
        mismatchCount: Array.isArray(_ripxPaintParityAudit.mismatches)
          ? _ripxPaintParityAudit.mismatches.length
          : 0,
        updatedAtMs:
          _ripxPaintParityAudit.updatedAt != null
            ? Number(_ripxPaintParityAudit.updatedAt) || null
            : null,
        mismatches: Array.isArray(_ripxPaintParityAudit.mismatches)
          ? _ripxPaintParityAudit.mismatches.slice(0, RIPX_PAINT_PARITY_MAX_ISSUES)
          : [],
      },
    };
  }

  function resetRipxPaintStats() {
    _ripxPaintStats = createRipxPaintStats();
  }

  function debugPaintStats(options) {
    var opts = options && typeof options === 'object' ? options : {};
    if (opts.reset === true) {
      resetRipxPaintStats();
    }
    var snapshot = getRipxPaintStatsSnapshot();
    if (opts.log !== false && typeof console !== 'undefined') {
      if (console.groupCollapsed) console.groupCollapsed('[RipX] paint stats');
      if (console.table) {
        var totalsRow = Object.assign({ scope: 'totals' }, snapshot.totals);
        console.table([totalsRow]);
        var scopeRows = [];
        var scopeKeys = Object.keys(snapshot.byScope || {});
        for (var i = 0; i < scopeKeys.length; i++) {
          var scope = scopeKeys[i];
          scopeRows.push(Object.assign({ scope: scope }, snapshot.byScope[scope]));
        }
        if (scopeRows.length) console.table(scopeRows);
      }
      if (console.log) console.log('schedules', snapshot.schedules);
      if (console.groupEnd) console.groupEnd();
    }
    return { ok: true, stats: snapshot };
  }

  /** Fetch with timeout to avoid hanging on slow/failed networks. Uses AbortController. */
  function fetchWithTimeout(url, options, timeoutMs) {
    var t = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 10000;
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var signal = controller ? controller.signal : undefined;
    var timer = setTimeout(function () {
      if (controller) controller.abort();
    }, t);
    var opts = Object.assign({}, options || {});
    if (signal) opts.signal = signal;
    return fetch(url, opts).then(
      function (r) {
        clearTimeout(timer);
        return r;
      },
      function (err) {
        clearTimeout(timer);
        throw err;
      }
    );
  }
  /** Fetch with one retry after delay (for transient failures). */
  function fetchWithRetry(url, options, timeoutMs, retryDelayMs) {
    var delay = typeof retryDelayMs === 'number' && retryDelayMs > 0 ? retryDelayMs : 800;
    return fetchWithTimeout(url, options, timeoutMs).catch(function (err) {
      debugLog('fetch failed, retrying once', url.substring(0, 80) + '...');
      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          fetchWithTimeout(url, options, timeoutMs).then(resolve, reject);
        }, delay);
      });
    });
  }

  function hasConsent() {
    if (!consentRequired) return true;
    return !!(
      window.ripx_consent ||
      (window.gdprConsent && window.gdprConsent.marketing) ||
      (window.__cmp && false) // CMP integration: check via __cmp('getConsentData')
    );
  }

  const URL_PARAMS = new URLSearchParams(window.location.search);
  // Shopify navigation drops query params; keep preview context sticky across clicks (PDP/collections/cart).
  const PREVIEW_STORAGE_KEY = '__ripx_preview_ctx_v1__';
  const PREVIEW_WINDOW_NAME_PREFIX = '__ripx_preview_ctx_v1__:';
  const PREVIEW_STORAGE_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours
  const PREVIEW_VARIANT_CACHE_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes
  const LIVE_USER_STORAGE_KEY = '__ripx_live_user_id_v1__';
  function extractPreviewParamsFromSearch(search) {
    var params = new URLSearchParams(search || '');
    var testId = params.get('ab_preview_test') || null;
    var variantId = params.get('ab_preview_variant') || null;
    var variantName = params.get('ab_preview_variant_name') || null;
    if (!(params.get('ab_preview') === '1' || testId || variantId || variantName)) return null;
    return {
      preview: params.get('ab_preview') === '1' || !!testId,
      testId: testId,
      testType: params.get('ab_preview_test_type') || null,
      variantId: variantId,
      variantName: variantName,
      tenantDomain: params.get('ab_preview_domain') || null,
      simple: params.get('ab_preview_simple') === '1',
      sessionId: params.get('ab_preview_session') || null,
    };
  }
  function seedPreviewCtxFromPasswordReturnUrl() {
    try {
      var pathLower = String(window.location.pathname || '').toLowerCase();
      if (pathLower.indexOf('/password') === -1) return null;
      var returnRaw = URL_PARAMS.get('return_url') || '';
      if (!returnRaw) {
        var returnInput = document.querySelector('input[name="return_url"]');
        returnRaw = returnInput && returnInput.value ? String(returnInput.value) : '';
      }
      if (!returnRaw) return null;
      var returnUrl = new URL(returnRaw, window.location.origin);
      var extracted = extractPreviewParamsFromSearch(returnUrl.search);
      if (!extracted || !window.sessionStorage) return null;
      window.sessionStorage.setItem(
        PREVIEW_STORAGE_KEY,
        JSON.stringify(Object.assign({}, extracted, { persistedAtMs: Date.now() }))
      );
      return extracted;
    } catch (_ePasswordSeed) {
      return null;
    }
  }
  seedPreviewCtxFromPasswordReturnUrl();
  function getPreviewParam(name) {
    var direct = URL_PARAMS.get(name);
    if (direct !== null && direct !== undefined && direct !== '') return direct;
    try {
      var nestedTarget = URL_PARAMS.get('url') || '';
      if (!nestedTarget) return direct;
      var parsedTarget = new URL(nestedTarget, window.location.origin);
      var nested = parsedTarget.searchParams.get(name);
      return nested !== null && nested !== undefined && nested !== '' ? nested : direct;
    } catch (_ePreviewParam) {
      return direct;
    }
  }
  function getEffectivePreviewPathname() {
    try {
      var nestedTarget = URL_PARAMS.get('url') || '';
      if (nestedTarget) {
        var parsedTarget = new URL(nestedTarget, window.location.origin);
        var nestedPath = String(parsedTarget.pathname || '').toLowerCase();
        if (nestedPath) return nestedPath;
      }
    } catch (_eNestedPath) {}
    return String(window.location.pathname || '').toLowerCase();
  }
  function inferPriceSurfaceFromPathname(pathname) {
    var path = String(pathname || '')
      .trim()
      .toLowerCase();
    if (!path) return 'home';
    if (path.indexOf('/products/') !== -1) return 'pdp';
    if (path.indexOf('/collections/') !== -1) return 'plp';
    if (path.indexOf('/cart') !== -1) return 'cart';
    if (path.indexOf('/search') !== -1) return 'search';
    if (path === '/' || path === '') return 'home';
    if (path.indexOf('/pages/') !== -1) return 'home';
    return null;
  }
  function getListingPriceSurfaceKeys() {
    var primary = inferPriceSurfaceFromPathname(getEffectivePreviewPathname());
    if (primary === 'plp') return ['plp', 'recommendation', 'global'];
    if (primary === 'search') return ['search', 'recommendation', 'global'];
    if (primary === 'home') return ['home', 'recommendation', 'global'];
    if (primary === 'pdp') return ['pdp', 'quickview', 'recommendation', 'global'];
    if (primary === 'cart') return ['cart', 'global'];
    return ['plp', 'search', 'home', 'recommendation', 'global'];
  }
  function getPriceSurfaceHintFromHref(href) {
    try {
      var parsed = new URL(String(href || window.location.href || ''), window.location.origin);
      var nestedTarget = parsed.searchParams.get('url') || '';
      if (nestedTarget) {
        parsed = new URL(nestedTarget, window.location.origin);
      }
      return inferPriceSurfaceFromPathname(parsed.pathname);
    } catch (_eSurfaceHint) {
      return null;
    }
  }
  const PREVIEW_RESET_SESSION = getPreviewParam('ab_preview_reset') === '1';
  const URL_PREVIEW_SESSION_ID = getPreviewParam('ab_preview_session') || null;
  function clearPreviewStorageForUrlContext() {
    try {
      if (window.sessionStorage) {
        window.sessionStorage.removeItem(PREVIEW_STORAGE_KEY);
        var resetTestId = getPreviewParam('ab_preview_test');
        if (resetTestId) {
          window.sessionStorage.removeItem('ripx_preview_variant_cache_' + String(resetTestId));
          window.sessionStorage.removeItem('ripx_preview_variant_cache_v2_' + String(resetTestId));
        }
        for (var i = window.sessionStorage.length - 1; i >= 0; i -= 1) {
          var key = window.sessionStorage.key(i);
          if (
            key &&
            (key.indexOf('ripx_preview_variant_cache_') === 0 ||
              key.indexOf('ripx_preview_variant_cache_v2_') === 0)
          ) {
            window.sessionStorage.removeItem(key);
          }
        }
      }
    } catch (_eResetSession) {}
    try {
      if (
        typeof window.name === 'string' &&
        window.name.indexOf(PREVIEW_WINDOW_NAME_PREFIX) === 0
      ) {
        window.name = '';
      }
    } catch (_eResetName) {}
  }
  const FORCE_LIVE_MODE =
    URL_PARAMS.get('ripx_live') === '1' || URL_PARAMS.get('ripx_clear_preview') === '1';
  if (FORCE_LIVE_MODE || PREVIEW_RESET_SESSION) {
    clearPreviewStorageForUrlContext();
  }
  function normalizePreviewCtxObject(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const persistedAtMs = Number(obj.persistedAtMs || 0);
    if (
      Number.isFinite(persistedAtMs) &&
      persistedAtMs > 0 &&
      Date.now() - persistedAtMs > PREVIEW_STORAGE_MAX_AGE_MS
    ) {
      return null;
    }
    return {
      preview: obj.preview === true || obj.preview === '1',
      testId: obj.testId ? String(obj.testId) : null,
      testType: obj.testType ? String(obj.testType) : null,
      variantId: obj.variantId ? String(obj.variantId) : null,
      variantName: obj.variantName ? String(obj.variantName) : null,
      tenantDomain: obj.tenantDomain ? String(obj.tenantDomain) : null,
      simple: obj.simple === true || obj.simple === '1',
      sessionId: obj.sessionId ? String(obj.sessionId) : null,
      launchTargetUrl: obj.launchTargetUrl ? String(obj.launchTargetUrl) : null,
      persistedAtMs:
        Number.isFinite(persistedAtMs) && persistedAtMs > 0 ? Math.round(persistedAtMs) : null,
    };
  }
  function maybeFollowPreviewLaunchTargetFromWindowName() {
    if (!windowNamePreview || !windowNamePreview.launchTargetUrl) return false;
    var pathLower = (window.location.pathname || '').toLowerCase();
    if (pathLower.indexOf('/password') !== -1) return false;
    try {
      var target = new URL(windowNamePreview.launchTargetUrl, window.location.origin);
      var current = new URL(window.location.href);
      if (
        String(target.hostname || '').toLowerCase() !== String(current.hostname || '').toLowerCase()
      ) {
        return false;
      }
      if (target.pathname === current.pathname && target.search === current.search) {
        return false;
      }
      window.location.replace(target.toString());
      return true;
    } catch (_eLaunchTarget) {
      return false;
    }
  }
  function readPersistedPreviewCtx() {
    try {
      const raw = window.sessionStorage && window.sessionStorage.getItem(PREVIEW_STORAGE_KEY);
      if (!raw) return null;
      const normalized = normalizePreviewCtxObject(JSON.parse(raw));
      if (!normalized) {
        try {
          window.sessionStorage.removeItem(PREVIEW_STORAGE_KEY);
        } catch (eRemove) {}
        return null;
      }
      return normalized;
    } catch (e) {
      return null;
    }
  }
  function readWindowNamePreviewCtx() {
    try {
      const raw = typeof window.name === 'string' ? window.name : '';
      if (!raw || raw.indexOf(PREVIEW_WINDOW_NAME_PREFIX) !== 0) return null;
      const normalized = normalizePreviewCtxObject(
        JSON.parse(raw.slice(PREVIEW_WINDOW_NAME_PREFIX.length))
      );
      if (!normalized) {
        try {
          if (window.name.indexOf(PREVIEW_WINDOW_NAME_PREFIX) === 0) window.name = '';
        } catch (eReset) {}
        return null;
      }
      return normalized;
    } catch (e) {
      return null;
    }
  }
  function clearWindowNamePreviewCtx() {
    try {
      if (
        typeof window.name === 'string' &&
        window.name.indexOf(PREVIEW_WINDOW_NAME_PREFIX) === 0
      ) {
        window.name = '';
      }
    } catch (e) {}
  }
  function writePersistedPreviewCtx(ctx) {
    try {
      if (!window.sessionStorage) return;
      const payload = {
        ...(ctx || {}),
        persistedAtMs: Date.now(),
      };
      window.sessionStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {}
  }
  const persistedPreview = readPersistedPreviewCtx();
  const windowNamePreview = readWindowNamePreviewCtx();
  const PREVIEW_SESSION_ID =
    URL_PREVIEW_SESSION_ID ||
    (persistedPreview && persistedPreview.preview ? persistedPreview.sessionId : null) ||
    (windowNamePreview && windowNamePreview.preview ? windowNamePreview.sessionId : null) ||
    null;

  const _urlPreview = getPreviewParam('ab_preview') === '1';
  const _urlPreviewTest = getPreviewParam('ab_preview_test');
  const _urlPreviewVariantId = getPreviewParam('ab_preview_variant');
  const _urlPreviewVariantName = getPreviewParam('ab_preview_variant_name');
  const _urlPreviewTestType = getPreviewParam('ab_preview_test_type');
  const _urlPreviewTenantDomain = getPreviewParam('ab_preview_domain');
  const PREVIEW_SIMPLE_MODE =
    getPreviewParam('ab_preview_simple') === '1' ||
    !!(persistedPreview && persistedPreview.preview && persistedPreview.simple) ||
    !!(windowNamePreview && windowNamePreview.preview && windowNamePreview.simple);

  const HAS_URL_PREVIEW_CTX = !!(
    _urlPreview ||
    _urlPreviewTest ||
    _urlPreviewVariantId ||
    _urlPreviewVariantName ||
    _urlPreviewTestType ||
    _urlPreviewTenantDomain
  );

  // Effective preview inputs: URL wins; then embedded config; then persisted session; then window.name.
  const PREVIEW_TEST_ID =
    _urlPreviewTest ||
    (CONFIG.previewTestId && String(CONFIG.previewTestId)) ||
    (persistedPreview && persistedPreview.preview ? persistedPreview.testId : null) ||
    (windowNamePreview && windowNamePreview.preview ? windowNamePreview.testId : null) ||
    null;
  const PREVIEW_VARIANT_ID =
    _urlPreviewVariantId ||
    (CONFIG.previewVariantId && String(CONFIG.previewVariantId)) ||
    (persistedPreview && persistedPreview.preview ? persistedPreview.variantId : null) ||
    (windowNamePreview && windowNamePreview.preview ? windowNamePreview.variantId : null) ||
    null;
  const PREVIEW_VARIANT_NAME =
    _urlPreviewVariantName ||
    (CONFIG.previewVariantName && String(CONFIG.previewVariantName)) ||
    (persistedPreview && persistedPreview.preview ? persistedPreview.variantName : null) ||
    (windowNamePreview && windowNamePreview.preview ? windowNamePreview.variantName : null) ||
    null;
  const PREVIEW_TEST_TYPE =
    _urlPreviewTestType ||
    (CONFIG.previewTestType && String(CONFIG.previewTestType)) ||
    (persistedPreview && persistedPreview.preview ? persistedPreview.testType : null) ||
    (windowNamePreview && windowNamePreview.preview ? windowNamePreview.testType : null) ||
    null;
  const PREVIEW_TENANT_DOMAIN =
    _urlPreviewTenantDomain ||
    (CONFIG.previewTenantDomain && String(CONFIG.previewTenantDomain)) ||
    (persistedPreview && persistedPreview.preview ? persistedPreview.tenantDomain : null) ||
    (windowNamePreview && windowNamePreview.preview ? windowNamePreview.tenantDomain : null) ||
    null;
  const EMBEDDED_PREVIEW_VARIANT =
    CONFIG.previewVariant && typeof CONFIG.previewVariant === 'object'
      ? CONFIG.previewVariant
      : null;

  // True only when a concrete preview context is active (target test id or runtime preview flag).
  const PREVIEW_TEST_CONTEXT = !!PREVIEW_TEST_ID || !!(CONFIG.previewMode === true);
  const PREVIEW_MODE =
    _urlPreview ||
    PREVIEW_TEST_CONTEXT ||
    !!(windowNamePreview && windowNamePreview.preview) ||
    !!(persistedPreview && persistedPreview.preview);
  const STRICT_PREVIEW_TEST_MODE = PREVIEW_MODE && !!PREVIEW_TEST_ID;

  if (maybeFollowPreviewLaunchTargetFromWindowName()) {
    return;
  }

  function getRuntimeActiveTestsForBootstrap() {
    if (PREVIEW_MODE && PREVIEW_TEST_ID) {
      var embedded = Array.isArray(CONFIG.activeTests) ? CONFIG.activeTests : [];
      for (var i = 0; i < embedded.length; i += 1) {
        var candidate = embedded[i];
        if (candidate && String(candidate.id) === String(PREVIEW_TEST_ID)) {
          return [candidate];
        }
      }
      var bootstrapType =
        String(PREVIEW_TEST_TYPE || '')
          .trim()
          .toLowerCase() === 'shipping' || resolvePreviewLooksLikeShipping(null)
          ? 'shipping'
          : 'price';
      // Never use all-products for synthetic price preview — that paints one arm
      // price on every PDP/card until preview-storefront-test returns.
      if (bootstrapType === 'shipping') {
        return [
          {
            id: PREVIEW_TEST_ID,
            type: 'shipping',
            targetType: 'all-products',
          },
        ];
      }
      // Do NOT seed the opened PDP as targetIds — that fakes a match when the arm's
      // byProduct matrix belongs to a different product (sticky / wrong-row preview).
      var bootProductId = null;
      try {
        bootProductId = getCurrentProductId();
      } catch (_eBootPid) {
        bootProductId = null;
      }
      if (bootProductId) rememberPreviewFocusProductId(bootProductId);
      ripxTrace('S1', 'synthetic price preview bootstrap', {
        productId: bootProductId,
        testId: PREVIEW_TEST_ID,
        targetIds: null,
      });
      return [
        {
          id: PREVIEW_TEST_ID,
          type: 'price',
          targetType: 'product',
          targetIds: null,
          targetId: null,
          previewSynthetic: true,
        },
      ];
    }
    return Array.isArray(CONFIG.activeTests) ? CONFIG.activeTests.slice() : [];
  }

  function previewFocusLooksLikePrice() {
    if (!(PREVIEW_MODE && PREVIEW_TEST_ID)) return false;
    var hintedType = String(PREVIEW_TEST_TYPE || '')
      .trim()
      .toLowerCase();
    if (hintedType === 'price') return true;
    if (hintedType === 'shipping' || hintedType === 'offer' || hintedType === 'checkout') {
      return false;
    }
    var embedded = Array.isArray(CONFIG.activeTests) ? CONFIG.activeTests : [];
    for (var i = 0; i < embedded.length; i += 1) {
      var test = embedded[i];
      if (test && String(test.id) === String(PREVIEW_TEST_ID)) {
        return testTypeIsPrice(test);
      }
    }
    return !resolvePreviewLooksLikeShipping(null);
  }

  function bootstrapAntiFlickerAndAssignment() {
    if (!hasValidConfig) return;
    var tests = getRuntimeActiveTestsForBootstrap();
    if (!PREVIEW_MODE && tests.length === 0) {
      updatePriceAntiFlickerBootstrapHint([]);
      return;
    }
    if (consentRequired && !hasConsent() && !PREVIEW_MODE && !FORCE_LIVE_MODE) return;
    if (PREVIEW_MODE && PREVIEW_TEST_ID && !hasAntiFlickerEligibleTests(tests)) {
      updatePriceAntiFlickerBootstrapHint([]);
      releaseAntiFlickerGuard('preview_non_price');
      return;
    }
    updatePriceAntiFlickerBootstrapHint(tests);
    if (hasAntiFlickerEligibleTests(tests)) {
      installAntiFlickerGuard(
        getAntiFlickerTimeoutForTests(tests),
        getAntiFlickerGuardModeForTests(tests),
        tests
      );
    }
  }

  bootstrapAntiFlickerAndAssignment();

  const RIPX_LIVE_DIAGNOSTICS_KEY = '__ripx_live_diagnostics_v1__';
  const RIPX_LIVE_DIAGNOSTICS_HISTORY_KEY = '__ripx_live_diagnostics_history_v1__';
  const RIPX_LIVE_DIAGNOSTICS_COOKIE = 'ripx_ab_state';
  const RIPX_LIVE_DIAGNOSTICS_MAX_EVENTS = 80;
  var _ripxLiveDiagnostics = {
    schema: 1,
    version: SCRIPT_VERSION,
    loadedAt: new Date().toISOString(),
    href: (window.location.origin || '') + (window.location.pathname || ''),
    shopDomain: CONFIG.shopDomain || null,
    apiUrl: CONFIG.apiUrl || null,
    preview: {
      mode: PREVIEW_MODE,
      testId: PREVIEW_TEST_ID || null,
      simple: PREVIEW_SIMPLE_MODE,
      forceLiveMode: FORCE_LIVE_MODE,
      sessionStoragePresent: !!(persistedPreview && persistedPreview.preview),
      windowNamePresent: !!(windowNamePreview && windowNamePreview.preview),
    },
    runtime: {
      validConfig: hasValidConfig,
      activeTestsCount: (CONFIG.activeTests || []).length,
      activeTestIds: (CONFIG.activeTests || [])
        .map(function (t) {
          return t && t.id;
        })
        .filter(Boolean),
      consentRequired: consentRequired,
    },
    timing: _ripxTiming,
    assignments: {},
    skips: {},
    events: [],
  };

  function sanitizeDiagnosticVariant(variant) {
    if (!variant || typeof variant !== 'object') return variant || null;
    return {
      variantId:
        variant.variantId !== undefined && variant.variantId !== null
          ? String(variant.variantId)
          : variant.id !== undefined && variant.id !== null
            ? String(variant.id)
            : null,
      variantName: variant.variantName || variant.name || null,
      isNewAssignment: variant.isNewAssignment === true,
      isPreview: variant.isPreview === true,
      hasConfig: !!variant.config,
      configKeys:
        variant.config && typeof variant.config === 'object' ? Object.keys(variant.config) : [],
      hasAssignmentSig: !!variant.assignment_sig,
    };
  }

  function sanitizeDiagnosticVariantsMap(variants) {
    var out = {};
    if (!variants || typeof variants !== 'object') return out;
    Object.keys(variants).forEach(function (testId) {
      out[testId] = sanitizeDiagnosticVariant(variants[testId]);
    });
    return out;
  }

  function getSanitizedCurrentUrl() {
    try {
      var parsed = new URL(window.location.href || '', window.location.origin);
      return parsed.origin + parsed.pathname;
    } catch (_eUrl) {
      return window.location.pathname || '';
    }
  }

  function getRipxLiveDiagnosticsSnapshot() {
    try {
      return JSON.parse(JSON.stringify(_ripxLiveDiagnostics));
    } catch (_eClone) {
      return _ripxLiveDiagnostics;
    }
  }

  function writeRipxDiagnosticsCookie() {
    try {
      if (consentRequired && !hasConsent()) return;
      var assigned = Object.keys(_ripxLiveDiagnostics.assignments || {});
      var value = [
        'v=' + encodeURIComponent(SCRIPT_VERSION),
        'loaded=1',
        'tests=' + encodeURIComponent(String(_ripxLiveDiagnostics.runtime.activeTestsCount || 0)),
        'assigned=' + encodeURIComponent(assigned.join('|')),
        'preview=' + encodeURIComponent(PREVIEW_MODE ? '1' : '0'),
        'ts=' + encodeURIComponent(String(Date.now())),
      ].join('&');
      document.cookie =
        RIPX_LIVE_DIAGNOSTICS_COOKIE +
        '=' +
        value.slice(0, 900) +
        ';max-age=1800;path=/;SameSite=Lax';
    } catch (_eCookie) {}
  }

  function persistRipxLiveDiagnostics(eventName, detail) {
    try {
      var canPersistDiagnostics =
        !consentRequired || hasConsent() || PREVIEW_MODE || FORCE_LIVE_MODE;
      _ripxLiveDiagnostics.href = getSanitizedCurrentUrl() || _ripxLiveDiagnostics.href;
      _ripxLiveDiagnostics.pathname = window.location.pathname || '';
      _ripxLiveDiagnostics.updatedAt = new Date().toISOString();
      _ripxLiveDiagnostics.timing = _ripxTiming;
      _ripxLiveDiagnostics.runtime.activeTestsCount = (CONFIG.activeTests || []).length;
      _ripxLiveDiagnostics.runtime.activeTestIds = (CONFIG.activeTests || [])
        .map(function (t) {
          return t && t.id;
        })
        .filter(Boolean);
      _ripxLiveDiagnostics.antiFlicker = getAntiFlickerDiagnostics();
      if (eventName) {
        _ripxLiveDiagnostics.events.push({
          at: _ripxLiveDiagnostics.updatedAt,
          event: eventName,
          detail: detail || null,
        });
        if (_ripxLiveDiagnostics.events.length > RIPX_LIVE_DIAGNOSTICS_MAX_EVENTS) {
          _ripxLiveDiagnostics.events = _ripxLiveDiagnostics.events.slice(
            -RIPX_LIVE_DIAGNOSTICS_MAX_EVENTS
          );
        }
      }
      var snapshot = getRipxLiveDiagnosticsSnapshot();
      if (canPersistDiagnostics) {
        try {
          if (window.sessionStorage) {
            window.sessionStorage.setItem(RIPX_LIVE_DIAGNOSTICS_KEY, JSON.stringify(snapshot));
          }
        } catch (_eSession) {}
        try {
          if (window.localStorage) {
            window.localStorage.setItem(RIPX_LIVE_DIAGNOSTICS_KEY, JSON.stringify(snapshot));
            var rawHistory = window.localStorage.getItem(RIPX_LIVE_DIAGNOSTICS_HISTORY_KEY);
            var history = rawHistory ? JSON.parse(rawHistory) : [];
            if (!Array.isArray(history)) history = [];
            history.push({
              at: snapshot.updatedAt,
              href: snapshot.href,
              activeTestsCount: snapshot.runtime.activeTestsCount,
              assignedTestIds: Object.keys(snapshot.assignments || {}),
              previewMode: snapshot.preview.mode,
              lastEvent: eventName || null,
            });
            window.localStorage.setItem(
              RIPX_LIVE_DIAGNOSTICS_HISTORY_KEY,
              JSON.stringify(history.slice(-25))
            );
          }
        } catch (_eLocal) {}
        writeRipxDiagnosticsCookie();
      } else {
        try {
          _ripxLiveDiagnostics.persistenceSkipped = {
            reason: 'consent_required',
            at: _ripxLiveDiagnostics.updatedAt,
          };
          if (window.sessionStorage) {
            window.sessionStorage.removeItem(RIPX_LIVE_DIAGNOSTICS_KEY);
          }
          if (window.localStorage) {
            window.localStorage.removeItem(RIPX_LIVE_DIAGNOSTICS_KEY);
          }
        } catch (_eClearDiag) {}
      }
      snapshot = getRipxLiveDiagnosticsSnapshot();
      try {
        window.__RIPX_LIVE_DIAGNOSTICS__ = snapshot;
      } catch (_eGlobal) {}
      try {
        if (
          typeof window.CustomEvent === 'function' &&
          typeof window.dispatchEvent === 'function'
        ) {
          window.dispatchEvent(
            new CustomEvent('ripx:diagnostics', {
              detail: { event: eventName || 'snapshot', diagnostics: snapshot },
            })
          );
        }
      } catch (_eEvent) {}
      if (DEBUG && eventName) debugLog('diagnostics:', eventName, detail || {});
      return snapshot;
    } catch (_ePersist) {
      return _ripxLiveDiagnostics;
    }
  }

  function recordRipxAssignment(testId, variant, reason) {
    var key = testId != null ? String(testId) : '';
    if (!key) return;
    var sanitized = sanitizeDiagnosticVariant(variant);
    _ripxLiveDiagnostics.assignments[key] = Object.assign({}, sanitized || {}, {
      reason: reason || 'assigned',
      at: new Date().toISOString(),
    });
    persistRipxLiveDiagnostics('assignment:' + (reason || 'assigned'), {
      testId: key,
      variant: sanitized,
    });
  }

  function recordRipxSkip(testId, reason, detail) {
    var key = testId != null ? String(testId) : 'runtime';
    _ripxLiveDiagnostics.skips[key] = {
      reason: reason || 'unknown',
      detail: detail || null,
      at: new Date().toISOString(),
    };
    persistRipxLiveDiagnostics('skip:' + (reason || 'unknown'), {
      testId: key,
      detail: detail || null,
    });
  }

  // Persist preview so Shopify password redirects / in-theme navigation keep test+variant.
  // ab_preview_test alone (without ab_preview=1) still enables preview; session must survive losing query params.
  if (PREVIEW_MODE && (PREVIEW_TEST_ID || PREVIEW_VARIANT_ID || PREVIEW_VARIANT_NAME)) {
    writePersistedPreviewCtx({
      preview: true,
      testId: PREVIEW_TEST_ID || null,
      testType: PREVIEW_TEST_TYPE || null,
      variantId: PREVIEW_VARIANT_ID || null,
      variantName: PREVIEW_VARIANT_NAME || null,
      tenantDomain: PREVIEW_TENANT_DOMAIN || null,
      simple: PREVIEW_SIMPLE_MODE,
      sessionId: PREVIEW_SESSION_ID || null,
    });
    if (
      windowNamePreview &&
      (HAS_URL_PREVIEW_CTX || (persistedPreview && persistedPreview.preview))
    ) {
      clearWindowNamePreviewCtx();
    }
  }

  function cleanSimplePreviewUrlAfterSeed() {
    if (!PREVIEW_SIMPLE_MODE || !HAS_URL_PREVIEW_CTX) return;
    if (!window.history || typeof window.history.replaceState !== 'function') return;
    try {
      var current = new URL(window.location.href || '', window.location.origin);
      if (current.searchParams.get('url')) return;
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
      ].forEach(function (key) {
        current.searchParams.delete(key);
      });
      var cleanPath = current.pathname + current.search + current.hash;
      window.history.replaceState(window.history.state || null, document.title || '', cleanPath);
      try {
        window.__RIPX_SIMPLE_PREVIEW_CLEAN_URL__ = {
          cleaned: true,
          at: Date.now(),
          href: current.toString(),
          reset: PREVIEW_RESET_SESSION,
          sessionId: PREVIEW_SESSION_ID || null,
        };
      } catch (_eCleanStatus) {}
    } catch (_eCleanUrl) {}
  }
  cleanSimplePreviewUrlAfterSeed();

  function whenConsent(cb) {
    // Preview QA must run without waiting for marketing consent (otherwise RipX never mounts).
    if (
      hasConsent() ||
      PREVIEW_MODE ||
      PREVIEW_TEST_CONTEXT ||
      (PREVIEW_TEST_ID && (PREVIEW_VARIANT_ID || PREVIEW_VARIANT_NAME))
    ) {
      cb();
      return;
    }
    window.ripx_consent_callback = function () {
      cb();
      ensureBatchFetched();
    };
  }

  function resolvePreviewLooksLikeShipping(variant) {
    var hintedType = String(PREVIEW_TEST_TYPE || '')
      .trim()
      .toLowerCase();
    if (hintedType === 'shipping') return true;
    if (hintedType === 'price' || hintedType === 'offer' || hintedType === 'checkout') {
      return false;
    }
    var previewTest = PREVIEW_TEST_ID ? getActiveTestById(PREVIEW_TEST_ID) : null;
    if (previewTest && testTypeIsShipping(previewTest)) return true;
    var embeddedPreviewConfig =
      EMBEDDED_PREVIEW_VARIANT &&
      EMBEDDED_PREVIEW_VARIANT.config &&
      typeof EMBEDDED_PREVIEW_VARIANT.config === 'object'
        ? EMBEDDED_PREVIEW_VARIANT.config
        : null;
    if (embeddedPreviewConfig && configLooksLikeShipping(embeddedPreviewConfig)) return true;
    var cachedPreview =
      PREVIEW_TEST_ID && typeof readPreviewVariantCache === 'function'
        ? readPreviewVariantCache(PREVIEW_TEST_ID)
        : null;
    var cachedConfig =
      cachedPreview && cachedPreview.config && typeof cachedPreview.config === 'object'
        ? cachedPreview.config
        : null;
    if (cachedConfig && configLooksLikeShipping(cachedConfig)) return true;
    var variantConfig =
      variant && variant.config && typeof variant.config === 'object' ? variant.config : null;
    return !!(variantConfig && configLooksLikeShipping(variantConfig));
  }

  function isRipxShippingCartState(state) {
    return !!(state && state.__ripx_shipping_test);
  }

  function shouldUseLightweightShippingPreviewPdpHandoff() {
    if (!(PREVIEW_MODE && PREVIEW_SIMPLE_MODE && PREVIEW_TEST_ID)) return false;
    if (!isPdpProductPath() || isCartSurface()) return false;
    var hintedType = String(PREVIEW_TEST_TYPE || '')
      .trim()
      .toLowerCase();
    if (hintedType === 'shipping') return true;
    if (hintedType === 'price' || hintedType === 'offer' || hintedType === 'checkout') {
      return false;
    }
    return resolvePreviewLooksLikeShipping(null);
  }

  function buildShippingAssignmentKey(test, variant) {
    if (!test || !variant) return '';
    var variantIdForCart = resolveShippingVariantIdForCart(variant);
    if (!variantIdForCart) return '';
    var proof = getAssignmentProofFromVariant(variant);
    return [
      String(test.id || ''),
      String(variantIdForCart),
      proof && proof.sig ? String(proof.sig) : '',
      proof && proof.ts ? String(proof.ts) : '',
    ].join('\u0001');
  }

  function finalizeShippingPreviewCartHandoff(test, variant, reason) {
    if (!test || !variant || !testTypeIsShipping(test)) return false;
    var handoffReason = reason || 'finalize';
    injectShippingTestCartAttributes(test, variant, {
      reason: handoffReason,
      force: true,
      lightweight: false,
      skipRepairBurst: shouldUseLightweightShippingPreviewPdpHandoff() && !isCartSurface(),
      // Checkout guard performs one forced cart-level sync after state is finalized.
      skipCartSync: handoffReason === 'checkout-start',
    });
    _ripxShippingPreviewHandoffDeferred = false;
    return true;
  }

  /**
   * Seed cart attributes as early as possible in preview mode.
   * This avoids races where add-to-cart fires before the main init flow finishes.
   */
  function bootstrapPreviewCartAttributeSeed(variant, reason) {
    if (!PREVIEW_MODE || !PREVIEW_TEST_ID) return false;
    var earlyVariantId = PREVIEW_VARIANT_ID || PREVIEW_VARIANT_NAME;
    if (!earlyVariantId) return false;
    try {
      if (resolvePreviewLooksLikeShipping(variant)) {
        var previewTest = getActiveTestById(PREVIEW_TEST_ID);
        var shippingTest =
          previewTest && testTypeIsShipping(previewTest)
            ? previewTest
            : makeSyntheticPreviewShippingTest();
        if (!shippingTest) return false;
        injectShippingTestCartAttributes(
          shippingTest,
          variant && (variant.variantId != null || variant.id != null)
            ? variant
            : {
                variantId: earlyVariantId,
                id: earlyVariantId,
                variantName: PREVIEW_VARIANT_NAME || earlyVariantId,
                assignment_sig: variant && variant.assignment_sig,
                assignment_ts: variant && variant.assignment_ts,
                assignment_user: variant && variant.assignment_user,
              },
          {
            reason: reason || 'preview_seed',
            lightweight: shouldUseLightweightShippingPreviewPdpHandoff(),
          }
        );
        recordShippingDebugStep('preview_cart_seed_shipping', {
          reason: reason || 'preview_seed',
          testId: PREVIEW_TEST_ID,
          variant: earlyVariantId,
        });
        return true;
      }
      // Seed test+variant only — never claim direct_price_override without a resolved
      // target unit (that blocks checkout readiness and confuses ATC diagnostics).
      injectPriceTestCartAttributes(PREVIEW_TEST_ID, earlyVariantId, null, null, null, null);
      return true;
    } catch (eSeed) {
      if (DEBUG) {
        debugLog(
          'preview cart-attr seed failed:',
          reason || 'preview_seed',
          eSeed && eSeed.message
        );
      }
      return false;
    }
  }

  function seedPreviewCartAttributesEarly() {
    bootstrapPreviewCartAttributeSeed(null, 'early_seed');
  }
  function prewarmPreviewVariantFetch() {
    if (!(PREVIEW_MODE && PREVIEW_TEST_ID) || !hasValidConfig) return;
    try {
      var cached = readPreviewVariantCache(PREVIEW_TEST_ID);
      if (cached && cached.config && typeof cached.config === 'object') return;
      getPreviewVariantSingleFlight(PREVIEW_TEST_ID).catch(function () {});
    } catch (_ePrewarm) {}
  }
  function withPreviewQueryParams(urlValue) {
    var raw = urlValue ? String(urlValue).trim() : '';
    if (!raw) return '';
    try {
      var parsed = new URL(raw, window.location.origin);
      if (PREVIEW_MODE) parsed.searchParams.set('ab_preview', '1');
      if (PREVIEW_SIMPLE_MODE) parsed.searchParams.set('ab_preview_simple', '1');
      if (PREVIEW_TEST_ID) parsed.searchParams.set('ab_preview_test', String(PREVIEW_TEST_ID));
      if (PREVIEW_TEST_TYPE)
        parsed.searchParams.set('ab_preview_test_type', String(PREVIEW_TEST_TYPE));
      if (PREVIEW_VARIANT_ID)
        parsed.searchParams.set('ab_preview_variant', String(PREVIEW_VARIANT_ID));
      if (PREVIEW_VARIANT_NAME) {
        parsed.searchParams.set('ab_preview_variant_name', String(PREVIEW_VARIANT_NAME));
      }
      if (PREVIEW_TENANT_DOMAIN)
        parsed.searchParams.set('ab_preview_domain', String(PREVIEW_TENANT_DOMAIN));
      if (PREVIEW_SESSION_ID)
        parsed.searchParams.set('ab_preview_session', String(PREVIEW_SESSION_ID));
      return parsed.toString();
    } catch (_e) {
      return raw;
    }
  }
  const PRICE_PREVIEW_FRAME = !!window.__RIPX_PRICE_PREVIEW_FRAME__;
  function getPricePreviewTargetPath() {
    if (!PRICE_PREVIEW_FRAME) return '';
    try {
      var rawTarget = URL_PARAMS.get('url') || '';
      if (!rawTarget) return '';
      var parsedTarget = new URL(rawTarget, window.location.origin);
      return parsedTarget.pathname + parsedTarget.search;
    } catch (_e) {
      return '';
    }
  }
  const PRICE_PREVIEW_TARGET_PATH = getPricePreviewTargetPath();
  function toPreviewBootstrapUrl(urlValue) {
    var withCtx = withPreviewQueryParams(urlValue || window.location.href);
    if (!withCtx) return '';
    try {
      var parsed = new URL(withCtx, window.location.origin);
      if (!/\.myshopify\.com$/i.test(String(parsed.hostname || ''))) return parsed.toString();
      var p = String(parsed.pathname || '').toLowerCase();
      if (
        p.indexOf('/apps/ripx/preview-bootstrap') === 0 ||
        p.indexOf('/apps/ripx/preview-bootstrap-v2') === 0 ||
        p.indexOf('/apps/ripx/price-preview-bootstrap-v1') === 0
      )
        return parsed.toString();
      if (PREVIEW_SIMPLE_MODE) return parsed.toString();
      if (PRICE_PREVIEW_FRAME) return parsed.toString();
      return (
        'https://' +
        parsed.hostname +
        '/apps/ripx/preview-bootstrap-v2?url=' +
        encodeURIComponent(parsed.toString())
      );
    } catch (_e) {
      return withCtx;
    }
  }
  function toShopifyReturnToPath(urlValue) {
    var raw = urlValue ? String(urlValue).trim() : '';
    if (!raw) return '';
    try {
      var parsed = new URL(raw, window.location.origin);
      if (
        String(parsed.hostname || '').toLowerCase() ===
        String(window.location.hostname || '').toLowerCase()
      ) {
        return parsed.pathname + parsed.search + parsed.hash;
      }
      return raw;
    } catch (_e) {
      return raw;
    }
  }
  function schedulePreviewBootstrapReloadAfterCartAdd(reason) {
    if (!PREVIEW_MODE) return;
    if (PREVIEW_SIMPLE_MODE) return;
    // The isolated price-preview runner owns iframe navigation and re-injection.
    // Reloading the frame into the generic bootstrap would reintroduce the old escape path.
    if (PRICE_PREVIEW_FRAME) return;
    setTimeout(function () {
      try {
        var next = toPreviewBootstrapUrl(window.location.href);
        if (!next) return;
        if (DEBUG) debugLog('preview cart-add bootstrap reload:', reason || 'cart-add', next);
        window.location.replace(next);
      } catch (_e) {}
    }, 25);
  }
  seedPreviewCartAttributesEarly();
  prewarmPreviewVariantFetch();

  const VISUAL_PICKER_MODE = getPreviewParam('ab_visual_picker') === '1';
  const PRICE_SURFACE_PICK_MODE = getPreviewParam('ab_price_surface_pick') === '1';
  const AB_VISUAL_EDITOR =
    getPreviewParam('ab_visual_editor') === '1' || !!(CONFIG.visualEditor === true);
  const IN_IFRAME = typeof window.parent !== 'undefined' && window.self !== window.top;
  const HAS_VISUAL_PICKER_OPENER = (function () {
    try {
      return !!(window.opener && !window.opener.closed);
    } catch (_eOpener) {
      return false;
    }
  })();
  const VISUAL_EDITOR_EMBED = AB_VISUAL_EDITOR && IN_IFRAME;
  const PREVIEW_DOCUMENT_PROXY = (function () {
    try {
      var path = String(window.location.pathname || '').toLowerCase();
      if (path.indexOf('/track/preview-document') !== -1) return true;
      var nestedTarget = URL_PARAMS.get('url') || '';
      if (!nestedTarget) return false;
      var shopHost = String(CONFIG.shopDomain || PREVIEW_TENANT_DOMAIN || '')
        .trim()
        .toLowerCase();
      var currentHost = String(window.location.hostname || '')
        .trim()
        .toLowerCase();
      return !!(shopHost && currentHost && currentHost !== shopHost);
    } catch (_eProxy) {
      return false;
    }
  })();
  function withVisualPickerQueryParams(urlValue) {
    var raw = withPreviewQueryParams(urlValue);
    if (!raw) return '';
    try {
      var parsed = new URL(raw, window.location.origin);
      if (AB_VISUAL_EDITOR || VISUAL_PICKER_MODE) parsed.searchParams.set('ab_visual_editor', '1');
      if (VISUAL_PICKER_MODE) parsed.searchParams.set('ab_visual_picker', '1');
      if (PRICE_SURFACE_PICK_MODE) parsed.searchParams.set('ab_price_surface_pick', '1');
      return parsed.toString();
    } catch (_ePickerParams) {
      return raw;
    }
  }
  function resolvePreviewDocumentApiUrl() {
    var configured =
      CONFIG && CONFIG.previewDocumentApiUrl ? String(CONFIG.previewDocumentApiUrl).trim() : '';
    if (configured) return configured;
    var apiUrl = CONFIG && CONFIG.apiUrl ? String(CONFIG.apiUrl).trim().replace(/\/+$/, '') : '';
    if (!apiUrl) return '';
    return apiUrl + '/track/preview-document';
  }
  /** Visual picker runs in the editor iframe, picker modal, or preview-document proxy tabs. */
  const VISUAL_PICKER_ACTIVE =
    VISUAL_PICKER_MODE &&
    (IN_IFRAME ||
      HAS_VISUAL_PICKER_OPENER ||
      PREVIEW_DOCUMENT_PROXY ||
      !!window.__RIPX_FORCE_PICKER__);

  /**
   * Generate or retrieve user ID
   */
  function getUserId() {
    if (consentRequired && !hasConsent()) return null;
    let userId = getCookie(CONFIG.cookieName);
    let storedUserId = null;
    try {
      storedUserId = window.localStorage && window.localStorage.getItem(LIVE_USER_STORAGE_KEY);
      if (storedUserId) storedUserId = String(storedUserId).trim();
    } catch (_eStoredUser) {
      storedUserId = null;
    }

    if (!userId && storedUserId) {
      userId = storedUserId;
      setCookie(CONFIG.cookieName, userId, CONFIG.cookieExpiry);
    }

    if (!userId) {
      userId = 'user_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11);
      setCookie(CONFIG.cookieName, userId, CONFIG.cookieExpiry);
    }

    try {
      if (window.localStorage && userId) {
        window.localStorage.setItem(LIVE_USER_STORAGE_KEY, userId);
      }
    } catch (_eMirrorUser) {}

    // If another same-origin tab wrote the cookie/localStorage at almost the same time, prefer it.
    try {
      userId =
        getCookie(CONFIG.cookieName) ||
        (window.localStorage && window.localStorage.getItem(LIVE_USER_STORAGE_KEY)) ||
        userId;
    } catch (_eRereadUser) {}

    return userId;
  }

  function getDeviceType() {
    return window.innerWidth <= 768 ? 'mobile' : 'desktop';
  }

  function getOperatingSystem() {
    const ua = (navigator.userAgent || navigator.platform || '').toLowerCase();
    if (/iphone|ipad|ipod/.test(ua)) return 'ios';
    if (/android/.test(ua)) return 'android';
    if (/macintosh|mac os x/.test(ua)) return 'macos';
    if (/windows/.test(ua)) return 'windows';
    if (/linux/.test(ua)) return 'linux';
    return 'other';
  }

  function getCustomerType() {
    if (consentRequired && !hasConsent()) return 'new';
    const key = 'ab_test_returning';
    const existing = getCookie(key);
    if (existing) {
      return 'returning';
    }
    setCookie(key, '1', CONFIG.cookieExpiry);
    return 'new';
  }

  function getCountryCode() {
    if (window.Shopify?.country) {
      return window.Shopify.country;
    }
    const language = navigator.language || '';
    const parts = language.split('-');
    return parts.length > 1 ? parts[1].toUpperCase() : '';
  }

  /**
   * Detect traffic source from UTM params and referrer
   */
  function getTrafficSource() {
    const params = new URLSearchParams(window.location.search);
    const utmSource = (params.get('utm_source') || '').toLowerCase();
    const utmMedium = (params.get('utm_medium') || '').toLowerCase();
    const referrer = (document.referrer || '').toLowerCase();

    if (utmMedium === 'sms') return 'sms';
    if (utmMedium === 'email') return 'email';
    if (utmMedium === 'shopping') return 'paid_shopping';
    if (utmMedium.indexOf('social') !== -1 && /(cpc|ppc|paid|cpv|cpm)/.test(utmMedium)) {
      return 'paid_social';
    }
    if (utmMedium.indexOf('social') !== -1) return 'organic_social';
    if (
      ['cpc', 'ppc', 'paid', 'cpv', 'cpm'].some(function (m) {
        return utmMedium.indexOf(m) !== -1;
      })
    )
      return 'paid_search';
    if (utmSource.indexOf('google') !== -1 || referrer.indexOf('google.') !== -1) return 'google';
    if (utmSource.indexOf('facebook') !== -1 || referrer.indexOf('facebook.') !== -1)
      return 'facebook';
    if (utmSource.indexOf('instagram') !== -1 || referrer.indexOf('instagram.') !== -1)
      return 'instagram';
    if (utmSource.indexOf('tiktok') !== -1 || referrer.indexOf('tiktok.') !== -1) return 'tiktok';
    if (
      utmSource.indexOf('twitter') !== -1 ||
      referrer.indexOf('twitter.') !== -1 ||
      referrer.indexOf('x.com') !== -1
    )
      return 'twitter';
    if (utmSource.indexOf('youtube') !== -1 || referrer.indexOf('youtube.') !== -1)
      return 'youtube';
    if (
      [
        'facebook',
        'twitter',
        'instagram',
        'linkedin',
        'pinterest',
        'tiktok',
        'youtube',
        'reddit',
      ].some(function (s) {
        return utmSource.indexOf(s) !== -1 || referrer.indexOf(s) !== -1;
      })
    )
      return 'organic_social';

    if (!referrer) return 'direct';
    try {
      const refHost = new URL(referrer).hostname.toLowerCase();
      const searchEngines = ['google', 'bing', 'yahoo', 'duckduckgo', 'baidu', 'yandex'];
      if (
        searchEngines.some(function (e) {
          return refHost.indexOf(e) !== -1;
        })
      )
        return 'organic_search';
    } catch (e) {}
    return 'referral';
  }

  /**
   * Get and increment session count for min_sessions targeting (once per page load)
   */
  var _sessionCountIncremented = false;
  function getAndIncrementSessionCount() {
    const key = 'ab_test_session_count';
    if (!_sessionCountIncremented) {
      _sessionCountIncremented = true;
      var count = parseInt(getCookie(key), 10) || 0;
      count += 1;
      setCookie(key, String(count), CONFIG.cookieExpiry);
      return count;
    }
    return parseInt(getCookie(key), 10) || 0;
  }

  /**
   * Get shop domain
   */
  function getShopDomain() {
    return CONFIG.shopDomain || window.Shopify?.shop || document.domain;
  }

  /**
   * Match /track/ping: Shopify tenants use shop_domain=, standalone uses site= (both resolve the same tenant).
   * @param {URLSearchParams} params
   */
  function appendTrackTenantParams(params) {
    var d = PREVIEW_MODE && PREVIEW_TENANT_DOMAIN ? PREVIEW_TENANT_DOMAIN : getShopDomain();
    if (!d || !params) return params;
    var dom = String(d).toLowerCase();
    if (dom.indexOf('.myshopify.com') !== -1) {
      // Dual-write: server resolveShop historically only read `shop` / header.
      params.set('shop_domain', d);
      params.set('shop', d);
    } else {
      params.set('site', d);
      params.set('shop_domain', d);
    }
    return params;
  }

  /**
   * Evaluate JS targeting code safely. Code must return boolean.
   * Has access to: location, document, navigator, window, Shopify, getDeviceType, getCountryCode, etc.
   */
  function evaluateJsTargeting(testId, code) {
    if (!code || typeof code !== 'string' || !code.trim()) return true;
    try {
      const fn = new Function(
        'location',
        'document',
        'navigator',
        'window',
        'getDeviceType',
        'getCountryCode',
        'getTrafficSource',
        'return (function(){ ' + code + ' })();'
      );
      const result = fn(
        window.location,
        document,
        navigator,
        window,
        getDeviceType,
        getCountryCode,
        getTrafficSource
      );
      return result === true;
    } catch (e) {
      console.warn('[RipX] JS targeting error for test ' + testId + ':', e);
      return false;
    }
  }

  // Batch variant cache: pre-fetch live assignments before per-test application starts.
  // Backend caps /track/variants at 50 test IDs; chunk client-side so every running test can still bucket.
  const LIVE_VARIANT_BATCH_SIZE = 50;
  const LIVE_VARIANT_CHUNK_CONCURRENCY = 3;
  var _variantCachePromise = null;
  /** Single in-flight GET /track/preview per page (main loop + visual preview + reapply share it). */
  var _previewVariantInflight = null;
  var _previewVariantInflightKey = '';
  var _previewVariantCacheByTestId = {};
  var _ripxInitStarted = false;
  var _ripxPreviewStabilityTimer = null;
  function getPreviewVariantScopeKey() {
    return [String(PREVIEW_VARIANT_ID || ''), String(PREVIEW_VARIANT_NAME || '')].join('\u0001');
  }
  function getPreviewVariantCacheStorageKey(testId) {
    return (
      'ripx_preview_variant_cache_v2_' +
      String(testId || '') +
      '__' +
      encodeURIComponent(getPreviewVariantScopeKey())
    );
  }
  function writePreviewVariantCache(testId, variant) {
    if (!variant || !variant.config || typeof variant.config !== 'object') return;
    var key = String(testId || '');
    if (!key) return;
    var payload = { variant: variant, persistedAtMs: Date.now(), scope: getPreviewVariantScopeKey() };
    // Memory key must include arm scope — otherwise Variation A paints from a Control cache.
    _previewVariantCacheByTestId[key + '\u0001' + getPreviewVariantScopeKey()] = payload;
    _previewVariantCacheByTestId[key] = payload;
    try {
      if (window.sessionStorage) {
        window.sessionStorage.setItem(
          getPreviewVariantCacheStorageKey(key),
          JSON.stringify(payload)
        );
      }
    } catch (_) {}
  }
  function readPreviewVariantCache(testId) {
    var key = String(testId || '');
    if (!key) return null;
    var scope = getPreviewVariantScopeKey();
    var scopedKey = key + '\u0001' + scope;
    var inMemory =
      (_previewVariantCacheByTestId && _previewVariantCacheByTestId[scopedKey]) ||
      (_previewVariantCacheByTestId &&
      _previewVariantCacheByTestId[key] &&
      String(_previewVariantCacheByTestId[key].scope || '') === scope
        ? _previewVariantCacheByTestId[key]
        : null);
    if (
      inMemory &&
      inMemory.variant &&
      inMemory.persistedAtMs &&
      Date.now() - Number(inMemory.persistedAtMs) <= PREVIEW_VARIANT_CACHE_MAX_AGE_MS
    ) {
      return inMemory.variant;
    }
    if (_previewVariantCacheByTestId) {
      if (_previewVariantCacheByTestId[scopedKey]) delete _previewVariantCacheByTestId[scopedKey];
      if (
        _previewVariantCacheByTestId[key] &&
        String(_previewVariantCacheByTestId[key].scope || '') === scope
      ) {
        delete _previewVariantCacheByTestId[key];
      }
    }
    try {
      if (window.sessionStorage) {
        var raw = window.sessionStorage.getItem(getPreviewVariantCacheStorageKey(key));
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && parsed.variant && parsed.persistedAtMs) {
            if (Date.now() - Number(parsed.persistedAtMs) <= PREVIEW_VARIANT_CACHE_MAX_AGE_MS) {
              if (
                parsed.variant &&
                parsed.variant.config &&
                typeof parsed.variant.config === 'object'
              ) {
                parsed.scope = scope;
                _previewVariantCacheByTestId[scopedKey] = parsed;
                _previewVariantCacheByTestId[key] = parsed;
                return parsed.variant;
              }
            } else {
              window.sessionStorage.removeItem(getPreviewVariantCacheStorageKey(key));
            }
          } else if (parsed && parsed.config && typeof parsed.config === 'object') {
            // Backward compatibility with old cache shape (raw variant object).
            writePreviewVariantCache(key, parsed);
            return parsed;
          }
        }
      }
    } catch (_) {}
    return null;
  }
  function getLiveVariantCacheStorageKey(testId) {
    return (
      'ripx_live_variant_cache_v1_' +
      encodeURIComponent(String(getShopDomain() || '')) +
      '__' +
      encodeURIComponent(String(getUserId() || '')) +
      '__' +
      encodeURIComponent(String(SCRIPT_VERSION || '')) +
      '__' +
      encodeURIComponent(String(testId || ''))
    );
  }
  function writeLiveVariantCache(testId, variant) {
    var key = String(testId || '');
    if (!key || !variant || typeof variant !== 'object') return;
    try {
      if (!window.sessionStorage) return;
      window.sessionStorage.setItem(
        getLiveVariantCacheStorageKey(key),
        JSON.stringify({
          testId: key,
          shopDomain: getShopDomain() || '',
          userId: getUserId() || '',
          scriptVersion: SCRIPT_VERSION,
          variant: normalizeVariantForStorefront(variant),
          persistedAtMs: Date.now(),
        })
      );
    } catch (_eLiveWrite) {}
  }
  function writeLiveVariantCacheMap(variants) {
    if (!variants || typeof variants !== 'object') return;
    Object.keys(variants).forEach(function (testId) {
      writeLiveVariantCache(testId, variants[testId]);
    });
  }
  function readLiveVariantCache(testId) {
    var key = String(testId || '');
    if (!key || PREVIEW_MODE) return null;
    try {
      if (!window.sessionStorage) return null;
      var raw = window.sessionStorage.getItem(getLiveVariantCacheStorageKey(key));
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      var persistedAtMs = Number(parsed && parsed.persistedAtMs);
      if (!persistedAtMs || Date.now() - persistedAtMs > LIVE_VARIANT_CACHE_MAX_AGE_MS) {
        window.sessionStorage.removeItem(getLiveVariantCacheStorageKey(key));
        return null;
      }
      if (String((parsed && parsed.testId) || '') !== key) return null;
      if (String((parsed && parsed.shopDomain) || '') !== String(getShopDomain() || ''))
        return null;
      if (String((parsed && parsed.userId) || '') !== String(getUserId() || '')) return null;
      if (String((parsed && parsed.scriptVersion) || '') !== String(SCRIPT_VERSION || '')) {
        return null;
      }
      if (!parsed.variant || typeof parsed.variant !== 'object') return null;
      return normalizeVariantForStorefront(parsed.variant);
    } catch (_eLiveRead) {
      return null;
    }
  }
  /** Latest line-attribute payload to apply on theme AJAX cart/add requests. */
  var _ripxCartAttributeState = null;
  var _ripxShippingAssignmentKey = '';
  var _ripxShippingPreviewHandoffDeferred = false;
  var _ripxCartFormTargetProductIds = null;
  var _ripxTargetUnitByProductId = {};
  var _ripxDiscountUnitByProductId = {};
  var _ripxPriceMethodByProductId = {};
  var _ripxTargetUnitByVariantId = {};
  var _ripxDiscountUnitByVariantId = {};
  var _ripxPriceMethodByVariantId = {};
  var _ripxAssignedPriceByProductId = {};
  var _ripxAssignedPriceByVariantId = {};
  var _ripxPaintParityAudit = { checked: 0, ok: 0, mismatches: [], updatedAt: 0 };
  var _ripxPaintParityPublishTimer = null;
  var RIPX_PAINT_PARITY_TOLERANCE = 0.02;
  var RIPX_PAINT_PARITY_MAX_ISSUES = 12;
  var RIPX_PAINT_PARITY_PUBLISH_MS = 120;
  var _ripxCartFormObserverInstalled = false;
  var _ripxCartFormObserverTimer = null;
  var _ripxCartAddInterceptorsInstalled = false;
  var _ripxCartSubmitGuardsInstalled = false;
  var _ripxCartPropsRepairInFlight = null;
  var _ripxCartPropsRepairLastAt = 0;
  var _ripxCartLevelAttributeSyncInFlight = null;
  var _ripxCartLevelAttributeSyncLastAt = 0;
  var _ripxCartPropsRepairTimers = [];
  var _ripxCheckoutNavigationGuardsInstalled = false;
  var _ripxCartNativeState = {
    cart: null,
    fetchedAt: 0,
    hasDiscounts: false,
    uiMatches: false,
    expectedSubtotalCents: null,
    displayedSubtotalCents: null,
  };
  var _ripxCartNativeStateInFlight = null;
  var _ripxCartNativeStateTimer = null;
  var _ripxGlobalPaintScheduleAtByKey = {};
  var THEME_APPLY_RETRY_MS = 50;
  var THEME_APPLY_TIMEOUT_MS = 1200;
  function createRipxPaintStats() {
    return {
      since: Date.now(),
      lastEventAt: null,
      totals: { attempts: 0, textWrites: 0, attrWrites: 0, mutations: 0, unchanged: 0 },
      byScope: {},
      schedules: { requested: 0, deduped: 0, skippedCartDisabled: 0 },
    };
  }
  var _ripxPaintStats = createRipxPaintStats();
  function createRipxThemeStats() {
    return {
      since: Date.now(),
      lastEventAt: null,
      counters: {
        attempts: 0,
        applied: 0,
        retried: 0,
        timedOut: 0,
        fallbacks: 0,
      },
      fallbackReasons: {},
      lastDetail: null,
    };
  }
  var _ripxThemeStats = createRipxThemeStats();
  function recordThemeFallback(reason) {
    var key = reason && String(reason).trim() ? String(reason).trim() : 'unknown';
    _ripxThemeStats.counters.fallbacks += 1;
    if (!_ripxThemeStats.fallbackReasons[key]) _ripxThemeStats.fallbackReasons[key] = 0;
    _ripxThemeStats.fallbackReasons[key] += 1;
    _ripxThemeStats.lastEventAt = Date.now();
  }
  function getRipxThemeStatsSnapshot() {
    var now = Date.now();
    var counters = _ripxThemeStats.counters || {};
    var reasons = {};
    var keys = Object.keys(_ripxThemeStats.fallbackReasons || {});
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      reasons[key] = Number(_ripxThemeStats.fallbackReasons[key]) || 0;
    }
    return {
      sinceMs: Number(_ripxThemeStats.since) || now,
      sinceIso: new Date(Number(_ripxThemeStats.since) || now).toISOString(),
      elapsedMs: Math.max(0, now - (Number(_ripxThemeStats.since) || now)),
      lastEventAtMs:
        _ripxThemeStats.lastEventAt != null ? Number(_ripxThemeStats.lastEventAt) || null : null,
      lastEventAtIso:
        _ripxThemeStats.lastEventAt != null
          ? new Date(Number(_ripxThemeStats.lastEventAt)).toISOString()
          : null,
      counters: {
        attempts: Number(counters.attempts) || 0,
        applied: Number(counters.applied) || 0,
        retried: Number(counters.retried) || 0,
        timedOut: Number(counters.timedOut) || 0,
        fallbacks: Number(counters.fallbacks) || 0,
      },
      fallbackReasons: reasons,
      lastDetail:
        _ripxThemeStats.lastDetail && typeof _ripxThemeStats.lastDetail === 'object'
          ? Object.assign({}, _ripxThemeStats.lastDetail)
          : null,
    };
  }
  function resetRipxThemeStats() {
    _ripxThemeStats = createRipxThemeStats();
  }
  function debugThemeStats(options) {
    var opts = options && typeof options === 'object' ? options : {};
    if (opts.reset === true) {
      resetRipxThemeStats();
    }
    var snapshot = getRipxThemeStatsSnapshot();
    if (opts.log !== false && typeof console !== 'undefined') {
      if (console.groupCollapsed) console.groupCollapsed('[RipX] theme runtime stats');
      if (console.table) console.table([Object.assign({ scope: 'theme' }, snapshot.counters)]);
      if (console.log) {
        console.log('fallbackReasons', snapshot.fallbackReasons);
        console.log('lastDetail', snapshot.lastDetail);
      }
      if (console.groupEnd) console.groupEnd();
    }
    return { ok: true, stats: snapshot };
  }

  /**
   * Live price-test entry point.
   *
   * See `PRICE_TEST_FLOW.md` before changing this request contract. The backend uses the
   * context below for targeting, segmentation, diagnostics, and assignment signing.
   */
  function getVariantCachePromise() {
    if (_variantCachePromise) return _variantCachePromise;
    // Never bucket users from preview sessions.
    if (PREVIEW_MODE) {
      recordRipxSkip('runtime', 'preview_mode_blocks_live_batch', {
        previewTestId: PREVIEW_TEST_ID || null,
        simplePreview: PREVIEW_SIMPLE_MODE,
        sessionStoragePresent: !!(persistedPreview && persistedPreview.preview),
      });
      _variantCachePromise = Promise.resolve({});
      return _variantCachePromise;
    }
    if (!hasValidConfig || !CONFIG.activeTests || CONFIG.activeTests.length === 0) {
      recordRipxSkip('runtime', !hasValidConfig ? 'invalid_runtime_config' : 'no_active_tests', {
        hasApiUrl: !!CONFIG.apiUrl,
        activeTestsCount: CONFIG.activeTests ? CONFIG.activeTests.length : 0,
      });
      return Promise.resolve({});
    }
    if (consentRequired && !hasConsent()) {
      recordRipxSkip('runtime', 'consent_required', { consentRequired: true });
      return Promise.resolve({});
    }
    const userId = getUserId();
    const shopDomain = getShopDomain();
    const requestedTestIds = CONFIG.activeTests
      .map(function (t) {
        return t.id;
      })
      .filter(Boolean);
    const testIds = requestedTestIds.join(',');
    if (!requestedTestIds.length) {
      recordRipxSkip('runtime', 'no_active_test_ids', {
        activeTestsCount: CONFIG.activeTests ? CONFIG.activeTests.length : 0,
      });
      return Promise.resolve({});
    }
    const device = getDeviceType();
    const operatingSystem = getOperatingSystem();
    const customer = getCustomerType();
    const country = getCountryCode();
    const trafficSource = getTrafficSource();
    const currentUrl = window.location.href || '';
    const currentPathname =
      window.location.pathname != null && window.location.pathname !== ''
        ? window.location.pathname
        : '/';
    const sessionCount = getAndIncrementSessionCount();

    const jsTargetingResults = {};
    CONFIG.activeTests.forEach(function (t) {
      if (t.jsTargeting && t.jsTargeting.enabled && t.jsTargeting.code) {
        jsTargetingResults[t.id] = evaluateJsTargeting(t.id, t.jsTargeting.code);
      }
    });

    const urlParams = new URLSearchParams(window.location.search);
    const baseParams = new URLSearchParams({
      user_id: userId,
      shop_domain: shopDomain,
      device: device,
      operating_system: operatingSystem,
      customer: customer,
      country: country || '',
      traffic_source: trafficSource,
      current_url: currentUrl,
      current_pathname: currentPathname,
      session_count: String(sessionCount),
      referrer: document.referrer || '',
      utm_source: urlParams.get('utm_source') || '',
      utm_medium: urlParams.get('utm_medium') || '',
    });
    var cProductId = getCurrentProductId();
    var cCollectionId = getCurrentCollectionId();
    if (cProductId) baseParams.set('current_product_id', cProductId);
    if (cCollectionId) baseParams.set('current_collection_id', cCollectionId);
    if (Object.keys(jsTargetingResults).length > 0) {
      baseParams.set('js_targeting_results', JSON.stringify(jsTargetingResults));
    }
    baseParams.set('ripx_diag', 'live_batch');
    var variantRequestStartedAt = Date.now();
    markRipxTiming('variants_request_started', {
      requestedTestIds: requestedTestIds,
      chunkCount: Math.ceil(requestedTestIds.length / LIVE_VARIANT_BATCH_SIZE),
    });
    var testIdChunks = [];
    for (
      var chunkStart = 0;
      chunkStart < requestedTestIds.length;
      chunkStart += LIVE_VARIANT_BATCH_SIZE
    ) {
      testIdChunks.push(requestedTestIds.slice(chunkStart, chunkStart + LIVE_VARIANT_BATCH_SIZE));
    }
    persistRipxLiveDiagnostics('variants_request', {
      testIds: testIds,
      requestedTestIds: requestedTestIds,
      chunkCount: testIdChunks.length,
      productId: cProductId || null,
      collectionId: cCollectionId || null,
      pathname: currentPathname,
    });
    function fetchVariantChunk(chunkIds, chunkIndex) {
      var params = new URLSearchParams(baseParams.toString());
      params.set('test_ids', chunkIds.join(','));
      var variantsUrl = CONFIG.apiUrl + '/track/variants?' + params.toString();
      return fetchWithRetry(variantsUrl, { method: 'GET' }, 8000, 600)
        .then(function (r) {
          if (!r.ok) {
            recordRipxSkip('runtime', 'variants_request_http_error', {
              status: r.status,
              chunkIndex: chunkIndex,
              testIds: chunkIds,
            });
            return { variants: {}, diagnostics: null };
          }
          return r.json();
        })
        .then(function (data) {
          return {
            variants: (data && data.variants) || {},
            diagnostics: data && data.diagnostics ? data.diagnostics : null,
            chunkIndex: chunkIndex,
          };
        })
        .catch(function (err) {
          recordRipxSkip('runtime', 'variants_request_failed', {
            error: err && (err.message || err.name || String(err)),
            chunkIndex: chunkIndex,
            testIds: chunkIds,
          });
          return { variants: {}, diagnostics: null, chunkIndex: chunkIndex };
        });
    }
    function fetchVariantChunksWithConcurrency() {
      var results = [];
      var nextIndex = 0;
      var workerCount = Math.min(LIVE_VARIANT_CHUNK_CONCURRENCY, testIdChunks.length);
      function runWorker() {
        if (nextIndex >= testIdChunks.length) return Promise.resolve();
        var chunkIndex = nextIndex;
        nextIndex += 1;
        return fetchVariantChunk(testIdChunks[chunkIndex], chunkIndex).then(function (result) {
          results[chunkIndex] = result;
          return runWorker();
        });
      }
      var workers = [];
      for (var wi = 0; wi < workerCount; wi++) {
        workers.push(runWorker());
      }
      return Promise.all(workers).then(function () {
        return results.filter(Boolean);
      });
    }
    _variantCachePromise = fetchVariantChunksWithConcurrency()
      .then(function (results) {
        var variants = {};
        var backendDiagnostics = [];
        (results || []).forEach(function (result) {
          if (result && result.variants && typeof result.variants === 'object') {
            Object.keys(result.variants).forEach(function (testId) {
              variants[testId] = result.variants[testId];
            });
          }
          if (result && result.diagnostics) {
            backendDiagnostics.push(result.diagnostics);
          }
        });
        var safeVariants = sanitizeDiagnosticVariantsMap(variants);
        Object.keys(safeVariants).forEach(function (testId) {
          recordRipxAssignment(testId, safeVariants[testId], 'live_batch');
        });
        writeLiveVariantCacheMap(variants);
        persistRipxLiveDiagnostics('variants_response', {
          requestedTestIds: requestedTestIds,
          assignedTestIds: Object.keys(variants),
          missingAssignmentTestIds: requestedTestIds.filter(function (testId) {
            return !Object.prototype.hasOwnProperty.call(variants, testId);
          }),
          chunkCount: testIdChunks.length,
          chunkConcurrency: Math.min(LIVE_VARIANT_CHUNK_CONCURRENCY, testIdChunks.length),
          latencyMs: Date.now() - variantRequestStartedAt,
          variants: safeVariants,
          backendDiagnostics: backendDiagnostics,
        });
        markRipxTiming('variants_response_received', {
          assignedTestIds: Object.keys(variants),
          latencyMs: Date.now() - variantRequestStartedAt,
        });
        return variants;
      })
      .catch(function (err) {
        if (DEBUG) debugLog('variants fetch failed', err && (err.message || err.name));
        recordRipxSkip('runtime', 'variants_request_failed', {
          error: err && (err.message || err.name || String(err)),
        });
        return {};
      });
    return _variantCachePromise;
  }

  function ensureBatchFetched() {
    if (consentRequired && !hasConsent() && !PREVIEW_MODE) {
      recordRipxSkip('runtime', 'batch_waiting_for_consent', { consentRequired: true });
      return false;
    }
    getVariantCachePromise();
    return true;
  }

  function isPdpProductPath() {
    var path = getEffectivePreviewPathname();
    return path.indexOf('/products/') !== -1 && path.length > '/products/'.length + 1;
  }

  function deferPdpPriceApplyUntilProductId(
    test,
    variant,
    targetType,
    targetIds,
    shouldTrackAntiFlicker
  ) {
    if (!testTypeIsPrice(test) || !variant || !variant.config || !isPdpProductPath()) return false;
    var tt = String(targetType || '').toLowerCase();
    if (tt !== 'all-products' && tt !== 'all_products' && tt !== 'product' && tt !== 'collection') {
      return false;
    }
    var attempts = 0;
    var maxAttempts = 48;
    var ids = Array.isArray(targetIds) ? targetIds : [];
    var iv = setInterval(function () {
      attempts++;
      var cid = getCurrentProductId();
      if (cid) {
        clearInterval(iv);
        var shouldApply =
          tt === 'all-products' ||
          tt === 'all_products' ||
          (tt === 'product' &&
            // Empty targetIds means "any product" (same as matchesTarget). Preview synthetic
            // bootstraps use empty ids until real targets load — still paint this PDP.
            (!ids.length ||
              ids.some(function (id) {
                return id && gidMatches(id, cid);
              }))) ||
          (tt === 'collection' && ids.length && productBelongsToPriceTestCollections(ids));
        if (
          (tt === 'all-products' || tt === 'all_products' || tt === 'product') &&
          isExcludedProductForTest(test, cid)
        ) {
          shouldApply = false;
        }
        persistRipxLiveDiagnostics('price_apply:pdp_retry', {
          testId: test.id,
          productId: cid,
          targetType: tt,
          applied: !!shouldApply,
          variant: sanitizeDiagnosticVariant(variant),
        });
        if (shouldApply) {
          applyPriceTest(test.id, cid, test.targetVariantId || null, variant);
        }
        if (shouldTrackAntiFlicker) markAntiFlickerDone();
      } else if (attempts >= maxAttempts) {
        clearInterval(iv);
        if (DEBUG) {
          debugLog(
            'PDP: product id not resolved after retries — theme may defer ProductJson; try hard refresh.'
          );
        }
        persistRipxLiveDiagnostics('price_apply:pdp_retry_timeout', {
          testId: test.id,
          targetType: tt,
          attempts: attempts,
        });
        if (shouldTrackAntiFlicker) markAntiFlickerDone();
      }
    }, 125);
    return true;
  }

  function previewQueryMatchesVariantLabel(query, variant) {
    if (!variant || typeof variant !== 'object') return false;
    var q = String(query || '').trim();
    if (!q) return false;
    var variantId =
      variant.variantId != null
        ? String(variant.variantId).trim()
        : variant.id != null
          ? String(variant.id).trim()
          : '';
    var variantName = variant.variantName != null ? String(variant.variantName).trim() : '';
    if (variant.name != null && !variantName) variantName = String(variant.name).trim();
    if (variantId && variantId === q) return true;
    if (variantName && variantName.toLowerCase() === q.toLowerCase()) return true;
    return false;
  }

  function getEmbeddedPreviewVariant(testId) {
    if (!EMBEDDED_PREVIEW_VARIANT || String(testId) !== String(PREVIEW_TEST_ID)) return null;
    if (
      PREVIEW_VARIANT_ID &&
      !previewQueryMatchesVariantLabel(PREVIEW_VARIANT_ID, EMBEDDED_PREVIEW_VARIANT)
    ) {
      return null;
    }
    if (
      PREVIEW_VARIANT_NAME &&
      !previewQueryMatchesVariantLabel(PREVIEW_VARIANT_NAME, EMBEDDED_PREVIEW_VARIANT)
    ) {
      return null;
    }
    return normalizeVariantForStorefront(
      Object.assign({}, EMBEDDED_PREVIEW_VARIANT, { isPreview: true })
    );
  }

  /**
   * Get variant for a test
   */
  async function getVariant(testId) {
    if (!hasValidConfig) {
      return null;
    }
    if (PREVIEW_MODE && !PREVIEW_TEST_ID) {
      return null;
    }
    if (STRICT_PREVIEW_TEST_MODE && PREVIEW_TEST_ID === String(testId)) {
      var embeddedPreviewVariant = getEmbeddedPreviewVariant(testId);
      if (embeddedPreviewVariant) {
        return embeddedPreviewVariant;
      }
      var cachedPreviewVariant = readPreviewVariantCache(testId);
      if (cachedPreviewVariant) {
        getPreviewVariantSingleFlight(testId);
        return normalizeVariantForStorefront({
          ...cachedPreviewVariant,
          isPreview: true,
        });
      }
      const previewVariant = await getPreviewVariantSingleFlight(testId);
      if (previewVariant) {
        return normalizeVariantForStorefront({
          ...previewVariant,
          isPreview: true,
        });
      }

      if (DEBUG) {
        debugLog(
          'Preview variant fetch failed or empty config — check Network for /track/preview (CORS, 404).'
        );
      }
      return {
        variantId: PREVIEW_VARIANT_ID || null,
        variantName: PREVIEW_VARIANT_NAME || 'Control',
        isPreview: true,
      };
    }
    if (STRICT_PREVIEW_TEST_MODE) {
      return null;
    }

    const id = String(testId);

    var cachedLiveVariant = readLiveVariantCache(id);
    if (cachedLiveVariant) {
      // Keep the network refresh in flight, but do not hold page painting on repeat navigation.
      getVariantCachePromise();
      recordRipxAssignment(id, cachedLiveVariant, 'live_session_cache');
      return cachedLiveVariant;
    }

    try {
      const cache = await getVariantCachePromise();
      if (cache && typeof cache === 'object') {
        var fromCache = cache[id];
        if (fromCache === undefined || fromCache === null) {
          fromCache = cache[testId];
        }
        if (fromCache !== undefined && fromCache !== null)
          return normalizeVariantForStorefront(fromCache);
      }
    } catch (e) {
      console.error('Error getting variant from cache:', e);
    }

    const userId = getUserId();
    const shopDomain = getShopDomain();

    try {
      const device = getDeviceType();
      const operatingSystem = getOperatingSystem();
      const customer = getCustomerType();
      const country = getCountryCode();
      const trafficSource = getTrafficSource();
      const currentUrl = window.location.href || '';
      const currentPathname =
        window.location.pathname != null && window.location.pathname !== ''
          ? window.location.pathname
          : '/';
      const sessionCount = getAndIncrementSessionCount();

      const urlParams = new URLSearchParams(window.location.search);
      const params = new URLSearchParams({
        test_id: id,
        user_id: userId,
        shop_domain: shopDomain,
        device: device,
        operating_system: operatingSystem,
        customer: customer,
        country: country || '',
        traffic_source: trafficSource,
        current_url: currentUrl,
        current_pathname: currentPathname,
        session_count: String(sessionCount),
        referrer: document.referrer || '',
        utm_source: urlParams.get('utm_source') || '',
        utm_medium: urlParams.get('utm_medium') || '',
      });
      if (PREVIEW_MODE) {
        params.set('preview_session', '1');
      }
      var currentProductId = getCurrentProductId();
      var currentCollectionId = getCurrentCollectionId();
      if (currentProductId) {
        params.set('current_product_id', currentProductId);
      }
      if (currentCollectionId) {
        params.set('current_collection_id', currentCollectionId);
      }
      const testConfig = CONFIG.activeTests.find(function (t) {
        return String(t.id) === id;
      });
      if (
        testConfig &&
        testConfig.jsTargeting &&
        testConfig.jsTargeting.enabled &&
        testConfig.jsTargeting.code
      ) {
        params.set(
          'js_targeting_passed',
          String(evaluateJsTargeting(id, testConfig.jsTargeting.code))
        );
      }
      const response = await fetchWithTimeout(
        `${CONFIG.apiUrl}/track/variant?${params.toString()}`,
        { method: 'GET' },
        8000
      );

      if (response.ok) {
        const data = await response.json();
        return normalizeVariantForStorefront(data.variant);
      }
    } catch (error) {
      console.error('Error getting variant:', error);
    }

    return null;
  }

  /**
   * Coalesce parallel preview variant requests (same test + variant params).
   * @param {string} testId
   * @returns {Promise<object|null>}
   */
  function getPreviewVariantSingleFlight(testId) {
    var key =
      String(testId) +
      '\u0000' +
      (PREVIEW_VARIANT_ID || '') +
      '\u0000' +
      (PREVIEW_VARIANT_NAME || '');
    if (_previewVariantInflight && _previewVariantInflightKey === key) {
      return _previewVariantInflight;
    }
    var p = fetchPreviewVariant(testId);
    _previewVariantInflightKey = key;
    var wrapped = p.finally(function () {
      if (_previewVariantInflight === wrapped) {
        _previewVariantInflight = null;
        _previewVariantInflightKey = '';
      }
    });
    _previewVariantInflight = wrapped;
    return wrapped;
  }

  async function fetchPreviewVariant(testId) {
    if (!hasValidConfig) {
      return null;
    }

    try {
      const params = new URLSearchParams();
      params.set('test_id', testId);
      appendTrackTenantParams(params);
      var previewUserId = getUserId();
      if (!previewUserId) {
        if (!window.__RIPX_PREVIEW_USER_ID__) {
          window.__RIPX_PREVIEW_USER_ID__ =
            'ripx_preview_' + Math.random().toString(36).slice(2, 12);
        }
        previewUserId = window.__RIPX_PREVIEW_USER_ID__;
      }
      if (previewUserId && String(previewUserId).trim()) {
        params.set('user_id', String(previewUserId).trim());
      }

      if (PREVIEW_VARIANT_ID) {
        params.set('variant_id', PREVIEW_VARIANT_ID);
      }
      if (PREVIEW_VARIANT_NAME) {
        params.set('variant_name', PREVIEW_VARIANT_NAME);
      }

      const response = await fetchWithTimeout(
        `${CONFIG.apiUrl}/track/preview?${params.toString()}`,
        { method: 'GET' },
        8000
      );

      if (response.ok) {
        const data = await response.json();
        var normalized = normalizeVariantForStorefront(data.variant);
        if (normalized && normalized.config && typeof normalized.config === 'object') {
          writePreviewVariantCache(testId, normalized);
        }
        return normalized;
      }
    } catch (error) {
      console.error('Error getting preview variant:', error);
    }
    var cached = readPreviewVariantCache(testId);
    if (cached) return cached;
    return null;
  }

  /**
   * Fetch minimal test payload for preview when the test is draft/paused (not in script.js activeTests).
   */
  async function fetchPreviewStorefrontTestShape(testId) {
    if (!hasValidConfig || !testId) {
      return null;
    }
    try {
      const params = new URLSearchParams();
      params.set('test_id', String(testId));
      appendTrackTenantParams(params);
      const response = await fetchWithTimeout(
        `${CONFIG.apiUrl}/track/preview-storefront-test?${params.toString()}`,
        { method: 'GET' },
        8000
      );
      if (response.ok) {
        const data = await response.json();
        return data.test || null;
      }
    } catch (error) {
      console.error('Error fetching preview storefront test:', error);
    }
    return null;
  }

  /**
   * Track conversion event (purchase/order)
   */
  async function trackConversion(testId, variantId, value = 0, metadata = {}) {
    if (PREVIEW_MODE || !hasValidConfig) {
      return;
    }
    const userId = getUserId();
    const shopDomain = getShopDomain();

    const meta = { ...metadata };
    if (!meta.conversion_url && typeof window !== 'undefined' && window.location) {
      meta.conversion_url = window.location.pathname || window.location.href;
    }

    try {
      await fetchWithTimeout(
        CONFIG.apiUrl + '/track',
        {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            test_id: testId,
            variant_id: variantId,
            user_id: userId,
            shop_domain: shopDomain,
            event_type: 'conversion',
            event_value: value,
            metadata: meta,
          }),
        },
        6000
      );
    } catch (error) {
      if (DEBUG) debugLog('track conversion failed', error && (error.message || error.name));
    }
  }

  /**
   * Track custom event (add_to_cart, signup, etc.)
   * Use when variant is unknown - fetches from cache. Pass variantId if known.
   *
   * @param {string} testId - Test ID
   * @param {string} eventName - Custom event name (e.g. add_to_cart, newsletter_signup)
   * @param {number} [value=0] - Optional numeric value
   * @param {Object} [metadata={}] - Optional metadata
   * @param {string} [variantId] - Variant ID if known (avoids extra fetch)
   */
  async function trackEvent(testId, eventName, value = 0, metadata = {}, variantId) {
    if (PREVIEW_MODE || !hasValidConfig || !eventName || !String(eventName).trim()) {
      return;
    }
    const userId = getUserId();
    const shopDomain = getShopDomain();
    let vid = variantId;

    if (!vid) {
      const variant = await getVariant(testId);
      vid = variant?.variantId;
    }
    if (!vid) return;

    try {
      await fetchWithTimeout(
        CONFIG.apiUrl + '/track',
        {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            test_id: testId,
            variant_id: vid,
            user_id: userId,
            shop_domain: shopDomain,
            event_type: 'custom',
            event_name: String(eventName).trim(),
            event_value: typeof value === 'number' ? value : 0,
            metadata: metadata && typeof metadata === 'object' ? metadata : {},
          }),
        },
        6000
      );
    } catch (error) {
      if (DEBUG) debugLog('track event failed', error && (error.message || error.name));
    }
  }

  function normalizeRipxCatalogEventName(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 100);
  }

  function getCatalogDefinitionsForRuntime() {
    return Array.isArray(CONFIG.goalMetricDefinitions) ? CONFIG.goalMetricDefinitions : [];
  }

  function getTestsUsingGoalEvent(eventName, tests) {
    var normalized = normalizeRipxCatalogEventName(eventName);
    return (tests || CONFIG.activeTests || []).filter(function (test) {
      return (test.goalEvents || []).some(function (goalEvent) {
        return normalizeRipxCatalogEventName(goalEvent && goalEvent.eventName) === normalized;
      });
    });
  }

  function getTriggerValue(parameterName, payload, element) {
    var key = String(parameterName || '').trim();
    if (payload && typeof payload === 'object' && payload.value !== undefined) {
      var directValue = Number(payload.value);
      if (Number.isFinite(directValue)) return directValue;
    }
    if (!key) return 0;
    if (payload && typeof payload === 'object' && payload[key] !== undefined) {
      var payloadValue = Number(payload[key]);
      return Number.isFinite(payloadValue) ? payloadValue : 0;
    }
    if (element && element.getAttribute) {
      var attr =
        element.getAttribute('data-' + key.replace(/_/g, '-')) ||
        element.getAttribute('data-' + key);
      var attrValue = Number(attr);
      return Number.isFinite(attrValue) ? attrValue : 0;
    }
    return 0;
  }

  function fireCatalogEvent(definition, source, payload, element, tests) {
    if (!definition || !definition.eventName) return;
    var eventName = normalizeRipxCatalogEventName(definition.eventName);
    var matchingTests = getTestsUsingGoalEvent(eventName, tests);
    if (!matchingTests.length) return;
    var config = definition.triggerConfig || {};
    var value = getTriggerValue(config.parameterName, payload, element);
    var metadata = {
      source: 'goals_metrics_catalog',
      trigger_type: definition.triggerType || 'custom_event',
      trigger_source: source || 'runtime',
      catalog_id: definition.id || null,
    };
    if (element) {
      var elementMetadata = getElementTriggerMetadata(element);
      Object.keys(elementMetadata).forEach(function (key) {
        metadata[key] = elementMetadata[key];
      });
    }
    if (payload && payload.metadata && typeof payload.metadata === 'object') {
      Object.keys(payload.metadata).forEach(function (key) {
        metadata[key] = payload.metadata[key];
      });
    }
    matchingTests.forEach(function (test) {
      trackEvent(test.id, eventName, value, metadata);
    });
    if (DEBUG) debugLog('catalog event fired', eventName, source, matchingTests.length);
  }

  var _ripxAutomaticGoalLastFiredAt = {};

  function getCatalogDefinitionForEvent(eventName) {
    var normalized = normalizeRipxCatalogEventName(eventName);
    var definitions = getCatalogDefinitionsForRuntime();
    for (var i = 0; i < definitions.length; i += 1) {
      if (
        normalizeRipxCatalogEventName(definitions[i] && definitions[i].eventName) === normalized
      ) {
        return definitions[i];
      }
    }
    return { eventName: normalized, triggerType: 'automatic', triggerConfig: {} };
  }

  function fireAutomaticGoalEvent(eventName, source, payload, element, tests, dedupeMs) {
    var normalized = normalizeRipxCatalogEventName(eventName);
    if (!normalized) return;
    if (!getTestsUsingGoalEvent(normalized, tests).length) return;
    var now = Date.now();
    var dedupeWindow = typeof dedupeMs === 'number' ? dedupeMs : 0;
    if (dedupeWindow > 0 && now - (_ripxAutomaticGoalLastFiredAt[normalized] || 0) < dedupeWindow) {
      return;
    }
    _ripxAutomaticGoalLastFiredAt[normalized] = now;
    fireCatalogEvent(
      getCatalogDefinitionForEvent(normalized),
      source,
      payload || {},
      element,
      tests
    );
  }

  function wildcardToRegExp(pattern) {
    var escaped = String(pattern || '')
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    return new RegExp('^' + escaped + '$', 'i');
  }

  function urlMatchesPattern(pattern) {
    var raw = String(pattern || '').trim();
    if (!raw) return false;
    var href = String(window.location.href || '');
    var path = String(window.location.pathname || '/');
    try {
      return wildcardToRegExp(raw).test(href) || wildcardToRegExp(raw).test(path);
    } catch (e) {
      return href.indexOf(raw) !== -1 || path.indexOf(raw) !== -1;
    }
  }

  function getLinkUrl(element) {
    if (!element || !element.getAttribute) return null;
    var href = element.getAttribute('href');
    if (!href) return null;
    try {
      return new URL(href, window.location.href);
    } catch (_eUrl) {
      return null;
    }
  }

  function isFileDownloadUrl(url) {
    if (!url || !url.pathname) return false;
    return /\.(pdf|xlsx?|docx?|pptx?|zip|rar|7z|csv|txt|rtf|mp3|mp4|mov|avi|wmv|dmg|exe)$/i.test(
      url.pathname
    );
  }

  function getLinkTriggerMetadata(element) {
    var url = getLinkUrl(element);
    if (!url) return {};
    return {
      link_url: url.href,
      link_domain: url.hostname,
      outbound: url.hostname !== window.location.hostname,
      file_extension: isFileDownloadUrl(url) ? url.pathname.split('.').pop().toLowerCase() : '',
    };
  }

  function shouldFireClickDefinition(definition, element) {
    var config = definition.triggerConfig || {};
    var linkKind = String(config.linkKind || '').toLowerCase();
    if (!linkKind) return true;
    var url = getLinkUrl(element);
    if (!url) return false;
    if (linkKind === 'outbound') return url.hostname !== window.location.hostname;
    if (linkKind === 'file_download') return isFileDownloadUrl(url);
    return true;
  }

  function installCatalogDataLayerBridge(tests) {
    var definitions = getCatalogDefinitionsForRuntime().filter(function (definition) {
      return (definition.triggerType || 'custom_event') === 'custom_event';
    });
    if (!definitions.length) return;
    var byEvent = {};
    definitions.forEach(function (definition) {
      byEvent[normalizeRipxCatalogEventName(definition.eventName)] = definition;
    });
    function inspectDataLayerItem(item) {
      if (!item || typeof item !== 'object') return;
      var eventName = normalizeRipxCatalogEventName(item.event || item.event_name);
      if (eventName && byEvent[eventName]) {
        fireCatalogEvent(byEvent[eventName], 'dataLayer', item, null, tests);
      }
    }
    var dataLayer = (window.dataLayer = window.dataLayer || []);
    if (!dataLayer.__ripxPatched) {
      var originalPush = dataLayer.push;
      dataLayer.push = function () {
        var result = originalPush.apply(dataLayer, arguments);
        for (var i = 0; i < arguments.length; i += 1) inspectDataLayerItem(arguments[i]);
        return result;
      };
      dataLayer.__ripxPatched = true;
    }
    dataLayer.slice(0, 50).forEach(inspectDataLayerItem);
  }

  function installCatalogDomTriggers(tests) {
    var definitions = getCatalogDefinitionsForRuntime();
    var clickDefinitions = definitions.filter(function (definition) {
      return definition.triggerType === 'css_click';
    });
    var formStartDefinitions = definitions.filter(function (definition) {
      return definition.triggerType === 'form_start';
    });
    var formDefinitions = definitions.filter(function (definition) {
      return definition.triggerType === 'form_submit';
    });
    var urlDefinitions = definitions.filter(function (definition) {
      return definition.triggerType === 'url_match';
    });
    var visibilityDefinitions = definitions.filter(function (definition) {
      return definition.triggerType === 'element_visibility';
    });
    var javascriptDefinitions = definitions.filter(function (definition) {
      return definition.triggerType === 'custom_javascript';
    });

    function fireUrlDefinitions() {
      urlDefinitions.forEach(function (definition) {
        if (urlMatchesPattern(definition.triggerConfig && definition.triggerConfig.urlPattern)) {
          fireCatalogEvent(definition, 'url_match', { url: window.location.href }, null, tests);
        }
      });
    }

    fireUrlDefinitions();

    if (urlDefinitions.length && window.history && !window.__RIPX_URL_TRIGGERS_PATCHED__) {
      var originalPushState = window.history.pushState;
      var originalReplaceState = window.history.replaceState;
      var scheduleUrlFire = function () {
        setTimeout(fireUrlDefinitions, 0);
      };
      window.history.pushState = function () {
        var result = originalPushState.apply(window.history, arguments);
        scheduleUrlFire();
        return result;
      };
      window.history.replaceState = function () {
        var result = originalReplaceState.apply(window.history, arguments);
        scheduleUrlFire();
        return result;
      };
      window.addEventListener('popstate', scheduleUrlFire);
      window.__RIPX_URL_TRIGGERS_PATCHED__ = true;
    }

    if (clickDefinitions.length && document && document.addEventListener) {
      document.addEventListener(
        'click',
        function (event) {
          clickDefinitions.forEach(function (definition) {
            var selector = definition.triggerConfig && definition.triggerConfig.selector;
            if (!selector || !event.target || !event.target.closest) return;
            try {
              var matched = event.target.closest(selector);
              if (matched && shouldFireClickDefinition(definition, matched)) {
                fireCatalogEvent(
                  definition,
                  'css_click',
                  { metadata: getLinkTriggerMetadata(matched) },
                  matched,
                  tests
                );
              }
            } catch (_eSelector) {}
          });
        },
        true
      );
    }

    if (formStartDefinitions.length && document && document.addEventListener) {
      var startedForms = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
      function hasFormStarted(form, eventName) {
        var state = startedForms ? startedForms.get(form) : form.__ripxFormStartState;
        return state && state[eventName];
      }
      function markFormStarted(form, eventName) {
        var state = startedForms ? startedForms.get(form) : form.__ripxFormStartState;
        if (!state) state = {};
        state[eventName] = true;
        if (startedForms) startedForms.set(form, state);
        else form.__ripxFormStartState = state;
      }
      function handleFormStart(event) {
        if (!event.target || !event.target.closest) return;
        var form = event.target.closest('form');
        if (!form || !form.matches) return;
        formStartDefinitions.forEach(function (definition) {
          var selector = definition.triggerConfig && definition.triggerConfig.selector;
          if (!selector || hasFormStarted(form, definition.eventName)) return;
          try {
            if (form.matches(selector)) {
              markFormStarted(form, definition.eventName);
              fireCatalogEvent(definition, 'form_start', {}, form, tests);
            }
          } catch (_eSelector) {}
        });
      }
      document.addEventListener('focusin', handleFormStart, true);
      document.addEventListener('change', handleFormStart, true);
    }

    if (formDefinitions.length && document && document.addEventListener) {
      document.addEventListener(
        'submit',
        function (event) {
          formDefinitions.forEach(function (definition) {
            var selector = definition.triggerConfig && definition.triggerConfig.selector;
            if (!selector || !event.target || !event.target.matches) return;
            try {
              if (event.target.matches(selector)) {
                fireCatalogEvent(definition, 'form_submit', {}, event.target, tests);
              }
            } catch (_eSelector) {}
          });
        },
        true
      );
    }

    if (visibilityDefinitions.length)
      installCatalogVisibilityTriggers(visibilityDefinitions, tests);
    if (javascriptDefinitions.length)
      installCatalogJavascriptTriggers(javascriptDefinitions, tests);
  }

  function getElementTriggerMetadata(element, extra) {
    var metadata = extra && typeof extra === 'object' ? extra : {};
    if (!element || !element.getAttribute) return metadata;
    metadata.element_id = element.getAttribute('id') || '';
    metadata.element_classes = element.getAttribute('class') || '';
    metadata.element_text = String(element.textContent || '')
      .trim()
      .slice(0, 120);
    metadata.product_id = element.getAttribute('data-product-id') || '';
    metadata.product_handle = element.getAttribute('data-product-handle') || '';
    metadata.promotion_id = element.getAttribute('data-promo-id') || '';
    if (String(element.tagName || '').toLowerCase() === 'form') {
      metadata.form_id = element.getAttribute('id') || '';
      metadata.form_name = element.getAttribute('name') || '';
      metadata.form_action = element.getAttribute('action') || '';
      metadata.form_method = element.getAttribute('method') || 'get';
    }
    return metadata;
  }

  function installCatalogVisibilityTriggers(definitions, tests) {
    if (!document || !document.querySelectorAll) return;
    definitions.forEach(function (definition) {
      var config = definition.triggerConfig || {};
      var selector = config.selector;
      if (!selector) return;
      var threshold = Math.min(100, Math.max(1, Number(config.visibilityThreshold || 50))) / 100;
      var minDuration = Math.max(0, Number(config.visibilityMinDurationMs || 0));
      var frequency = config.visibilityFrequency || 'once_per_page';
      var firedPage = false;
      var firedElements = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
      var visibleTimers = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
      var observedElements = typeof WeakSet !== 'undefined' ? new WeakSet() : null;

      function hasElementFired(element) {
        return firedElements && firedElements.has(element);
      }

      function markElementFired(element) {
        if (firedElements) firedElements.add(element);
      }

      function fireVisibility(element, ratio) {
        if (frequency === 'once_per_page' && firedPage) return;
        if (frequency === 'once_per_element' && hasElementFired(element)) return;
        firedPage = true;
        markElementFired(element);
        fireCatalogEvent(
          definition,
          'element_visibility',
          {
            value: Math.round(ratio * 100),
            metadata: getElementTriggerMetadata(element, {
              percent_visible: Math.round(ratio * 100),
              visible_duration_ms: minDuration,
            }),
          },
          element,
          tests
        );
      }

      function handleVisible(element, ratio) {
        if (!element || ratio < threshold) return;
        if (frequency === 'once_per_page' && firedPage) return;
        if (frequency === 'once_per_element' && hasElementFired(element)) return;
        if (!minDuration) {
          fireVisibility(element, ratio);
          return;
        }
        if (visibleTimers && visibleTimers.has(element)) return;
        var timer = setTimeout(function () {
          if (visibleTimers) visibleTimers.delete(element);
          fireVisibility(element, ratio);
        }, minDuration);
        if (visibleTimers) visibleTimers.set(element, timer);
      }

      function handleHidden(element) {
        if (!visibleTimers || !visibleTimers.has(element)) return;
        clearTimeout(visibleTimers.get(element));
        visibleTimers.delete(element);
      }

      function scanWithObserver(observer) {
        var nodes;
        try {
          nodes = document.querySelectorAll(selector);
        } catch (_eSelector) {
          nodes = [];
        }
        for (var i = 0; i < nodes.length; i += 1) {
          if (observedElements && observedElements.has(nodes[i])) continue;
          if (observedElements) observedElements.add(nodes[i]);
          observer.observe(nodes[i]);
        }
      }

      if (typeof IntersectionObserver === 'function') {
        var observer = new IntersectionObserver(
          function (entries) {
            entries.forEach(function (entry) {
              if (entry.isIntersecting && entry.intersectionRatio >= threshold) {
                handleVisible(entry.target, entry.intersectionRatio);
              } else {
                handleHidden(entry.target);
              }
            });
          },
          { threshold: [threshold] }
        );
        scanWithObserver(observer);
        if (config.observeDomChanges !== false && typeof MutationObserver === 'function') {
          var mutationObserver = new MutationObserver(function () {
            scanWithObserver(observer);
          });
          mutationObserver.observe(document.documentElement || document.body, {
            childList: true,
            subtree: true,
          });
        }
      } else {
        try {
          var fallbackNodes = document.querySelectorAll(selector);
          for (var fi = 0; fi < fallbackNodes.length; fi += 1) {
            var rect = fallbackNodes[fi].getBoundingClientRect();
            var visible =
              rect.width > 0 &&
              rect.height > 0 &&
              rect.bottom >= 0 &&
              rect.right >= 0 &&
              rect.top <= (window.innerHeight || document.documentElement.clientHeight) &&
              rect.left <= (window.innerWidth || document.documentElement.clientWidth);
            if (visible) handleVisible(fallbackNodes[fi], 1);
          }
        } catch (_eFallback) {}
      }
    });
  }

  function normalizeCustomJavascriptResult(result) {
    if (!result) return null;
    if (result === true) return { value: 0, metadata: {} };
    if (typeof result === 'number') return { value: result, metadata: {} };
    if (typeof result === 'object') {
      if (result.fire === false) return null;
      return {
        value: Number.isFinite(Number(result.value)) ? Number(result.value) : 0,
        metadata: result.metadata && typeof result.metadata === 'object' ? result.metadata : {},
      };
    }
    return { value: 0, metadata: { result: String(result).slice(0, 120) } };
  }

  function installCatalogJavascriptTriggers(definitions, tests) {
    definitions.forEach(function (definition) {
      var config = definition.triggerConfig || {};
      var code = String(config.customJavascript || '').trim();
      if (!code) return;
      var intervalMs = Math.min(
        10000,
        Math.max(250, Number(config.customJavascriptIntervalMs || 1000))
      );
      var maxWaitMs = Math.min(
        120000,
        Math.max(1000, Number(config.customJavascriptMaxWaitMs || 10000))
      );
      var startedAt = Date.now();
      var fn;
      try {
        fn = new Function('context', 'window', 'document', 'dataLayer', '"use strict";\n' + code);
      } catch (error) {
        if (DEBUG)
          debugLog('custom javascript trigger compile failed', definition.eventName, error);
        return;
      }
      function evaluate() {
        var context = {
          url: String(window.location.href || ''),
          path: String(window.location.pathname || ''),
          query: String(window.location.search || ''),
          referrer: String(document.referrer || ''),
          title: String(document.title || ''),
          shopDomain: getShopDomain(),
        };
        try {
          var result = normalizeCustomJavascriptResult(
            fn(context, window, document, window.dataLayer || [])
          );
          if (result) {
            fireCatalogEvent(definition, 'custom_javascript', result, null, tests);
            return true;
          }
        } catch (error) {
          if (DEBUG) debugLog('custom javascript trigger failed', definition.eventName, error);
          return true;
        }
        return Date.now() - startedAt >= maxWaitMs;
      }
      if (evaluate()) return;
      var timer = setInterval(function () {
        if (evaluate()) clearInterval(timer);
      }, intervalMs);
    });
  }

  function findCartViewControl(node) {
    if (!node || typeof node.closest !== 'function') return null;
    return node.closest(
      'a[href*="/cart"], button[name="cart"], [data-cart-toggle], [data-cart-drawer-toggle], [data-ripx-view-cart], .cart-link, .header__icon--cart'
    );
  }

  function installAutomaticCartGoalTriggers(tests) {
    if (!document || typeof document.addEventListener !== 'function') return;
    if (window.__RIPX_AUTOMATIC_CART_GOAL_TRIGGERS__) return;
    window.__RIPX_AUTOMATIC_CART_GOAL_TRIGGERS__ = true;

    document.addEventListener(
      'click',
      function (event) {
        var control = findCartViewControl(event && event.target);
        if (!control) return;
        fireAutomaticGoalEvent(
          'view_cart',
          'cart_control_click',
          { metadata: getLinkTriggerMetadata(control) },
          control,
          tests,
          2000
        );
      },
      true
    );

    if (typeof MutationObserver === 'function') {
      var lastCartVisibleAt = 0;
      var observer = new MutationObserver(function () {
        var root = cartUiRoot();
        if (!root) return;
        var now = Date.now();
        if (now - lastCartVisibleAt < 2000) return;
        lastCartVisibleAt = now;
        fireAutomaticGoalEvent(
          'view_cart',
          'cart_ui_visible',
          { metadata: { cart_ui_detected: true } },
          root,
          tests,
          2000
        );
      });
      try {
        observer.observe(document.documentElement || document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class', 'open', 'aria-hidden', 'style'],
        });
      } catch (_eCartObserver) {}
    }
  }

  function installGoalMetricCatalogTriggers(tests) {
    if (PREVIEW_MODE || !hasValidConfig || window.__RIPX_GOAL_METRIC_TRIGGERS__) return;
    window.__RIPX_GOAL_METRIC_TRIGGERS__ = true;
    installCatalogDataLayerBridge(tests);
    installCatalogDomTriggers(tests);
    installAutomaticCartGoalTriggers(tests);
  }

  function debugGoalMetrics(eventName) {
    var normalized = normalizeRipxCatalogEventName(eventName || '');
    var definitions = getCatalogDefinitionsForRuntime();
    var activeTests = CONFIG.activeTests || [];
    var selectedEvents = [];
    activeTests.forEach(function (test) {
      (test.goalEvents || []).forEach(function (goalEvent) {
        selectedEvents.push({
          testId: test.id,
          eventName: goalEvent.eventName,
          role: goalEvent.metricRole || 'secondary',
          aggregation: goalEvent.aggregation || 'count',
        });
      });
    });
    var matchingDefinitions = normalized
      ? definitions.filter(function (definition) {
          return normalizeRipxCatalogEventName(definition.eventName) === normalized;
        })
      : definitions;
    var matchingTests = normalized ? getTestsUsingGoalEvent(normalized, activeTests) : [];
    return {
      installed: !!window.__RIPX_GOAL_METRIC_TRIGGERS__,
      previewMode: PREVIEW_MODE,
      hasValidConfig: hasValidConfig,
      shopDomain: getShopDomain(),
      definitionsCount: definitions.length,
      selectedEventsCount: selectedEvents.length,
      dataLayerPatched: !!(window.dataLayer && window.dataLayer.__ripxPatched),
      matchingDefinitions: matchingDefinitions.map(function (definition) {
        return {
          id: definition.id || null,
          name: definition.name || definition.eventName,
          eventName: definition.eventName,
          triggerType: definition.triggerType || 'custom_event',
          triggerConfig: definition.triggerConfig || {},
        };
      }),
      selectedEvents: normalized
        ? selectedEvents.filter(function (goalEvent) {
            return normalizeRipxCatalogEventName(goalEvent.eventName) === normalized;
          })
        : selectedEvents,
      matchingTestIds: matchingTests.map(function (test) {
        return test.id;
      }),
      helperCommands: {
        inspectAll: 'window.RipX.debugGoalMetrics()',
        inspectEvent: "window.RipX.debugGoalMetrics('event_key')",
        fireTest: "window.RipX.testGoalMetricEvent('event_key', 1)",
      },
    };
  }

  function testGoalMetricEvent(eventName, value, metadata) {
    var normalized = normalizeRipxCatalogEventName(eventName);
    if (!normalized) {
      return { fired: false, reason: 'event_name_required' };
    }
    var definitions = getCatalogDefinitionsForRuntime();
    var definition = definitions.filter(function (item) {
      return normalizeRipxCatalogEventName(item.eventName) === normalized;
    })[0] || { eventName: normalized, triggerType: 'manual_debug', triggerConfig: {} };
    var matchingTests = getTestsUsingGoalEvent(normalized, CONFIG.activeTests || []);
    if (!matchingTests.length) {
      return {
        fired: false,
        reason: 'no_active_test_uses_event',
        eventName: normalized,
        debug: debugGoalMetrics(normalized),
      };
    }
    var numericValue = Number(value);
    fireCatalogEvent(
      definition,
      'manual_debug',
      {
        value: Number.isFinite(numericValue) ? numericValue : 0,
        metadata: Object.assign(
          { debug: true },
          metadata && typeof metadata === 'object' ? metadata : {}
        ),
      },
      null,
      matchingTests
    );
    return {
      fired: true,
      eventName: normalized,
      matchingTestIds: matchingTests.map(function (test) {
        return test.id;
      }),
      note: 'Check Network for POST /api/track with event_type=custom.',
    };
  }

  async function evaluateFeatureFlags(keys) {
    var list = Array.isArray(keys) ? keys : [keys];
    list = list
      .map(function (key) {
        return String(key || '').trim();
      })
      .filter(Boolean);
    if (!list.length || !hasValidConfig) return {};
    var endpoint = CONFIG.featureFlagUrl || CONFIG.apiUrl + '/feature-flags/evaluate';
    var params = new URLSearchParams();
    params.set('keys', list.join(','));
    var shopDomain = getShopDomain();
    if (shopDomain) params.set('shop', shopDomain);
    try {
      var response = await fetchWithTimeout(
        endpoint + '?' + params.toString(),
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
        },
        5000
      );
      if (!response || !response.ok) return {};
      var payload = await response.json();
      return (payload && payload.flags) || {};
    } catch (error) {
      if (DEBUG) debugLog('feature flag evaluation failed', error && (error.message || error.name));
      return {};
    }
  }

  async function trackRecommendationEvent(testId, action, metadata, variantId) {
    var normalizedAction = String(action || '')
      .trim()
      .toLowerCase();
    var eventName = 'recommendation_' + normalizedAction;
    var allowed = {
      recommendation_impression: true,
      recommendation_click: true,
      recommendation_add_to_cart: true,
      recommendation_checkout_start: true,
      recommendation_purchase: true,
    };
    if (!allowed[eventName]) {
      if (DEBUG) debugLog('ignored recommendation event', normalizedAction);
      return;
    }
    await trackEvent(testId, eventName, 0, metadata || {}, variantId);
  }

  /**
   * Numeric Shopify product id for data-product-id attributes (themes use number, not GID).
   */
  function toNumericProductId(id) {
    if (id == null || id === '') return '';
    var s = String(id).trim();
    var m = s.match(/Product\/(\d+)/);
    if (m) return m[1];
    return s.replace(/\D/g, '') || s;
  }

  /**
   * Active store currency (Shopify.theme or currency meta).
   */
  function getShopCurrency() {
    if (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) {
      return String(window.Shopify.currency.active);
    }
    var el = document.querySelector('[data-shop-currency], [data-currency-code]');
    if (el) {
      return (
        el.getAttribute('data-shop-currency') || el.getAttribute('data-currency-code') || 'USD'
      );
    }
    return 'USD';
  }

  /**
   * Format price for display (theme money format when available).
   */
  function formatShopPrice(amount) {
    var n = parseFloat(amount, 10);
    if (isNaN(n) || n < 0) return '';
    if (typeof Shopify !== 'undefined' && typeof Shopify.formatMoney === 'function') {
      try {
        return Shopify.formatMoney(Math.round(n * 100));
      } catch (e) {}
    }
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: getShopCurrency(),
      }).format(n);
    } catch (e) {
      return String(n);
    }
  }

  /**
   * Get product JSON from page (Dawn #ProductJson, theme script, or meta).
   * Returns { product, variants, selectedVariant } or null.
   */
  function getProductJson() {
    var script = document.querySelector(
      '#ProductJson, script[type="application/json"][data-product-json], script[data-section-type="product-template"], script[data-section-type="product"]'
    );
    if (script && script.textContent) {
      try {
        var data = JSON.parse(script.textContent);
        var product = data.product || data;
        var variants = product.variants || data.variants || [];
        if (!variants.length && product && product.variants) variants = product.variants;
        var selected =
          product.selected_or_first_available_variant ||
          data.selected_or_first_available_variant ||
          (variants.length ? variants[0] : null);
        if (selected && variants.length) {
          var selId = selected.id || selected.variant_id;
          if (
            selId &&
            !variants.find(function (v) {
              return String(v.id) === String(selId);
            })
          ) {
            selected =
              variants.find(function (v) {
                return String(v.id) === String(selId);
              }) || variants[0];
          }
        }
        return { product: product, variants: variants, selectedVariant: selected };
      } catch (e) {}
    }
    if (window.ShopifyAnalytics?.meta?.product) {
      var p = window.ShopifyAnalytics.meta.product;
      var vs = p.variants || [];
      var sel =
        vs.find(function (v) {
          return String(v.id) === String(p.selected_variant_id);
        }) || vs[0];
      return { product: p, variants: vs, selectedVariant: sel };
    }
    if (window.Shopify?.meta?.product) {
      var p2 = window.Shopify.meta.product;
      var vs2 = p2.variants || [];
      var sel2 =
        vs2.find(function (v) {
          return String(v.id) === String(p2.selected_variant_id);
        }) || vs2[0];
      return { product: p2, variants: vs2, selectedVariant: sel2 };
    }
    return null;
  }

  /**
   * Get currently selected variant ID (form input or product JSON).
   */
  function getSelectedVariantId() {
    var input = document.querySelector('input[name="id"], input[name="variant_id"], [name="id"]');
    if (input && input.value) return input.value.trim();
    var json = getProductJson();
    if (json && json.selectedVariant && json.selectedVariant.id) {
      return String(json.selectedVariant.id);
    }
    return null;
  }

  /**
   * Parse variant price or compare_at_price from JSON (Shopify uses subunits/cents when integer).
   */
  function parseVariantPrice(raw) {
    if (raw === null || raw === undefined) return null;
    var num = parseFloat(String(raw).replace(/[^0-9.-]/g, ''), 10);
    if (isNaN(num)) return null;
    if (typeof raw === 'number' && Number.isInteger(raw)) num = raw / 100;
    else if (String(raw).indexOf('.') === -1 && num >= 100) num = num / 100;
    return num;
  }

  /**
   * Get catalog selling price for current (or given) variant in dollars.
   */
  function getCatalogPriceFromPage(preferredVariantId) {
    var json = getProductJson();
    if (!json || !json.variants || !json.variants.length) return null;
    var vid = preferredVariantId || getSelectedVariantId();
    var v = json.variants.find(function (x) {
      return String(x.id) === String(vid);
    });
    if (!v) v = json.selectedVariant || json.variants[0];
    if (!v) return null;
    return parseVariantPrice(v.price);
  }

  /**
   * Get catalog compare_at_price for current variant in dollars (for "percent off list").
   * Returns null if not present; themes/API may omit it.
   */
  function getCatalogCompareAtFromPage(preferredVariantId) {
    var json = getProductJson();
    if (!json || !json.variants || !json.variants.length) return null;
    var vid = preferredVariantId || getSelectedVariantId();
    var v = json.variants.find(function (x) {
      return String(x.id) === String(vid);
    });
    if (!v) v = json.selectedVariant || json.variants[0];
    if (!v || v.compare_at_price == null) return null;
    return parseVariantPrice(v.compare_at_price);
  }

  /**
   * Inject line item properties on product /cart/add forms so checkout Discount Functions can read CartLine attributes.
   * Shopify expects properties[_key] (not attributes[]) for line-level data. Leading underscore = hidden from buyers in most themes.
   * See docs/SHOPIFY_CHECKOUT_PRICE_RESOLVER.md
   */
  function getRipxCartAttrsPayload(
    testId,
    variantId,
    shopDomain,
    assignmentProof,
    pricingProof,
    offerProof
  ) {
    var out = {
      _ripx_price_test: String(testId || ''),
      _ripx_variant: String(variantId == null ? '' : variantId),
      _ripx_shop: shopDomain ? String(shopDomain) : '',
    };
    if (
      assignmentProof &&
      assignmentProof.sig &&
      assignmentProof.ts &&
      assignmentProof.user &&
      String(assignmentProof.sig).trim() &&
      String(assignmentProof.ts).trim() &&
      String(assignmentProof.user).trim()
    ) {
      out._ripx_assignment_sig = String(assignmentProof.sig).trim();
      out._ripx_assignment_ts = String(assignmentProof.ts).trim();
      out._ripx_assignment_user = String(assignmentProof.user).trim();
    }
    if (
      pricingProof &&
      pricingProof.targetUnit !== undefined &&
      pricingProof.targetUnit !== null &&
      isFinite(Number(pricingProof.targetUnit))
    ) {
      out._ripx_target_unit = Number(pricingProof.targetUnit).toFixed(2);
    }
    if (
      pricingProof &&
      pricingProof.discountUnit !== undefined &&
      pricingProof.discountUnit !== null &&
      isFinite(Number(pricingProof.discountUnit))
    ) {
      out._ripx_discount_unit = Number(pricingProof.discountUnit).toFixed(2);
    }
    if (pricingProof && pricingProof.priceMethod && String(pricingProof.priceMethod).trim()) {
      out._ripx_price_method = String(pricingProof.priceMethod).trim();
    }
    if (offerProof && offerProof.discountType) {
      var offerType = String(offerProof.discountType || '')
        .trim()
        .toLowerCase();
      if (offerType === 'percent' || offerType === 'fixed' || offerType === 'free_shipping') {
        out._ripx_offer_discount_type = offerType;
      }
    }
    if (
      offerProof &&
      offerProof.discountValue !== undefined &&
      offerProof.discountValue !== null &&
      String(offerProof.discountValue).trim() !== ''
    ) {
      var offerValueNum = Number(offerProof.discountValue);
      if (isFinite(offerValueNum) && offerValueNum > 0) {
        out._ripx_offer_discount_value = offerValueNum.toFixed(2);
      }
    }
    if (offerProof && offerProof.codeName) {
      var offerCodeName = normalizeExplicitOfferCode(offerProof.codeName);
      if (offerCodeName) {
        out._ripx_offer_code_name = offerCodeName;
      }
    }
    return out;
  }

  var RIPX_LINE_PROPERTY_KEYS = [
    '_ripx_price_test',
    '_ripx_variant',
    '_ripx_shop',
    '_ripx_assignment_sig',
    '_ripx_assignment_ts',
    '_ripx_assignment_user',
    '_ripx_target_unit',
    '_ripx_discount_unit',
    '_ripx_price_method',
    '_ripx_offer_discount_type',
    '_ripx_offer_discount_value',
    '_ripx_offer_code_name',
  ];
  var RIPX_LEGACY_BUYER_VISIBLE_PROPERTY_KEY = 'RipX';
  var RIPX_BUYER_VISIBLE_PROPERTY_KEY = '_ripx_summary';
  var RIPX_PUBLIC_LINE_PROPERTY_KEYS = RIPX_LINE_PROPERTY_KEYS.map(function (key) {
    return getRipxPublicLinePropertyKey(key);
  });
  function getRipxPublicLinePropertyKey(key) {
    return String(key || '').charAt(0) === '_' ? String(key).slice(1) : String(key || '');
  }
  function getRipxBuyerVisibleLineSummary(payload) {
    var variant = payload && payload._ripx_variant ? String(payload._ripx_variant).trim() : '';
    var label = payload && payload.__ripx_shipping_test ? 'Shipping Test' : 'Price Test';
    return variant ? label + ': ' + variant : label + ' Applied';
  }
  function forEachRipxLineProperty(payload, callback) {
    if (!payload || typeof callback !== 'function') return;
    for (var i = 0; i < RIPX_LINE_PROPERTY_KEYS.length; i++) {
      var privateKey = RIPX_LINE_PROPERTY_KEYS[i];
      var value = payload[privateKey];
      if (value === undefined || value === null || String(value).trim() === '') continue;
      callback(privateKey, value);
    }
  }

  function setRipxAttrValueOnFormData(formData, key, value, preserveExisting) {
    if (!formData || !key) return;
    if (value === undefined || value === null || String(value).trim() === '') return;
    if (
      preserveExisting &&
      typeof formData.get === 'function' &&
      formData.get(key) !== null &&
      String(formData.get(key)).trim() !== ''
    ) {
      return;
    }
    formData.set(key, value);
  }

  function applyRipxCartAttrsToFormData(formData, payload, preserveExisting) {
    if (!formData || !payload) return false;
    var buyerVisibleSummary = getRipxBuyerVisibleLineSummary(payload);
    function collectItemIndexes() {
      var idxMap = {};
      var idxList = [];
      try {
        if (typeof formData.forEach === 'function') {
          formData.forEach(function (_value, key) {
            var m = String(key || '').match(/^items\[(\d+)\]\[[^\]]+\]/);
            if (!m) return;
            var idx = m[1];
            if (idxMap[idx]) return;
            idxMap[idx] = true;
            idxList.push(idx);
          });
        }
      } catch (e) {}
      return idxList;
    }
    function setItemProperty(index, propKey, value) {
      if (value === undefined || value === null || String(value).trim() === '') return;
      var itemKey = 'items[' + index + '][properties][' + propKey + ']';
      if (
        preserveExisting &&
        typeof formData.get === 'function' &&
        formData.get(itemKey) !== null &&
        String(formData.get(itemKey)).trim() !== ''
      ) {
        return;
      }
      formData.set(itemKey, value);
    }
    function removeLegacyPublicProps() {
      if (typeof formData.delete !== 'function') return;
      RIPX_PUBLIC_LINE_PROPERTY_KEYS.forEach(function (publicKey) {
        formData.delete('properties[' + publicKey + ']');
      });
      formData.delete('properties[' + RIPX_LEGACY_BUYER_VISIBLE_PROPERTY_KEY + ']');
      var indexes = collectItemIndexes();
      indexes.forEach(function (index) {
        RIPX_PUBLIC_LINE_PROPERTY_KEYS.forEach(function (publicKey) {
          formData.delete('items[' + index + '][properties][' + publicKey + ']');
        });
        formData.delete(
          'items[' + index + '][properties][' + RIPX_LEGACY_BUYER_VISIBLE_PROPERTY_KEY + ']'
        );
      });
    }
    function applyToItemIndexes() {
      var indexes = collectItemIndexes();
      if (!indexes.length) return false;
      indexes.forEach(function (index) {
        setItemProperty(index, RIPX_BUYER_VISIBLE_PROPERTY_KEY, buyerVisibleSummary);
        forEachRipxLineProperty(payload, function (propKey, value) {
          setItemProperty(index, propKey, value);
        });
      });
      return true;
    }
    removeLegacyPublicProps();
    setRipxAttrValueOnFormData(
      formData,
      'properties[' + RIPX_BUYER_VISIBLE_PROPERTY_KEY + ']',
      buyerVisibleSummary,
      preserveExisting
    );
    setRipxAttrValueOnFormData(
      formData,
      'properties[_ripx_price_test]',
      payload._ripx_price_test,
      preserveExisting
    );
    setRipxAttrValueOnFormData(
      formData,
      'properties[_ripx_variant]',
      payload._ripx_variant,
      preserveExisting
    );
    setRipxAttrValueOnFormData(
      formData,
      'properties[_ripx_shop]',
      payload._ripx_shop,
      preserveExisting
    );
    setRipxAttrValueOnFormData(
      formData,
      'properties[_ripx_assignment_sig]',
      payload._ripx_assignment_sig,
      preserveExisting
    );
    setRipxAttrValueOnFormData(
      formData,
      'properties[_ripx_assignment_ts]',
      payload._ripx_assignment_ts,
      preserveExisting
    );
    setRipxAttrValueOnFormData(
      formData,
      'properties[_ripx_assignment_user]',
      payload._ripx_assignment_user,
      preserveExisting
    );
    setRipxAttrValueOnFormData(
      formData,
      'properties[_ripx_target_unit]',
      payload._ripx_target_unit,
      preserveExisting
    );
    setRipxAttrValueOnFormData(
      formData,
      'properties[_ripx_discount_unit]',
      payload._ripx_discount_unit,
      preserveExisting
    );
    setRipxAttrValueOnFormData(
      formData,
      'properties[_ripx_price_method]',
      payload._ripx_price_method,
      preserveExisting
    );
    setRipxAttrValueOnFormData(
      formData,
      'properties[_ripx_offer_discount_type]',
      payload._ripx_offer_discount_type,
      preserveExisting
    );
    setRipxAttrValueOnFormData(
      formData,
      'properties[_ripx_offer_discount_value]',
      payload._ripx_offer_discount_value,
      preserveExisting
    );
    setRipxAttrValueOnFormData(
      formData,
      'properties[_ripx_offer_code_name]',
      payload._ripx_offer_code_name,
      preserveExisting
    );
    forEachRipxLineProperty(payload, function (propKey, value) {
      setRipxAttrValueOnFormData(formData, 'properties[' + propKey + ']', value, preserveExisting);
    });
    applyToItemIndexes();
    return true;
  }

  function setRipxAttrValueOnSearchParams(params, key, value, preserveExisting) {
    if (!params || !key) return;
    if (value === undefined || value === null || String(value).trim() === '') return;
    if (preserveExisting && params.get(key) != null && String(params.get(key)).trim() !== '') {
      return;
    }
    params.set(key, value);
  }

  function applyRipxCartAttrsToSearchParams(params, payload, preserveExisting) {
    if (!params || !payload) return false;
    var buyerVisibleSummary = getRipxBuyerVisibleLineSummary(payload);
    function collectItemIndexes() {
      var idxMap = {};
      var idxList = [];
      try {
        if (typeof params.forEach === 'function') {
          params.forEach(function (_value, key) {
            var m = String(key || '').match(/^items\[(\d+)\]\[[^\]]+\]/);
            if (!m) return;
            var idx = m[1];
            if (idxMap[idx]) return;
            idxMap[idx] = true;
            idxList.push(idx);
          });
        }
      } catch (e) {}
      return idxList;
    }
    function setItemProperty(index, propKey, value) {
      if (value === undefined || value === null || String(value).trim() === '') return;
      var itemKey = 'items[' + index + '][properties][' + propKey + ']';
      if (
        preserveExisting &&
        params.get(itemKey) != null &&
        String(params.get(itemKey)).trim() !== ''
      ) {
        return;
      }
      params.set(itemKey, value);
    }
    function removeLegacyPublicProps() {
      RIPX_PUBLIC_LINE_PROPERTY_KEYS.forEach(function (publicKey) {
        params.delete('properties[' + publicKey + ']');
      });
      params.delete('properties[' + RIPX_LEGACY_BUYER_VISIBLE_PROPERTY_KEY + ']');
      var indexes = collectItemIndexes();
      indexes.forEach(function (index) {
        RIPX_PUBLIC_LINE_PROPERTY_KEYS.forEach(function (publicKey) {
          params.delete('items[' + index + '][properties][' + publicKey + ']');
        });
        params.delete(
          'items[' + index + '][properties][' + RIPX_LEGACY_BUYER_VISIBLE_PROPERTY_KEY + ']'
        );
      });
    }
    function applyToItemIndexes() {
      var indexes = collectItemIndexes();
      if (!indexes.length) return false;
      indexes.forEach(function (index) {
        setItemProperty(index, RIPX_BUYER_VISIBLE_PROPERTY_KEY, buyerVisibleSummary);
        forEachRipxLineProperty(payload, function (propKey, value) {
          setItemProperty(index, propKey, value);
        });
      });
      return true;
    }
    removeLegacyPublicProps();
    setRipxAttrValueOnSearchParams(
      params,
      'properties[' + RIPX_BUYER_VISIBLE_PROPERTY_KEY + ']',
      buyerVisibleSummary,
      preserveExisting
    );
    setRipxAttrValueOnSearchParams(
      params,
      'properties[_ripx_price_test]',
      payload._ripx_price_test,
      preserveExisting
    );
    setRipxAttrValueOnSearchParams(
      params,
      'properties[_ripx_variant]',
      payload._ripx_variant,
      preserveExisting
    );
    setRipxAttrValueOnSearchParams(
      params,
      'properties[_ripx_shop]',
      payload._ripx_shop,
      preserveExisting
    );
    setRipxAttrValueOnSearchParams(
      params,
      'properties[_ripx_assignment_sig]',
      payload._ripx_assignment_sig,
      preserveExisting
    );
    setRipxAttrValueOnSearchParams(
      params,
      'properties[_ripx_assignment_ts]',
      payload._ripx_assignment_ts,
      preserveExisting
    );
    setRipxAttrValueOnSearchParams(
      params,
      'properties[_ripx_assignment_user]',
      payload._ripx_assignment_user,
      preserveExisting
    );
    setRipxAttrValueOnSearchParams(
      params,
      'properties[_ripx_target_unit]',
      payload._ripx_target_unit,
      preserveExisting
    );
    setRipxAttrValueOnSearchParams(
      params,
      'properties[_ripx_discount_unit]',
      payload._ripx_discount_unit,
      preserveExisting
    );
    setRipxAttrValueOnSearchParams(
      params,
      'properties[_ripx_price_method]',
      payload._ripx_price_method,
      preserveExisting
    );
    setRipxAttrValueOnSearchParams(
      params,
      'properties[_ripx_offer_discount_type]',
      payload._ripx_offer_discount_type,
      preserveExisting
    );
    setRipxAttrValueOnSearchParams(
      params,
      'properties[_ripx_offer_discount_value]',
      payload._ripx_offer_discount_value,
      preserveExisting
    );
    setRipxAttrValueOnSearchParams(
      params,
      'properties[_ripx_offer_code_name]',
      payload._ripx_offer_code_name,
      preserveExisting
    );
    forEachRipxLineProperty(payload, function (propKey, value) {
      setRipxAttrValueOnSearchParams(
        params,
        'properties[' + propKey + ']',
        value,
        preserveExisting
      );
    });
    applyToItemIndexes();
    return true;
  }

  function isCartAddPath(urlValue) {
    if (!urlValue) return false;
    try {
      var parsed = new URL(String(urlValue), window.location.origin);
      var p = (parsed.pathname || '').replace(/\/+$/, '');
      // Suffix match: /cart/add or /cart/add.js with any prefix (/en/…, /en-us/…, nested Markets paths).
      return /\/cart\/add(?:\.js)?$/i.test(p);
    } catch (e) {
      return false;
    }
  }

  function isCartUpdateOrChangePath(urlValue) {
    if (!urlValue) return false;
    try {
      var parsed = new URL(String(urlValue), window.location.origin);
      var p = (parsed.pathname || '').replace(/\/+$/, '');
      return /\/cart\/(?:change|update)(?:\.js)?$/i.test(p);
    } catch (e) {
      return false;
    }
  }

  /** @type {Record<string, true>} */
  var _ripxCartDebugNearMiss = {};

  function pathnameFromCartUrl(urlValue) {
    try {
      var p = new URL(String(urlValue), window.location.origin).pathname || '';
      return p.replace(/\/+$/, '') || '/';
    } catch (e) {
      return '(invalid-url)';
    }
  }

  function looksLikeCartAddNearMiss(urlValue) {
    if (!urlValue || isCartAddPath(urlValue)) return false;
    try {
      var p = (new URL(String(urlValue), window.location.origin).pathname || '').toLowerCase();
      return p.indexOf('cart') !== -1 && p.indexOf('add') !== -1;
    } catch (e) {
      return false;
    }
  }

  function debugLogCartNearMissOnce(pathname) {
    if (!DEBUG) return;
    if (_ripxCartDebugNearMiss[pathname]) return;
    if (Object.keys(_ripxCartDebugNearMiss).length >= 32) return;
    _ripxCartDebugNearMiss[pathname] = true;
    debugLog(
      'cart near-miss:',
      pathname,
      'POST path mentions cart+add but is not */cart/add(.js) — if this is add-to-cart, file an issue with the path pattern.'
    );
  }

  /** Body shape hint when patchCartAddBodyForRipx returns changed:false (debug only). */
  function debugDescribeCartAddBody(body) {
    if (body == null || body === '') return 'body:none';
    try {
      if (typeof FormData !== 'undefined' && body instanceof FormData) return 'body:FormData';
      if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
        return 'body:URLSearchParams';
      }
      if (typeof body === 'string') {
        var t = body.trim();
        if (!t) return 'body:string(empty)';
        var c0 = t.charAt(0);
        if (c0 === '{' || c0 === '[') return 'body:string(JSON)';
        if (t.indexOf('=') !== -1) return 'body:string(form)';
        return 'body:string(other)';
      }
      if (typeof Blob !== 'undefined' && body instanceof Blob) return 'body:Blob';
      if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer)
        return 'body:ArrayBuffer';
    } catch (e) {}
    return 'body:' + typeof body;
  }

  function getHeaderValue(headers, headerName) {
    if (!headers || !headerName) return '';
    var key = String(headerName).toLowerCase();
    try {
      if (typeof Headers !== 'undefined' && headers instanceof Headers) {
        return headers.get(headerName) || headers.get(key) || '';
      }
    } catch (e) {}
    if (Array.isArray(headers)) {
      for (var i = 0; i < headers.length; i++) {
        var pair = headers[i];
        if (Array.isArray(pair) && String(pair[0]).toLowerCase() === key) {
          return String(pair[1] || '');
        }
      }
      return '';
    }
    if (typeof headers === 'object') {
      for (var h in headers) {
        if (Object.prototype.hasOwnProperty.call(headers, h) && String(h).toLowerCase() === key) {
          return String(headers[h] || '');
        }
      }
    }
    return '';
  }

  function setHeaderValue(headers, headerName, headerValue) {
    if (!headers || !headerName) return;
    try {
      if (typeof Headers !== 'undefined' && headers instanceof Headers) {
        headers.set(headerName, headerValue);
        return;
      }
    } catch (e) {}
    if (Array.isArray(headers)) {
      var key = String(headerName).toLowerCase();
      for (var i = 0; i < headers.length; i++) {
        var pair = headers[i];
        if (Array.isArray(pair) && String(pair[0]).toLowerCase() === key) {
          pair[1] = headerValue;
          return;
        }
      }
      headers.push([headerName, headerValue]);
      return;
    }
    if (typeof headers === 'object') {
      headers[headerName] = headerValue;
    }
  }

  /**
   * Last-mile cart handoff for price tests.
   *
   * Themes submit cart adds in many shapes (FormData, JSON, URLSearchParams, raw strings). This
   * keeps RipX line properties attached so Cart Transform / Discount Function can trust the line.
   */
  function patchCartAddBodyForRipx(body, headers, payload) {
    if (!payload || !payload._ripx_price_test || !payload._ripx_variant) {
      if (DEBUG) debugLog('cart patch skip: missing _ripx_price_test / _ripx_variant on payload');
      return { changed: false, body: body };
    }
    function maybeSwapVariantId(currentId, swapState) {
      if (!shouldSwapRipxCartVariant(currentId, swapState)) return currentId;
      return swapState.mappedVariantId;
    }
    function applyNativeVariantSwapToObject(obj, swapState) {
      if (!obj || typeof obj !== 'object' || !swapState) return;
      if (obj.id != null) {
        obj.id = maybeSwapVariantId(obj.id, swapState);
      }
      if (Array.isArray(obj.items)) {
        for (var i = 0; i < obj.items.length; i++) {
          if (obj.items[i] && typeof obj.items[i] === 'object' && obj.items[i].id != null) {
            obj.items[i].id = maybeSwapVariantId(obj.items[i].id, swapState);
          }
        }
      }
      if (Array.isArray(obj.line_items)) {
        for (var j = 0; j < obj.line_items.length; j++) {
          if (
            obj.line_items[j] &&
            typeof obj.line_items[j] === 'object' &&
            obj.line_items[j].id != null
          ) {
            obj.line_items[j].id = maybeSwapVariantId(obj.line_items[j].id, swapState);
          }
        }
      }
    }
    function getCartLineVariantIdFromObject(obj) {
      if (!obj || typeof obj !== 'object') return '';
      return normalizeCartVariantId(
        obj.id || obj.variant_id || obj.variantId || obj.merchandise_id
      );
    }
    function payloadForCartLineVariant(basePayload, variantId) {
      return enrichRipxPayloadForCartVariant(basePayload, variantId);
    }
    function applyPricePreviewSectionsUrlToObject(obj) {
      // Price preview runs under /apps/ripx; Shopify section rendering must still use the real PDP
      // path or cart drawers can render wrong/empty sections after add/change/update.
      if (!PRICE_PREVIEW_TARGET_PATH || !obj || typeof obj !== 'object') return;
      obj.sections_url = PRICE_PREVIEW_TARGET_PATH;
    }
    var effectivePayload = payload;
    var nativeSwapState = getRipxNativeVariantSwapState(effectivePayload);
    if (!effectivePayload._ripx_target_unit || !effectivePayload._ripx_discount_unit) {
      var preferredPid = getPreferredRipxProductIdForCartAttrs();
      var rememberedTargetUnit = preferredPid
        ? getRememberedRipxTargetUnitForProductId(preferredPid)
        : '';
      var rememberedDiscountUnit = preferredPid
        ? getRememberedRipxDiscountUnitForProductId(preferredPid)
        : '';
      if (rememberedTargetUnit || rememberedDiscountUnit) {
        effectivePayload = Object.assign({}, payload, {
          _ripx_target_unit: effectivePayload._ripx_target_unit || rememberedTargetUnit,
          _ripx_discount_unit: effectivePayload._ripx_discount_unit || rememberedDiscountUnit,
        });
      }
    }
    if (!isRipxShippingCartState(effectivePayload) && !effectivePayload._ripx_price_method) {
      var preferredMethodPid = getPreferredRipxProductIdForCartAttrs();
      var rememberedPriceMethod = preferredMethodPid
        ? getRememberedRipxPriceMethodForProductId(preferredMethodPid)
        : '';
      if (rememberedPriceMethod) {
        effectivePayload = Object.assign({}, effectivePayload, {
          _ripx_price_method: rememberedPriceMethod,
        });
      }
    }

    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      var formPayload = effectivePayload;
      if (nativeSwapState && body.get && body.has && body.has('id')) {
        var formIdValue = body.get('id');
        if (shouldSwapRipxCartVariant(formIdValue, nativeSwapState)) {
          body.set('id', nativeSwapState.mappedVariantId);
        }
      }
      if (body.get && body.has && body.has('id')) {
        formPayload = payloadForCartLineVariant(formPayload, body.get('id'));
      }
      if (PRICE_PREVIEW_TARGET_PATH && body.set)
        body.set('sections_url', PRICE_PREVIEW_TARGET_PATH);
      applyRipxCartAttrsToFormData(body, formPayload, true);
      return { changed: true, body: body };
    }
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
      var paramsPayload = effectivePayload;
      if (nativeSwapState && body.has('id')) {
        var paramsIdValue = body.get('id');
        if (shouldSwapRipxCartVariant(paramsIdValue, nativeSwapState)) {
          body.set('id', nativeSwapState.mappedVariantId);
        }
      }
      if (body.has('id')) {
        paramsPayload = payloadForCartLineVariant(paramsPayload, body.get('id'));
      }
      if (PRICE_PREVIEW_TARGET_PATH) body.set('sections_url', PRICE_PREVIEW_TARGET_PATH);
      applyRipxCartAttrsToSearchParams(body, paramsPayload, true);
      return { changed: true, body: body };
    }
    if (typeof body === 'string') {
      var ct = String(getHeaderValue(headers, 'content-type') || '').toLowerCase();
      var trimmed = body.trim();

      var looksJson = ct.indexOf('application/json') !== -1 || /^\{[\s\S]*\}$/.test(trimmed);
      if (looksJson) {
        try {
          var obj = JSON.parse(trimmed || '{}');
          if (obj && typeof obj === 'object') {
            applyNativeVariantSwapToObject(obj, nativeSwapState);
            applyPricePreviewSectionsUrlToObject(obj);
            var objectRootPayload = payloadForCartLineVariant(
              effectivePayload,
              getCartLineVariantIdFromObject(obj)
            );
            function mergedRipxProps(existing, linePayload) {
              var propsPayload = linePayload || objectRootPayload;
              var nextProps = Object.assign({}, existing || {});
              RIPX_PUBLIC_LINE_PROPERTY_KEYS.forEach(function (publicKey) {
                if (Object.prototype.hasOwnProperty.call(nextProps, publicKey)) {
                  delete nextProps[publicKey];
                }
              });
              if (
                Object.prototype.hasOwnProperty.call(
                  nextProps,
                  RIPX_LEGACY_BUYER_VISIBLE_PROPERTY_KEY
                )
              ) {
                delete nextProps[RIPX_LEGACY_BUYER_VISIBLE_PROPERTY_KEY];
              }
              function setPropIfMissing(key, value) {
                if (value === undefined || value === null || String(value).trim() === '') return;
                if (nextProps[key] != null && String(nextProps[key]).trim() !== '') return;
                nextProps[key] = value;
              }
              function setRipxAssignmentProp(key, value) {
                if (value === undefined || value === null || String(value).trim() === '') return;
                nextProps[key] = value;
              }
              var overwriteRipxAssignmentProps = propsPayload && propsPayload.__ripx_shipping_test;
              var setAssignmentProp = overwriteRipxAssignmentProps
                ? setRipxAssignmentProp
                : setPropIfMissing;
              setPropIfMissing(
                RIPX_BUYER_VISIBLE_PROPERTY_KEY,
                getRipxBuyerVisibleLineSummary(propsPayload)
              );
              setAssignmentProp('_ripx_price_test', propsPayload._ripx_price_test);
              setAssignmentProp('_ripx_variant', propsPayload._ripx_variant);
              setAssignmentProp('_ripx_shop', propsPayload._ripx_shop);
              setAssignmentProp('_ripx_assignment_sig', propsPayload._ripx_assignment_sig);
              setAssignmentProp('_ripx_assignment_ts', propsPayload._ripx_assignment_ts);
              setAssignmentProp('_ripx_assignment_user', propsPayload._ripx_assignment_user);
              setPropIfMissing('_ripx_target_unit', propsPayload._ripx_target_unit);
              setPropIfMissing('_ripx_discount_unit', propsPayload._ripx_discount_unit);
              setPropIfMissing('_ripx_price_method', propsPayload._ripx_price_method);
              setPropIfMissing('_ripx_offer_discount_type', propsPayload._ripx_offer_discount_type);
              setPropIfMissing(
                '_ripx_offer_discount_value',
                propsPayload._ripx_offer_discount_value
              );
              setPropIfMissing('_ripx_offer_code_name', propsPayload._ripx_offer_code_name);
              forEachRipxLineProperty(propsPayload, setPropIfMissing);
              return nextProps;
            }
            function mapCartLinesWithRipx(arr) {
              if (!Array.isArray(arr)) return;
              for (var li = 0; li < arr.length; li++) {
                var item = arr[li];
                if (!item || typeof item !== 'object') continue;
                var nextItem = Object.assign({}, item);
                nextItem.properties = mergedRipxProps(
                  item.properties,
                  payloadForCartLineVariant(effectivePayload, getCartLineVariantIdFromObject(item))
                );
                arr[li] = nextItem;
              }
            }
            var hasItems = Array.isArray(obj.items);
            var hasLineItems = Array.isArray(obj.line_items);
            if (hasItems) {
              mapCartLinesWithRipx(obj.items);
            }
            if (hasLineItems) {
              mapCartLinesWithRipx(obj.line_items);
            }
            if (!hasItems && !hasLineItems) {
              obj.properties = mergedRipxProps(obj.properties, objectRootPayload);
            }
            return {
              changed: true,
              body: JSON.stringify(obj),
              contentType: 'application/json',
            };
          }
        } catch (e) {
          if (DEBUG) {
            debugLog('cart patch: JSON parse failed', e && (e.message || String(e)));
          }
        }
      }

      var looksUrlEncoded =
        ct.indexOf('application/x-www-form-urlencoded') !== -1 || trimmed.indexOf('=') !== -1;
      if (looksUrlEncoded) {
        try {
          var params = new URLSearchParams(body);
          var stringPayload = effectivePayload;
          if (nativeSwapState && params.has('id')) {
            var stringIdValue = params.get('id');
            if (shouldSwapRipxCartVariant(stringIdValue, nativeSwapState)) {
              params.set('id', nativeSwapState.mappedVariantId);
            }
          }
          if (params.has('id')) {
            stringPayload = payloadForCartLineVariant(stringPayload, params.get('id'));
          }
          applyRipxCartAttrsToSearchParams(params, stringPayload, true);
          return {
            changed: true,
            body: params.toString(),
            contentType: 'application/x-www-form-urlencoded; charset=UTF-8',
          };
        } catch (e) {
          if (DEBUG) {
            debugLog('cart patch: URLSearchParams parse failed', e && (e.message || String(e)));
          }
        }
      }
    }
    return { changed: false, body: body };
  }

  function patchPricePreviewSectionsUrl(body, headers) {
    if (!PRICE_PREVIEW_TARGET_PATH) return { changed: false, body: body };
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      if (body.set) body.set('sections_url', PRICE_PREVIEW_TARGET_PATH);
      return { changed: true, body: body };
    }
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
      body.set('sections_url', PRICE_PREVIEW_TARGET_PATH);
      return { changed: true, body: body };
    }
    if (typeof body === 'string') {
      var ct = String(getHeaderValue(headers, 'content-type') || '').toLowerCase();
      var trimmed = body.trim();
      var looksJson = ct.indexOf('application/json') !== -1 || /^\{[\s\S]*\}$/.test(trimmed);
      if (looksJson) {
        try {
          var obj = JSON.parse(trimmed || '{}');
          if (obj && typeof obj === 'object') {
            obj.sections_url = PRICE_PREVIEW_TARGET_PATH;
            return { changed: true, body: JSON.stringify(obj), contentType: 'application/json' };
          }
        } catch (eJson) {}
      }
      var looksUrlEncoded =
        ct.indexOf('application/x-www-form-urlencoded') !== -1 || trimmed.indexOf('=') !== -1;
      if (looksUrlEncoded) {
        try {
          var params = new URLSearchParams(body);
          params.set('sections_url', PRICE_PREVIEW_TARGET_PATH);
          return {
            changed: true,
            body: params.toString(),
            contentType: 'application/x-www-form-urlencoded; charset=UTF-8',
          };
        } catch (eParams) {}
      }
    }
    return { changed: false, body: body };
  }

  function getRipxCartLevelAttributesPayload(state) {
    var src = state || _ripxCartAttributeState;
    if (!src || !src._ripx_price_test || !src._ripx_variant) return null;
    return {
      _ripx_price_test: String(src._ripx_price_test).trim(),
      _ripx_variant: String(src._ripx_variant).trim(),
      ripx_price_test: String(src._ripx_price_test).trim(),
      ripx_variant: String(src._ripx_variant).trim(),
    };
  }

  function syncRipxCartLevelAttributes(reason, options) {
    var opts = options && typeof options === 'object' ? options : {};
    var force = Boolean(opts.force);
    var attrs = getRipxCartLevelAttributesPayload(_ripxCartAttributeState);
    if (!attrs || !_ripxNativeFetch) return Promise.resolve(false);
    if (_ripxCartLevelAttributeSyncInFlight) {
      return _ripxCartLevelAttributeSyncInFlight;
    }
    var now = Date.now();
    if (!force && now - _ripxCartLevelAttributeSyncLastAt < 400) return Promise.resolve(false);
    _ripxCartLevelAttributeSyncLastAt = now;
    _ripxCartLevelAttributeSyncInFlight = _ripxNativeFetch('/cart/update.js', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ attributes: attrs }),
    })
      .then(function (response) {
        var ok = !!(response && response.ok);
        recordShippingDebugStep(ok ? 'cart_level_attrs_synced' : 'cart_level_attrs_sync_failed', {
          reason: reason || 'unknown',
          status: response && response.status ? response.status : null,
        });
        return ok;
      })
      .catch(function () {
        recordShippingDebugStep('cart_level_attrs_sync_exception', {
          reason: reason || 'unknown',
        });
        return false;
      })
      .finally(function () {
        _ripxCartLevelAttributeSyncInFlight = null;
      });
    return _ripxCartLevelAttributeSyncInFlight;
  }

  function getRipxLinePropertiesPayload(state) {
    var src = state || _ripxCartAttributeState;
    if (!src || !src._ripx_price_test || !src._ripx_variant) return null;
    var out = {};
    function put(key, value) {
      if (!value) return;
      var v = String(value).trim();
      if (!v) return;
      out[key] = v;
    }
    forEachRipxLineProperty(src, put);
    put(RIPX_BUYER_VISIBLE_PROPERTY_KEY, getRipxBuyerVisibleLineSummary(src));
    return out._ripx_price_test && out._ripx_variant ? out : null;
  }

  function linePropertiesNeedRipxRepair(line, desiredProps) {
    if (!line || !desiredProps) return false;
    var current = line.properties && typeof line.properties === 'object' ? line.properties : {};
    var keys = Object.keys(desiredProps);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (!key) continue;
      if (current[key] == null || String(current[key]).trim() === '') return true;
      if (
        (key === '_ripx_price_test' ||
          key === '_ripx_variant' ||
          key === '_ripx_assignment_sig' ||
          key === '_ripx_assignment_ts' ||
          key === '_ripx_assignment_user') &&
        String(current[key]).trim() !== String(desiredProps[key]).trim()
      ) {
        return true;
      }
    }
    return false;
  }

  function findRipxRepairLineIndex(cartState, desiredProps) {
    if (!cartState || !Array.isArray(cartState.items) || !cartState.items.length) return -1;
    var preferredVariant = normalizeCartVariantId(
      (_ripxCartAttributeState && _ripxCartAttributeState.__ripx_native_variant_id) ||
        (_ripxCartAttributeState && _ripxCartAttributeState.__ripx_source_variant_id) ||
        ''
    );
    var fallbackIndex = -1;
    var repairCandidateCount = 0;
    for (var i = cartState.items.length - 1; i >= 0; i--) {
      var item = cartState.items[i];
      if (!linePropertiesNeedRipxRepair(item, desiredProps)) continue;
      repairCandidateCount++;
      if (!preferredVariant) return i;
      if (normalizeCartVariantId(item && item.variant_id) === preferredVariant) return i;
      if (fallbackIndex < 0) fallbackIndex = i;
    }
    // When variant metadata is unavailable but only one line is missing RipX properties, repair that
    // unique candidate. This covers native/drawer cart flows that add a line before our matcher can
    // see stable variant data, without risking multi-line carts.
    if (fallbackIndex >= 0 && (PRICE_PREVIEW_FRAME || repairCandidateCount === 1)) {
      return fallbackIndex;
    }
    return -1;
  }

  function countRipxRepairCandidates(cartState, desiredProps) {
    if (!cartState || !Array.isArray(cartState.items) || !desiredProps) return 0;
    var count = 0;
    for (var i = 0; i < cartState.items.length; i++) {
      if (linePropertiesNeedRipxRepair(cartState.items[i], desiredProps)) count++;
    }
    return count;
  }

  function cartLinesAlreadyHaveRipxAssignment(cartState, desiredProps) {
    if (!cartState || !Array.isArray(cartState.items) || !cartState.items.length || !desiredProps) {
      return false;
    }
    return countRipxRepairCandidates(cartState, desiredProps) === 0;
  }

  function findAllRipxRepairLineIndexes(cartState, desiredProps) {
    if (!cartState || !Array.isArray(cartState.items) || !cartState.items.length) return [];
    var indexes = [];
    for (var i = 0; i < cartState.items.length; i += 1) {
      if (linePropertiesNeedRipxRepair(cartState.items[i], desiredProps)) {
        indexes.push(i);
      }
    }
    return indexes;
  }

  function repairRipxCartLineAtIndex(cartState, lineIndex, desiredProps, reason) {
    var item = cartState.items[lineIndex] || {};
    var mergedProps = Object.assign({}, item.properties || {}, desiredProps);
    var requestBody = JSON.stringify({
      line: lineIndex + 1,
      quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
      properties: mergedProps,
    });
    return _ripxNativeFetch('/cart/change.js', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: requestBody,
    })
      .then(function (res) {
        if (!res || !res.ok) {
          recordShippingDebugStep('cart_repair_failed', {
            reason: reason || 'unknown',
            status: res && res.status ? res.status : null,
            line: lineIndex + 1,
          });
          return false;
        }
        recordShippingDebugStep('cart_repair_succeeded', {
          reason: reason || 'unknown',
          line: lineIndex + 1,
          keys: Object.keys(mergedProps || {}),
        });
        return true;
      })
      .catch(function () {
        recordShippingDebugStep('cart_repair_change_exception', {
          reason: reason || 'unknown',
          line: lineIndex + 1,
        });
        return false;
      });
  }

  function maybeRepairRipxCartLineProperties(reason) {
    var desiredProps = getRipxLinePropertiesPayload(_ripxCartAttributeState);
    if (!desiredProps || !_ripxNativeFetch) {
      recordShippingDebugStep('cart_repair_skipped', {
        reason: reason || 'unknown',
        hasDesiredProps: Boolean(desiredProps),
        hasNativeFetch: Boolean(_ripxNativeFetch),
      });
      return Promise.resolve(false);
    }
    if (_ripxCartPropsRepairInFlight) {
      recordShippingDebugStep('cart_repair_joined_inflight', { reason: reason || 'unknown' });
      return _ripxCartPropsRepairInFlight;
    }
    var now = Date.now();
    var checkoutHandoffReason =
      String(reason || '')
        .trim()
        .toLowerCase()
        .indexOf('checkout') === 0;
    if (!checkoutHandoffReason && now - _ripxCartPropsRepairLastAt < 300) {
      recordShippingDebugStep('cart_repair_throttled', { reason: reason || 'unknown' });
      return Promise.resolve(false);
    }
    _ripxCartPropsRepairLastAt = now;
    recordShippingDebugStep('cart_repair_started', {
      reason: reason || 'unknown',
      desiredKeys: Object.keys(desiredProps || {}),
    });
    _ripxCartPropsRepairInFlight = _ripxNativeFetch('/cart.js', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    })
      .then(function (response) {
        if (!response || !response.ok) return null;
        return response.json().catch(function () {
          return null;
        });
      })
      .then(function (cartState) {
        var shippingRepairAllLines = isRipxShippingCartState(_ripxCartAttributeState);
        var lineIndexes = shippingRepairAllLines
          ? findAllRipxRepairLineIndexes(cartState, desiredProps)
          : (function () {
              var singleIndex = findRipxRepairLineIndex(cartState, desiredProps);
              return singleIndex >= 0 ? [singleIndex] : [];
            })();
        if (lineIndexes.length === 0) {
          if (cartLinesAlreadyHaveRipxAssignment(cartState, desiredProps)) {
            recordShippingDebugStep('cart_repair_already_complete', {
              reason: reason || 'unknown',
              itemCount: Array.isArray(cartState && cartState.items) ? cartState.items.length : 0,
            });
            syncRipxCartLevelAttributes(reason || 'repair-already-complete');
            return true;
          }
          recordShippingDebugStep('cart_repair_no_matching_line', {
            reason: reason || 'unknown',
            itemCount: Array.isArray(cartState && cartState.items) ? cartState.items.length : 0,
            cartEmpty:
              !cartState || !Array.isArray(cartState.items) || cartState.items.length === 0,
          });
          if (DEBUG) {
            debugLog('cart props repair skipped:', reason || 'unknown', 'no matching line');
          }
          return false;
        }
        var repairChain = Promise.resolve(true);
        for (var li = 0; li < lineIndexes.length; li += 1) {
          (function (lineIndex) {
            repairChain = repairChain.then(function () {
              return repairRipxCartLineAtIndex(cartState, lineIndex, desiredProps, reason);
            });
          })(lineIndexes[li]);
        }
        return repairChain.then(function () {
          scheduleRipxCartNativeStateRefreshBurst();
          syncRipxCartLevelAttributes(reason || 'repair-complete');
          return true;
        });
      })
      .catch(function () {
        recordShippingDebugStep('cart_repair_exception', { reason: reason || 'unknown' });
        return false;
      })
      .finally(function () {
        _ripxCartPropsRepairInFlight = null;
      });
    return _ripxCartPropsRepairInFlight;
  }

  function shouldRepairRipxCartBeforeCheckout() {
    return !!(getRipxLinePropertiesPayload(_ripxCartAttributeState) && _ripxNativeFetch);
  }

  function isCheckoutPath(url) {
    var path = pathnameFromCartUrl(url || '');
    return path === '/checkout' || path.indexOf('/checkout/') === 0;
  }

  function isCheckoutForm(form) {
    if (!form || typeof form.getAttribute !== 'function') return false;
    return isCheckoutPath(form.getAttribute('action') || '');
  }

  function findCheckoutControl(node) {
    if (!node || typeof node.closest !== 'function') return null;
    return node.closest(
      'a[href*="/checkout"], button[name="checkout"], input[name="checkout"], [data-ripx-checkout], [data-checkout-button]'
    );
  }

  function isCheckoutSubmitControl(control) {
    if (!control || typeof control.getAttribute !== 'function') return false;
    var name = String(control.getAttribute('name') || '')
      .trim()
      .toLowerCase();
    if (name === 'checkout') return true;
    if (control.hasAttribute && control.hasAttribute('data-checkout-button')) return true;
    if (control.hasAttribute && control.hasAttribute('data-ripx-checkout')) return true;
    return false;
  }

  function continueCheckoutAfterRepair(control, form) {
    try {
      if (form) {
        form.__ripxCheckoutRepairSubmitting = true;
        if (
          control &&
          control.form === form &&
          typeof form.requestSubmit === 'function' &&
          (control.tagName === 'BUTTON' || control.tagName === 'INPUT')
        ) {
          // Preserve submitter semantics (e.g., name="checkout") so Shopify routes to checkout
          // instead of plain /cart form submission.
          form.requestSubmit(control);
          return;
        }
        if (typeof form.requestSubmit === 'function') {
          form.requestSubmit();
          return;
        }
        if (typeof form.submit === 'function') {
          form.submit();
          return;
        }
      }
      if (control && control.href) {
        window.location.href = control.href;
      }
    } catch (e) {}
  }

  function installRipxCheckoutNavigationGuards() {
    if (_ripxCheckoutNavigationGuardsInstalled) return;
    _ripxCheckoutNavigationGuardsInstalled = true;
    if (!document || typeof document.addEventListener !== 'function') return;
    function guard(event, control, form) {
      if (!shouldRepairRipxCartBeforeCheckout()) {
        recordShippingDebugStep('checkout_handoff_no_repair_state', {
          hasControl: Boolean(control),
          hasForm: Boolean(form),
        });
        return false;
      }
      if (form && form.__ripxCheckoutRepairSubmitting) return false;
      recordShippingDebugStep('checkout_handoff_started', {
        href: control && control.href ? control.href : null,
        formAction: form && form.getAttribute ? form.getAttribute('action') : null,
      });
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      if (event && typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      } else if (event && typeof event.stopPropagation === 'function') {
        event.stopPropagation();
      }
      Promise.all([
        _ripxShippingPreviewHandoffDeferred && PREVIEW_TEST_ID
          ? getVariant(PREVIEW_TEST_ID).then(function (previewVariant) {
              var previewTest =
                getActiveTestById(PREVIEW_TEST_ID) || makeSyntheticPreviewShippingTest();
              if (previewTest && previewVariant && testTypeIsShipping(previewTest)) {
                finalizeShippingPreviewCartHandoff(previewTest, previewVariant, 'checkout-start');
              }
              return syncRipxCartLevelAttributes('checkout-start', { force: true });
            })
          : syncRipxCartLevelAttributes('checkout-start', { force: true }),
        maybeRepairRipxCartLineProperties('checkout-start'),
      ])
        .then(function (results) {
          var cartLevelSynced = Array.isArray(results) ? Boolean(results[0]) : false;
          var linePropsRepaired = Array.isArray(results) ? Boolean(results[1]) : false;
          recordShippingDebugStep('checkout_handoff_repair_result', {
            cartLevelSynced: cartLevelSynced,
            linePropsRepaired: linePropsRepaired,
          });
        })
        .catch(function (error) {
          recordShippingDebugStep('checkout_handoff_repair_failed', {
            message:
              error && error.message ? String(error.message) : String(error || 'unknown error'),
          });
        })
        .finally(function () {
          continueCheckoutAfterRepair(control, form);
        });
      return true;
    }
    document.addEventListener(
      'submit',
      function (event) {
        var form = event && event.target;
        if (!isCheckoutForm(form)) return;
        guard(event, null, form);
      },
      true
    );
    document.addEventListener(
      'click',
      function (event) {
        var control = findCheckoutControl(event && event.target);
        if (!control) return;
        var controlForm = control.form || (control.closest && control.closest('form'));
        var form = null;
        if (controlForm && (isCheckoutForm(controlForm) || isCheckoutSubmitControl(control))) {
          form = controlForm;
        }
        guard(event, control, form);
      },
      true
    );
  }

  function scheduleRipxCartPropsRepairBurst(reason) {
    maybeRepairRipxCartLineProperties(reason || 'immediate');
    syncRipxCartLevelAttributes(reason || 'burst');
    var delays = PRICE_PREVIEW_FRAME ? [120, 420, 1100, 2200, 4200] : [120, 420, 1100];
    for (var i = 0; i < delays.length; i++) {
      (function (delayMs) {
        var timer = setTimeout(function () {
          var idx = _ripxCartPropsRepairTimers.indexOf(timer);
          if (idx >= 0) _ripxCartPropsRepairTimers.splice(idx, 1);
          maybeRepairRipxCartLineProperties((reason || 'burst') + '-t' + String(delayMs));
        }, delayMs);
        _ripxCartPropsRepairTimers.push(timer);
      })(delays[i]);
    }
  }

  function installRipxCartAddInterceptors() {
    if (_ripxCartAddInterceptorsInstalled) return;
    _ripxCartAddInterceptorsInstalled = true;
    installRipxCartSubmitGuards();
    installRipxCheckoutNavigationGuards();

    // Intercept fetch('/cart/add(.js)') theme flows (no HTML form submit path).
    if (typeof window.fetch === 'function') {
      var nativeFetch = window.fetch.bind(window);
      function finishRipxCartAddFetch(input, init, patchReason) {
        return nativeFetch(input, init).then(function (response) {
          if (response && response.ok) {
            fireAutomaticGoalEvent(
              'add_to_cart',
              'cart_add_fetch',
              { metadata: { cart_add_reason: patchReason || 'fetch' } },
              null,
              CONFIG.activeTests || [],
              1500
            );
            scheduleRipxCartNativeStateRefreshBurst();
            scheduleRipxCartPropsRepairBurst(patchReason || 'fetch');
            schedulePreviewBootstrapReloadAfterCartAdd(patchReason || 'fetch');
          }
          return response;
        });
      }
      function sendRipxPatchedCartAddFetch(input, init, state, ripxCartPath, patchReason) {
        var nextInit = init ? Object.assign({}, init) : {};
        if (!nextInit.headers) nextInit.headers = (input && input.headers) || {};
        function applyPatchAndSend(bodyValue, label) {
          if (bodyValue !== undefined) nextInit.body = bodyValue;
          var patch = patchCartAddBodyForRipx(nextInit.body, nextInit.headers, state);
          if (patch.changed) {
            nextInit.body = patch.body;
            if (patch.contentType && !getHeaderValue(nextInit.headers, 'content-type')) {
              setHeaderValue(nextInit.headers, 'Content-Type', patch.contentType);
            }
          }
          recordShippingDebugStep('cart_add_fetch_patch_result', {
            path: ripxCartPath,
            changed: Boolean(patch.changed),
            bodyShape: debugDescribeCartAddBody(nextInit.body),
          });
          if (DEBUG) {
            debugLog(
              'cart intercept fetch:',
              ripxCartPath,
              patch.changed ? 'patched' : 'unchanged',
              patch.changed ? '' : debugDescribeCartAddBody(nextInit.body),
              label || ''
            );
          }
          return finishRipxCartAddFetch(input, nextInit, patchReason || 'fetch');
        }
        if (nextInit.body === undefined && input && typeof input !== 'string') {
          if (typeof FormData !== 'undefined' && input.body && input.body instanceof FormData) {
            nextInit.body = input.body;
          } else if (
            typeof URLSearchParams !== 'undefined' &&
            input.body &&
            input.body instanceof URLSearchParams
          ) {
            nextInit.body = input.body;
          } else if (typeof input.body === 'string') {
            nextInit.body = input.body;
          } else if (
            typeof Blob !== 'undefined' &&
            input.body &&
            input.body instanceof Blob &&
            typeof input.body.text === 'function'
          ) {
            return input.body
              .text()
              .then(function (bodyText) {
                return applyPatchAndSend(bodyText, 'blob');
              })
              .catch(function () {
                return nativeFetch(input, init);
              });
          } else if (typeof input.clone === 'function' && typeof input.text === 'function') {
            return input
              .clone()
              .text()
              .then(function (requestBodyText) {
                return applyPatchAndSend(requestBodyText, 'request-text');
              })
              .catch(function () {
                return nativeFetch(input, init);
              });
          }
        }
        if (
          typeof Blob !== 'undefined' &&
          nextInit.body &&
          nextInit.body instanceof Blob &&
          typeof nextInit.body.text === 'function'
        ) {
          return nextInit.body
            .text()
            .then(function (blobText) {
              return applyPatchAndSend(blobText, 'blob');
            })
            .catch(function () {
              return nativeFetch(input, init);
            });
        }
        return applyPatchAndSend(undefined, '');
      }
      window.fetch = function (input, init) {
        try {
          var url =
            typeof input === 'string'
              ? input
              : input && typeof input.url === 'string'
                ? input.url
                : '';
          var methodRaw =
            (init && init.method) || (typeof input !== 'string' && input && input.method) || 'GET';
          var method = String(methodRaw || 'GET').toUpperCase();

          if (method === 'POST' && isCartAddPath(url)) {
            var ripxCartPath = pathnameFromCartUrl(url);
            recordShippingDebugStep('cart_add_fetch_seen', {
              path: ripxCartPath,
              hasLineState: isRipxCartAddStateReady(_ripxCartAttributeState),
            });
            if (DEBUG && !_ripxCartAttributeState) {
              debugLog('cart intercept fetch:', ripxCartPath, '— waiting for RipX line state');
            }
            // Preview: never delay theme cart/add. Patch if ready; hydrate in background.
            if (PREVIEW_MODE || PREVIEW_SIMPLE_MODE) {
              var previewFetchReady = isRipxCartAddStateReady(_ripxCartAttributeState);
              ripxTrace('S10', 'ATC fetch — preview non-blocking', {
                path: ripxCartPath,
                ready: previewFetchReady,
              });
              if (!previewFetchReady) {
                waitForRipxCartAttributeStateBeforeAdd('fetch-preview-bg');
              }
              if (isRipxCartAddStateReady(_ripxCartAttributeState)) {
                return sendRipxPatchedCartAddFetch(
                  input,
                  init,
                  _ripxCartAttributeState,
                  ripxCartPath,
                  'fetch-preview'
                );
              }
              return finishRipxCartAddFetch(input, init, 'fetch-preview-no-delay');
            }
            if (
              !isRipxCartAddStateReady(_ripxCartAttributeState) &&
              !shouldWaitForRipxCartAddState()
            ) {
              recordShippingDebugStep('cart_add_fetch_no_candidate_state', { path: ripxCartPath });
              return finishRipxCartAddFetch(input, init, 'fetch-no-ripx-candidate');
            }
            return waitForRipxCartAttributeStateBeforeAdd('fetch').then(function (state) {
              if (!state) {
                recordShippingDebugStep('cart_add_fetch_no_state_after_wait', {
                  path: ripxCartPath,
                });
                return finishRipxCartAddFetch(input, init, 'fetch-no-state');
              }
              recordShippingDebugStep('cart_add_fetch_state_ready', {
                path: ripxCartPath,
                testId: state._ripx_price_test || null,
                variant: state._ripx_variant || null,
              });
              return sendRipxPatchedCartAddFetch(input, init, state, ripxCartPath, 'fetch');
            });
          } else if (PRICE_PREVIEW_FRAME && method === 'POST' && isCartUpdateOrChangePath(url)) {
            var sectionsInit = init ? Object.assign({}, init) : {};
            if (!sectionsInit.headers) sectionsInit.headers = (input && input.headers) || {};
            if (sectionsInit.body === undefined && input && typeof input !== 'string') {
              if (typeof FormData !== 'undefined' && input.body && input.body instanceof FormData) {
                sectionsInit.body = input.body;
              } else if (
                typeof URLSearchParams !== 'undefined' &&
                input.body &&
                input.body instanceof URLSearchParams
              ) {
                sectionsInit.body = input.body;
              } else if (typeof input.body === 'string') {
                sectionsInit.body = input.body;
              } else if (typeof input.clone === 'function' && typeof input.text === 'function') {
                return input
                  .clone()
                  .text()
                  .then(function (requestBodyText) {
                    var asyncSectionsInit = Object.assign({}, sectionsInit);
                    asyncSectionsInit.body = requestBodyText;
                    var asyncSectionsPatch = patchPricePreviewSectionsUrl(
                      asyncSectionsInit.body,
                      asyncSectionsInit.headers
                    );
                    if (asyncSectionsPatch.changed) {
                      asyncSectionsInit.body = asyncSectionsPatch.body;
                      if (
                        asyncSectionsPatch.contentType &&
                        !getHeaderValue(asyncSectionsInit.headers, 'content-type')
                      ) {
                        setHeaderValue(
                          asyncSectionsInit.headers,
                          'Content-Type',
                          asyncSectionsPatch.contentType
                        );
                      }
                    }
                    return nativeFetch(input, asyncSectionsInit).then(function (response) {
                      if (response && response.ok) scheduleRipxCartNativeStateRefreshBurst();
                      return response;
                    });
                  })
                  .catch(function () {
                    return nativeFetch(input, init);
                  });
              }
            }
            var sectionsPatch = patchPricePreviewSectionsUrl(
              sectionsInit.body,
              sectionsInit.headers
            );
            if (sectionsPatch.changed) {
              sectionsInit.body = sectionsPatch.body;
              if (
                sectionsPatch.contentType &&
                !getHeaderValue(sectionsInit.headers, 'content-type')
              ) {
                setHeaderValue(sectionsInit.headers, 'Content-Type', sectionsPatch.contentType);
              }
            }
            return nativeFetch(input, sectionsInit).then(function (response) {
              if (response && response.ok) scheduleRipxCartNativeStateRefreshBurst();
              return response;
            });
          } else if (DEBUG && method === 'POST' && looksLikeCartAddNearMiss(url)) {
            debugLogCartNearMissOnce(pathnameFromCartUrl(url));
          }
        } catch (e) {}
        return nativeFetch(input, init);
      };
    }

    // Intercept XHR cart/add flows used by older or custom themes.
    if (typeof XMLHttpRequest !== 'undefined') {
      var origOpen = XMLHttpRequest.prototype.open;
      var origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
      var origSend = XMLHttpRequest.prototype.send;

      XMLHttpRequest.prototype.open = function (method, url) {
        this.__ripxMethod = method;
        this.__ripxUrl = url;
        this.__ripxContentType = '';
        return origOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
        if (name && String(name).toLowerCase() === 'content-type') {
          this.__ripxContentType = String(value || '');
        }
        return origSetHeader.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function (body) {
        try {
          var method = String(this.__ripxMethod || 'GET').toUpperCase();
          var xhrCartPath = pathnameFromCartUrl(this.__ripxUrl);
          if (method === 'POST' && isCartAddPath(this.__ripxUrl)) {
            recordShippingDebugStep('cart_add_xhr_seen', {
              path: xhrCartPath,
              hasLineState: isRipxCartAddStateReady(_ripxCartAttributeState),
            });
            var self = this;
            try {
              self.addEventListener(
                'loadend',
                function () {
                  if (self.status >= 200 && self.status < 300) {
                    fireAutomaticGoalEvent(
                      'add_to_cart',
                      'cart_add_xhr',
                      { metadata: { cart_add_reason: 'xhr' } },
                      null,
                      CONFIG.activeTests || [],
                      1500
                    );
                    scheduleRipxCartNativeStateRefreshBurst();
                    scheduleRipxCartPropsRepairBurst('xhr');
                    schedulePreviewBootstrapReloadAfterCartAdd('xhr');
                  }
                },
                { once: true }
              );
            } catch (eAdd) {}
            if (!isRipxCartAddStateReady(_ripxCartAttributeState)) {
              if (!shouldWaitForRipxCartAddState()) {
                recordShippingDebugStep('cart_add_xhr_no_candidate_state', { path: xhrCartPath });
                return origSend.call(this, body);
              }
              // Preview: never delay XHR cart/add — theme controls must stay responsive.
              if (PREVIEW_MODE || PREVIEW_SIMPLE_MODE) {
                waitForRipxCartAttributeStateBeforeAdd('xhr-preview-bg');
                recordShippingDebugStep('cart_add_xhr_preview_no_delay', { path: xhrCartPath });
                return origSend.call(this, body);
              }
              if (DEBUG) {
                debugLog('cart intercept xhr:', xhrCartPath, '— waiting for RipX line state');
              }
              waitForRipxCartAttributeStateBeforeAdd('xhr').then(function (state) {
                var delayedBody = body;
                if (state) {
                  var delayedHeaderObj = { 'content-type': self.__ripxContentType || '' };
                  var delayedPatch = patchCartAddBodyForRipx(body, delayedHeaderObj, state);
                  recordShippingDebugStep('cart_add_xhr_patch_after_wait', {
                    path: xhrCartPath,
                    changed: Boolean(delayedPatch.changed),
                  });
                  delayedBody = delayedPatch.body;
                  if (delayedPatch.contentType && !self.__ripxContentType) {
                    self.setRequestHeader('Content-Type', delayedPatch.contentType);
                    self.__ripxContentType = delayedPatch.contentType;
                  }
                  scheduleRipxCartPropsRepairBurst('xhr-late-state');
                  if (DEBUG) {
                    debugLog(
                      'cart intercept xhr:',
                      xhrCartPath,
                      delayedPatch.changed ? 'patched after wait' : 'unchanged after wait',
                      delayedPatch.changed ? '' : debugDescribeCartAddBody(body)
                    );
                  }
                } else {
                  recordShippingDebugStep('cart_add_xhr_no_state_after_wait', {
                    path: xhrCartPath,
                  });
                }
                return origSend.call(self, delayedBody);
              });
              return undefined;
            } else {
              var bodyBeforeXhr = body;
              var headerObj = { 'content-type': this.__ripxContentType || '' };
              var patch = patchCartAddBodyForRipx(body, headerObj, _ripxCartAttributeState);
              recordShippingDebugStep('cart_add_xhr_patch_result', {
                path: xhrCartPath,
                changed: Boolean(patch.changed),
              });
              body = patch.body;
              if (patch.contentType && !this.__ripxContentType) {
                this.setRequestHeader('Content-Type', patch.contentType);
                this.__ripxContentType = patch.contentType;
              }
              if (DEBUG) {
                debugLog(
                  'cart intercept xhr:',
                  xhrCartPath,
                  patch.changed ? 'patched' : 'unchanged',
                  patch.changed ? '' : debugDescribeCartAddBody(bodyBeforeXhr)
                );
              }
            }
          } else if (
            PRICE_PREVIEW_FRAME &&
            method === 'POST' &&
            isCartUpdateOrChangePath(this.__ripxUrl)
          ) {
            var sectionsHeaderObj = { 'content-type': this.__ripxContentType || '' };
            var sectionsPatch = patchPricePreviewSectionsUrl(body, sectionsHeaderObj);
            body = sectionsPatch.body;
            if (sectionsPatch.contentType && !this.__ripxContentType) {
              this.setRequestHeader('Content-Type', sectionsPatch.contentType);
              this.__ripxContentType = sectionsPatch.contentType;
            }
          } else if (DEBUG && method === 'POST' && looksLikeCartAddNearMiss(this.__ripxUrl)) {
            debugLogCartNearMissOnce(xhrCartPath);
          }
        } catch (e) {}
        return origSend.call(this, body);
      };
    }
  }

  function isRipxCartAddForm(form) {
    if (!form || !form.getAttribute) return false;
    var action = form.getAttribute('action') || '';
    if (action && isCartAddPath(action)) return true;
    return !!(
      (form.hasAttribute && form.hasAttribute('data-ajax-cart-form')) ||
      (form.hasAttribute && form.hasAttribute('data-cart-add'))
    );
  }

  function stampRipxCartAddFormsNow(reason, scopedForm) {
    if (!isRipxCartAddStateReady(_ripxCartAttributeState)) {
      recordShippingDebugStep('cart_add_form_stamp_skipped', {
        reason: reason || 'unknown',
        hasLineState: Boolean(_ripxCartAttributeState),
      });
      return false;
    }
    try {
      applyRipxStateToCartForms(_ripxCartFormTargetProductIds);
      if (scopedForm && isRipxCartAddForm(scopedForm)) {
        applyRipxStateToCartForms(_ripxCartFormTargetProductIds);
      }
      if (!stateLooksLikePriceCartState(_ripxCartAttributeState)) {
        clearRipxPriceOnlyCartHints();
      }
      recordShippingDebugStep('cart_add_form_stamped', {
        reason: reason || 'unknown',
        scoped: Boolean(scopedForm),
      });
      if (DEBUG) debugLog('cart form stamp:', reason || 'event');
      return true;
    } catch (e) {
      if (DEBUG) debugLog('cart form stamp failed:', e && (e.message || String(e)));
      return false;
    }
  }

  function installRipxCartSubmitGuards() {
    if (_ripxCartSubmitGuardsInstalled) return;
    _ripxCartSubmitGuardsInstalled = true;
    if (!document || typeof document.addEventListener !== 'function') return;
    try {
      document.addEventListener(
        'submit',
        function (event) {
          var form = event && event.target;
          if (!isRipxCartAddForm(form)) return;
          fireAutomaticGoalEvent(
            'add_to_cart',
            'cart_add_form_submit',
            { metadata: getElementTriggerMetadata(form, { cart_add_reason: 'form_submit' }) },
            form,
            CONFIG.activeTests || [],
            1500
          );
          if (form.__ripxResubmittingCartAdd) {
            if (stampRipxCartAddFormsNow('submit-resume', form)) {
              scheduleRipxCartPropsRepairBurst('submit-resume');
            }
            return;
          }
          if (stampRipxCartAddFormsNow('submit', form)) {
            scheduleRipxCartPropsRepairBurst('submit');
            return;
          }
          if (!shouldWaitForRipxCartAddState()) return;
          // Preview: never block theme Add to cart (preventDefault + stopImmediatePropagation
          // breaks Dawn/theme AJAX handlers). Best-effort stamp in the background.
          if (PREVIEW_MODE || PREVIEW_SIMPLE_MODE) {
            ripxTrace('S10', 'ATC submit — preview non-blocking', {
              hasState: !!_ripxCartAttributeState,
              ready: isRipxCartAddStateReady(_ripxCartAttributeState),
            });
            waitForRipxCartAttributeStateBeforeAdd('submit').then(function (state) {
              if (state) stampRipxCartAddFormsNow('submit-preview-bg', form);
              ripxTrace('S10', 'ATC submit — background hydrate done', {
                hasState: !!state,
                targetUnit: state && state._ripx_target_unit ? state._ripx_target_unit : null,
              });
            });
            return;
          }
          if (!event || typeof event.preventDefault !== 'function') return;
          event.preventDefault();
          if (typeof event.stopImmediatePropagation === 'function')
            event.stopImmediatePropagation();
          else if (typeof event.stopPropagation === 'function') event.stopPropagation();
          waitForRipxCartAttributeStateBeforeAdd('submit').then(function (state) {
            if (state) stampRipxCartAddFormsNow('submit-wait', form);
            try {
              form.__ripxResubmittingCartAdd = true;
              if (typeof form.requestSubmit === 'function') {
                form.requestSubmit(event.submitter || undefined);
              } else if (typeof form.submit === 'function') {
                form.submit();
              }
            } finally {
              setTimeout(function () {
                try {
                  form.__ripxResubmittingCartAdd = false;
                } catch (_eResetSubmit) {}
              }, 0);
            }
          });
        },
        true
      );
    } catch (_eSubmitGuard) {}
    try {
      document.addEventListener(
        'click',
        function (event) {
          var target = event && event.target;
          if (!target || !target.closest) return;
          var control = target.closest(
            'button[type="submit"], input[type="submit"], button[name="add"], [data-add-to-cart], [data-cart-add], .product-form__submit'
          );
          if (!control) return;
          var form = control.form || (control.closest && control.closest('form'));
          if (!isRipxCartAddForm(form)) return;
          if (stampRipxCartAddFormsNow('click', form)) {
            scheduleRipxCartPropsRepairBurst('click');
          }
        },
        true
      );
    } catch (_eClickGuard) {}
  }

  function cartUiRoot() {
    return document.querySelector(
      '.cart-drawer.active, .cart-drawer, #CartDrawer, cart-drawer, .drawer--cart, [data-cart-drawer], #cart-form, form[action*="/cart"], .cart-items, .cart__contents, main .cart'
    );
  }

  function cartUiFallbackPaintCount() {
    var root = cartUiRoot();
    if (!root || !root.querySelectorAll) return 0;
    try {
      return querySelectorAllWithShadowRoots(root, '[data-ripx-price="1"]').length;
    } catch (e) {
      return 0;
    }
  }

  function cartUiNativeMarkerCount() {
    var root = cartUiRoot();
    if (!root || !root.querySelectorAll) return 0;
    try {
      return querySelectorAllWithShadowRoots(
        root,
        '[data-ripx-native-cart="1"], [data-ripx-native-cart-line="1"], [data-ripx-native-cart-block="1"]'
      ).length;
    } catch (e) {
      return 0;
    }
  }

  function getDisplayedCartSubtotalCents() {
    var root = cartUiRoot();
    if (!root) return null;
    var selectors =
      '.totals__subtotal-value, [data-cart-subtotal], .cart-subtotal .money, .cart__subtotal .money, .totals .price';
    var nodes = querySelectorAllWithShadowRoots(root, selectors);
    for (var i = 0; i < nodes.length; i++) {
      var price = parsePriceFromDisplay(nodes[i]);
      if (price != null) return Math.round(price * 100);
    }
    return null;
  }

  function cartStateLineHasDiscount(item) {
    if (!item || typeof item !== 'object') return false;
    var original =
      item.original_line_price !== undefined && item.original_line_price !== null
        ? Number(item.original_line_price)
        : item.line_price !== undefined && item.line_price !== null
          ? Number(item.line_price)
          : null;
    var finalLine =
      item.final_line_price !== undefined && item.final_line_price !== null
        ? Number(item.final_line_price)
        : null;
    var totalDiscount =
      item.total_discount !== undefined && item.total_discount !== null
        ? Number(item.total_discount)
        : 0;
    if (Number.isFinite(totalDiscount) && totalDiscount > 0) return true;
    if (Number.isFinite(original) && Number.isFinite(finalLine) && finalLine < original)
      return true;
    return Array.isArray(item.discounts) && item.discounts.length > 0;
  }

  function cartStateHasNativeDiscounts(cartState) {
    if (!cartState || !Array.isArray(cartState.items)) return false;
    return cartState.items.some(cartStateLineHasDiscount);
  }

  function cartUiMatchesNativeDiscountState(cartState) {
    if (!cartStateHasNativeDiscounts(cartState)) return false;
    if (cartUiFallbackPaintCount() > 0) return false;
    var expected =
      cartState.items_subtotal_price !== undefined && cartState.items_subtotal_price !== null
        ? Number(cartState.items_subtotal_price)
        : null;
    var displayed = getDisplayedCartSubtotalCents();
    if (!Number.isFinite(expected) || displayed == null) return false;
    return displayed === expected;
  }

  function cacheRipxCartNativeState(cartState) {
    var expected =
      cartState &&
      cartState.items_subtotal_price !== undefined &&
      cartState.items_subtotal_price !== null
        ? Number(cartState.items_subtotal_price)
        : null;
    var displayed = getDisplayedCartSubtotalCents();
    _ripxCartNativeState = {
      cart: cartState || null,
      fetchedAt: Date.now(),
      hasDiscounts: cartStateHasNativeDiscounts(cartState),
      uiMatches: cartUiMatchesNativeDiscountState(cartState),
      expectedSubtotalCents: Number.isFinite(expected) ? expected : null,
      displayedSubtotalCents: displayed,
    };
    if (DEBUG) {
      debugLog(
        'cart native state:',
        _ripxCartNativeState.hasDiscounts ? 'discounts-present' : 'no-discounts',
        _ripxCartNativeState.uiMatches ? 'ui-matches' : 'ui-fallback-needed'
      );
    }
    return _ripxCartNativeState;
  }

  function fetchRipxCartNativeState() {
    if (!_ripxNativeFetch || !hasCartUiInDom()) return Promise.resolve(null);
    if (_ripxCartNativeStateInFlight) return _ripxCartNativeStateInFlight;
    _ripxCartNativeStateInFlight = _ripxNativeFetch('/cart.js', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    })
      .then(function (response) {
        if (!response || !response.ok) return null;
        return response.json().catch(function () {
          return null;
        });
      })
      .then(function (cartState) {
        return cacheRipxCartNativeState(cartState);
      })
      .catch(function () {
        return null;
      })
      .finally(function () {
        _ripxCartNativeStateInFlight = null;
      });
    return _ripxCartNativeStateInFlight;
  }

  function scheduleRipxCartNativeStateRefresh(delayMs) {
    if (_ripxCartNativeStateTimer) clearTimeout(_ripxCartNativeStateTimer);
    _ripxCartNativeStateTimer = setTimeout(
      function () {
        _ripxCartNativeStateTimer = null;
        fetchRipxCartNativeState();
      },
      Math.max(0, Number(delayMs) || 0)
    );
  }

  function scheduleRipxCartNativeStateRefreshBurst() {
    scheduleRipxCartNativeStateRefresh(0);
    setTimeout(fetchRipxCartNativeState, 180);
    setTimeout(fetchRipxCartNativeState, 700);
  }

  function shouldPreferNativeCartRendering() {
    var st = _ripxCartNativeState;
    if (!st || !st.hasDiscounts || !st.uiMatches) return false;
    return Date.now() - Number(st.fetchedAt || 0) < 15000;
  }

  function shouldBlockCartFallbackPaint() {
    if (!hasCartUiInDom()) return false;
    var st = _ripxCartNativeState;
    var fresh = st && Date.now() - Number(st.fetchedAt || 0) < 15000;
    if (!fresh) {
      fetchRipxCartNativeState().then(function () {
        try {
          if (window.RipX && typeof window.RipX.reapplyPriceTests === 'function') {
            setTimeout(window.RipX.reapplyPriceTests, 0);
          }
        } catch (e) {}
      });
      return true;
    }
    return !!st.hasDiscounts;
  }

  /**
   * Keep native cart/checkout pricing as single source of truth.
   * This disables visual cart repaint to avoid double price updates.
   */
  function shouldDisableCartUiPricePaint() {
    return true;
  }

  function formMatchesTargetProductIds(form, targetProductIds) {
    if (!form || !Array.isArray(targetProductIds) || targetProductIds.length === 0) return true;
    var scoped = targetProductIds
      .map(function (id) {
        return toNumericProductId(id);
      })
      .filter(Boolean);
    if (!scoped.length) return true;
    var holder = form.closest
      ? form.closest('[data-product-id],[data-product],[data-product-handle]')
      : null;
    var raw =
      (form.getAttribute && form.getAttribute('data-product-id')) ||
      (holder && holder.getAttribute && holder.getAttribute('data-product-id')) ||
      '';
    var pid = toNumericProductId(raw);
    if (!pid) return true;
    return scoped.indexOf(pid) !== -1;
  }

  function getRipxProductIdForForm(form) {
    if (!form) return null;
    var holder = form.closest
      ? form.closest('[data-product-id],[data-product],[data-product-handle]')
      : null;
    var raw =
      (form.getAttribute && form.getAttribute('data-product-id')) ||
      (holder && holder.getAttribute && holder.getAttribute('data-product-id')) ||
      '';
    return toNumericProductId(raw);
  }

  function rememberRipxTargetUnitForProduct(productId, targetUnit) {
    var pid = toNumericProductId(productId);
    var num = Number(targetUnit);
    if (!pid || !isFinite(num)) return;
    _ripxTargetUnitByProductId[String(pid)] = num.toFixed(2);
  }

  function rememberRipxTargetUnitForVariant(variantId, targetUnit) {
    var vid = normalizeCartVariantId(variantId);
    var num = Number(targetUnit);
    if (!vid || !isFinite(num)) return;
    _ripxTargetUnitByVariantId[String(vid)] = num.toFixed(2);
  }

  function rememberRipxTargetUnitForProducts(targetProductIds, targetUnit) {
    if (!Array.isArray(targetProductIds) || targetProductIds.length === 0) return;
    targetProductIds.forEach(function (productId) {
      rememberRipxTargetUnitForProduct(productId, targetUnit);
    });
  }

  function getRememberedRipxTargetUnitForProductId(productId) {
    var pid = toNumericProductId(productId);
    if (!pid) return '';
    return _ripxTargetUnitByProductId[String(pid)] || '';
  }

  function getRememberedRipxTargetUnitForVariantId(variantId) {
    var vid = normalizeCartVariantId(variantId);
    if (!vid) return '';
    return _ripxTargetUnitByVariantId[String(vid)] || '';
  }

  function registerRipxAssignedPrice(record) {
    if (!record || record.testId == null) return;
    var targetUnit = Number(record.targetUnit);
    if (!isFinite(targetUnit)) return;
    var entry = {
      testId: String(record.testId),
      display: record.display != null ? String(record.display) : '',
      targetUnit: targetUnit,
      variantIdForCart:
        record.variantIdForCart != null && String(record.variantIdForCart).trim() !== ''
          ? String(record.variantIdForCart)
          : '',
      updatedAt: Date.now(),
    };
    var pid = toNumericProductId(record.productId);
    if (pid) {
      _ripxAssignedPriceByProductId[String(pid)] = entry;
      rememberRipxTargetUnitForProduct(pid, targetUnit);
    }
    var vid = normalizeCartVariantId(record.variantId);
    if (vid) {
      _ripxAssignedPriceByVariantId[String(vid)] = entry;
      rememberRipxTargetUnitForVariant(vid, targetUnit);
    }
    if (record.variantIdForCart != null && String(record.variantIdForCart).trim() !== '') {
      rememberRipxTargetUnitForVariant(record.variantIdForCart, targetUnit);
    }
  }

  function getRipxAssignedPriceForContext(productId, variantId) {
    var vid = normalizeCartVariantId(variantId);
    if (vid && _ripxAssignedPriceByVariantId[String(vid)]) {
      return _ripxAssignedPriceByVariantId[String(vid)];
    }
    var pid = toNumericProductId(productId);
    if (pid && _ripxAssignedPriceByProductId[String(pid)]) {
      return _ripxAssignedPriceByProductId[String(pid)];
    }
    return null;
  }

  function compareRipxPaintParity(targetUnit, displayedAmount, tolerance) {
    var target = Number(targetUnit);
    var shown = Number(displayedAmount);
    var tol =
      tolerance != null && isFinite(Number(tolerance))
        ? Number(tolerance)
        : RIPX_PAINT_PARITY_TOLERANCE;
    if (!isFinite(target) || !isFinite(shown)) {
      return { ok: false, reason: 'missing_amount' };
    }
    if (Math.abs(shown - target) <= tol) {
      return { ok: true, delta: 0, targetUnit: target, displayedAmount: shown };
    }
    return {
      ok: false,
      reason: 'mismatch',
      delta: Math.round((shown - target) * 100) / 100,
      targetUnit: target,
      displayedAmount: shown,
    };
  }

  function recordRipxPricePaintParity(testId, el, targetUnit, scope) {
    if (!el || targetUnit == null || !isFinite(Number(targetUnit))) return;
    var shown = parsePriceFromDisplay(el);
    var parity = compareRipxPaintParity(targetUnit, shown);
    if (parity.ok) return;
    if (!Array.isArray(_ripxPaintParityAudit.mismatches)) {
      _ripxPaintParityAudit.mismatches = [];
    }
    if (_ripxPaintParityAudit.mismatches.length >= RIPX_PAINT_PARITY_MAX_ISSUES) return;
    _ripxPaintParityAudit.mismatches.push({
      testId: testId != null ? String(testId) : null,
      scope: scope || 'unknown',
      targetUnit: parity.targetUnit,
      displayedAmount: parity.displayedAmount,
      delta: parity.delta,
      reason: parity.reason || 'mismatch',
    });
    _ripxPaintParityAudit.updatedAt = Date.now();
    scheduleRipxPreviewPaintParityPublish();
  }

  function scheduleRipxPreviewPaintParityPublish() {
    if (!PREVIEW_MODE) return;
    if (_ripxPaintParityPublishTimer) {
      clearTimeout(_ripxPaintParityPublishTimer);
    }
    _ripxPaintParityPublishTimer = setTimeout(function () {
      _ripxPaintParityPublishTimer = null;
      publishRipxPreviewPaintParity(_ripxPaintParityAudit);
    }, RIPX_PAINT_PARITY_PUBLISH_MS);
  }

  function auditRipxPaintParityStampedNodes() {
    var checked = 0;
    var ok = 0;
    var mismatches = [];
    try {
      document.querySelectorAll('[data-ripx-price="1"]').forEach(function (el) {
        if (!el) return;
        var variantId = el.getAttribute('data-test-variant');
        var targetStr = getRememberedRipxTargetUnitForVariantId(variantId);
        if (!targetStr && el.closest) {
          var holder = el.closest('[data-product-id]');
          if (holder) {
            targetStr = getRememberedRipxTargetUnitForProductId(
              holder.getAttribute('data-product-id')
            );
          }
        }
        if (!targetStr) return;
        checked += 1;
        var shown = parsePriceFromDisplay(el);
        var parity = compareRipxPaintParity(Number(targetStr), shown);
        if (parity.ok) {
          ok += 1;
          return;
        }
        if (mismatches.length < RIPX_PAINT_PARITY_MAX_ISSUES) {
          mismatches.push({
            testId: el.getAttribute('data-test-id'),
            scope: 'audit',
            targetUnit: parity.targetUnit,
            displayedAmount: parity.displayedAmount,
            delta: parity.delta,
            reason: parity.reason || 'mismatch',
          });
        }
      });
    } catch (eAudit) {}
    _ripxPaintParityAudit = {
      checked: checked,
      ok: ok,
      mismatches: mismatches,
      updatedAt: Date.now(),
    };
    if (_ripxPaintParityPublishTimer) {
      clearTimeout(_ripxPaintParityPublishTimer);
      _ripxPaintParityPublishTimer = null;
    }
    publishRipxPreviewPaintParity(_ripxPaintParityAudit);
    return _ripxPaintParityAudit;
  }

  function publishRipxPreviewPaintParity(audit) {
    if (!PREVIEW_MODE || !audit) return;
    var payload = {
      type: 'ripx-price-paint-parity',
      source: 'ripx-storefront',
      paintParity: {
        checked: Number(audit.checked) || 0,
        ok: Number(audit.ok) || 0,
        mismatches: Array.isArray(audit.mismatches) ? audit.mismatches.slice(0, 12) : [],
      },
    };
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, '*');
      }
    } catch (eParent) {}
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(payload, '*');
      }
    } catch (eOpener) {}
  }

  function rememberRipxDiscountUnitForProduct(productId, discountUnit) {
    var pid = toNumericProductId(productId);
    var num = Number(discountUnit);
    if (!pid || !isFinite(num) || !(num > 0)) return;
    _ripxDiscountUnitByProductId[String(pid)] = num.toFixed(2);
  }

  function rememberRipxDiscountUnitForVariant(variantId, discountUnit) {
    var vid = normalizeCartVariantId(variantId);
    var num = Number(discountUnit);
    if (!vid || !isFinite(num) || !(num > 0)) return;
    _ripxDiscountUnitByVariantId[String(vid)] = num.toFixed(2);
  }

  function rememberRipxDiscountUnitForProducts(targetProductIds, discountUnit) {
    if (!Array.isArray(targetProductIds) || targetProductIds.length === 0) return;
    targetProductIds.forEach(function (productId) {
      rememberRipxDiscountUnitForProduct(productId, discountUnit);
    });
  }

  function getRememberedRipxDiscountUnitForProductId(productId) {
    var pid = toNumericProductId(productId);
    if (!pid) return '';
    return _ripxDiscountUnitByProductId[String(pid)] || '';
  }

  function getRememberedRipxDiscountUnitForVariantId(variantId) {
    var vid = normalizeCartVariantId(variantId);
    if (!vid) return '';
    return _ripxDiscountUnitByVariantId[String(vid)] || '';
  }

  function rememberRipxPriceMethodForProduct(productId, priceMethod) {
    var pid = toNumericProductId(productId);
    var method = normalizePriceApplicationMethod(priceMethod);
    if (!pid || !method) return;
    _ripxPriceMethodByProductId[String(pid)] = method;
  }

  function rememberRipxPriceMethodForVariant(variantId, priceMethod) {
    var vid = normalizeCartVariantId(variantId);
    var method = normalizePriceApplicationMethod(priceMethod);
    if (!vid || !method) return;
    _ripxPriceMethodByVariantId[String(vid)] = method;
  }

  function rememberRipxPriceMethodForProducts(targetProductIds, priceMethod) {
    if (!Array.isArray(targetProductIds) || targetProductIds.length === 0) return;
    targetProductIds.forEach(function (productId) {
      rememberRipxPriceMethodForProduct(productId, priceMethod);
    });
  }

  function getRememberedRipxPriceMethodForProductId(productId) {
    var pid = toNumericProductId(productId);
    if (!pid) return '';
    return _ripxPriceMethodByProductId[String(pid)] || '';
  }

  function getRememberedRipxPriceMethodForVariantId(variantId) {
    var vid = normalizeCartVariantId(variantId);
    if (!vid) return '';
    return _ripxPriceMethodByVariantId[String(vid)] || '';
  }

  function enrichRipxPayloadForCartVariant(payload, variantId) {
    if (!payload || !variantId) return payload;
    var targetUnit = getRememberedRipxTargetUnitForVariantId(variantId);
    var discountUnit = getRememberedRipxDiscountUnitForVariantId(variantId);
    var priceMethod = getRememberedRipxPriceMethodForVariantId(variantId);
    if (isRipxShippingCartState(payload)) return payload;
    if (!targetUnit && !discountUnit && !priceMethod) return payload;
    var next = Object.assign({}, payload);
    if (targetUnit && !next._ripx_target_unit) next._ripx_target_unit = targetUnit;
    if (discountUnit && !next._ripx_discount_unit) next._ripx_discount_unit = discountUnit;
    if (priceMethod && !next._ripx_price_method) next._ripx_price_method = priceMethod;
    return next;
  }

  function getRipxVariantIdForCard(card) {
    if (!card) return '';
    var raw =
      (card.getAttribute &&
        (card.getAttribute('data-variant-id') ||
          card.getAttribute('data-product-variant-id') ||
          card.getAttribute('data-current-variant-id'))) ||
      '';
    if (!raw && card.querySelector) {
      var variantNode =
        card.querySelector('[data-variant-id]') ||
        card.querySelector('[data-product-variant-id]') ||
        card.querySelector('form[action*="cart/add"] [name="id"]') ||
        card.querySelector('form[action*="/cart/add"] [name="id"]') ||
        card.querySelector('[name="id"]');
      raw =
        (variantNode &&
          ((variantNode.getAttribute &&
            (variantNode.getAttribute('data-variant-id') ||
              variantNode.getAttribute('data-product-variant-id'))) ||
            variantNode.value)) ||
        '';
    }
    return normalizeCartVariantId(raw);
  }

  function getRememberedRipxTargetUnitForForm(form) {
    return getRememberedRipxTargetUnitForProductId(getRipxProductIdForForm(form));
  }

  function getRememberedRipxDiscountUnitForForm(form) {
    return getRememberedRipxDiscountUnitForProductId(getRipxProductIdForForm(form));
  }

  function getRememberedRipxPriceMethodForForm(form) {
    return getRememberedRipxPriceMethodForProductId(getRipxProductIdForForm(form));
  }

  function getPreferredRipxProductIdForCartAttrs() {
    if (
      Array.isArray(_ripxCartFormTargetProductIds) &&
      _ripxCartFormTargetProductIds.length === 1
    ) {
      return toNumericProductId(_ripxCartFormTargetProductIds[0]);
    }
    var currentPid = toNumericProductId(getCurrentProductId());
    if (currentPid) return currentPid;
    var rememberedKeys = Object.keys(_ripxTargetUnitByProductId || {});
    if (rememberedKeys.length === 1) return toNumericProductId(rememberedKeys[0]);
    return null;
  }

  function getRipxNativeVariantSwapState(state) {
    if (!state || typeof state !== 'object') return null;
    var mappedVariantId = normalizeCartVariantId(state.__ripx_native_variant_id);
    var sourceVariantId = normalizeCartVariantId(state.__ripx_source_variant_id);
    if (!mappedVariantId || !sourceVariantId) return null;
    return { mappedVariantId: mappedVariantId, sourceVariantId: sourceVariantId };
  }

  function shouldSwapRipxCartVariant(currentVariantId, swapState) {
    if (!swapState || !swapState.mappedVariantId || !swapState.sourceVariantId) return false;
    return normalizeCartVariantId(currentVariantId) === swapState.sourceVariantId;
  }

  /**
   * Re-apply hidden RipX line properties to cart/add forms (dynamic drawers, section reloads).
   * Uses _ripxCartAttributeState; respects last injectPriceTestCartAttributes target scope.
   */
  function applyRipxStateToCartForms(targetProductIds) {
    var state = _ripxCartAttributeState;
    if (!state || !state._ripx_price_test || !state._ripx_variant) return;
    var keyTest = '_ripx_price_test';
    var keyVariant = '_ripx_variant';
    var keyShop = '_ripx_shop';
    var valueTest = String(state._ripx_price_test);
    var valueVariant = String(state._ripx_variant);
    var valueShop = state._ripx_shop ? String(state._ripx_shop) : '';
    var forms = document.querySelectorAll(
      'form[action*="cart/add"], form[action*="/cart/add"], form[data-ajax-cart-form], form[data-cart-add]'
    );
    forms.forEach(function (form) {
      if (!form) return;
      if (!formMatchesTargetProductIds(form, targetProductIds)) return;
      function removeHiddenInputByName(inputName) {
        if (!inputName) return;
        var inputs = form.querySelectorAll('input[type="hidden"]');
        for (var hi = 0; hi < inputs.length; hi++) {
          if (!inputs[hi] || inputs[hi].name !== inputName) continue;
          var removed = false;
          if (inputs[hi].parentNode && typeof inputs[hi].parentNode.removeChild === 'function') {
            try {
              inputs[hi].parentNode.removeChild(inputs[hi]);
              removed = true;
            } catch (_eRm) {}
          }
          if (!removed && Array.isArray(form.__hiddenInputs)) {
            var rmIdx = form.__hiddenInputs.indexOf(inputs[hi]);
            if (rmIdx !== -1) {
              form.__hiddenInputs.splice(rmIdx, 1);
              removed = true;
            }
          }
          // Only rewind for live NodeLists that shrink in place. Array stubs already
          // shifted via splice — decrementing here would infinite-loop.
          if (removed && typeof inputs.length === 'number' && !Array.isArray(inputs)) {
            hi -= 1;
          }
        }
      }
      function setHiddenInputByName(inputName, value) {
        if (!inputName) return;
        if (value === undefined || value === null || String(value).trim() === '') return;
        var inputs = form.querySelectorAll('input[type="hidden"]');
        for (var hi = 0; hi < inputs.length; hi++) {
          if (inputs[hi].name === inputName) {
            inputs[hi].value = value;
            return;
          }
        }
        var input = document.createElement('input');
        input.type = 'hidden';
        input.name = inputName;
        input.value = value;
        form.appendChild(input);
      }
      function setProperty(propKey, value) {
        if (value === undefined || value === null || String(value).trim() === '') return;
        var fullName = 'properties[' + propKey + ']';
        var normalizedValue = String(value).trim();
        var existingInputs = form.querySelectorAll('input[type="hidden"]');
        for (var ei = 0; ei < existingInputs.length; ei += 1) {
          if (existingInputs[ei] && existingInputs[ei].name === fullName) {
            if (String(existingInputs[ei].value || '').trim() === normalizedValue) {
              return;
            }
            break;
          }
        }
        removeHiddenInputByName('properties[' + getRipxPublicLinePropertyKey(propKey) + ']');
        setHiddenInputByName(fullName, value);
      }
      setProperty(keyTest, valueTest);
      setProperty(keyVariant, valueVariant);
      if (valueShop) setProperty(keyShop, valueShop);
      setHiddenInputByName(
        'properties[' + RIPX_BUYER_VISIBLE_PROPERTY_KEY + ']',
        getRipxBuyerVisibleLineSummary(state)
      );
      removeHiddenInputByName('properties[' + RIPX_LEGACY_BUYER_VISIBLE_PROPERTY_KEY + ']');
      if (state._ripx_assignment_sig) {
        setProperty('_ripx_assignment_sig', state._ripx_assignment_sig);
      }
      if (state._ripx_assignment_ts) {
        setProperty('_ripx_assignment_ts', state._ripx_assignment_ts);
      }
      if (state._ripx_assignment_user) {
        setProperty('_ripx_assignment_user', state._ripx_assignment_user);
      }
      if (!isRipxShippingCartState(state)) {
        var rememberedTargetUnitForForm = getRememberedRipxTargetUnitForForm(form);
        var targetUnitValue = rememberedTargetUnitForForm || state._ripx_target_unit;
        if (targetUnitValue) {
          setProperty('_ripx_target_unit', targetUnitValue);
        }
        var rememberedDiscountUnitForForm = getRememberedRipxDiscountUnitForForm(form);
        var discountUnitValue = rememberedDiscountUnitForForm || state._ripx_discount_unit;
        if (discountUnitValue) {
          setProperty('_ripx_discount_unit', discountUnitValue);
        }
        var rememberedPriceMethodForForm = getRememberedRipxPriceMethodForForm(form);
        var priceMethodValue = rememberedPriceMethodForForm || state._ripx_price_method;
        if (priceMethodValue) {
          setProperty('_ripx_price_method', priceMethodValue);
        }
      }
      if (state._ripx_offer_discount_type) {
        setProperty('_ripx_offer_discount_type', state._ripx_offer_discount_type);
      }
      if (state._ripx_offer_discount_value) {
        setProperty('_ripx_offer_discount_value', state._ripx_offer_discount_value);
      }
      if (state._ripx_offer_code_name) {
        setProperty('_ripx_offer_code_name', state._ripx_offer_code_name);
      }
      forEachRipxLineProperty(state, setProperty);
      var swapState = getRipxNativeVariantSwapState(state);
      if (swapState) {
        var variantIdInput =
          form.querySelector('input[name="id"]') ||
          form.querySelector('select[name="id"]') ||
          form.querySelector('[name="id"]');
        if (variantIdInput && shouldSwapRipxCartVariant(variantIdInput.value, swapState)) {
          variantIdInput.value = swapState.mappedVariantId;
          if (variantIdInput.setAttribute) {
            variantIdInput.setAttribute('data-ripx-native-variant', swapState.mappedVariantId);
          }
        }
      }
      if (PREVIEW_MODE) {
        var rawAction = (form.getAttribute && form.getAttribute('action')) || '';
        var resolvedAction = '';
        try {
          resolvedAction = rawAction ? new URL(rawAction, window.location.origin).toString() : '';
        } catch (_eAction) {}
        if (!resolvedAction || isCartAddPath(resolvedAction)) {
          var returnTo = PRICE_PREVIEW_FRAME
            ? withPreviewQueryParams(window.location.href)
            : toPreviewBootstrapUrl(window.location.href);
          if (returnTo) {
            setHiddenInputByName('return_to', toShopifyReturnToPath(returnTo));
          }
        }
      }
    });
  }

  function clearRipxPriceOnlyCartHints() {
    if (_ripxCartAttributeState && typeof _ripxCartAttributeState === 'object') {
      delete _ripxCartAttributeState._ripx_target_unit;
      delete _ripxCartAttributeState._ripx_discount_unit;
      delete _ripxCartAttributeState._ripx_price_method;
      delete _ripxCartAttributeState.ripx_target_unit;
      delete _ripxCartAttributeState.ripx_discount_unit;
      delete _ripxCartAttributeState.ripx_price_method;
      delete _ripxCartAttributeState.__ripx_price_application_method;
      delete _ripxCartAttributeState.__ripx_native_variant_id;
      delete _ripxCartAttributeState.__ripx_source_variant_id;
    }
    _ripxTargetUnitByProductId = {};
    _ripxDiscountUnitByProductId = {};
    _ripxPriceMethodByProductId = {};
    _ripxTargetUnitByVariantId = {};
    _ripxDiscountUnitByVariantId = {};
    _ripxPriceMethodByVariantId = {};
    try {
      var forms = document.querySelectorAll(
        'form[action*="cart/add"], form[action*="/cart/add"], form[data-ajax-cart-form], form[data-cart-add]'
      );
      Array.prototype.forEach.call(forms || [], function (form) {
        ['_ripx_target_unit', '_ripx_discount_unit', '_ripx_price_method'].forEach(function (key) {
          var publicKey = getRipxPublicLinePropertyKey(key);
          var inputs = form.querySelectorAll('input[type="hidden"]');
          Array.prototype.forEach.call(inputs || [], function (input) {
            if (
              input &&
              (input.name === 'properties[' + key + ']' ||
                input.name === 'properties[' + publicKey + ']')
            ) {
              if (input.parentNode) input.parentNode.removeChild(input);
              else if (Array.isArray(form.__hiddenInputs)) {
                var idx = form.__hiddenInputs.indexOf(input);
                if (idx !== -1) form.__hiddenInputs.splice(idx, 1);
              }
            }
          });
        });
      });
    } catch (e) {}
  }

  function installRipxCartFormObserver() {
    if (_ripxCartFormObserverInstalled) return;
    if (typeof MutationObserver === 'undefined') return;
    var root = document.documentElement || document.body;
    if (!root) return;
    _ripxCartFormObserverInstalled = true;
    var observerDebounceMs = PREVIEW_SIMPLE_MODE ? 500 : 200;
    var observer = new MutationObserver(function () {
      if (!_ripxCartAttributeState) return;
      if (_ripxCartFormObserverTimer) clearTimeout(_ripxCartFormObserverTimer);
      _ripxCartFormObserverTimer = setTimeout(function () {
        _ripxCartFormObserverTimer = null;
        applyRipxStateToCartForms(_ripxCartFormTargetProductIds);
      }, observerDebounceMs);
    });
    try {
      observer.observe(root, { childList: true, subtree: true });
    } catch (e) {
      _ripxCartFormObserverInstalled = false;
    }
  }

  /**
   * Build and inject the hidden line properties that connect storefront paint to checkout pricing.
   *
   * The visual PDP price alone is not enough. These fields carry the selected test/variant, signed
   * assignment, target amount, and chosen application method into `/cart/add` and Shopify Functions.
   */
  function injectPriceTestCartAttributes(
    testId,
    variantId,
    assignmentProof,
    targetProductIds,
    pricingProof,
    checkoutMethodProof,
    offerProof,
    options
  ) {
    var opts = options && typeof options === 'object' ? options : {};
    if (!testId || variantId == null || String(variantId).trim() === '') return;
    var valueShop =
      (CONFIG.shopDomain && String(CONFIG.shopDomain).trim()) ||
      (typeof window !== 'undefined' &&
        window.Shopify &&
        window.Shopify.shop &&
        String(window.Shopify.shop).trim()) ||
      '';
    var nextState = getRipxCartAttrsPayload(
      String(testId),
      String(variantId),
      valueShop,
      assignmentProof,
      pricingProof,
      offerProof
    );
    if (checkoutMethodProof && typeof checkoutMethodProof === 'object') {
      var resolvedMethod = normalizePriceApplicationMethod(checkoutMethodProof.applicationMethod);
      nextState.__ripx_price_application_method = resolvedMethod;
      nextState._ripx_price_method = resolvedMethod;
      var nativeVariantId = normalizeCartVariantId(checkoutMethodProof.nativeVariantId);
      var sourceVariantId = normalizeCartVariantId(checkoutMethodProof.sourceVariantId);
      if (nativeVariantId) nextState.__ripx_native_variant_id = nativeVariantId;
      if (sourceVariantId) nextState.__ripx_source_variant_id = sourceVariantId;
    }
    if (
      _ripxCartAttributeState &&
      _ripxCartAttributeState._ripx_price_test === String(testId) &&
      _ripxCartAttributeState._ripx_variant === String(variantId)
    ) {
      if (!nextState._ripx_target_unit && _ripxCartAttributeState._ripx_target_unit) {
        nextState._ripx_target_unit = _ripxCartAttributeState._ripx_target_unit;
      }
      if (!nextState._ripx_discount_unit && _ripxCartAttributeState._ripx_discount_unit) {
        nextState._ripx_discount_unit = _ripxCartAttributeState._ripx_discount_unit;
      }
      if (!nextState._ripx_assignment_sig && _ripxCartAttributeState._ripx_assignment_sig) {
        nextState._ripx_assignment_sig = _ripxCartAttributeState._ripx_assignment_sig;
      }
      if (!nextState._ripx_assignment_ts && _ripxCartAttributeState._ripx_assignment_ts) {
        nextState._ripx_assignment_ts = _ripxCartAttributeState._ripx_assignment_ts;
      }
      if (!nextState._ripx_assignment_user && _ripxCartAttributeState._ripx_assignment_user) {
        nextState._ripx_assignment_user = _ripxCartAttributeState._ripx_assignment_user;
      }
      if (!nextState.__ripx_native_variant_id && _ripxCartAttributeState.__ripx_native_variant_id) {
        nextState.__ripx_native_variant_id = _ripxCartAttributeState.__ripx_native_variant_id;
      }
      if (!nextState.__ripx_source_variant_id && _ripxCartAttributeState.__ripx_source_variant_id) {
        nextState.__ripx_source_variant_id = _ripxCartAttributeState.__ripx_source_variant_id;
      }
      if (
        !nextState.__ripx_price_application_method &&
        _ripxCartAttributeState.__ripx_price_application_method
      ) {
        nextState.__ripx_price_application_method =
          _ripxCartAttributeState.__ripx_price_application_method;
      }
      if (!nextState._ripx_price_method && _ripxCartAttributeState._ripx_price_method) {
        nextState._ripx_price_method = _ripxCartAttributeState._ripx_price_method;
      }
      if (
        !nextState._ripx_offer_discount_type &&
        _ripxCartAttributeState._ripx_offer_discount_type
      ) {
        nextState._ripx_offer_discount_type = _ripxCartAttributeState._ripx_offer_discount_type;
      }
      if (
        !nextState._ripx_offer_discount_value &&
        _ripxCartAttributeState._ripx_offer_discount_value
      ) {
        nextState._ripx_offer_discount_value = _ripxCartAttributeState._ripx_offer_discount_value;
      }
      if (!nextState._ripx_offer_code_name && _ripxCartAttributeState._ripx_offer_code_name) {
        nextState._ripx_offer_code_name = _ripxCartAttributeState._ripx_offer_code_name;
      }
    }
    _ripxCartAttributeState = nextState;
    if (PREVIEW_MODE && testId != null && variantId != null) {
      window.__RIPX_PRICE_TEST_CTX__ = {
        testId: String(testId),
        variantId: String(variantId),
      };
    }
    if (_ripxCartAttributeState && _ripxCartAttributeState._ripx_target_unit) {
      rememberRipxTargetUnitForProducts(
        targetProductIds,
        _ripxCartAttributeState._ripx_target_unit
      );
    }
    if (_ripxCartAttributeState && _ripxCartAttributeState._ripx_discount_unit) {
      rememberRipxDiscountUnitForProducts(
        targetProductIds,
        _ripxCartAttributeState._ripx_discount_unit
      );
    }
    if (_ripxCartAttributeState && _ripxCartAttributeState._ripx_price_method) {
      rememberRipxPriceMethodForProducts(
        targetProductIds,
        _ripxCartAttributeState._ripx_price_method
      );
    }
    if (checkoutMethodProof && typeof checkoutMethodProof === 'object') {
      var proofVariantIds = [
        checkoutMethodProof.sourceVariantId,
        checkoutMethodProof.nativeVariantId,
        variantId,
      ];
      for (var pv = 0; pv < proofVariantIds.length; pv += 1) {
        var proofVariantId = normalizeCartVariantId(proofVariantIds[pv]);
        if (!proofVariantId) continue;
        if (_ripxCartAttributeState && _ripxCartAttributeState._ripx_target_unit) {
          rememberRipxTargetUnitForVariant(
            proofVariantId,
            _ripxCartAttributeState._ripx_target_unit
          );
        }
        if (_ripxCartAttributeState && _ripxCartAttributeState._ripx_discount_unit) {
          rememberRipxDiscountUnitForVariant(
            proofVariantId,
            _ripxCartAttributeState._ripx_discount_unit
          );
        }
        if (_ripxCartAttributeState && _ripxCartAttributeState._ripx_price_method) {
          rememberRipxPriceMethodForVariant(
            proofVariantId,
            _ripxCartAttributeState._ripx_price_method
          );
        }
      }
    }
    if (Array.isArray(targetProductIds) && targetProductIds.length > 0) {
      _ripxCartFormTargetProductIds = targetProductIds;
    } else if (
      !Array.isArray(_ripxCartFormTargetProductIds) ||
      _ripxCartFormTargetProductIds.length === 0
    ) {
      _ripxCartFormTargetProductIds = targetProductIds;
    }
    installRipxCartAddInterceptors();
    if (!opts.skipDomApply) {
      applyRipxStateToCartForms(_ripxCartFormTargetProductIds);
      installRipxCartFormObserver();
    }
    if (DEBUG)
      debugLog(
        'injectPriceTestCartAttributes:',
        String(testId),
        String(variantId),
        valueShop || '(no shop)'
      );
  }

  /**
   * Preview may return a stub when /track/preview fails — no config, so DOM price helpers bail.
   * Checkout still needs _ripx_* line properties; inject when preview + test/variant ids are known.
   */
  function injectPreviewCartAttributesWhenConfigMissing(testId, variant) {
    if (!PREVIEW_MODE || !testId || !variant) return;
    if (variant.config) return;
    var allow =
      variant.isPreview || (PREVIEW_TEST_ID != null && String(testId) === String(PREVIEW_TEST_ID));
    if (!allow) return;
    var vid = variant.variantId != null ? variant.variantId : variant.id;
    if (vid == null || String(vid).trim() === '') vid = PREVIEW_VARIANT_ID;
    if (vid == null || String(vid).trim() === '') return;
    injectPriceTestCartAttributes(
      testId,
      vid,
      getAssignmentProofFromVariant(variant),
      null,
      null,
      null
    );
  }

  function configLooksLikeShipping(config) {
    if (!config || typeof config !== 'object') return false;
    var strategy = String(config.strategy || config.shipping_strategy || '')
      .trim()
      .toLowerCase();
    if (
      strategy === 'flat_rate' ||
      strategy === 'threshold_free_shipping' ||
      strategy === 'discount_percentage' ||
      strategy === 'discount_fixed' ||
      strategy === 'free_shipping' ||
      strategy === 'carrier_quote'
    ) {
      return true;
    }
    return !!(
      config.replace_existing_rates ||
      config.delivery_method_names ||
      config.deliveryMethodNames ||
      config.method_handles ||
      config.methodHandles ||
      config.zone_countries ||
      config.zoneCountries
    );
  }

  function makeSyntheticPreviewShippingTest() {
    if (!(PREVIEW_MODE && PREVIEW_TEST_ID)) return null;
    return {
      id: PREVIEW_TEST_ID,
      type: 'shipping',
      targetType: 'all-products',
      targetIds: null,
      targetId: null,
    };
  }

  function resolvePreviewCartShippingContext(variant) {
    var previewTest = PREVIEW_TEST_ID ? getActiveTestById(PREVIEW_TEST_ID) : null;
    var variantConfig =
      variant && variant.config && typeof variant.config === 'object' ? variant.config : null;
    var cachedPreview =
      PREVIEW_TEST_ID && readPreviewVariantCache(PREVIEW_TEST_ID)
        ? readPreviewVariantCache(PREVIEW_TEST_ID)
        : null;
    var cachedConfig =
      cachedPreview && cachedPreview.config && typeof cachedPreview.config === 'object'
        ? cachedPreview.config
        : null;
    var isShippingPreview =
      (previewTest && testTypeIsShipping(previewTest)) ||
      (variantConfig && configLooksLikeShipping(variantConfig)) ||
      (cachedConfig && configLooksLikeShipping(cachedConfig));
    if (!isShippingPreview) {
      return null;
    }
    var shippingTest =
      previewTest && testTypeIsShipping(previewTest)
        ? previewTest
        : makeSyntheticPreviewShippingTest();
    if (!shippingTest) {
      return null;
    }
    return {
      test: shippingTest,
      variant: variant || cachedPreview || null,
    };
  }

  /**
   * Normalize variant ID for lookup (numeric string or gid). Used for byVariant keys.
   */
  function toVariantIdKey(variantId) {
    if (variantId == null || variantId === '') return null;
    var s = String(variantId).trim();
    var m = s.match(/ProductVariant\/\s*(\d+)/i) || s.match(/\b(\d{10,})\b/);
    if (m) return m[1];
    return s;
  }

  /** Soft-match a byProduct map entry across numeric / GID / string keys. */
  function resolveByProductEntry(byProduct, productId) {
    if (!byProduct || typeof byProduct !== 'object') return null;
    if (productId == null || productId === '') return null;
    var pid = toNumericProductId(productId);
    var gid = pid ? 'gid://shopify/Product/' + pid : '';
    var direct =
      byProduct[productId] ||
      (pid ? byProduct[pid] : null) ||
      (gid ? byProduct[gid] : null) ||
      null;
    if (direct && typeof direct === 'object') return direct;
    if (!pid) return null;
    var keys = Object.keys(byProduct);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (toNumericProductId(key) === pid) {
        var hit = byProduct[key];
        if (hit && typeof hit === 'object') return hit;
      }
    }
    return null;
  }

  /** Soft-match a byVariant map entry across numeric / GID / string keys. */
  function resolveByVariantEntry(byVariant, currentVariantId) {
    if (!byVariant || typeof byVariant !== 'object') return null;
    if (currentVariantId == null || currentVariantId === '') return null;
    var vkey = toVariantIdKey(currentVariantId);
    var gid = vkey ? 'gid://shopify/ProductVariant/' + vkey : '';
    var direct =
      (vkey ? byVariant[vkey] : null) ||
      byVariant[currentVariantId] ||
      (gid ? byVariant[gid] : null) ||
      null;
    if (direct && typeof direct === 'object') return direct;
    if (!vkey) return null;
    var keys = Object.keys(byVariant);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (toVariantIdKey(key) === vkey) {
        var hit = byVariant[key];
        if (hit && typeof hit === 'object') return hit;
      }
    }
    return null;
  }

  function getAssignmentProofFromVariant(variant) {
    if (!variant || typeof variant !== 'object') return null;
    var sig = variant.assignment_sig || variant.assignmentSig;
    var ts = variant.assignment_ts || variant.assignmentTs;
    var user = variant.assignment_user || variant.assignmentUser || getUserId();
    if (!sig || !ts || !user) return null;
    return { sig: sig, ts: ts, user: user };
  }

  /** API/DB may send snake_case; storefront + getEffectivePriceConfig expect camelCase. */
  function normalizePriceConfigKeys(cfg) {
    if (!cfg || typeof cfg !== 'object') return cfg;
    var out = Object.assign({}, cfg);
    if (!out.priceMode && out.price_mode) out.priceMode = out.price_mode;
    if (out.priceDelta === undefined && out.price_delta !== undefined)
      out.priceDelta = out.price_delta;
    if (out.pricePercent === undefined && out.price_percent !== undefined)
      out.pricePercent = out.price_percent;
    if (!out.priceBase && out.price_base) out.priceBase = out.price_base;
    if (out.nativeVariantId === undefined && out.native_variant_id !== undefined)
      out.nativeVariantId = out.native_variant_id;
    if (!out.priceApplicationMethod && out.price_application_method)
      out.priceApplicationMethod = out.price_application_method;
    if (out.roundTo === undefined && out.round_to !== undefined) out.roundTo = out.round_to;
    if (typeof out.priceMode === 'string') out.priceMode = out.priceMode.toLowerCase();
    if (out.priceMode === 'delta' || out.priceMode === 'dollar') out.priceMode = 'amount';
    return out;
  }

  function normalizeThemeConfigKeys(cfg) {
    if (!cfg || typeof cfg !== 'object') return cfg;
    var out = Object.assign({}, cfg);
    if (!out.themeMode && out.theme_mode) out.themeMode = out.theme_mode;
    if (!out.themeTemplateHandle && out.theme_template_handle)
      out.themeTemplateHandle = out.theme_template_handle;
    if (!out.themeTemplateHandle && out.template) out.themeTemplateHandle = out.template;
    if (out.themeId === undefined && out.theme_id !== undefined) out.themeId = out.theme_id;
    if (out.sectionId === undefined && out.section_id !== undefined) out.sectionId = out.section_id;
    if (out.bodyClass === undefined && out.body_class !== undefined) out.bodyClass = out.body_class;
    var modeFallback = out.template || out.themeTemplateHandle ? 'template_switch' : 'asset_flag';
    out.themeMode = normalizeThemeMode(out.themeMode || out.theme_mode, modeFallback);
    return out;
  }

  function normalizeVariantForStorefront(variant) {
    if (!variant || typeof variant !== 'object') return variant;
    if (!variant.config) return variant;
    var normalizedConfig = normalizePriceConfigKeys(variant.config);
    normalizedConfig = normalizeThemeConfigKeys(normalizedConfig);
    // Recurse into byProduct / byVariant so nested snake_case / modes resolve.
    if (normalizedConfig.byProduct && typeof normalizedConfig.byProduct === 'object') {
      var nextByProduct = {};
      Object.keys(normalizedConfig.byProduct).forEach(function (pid) {
        var productCfg = normalizedConfig.byProduct[pid];
        if (!productCfg || typeof productCfg !== 'object') {
          nextByProduct[pid] = productCfg;
          return;
        }
        var nextProduct = normalizePriceConfigKeys(productCfg);
        if (productCfg.byVariant && typeof productCfg.byVariant === 'object') {
          var nextByVariant = {};
          Object.keys(productCfg.byVariant).forEach(function (vid) {
            nextByVariant[vid] = normalizePriceConfigKeys(productCfg.byVariant[vid]);
          });
          nextProduct.byVariant = nextByVariant;
        }
        nextByProduct[pid] = nextProduct;
      });
      normalizedConfig.byProduct = nextByProduct;
    }
    if (normalizedConfig.byVariant && typeof normalizedConfig.byVariant === 'object') {
      var nextRootByVariant = {};
      Object.keys(normalizedConfig.byVariant).forEach(function (vid) {
        nextRootByVariant[vid] = normalizePriceConfigKeys(normalizedConfig.byVariant[vid]);
      });
      normalizedConfig.byVariant = nextRootByVariant;
    }
    return Object.assign({}, variant, { config: normalizedConfig });
  }

  function hasModeValue(cfg, mode) {
    if (!cfg || typeof cfg !== 'object') return false;
    var m = String(mode || '').toLowerCase();
    if (m === 'fixed')
      return cfg.price !== null && cfg.price !== undefined && String(cfg.price).trim() !== '';
    if (m === 'amount')
      return (
        cfg.priceDelta !== null &&
        cfg.priceDelta !== undefined &&
        String(cfg.priceDelta).trim() !== ''
      );
    if (m === 'percent')
      return (
        cfg.pricePercent !== null &&
        cfg.pricePercent !== undefined &&
        String(cfg.pricePercent).trim() !== ''
      );
    if (m === 'control') return true;
    return false;
  }

  function normalizeMergedPriceConfig(baseCfg, mergedCfg) {
    var base = baseCfg && typeof baseCfg === 'object' ? baseCfg : {};
    var merged =
      mergedCfg && typeof mergedCfg === 'object'
        ? Object.assign({}, mergedCfg)
        : Object.assign({}, base);
    var mergedMode = String(merged.priceMode || 'fixed').toLowerCase();
    if (hasModeValue(merged, mergedMode)) return merged;
    var baseMode = String(base.priceMode || 'fixed').toLowerCase();
    if (!hasModeValue(base, baseMode)) return merged;
    merged.priceMode = baseMode;
    if (baseMode === 'fixed') merged.price = base.price;
    if (baseMode === 'amount') {
      merged.priceDelta = base.priceDelta;
      merged.priceBase = base.priceBase || merged.priceBase;
    }
    if (baseMode === 'percent') {
      merged.pricePercent = base.pricePercent;
      merged.priceBase = base.priceBase || merged.priceBase;
    }
    if (
      base.nativeVariantId !== undefined &&
      base.nativeVariantId !== null &&
      merged.nativeVariantId == null
    ) {
      merged.nativeVariantId = base.nativeVariantId;
    }
    if (
      base.priceApplicationMethod !== undefined &&
      base.priceApplicationMethod !== null &&
      merged.priceApplicationMethod == null
    ) {
      merged.priceApplicationMethod = base.priceApplicationMethod;
    }
    if (base.roundTo !== undefined && base.roundTo !== null && merged.roundTo == null) {
      merged.roundTo = base.roundTo;
    }
    return merged;
  }

  function normalizePriceApplicationMethod(value) {
    var raw = String(value || '')
      .trim()
      .toLowerCase();
    if (raw === 'discounted_checkout_price') return 'discounted_checkout_price';
    if (raw === 'native_variant_price') return 'native_variant_price';
    if (raw === 'direct_price_override') return 'direct_price_override';
    return 'auto';
  }

  function normalizeCartVariantId(value) {
    if (value == null || value === '') return '';
    var s = String(value).trim();
    var m = s.match(/ProductVariant\/\s*(\d+)/i) || s.match(/\b(\d{6,})\b/);
    return m ? m[1] : s;
  }

  function resolveMappedNativeVariantId(cfg, variant) {
    function pickMappedVariantId(config) {
      if (!config || typeof config !== 'object') return '';
      var candidates = [
        config.nativeVariantId,
        config.native_variant_id,
        config.mappedVariantId,
        config.mapped_variant_id,
        config.shopifyVariantId,
        config.shopify_variant_id,
      ];
      for (var i = 0; i < candidates.length; i += 1) {
        var normalized = normalizeCartVariantId(candidates[i]);
        if (normalized) return normalized;
      }
      return '';
    }

    var fromEffective = pickMappedVariantId(cfg);
    if (fromEffective) return fromEffective;

    var baseCfg =
      variant && variant.config && typeof variant.config === 'object' ? variant.config : null;
    if (!baseCfg || baseCfg === cfg) return '';
    return pickMappedVariantId(baseCfg);
  }

  function resolveStorefrontPriceApplicationMethod(configuredMethod, targetUnit, catalogUnit) {
    var normalized = normalizePriceApplicationMethod(configuredMethod);
    if (
      normalized === 'direct_price_override' ||
      normalized === 'auto' ||
      normalized === 'discounted_checkout_price' ||
      normalized === 'native_variant_price'
    ) {
      return 'direct_price_override';
    }
    return 'direct_price_override';
  }

  function getConfiguredCheckoutMethodProof(cfg, targetUnit, catalogUnit) {
    if (!cfg || typeof cfg !== 'object') return null;
    var configuredMethod = normalizePriceApplicationMethod(cfg.priceApplicationMethod);
    var method = resolveStorefrontPriceApplicationMethod(configuredMethod, targetUnit, catalogUnit);
    if (!method || method === 'auto') return null;
    return { applicationMethod: method };
  }

  function seedFixedPriceCartAttributesWithoutProductId(test, variant, reason) {
    if (!testTypeIsPrice(test) || !variant || !variant.config) return false;
    if (getCurrentProductId()) return false;
    var cfg = normalizePriceConfigKeys(variant.config || {});
    var mode = String(cfg.priceMode || 'fixed').toLowerCase();
    if (mode !== 'fixed') return false;
    if (
      cfg.byProduct &&
      typeof cfg.byProduct === 'object' &&
      Object.keys(cfg.byProduct).length > 0
    ) {
      return false;
    }
    var targetUnit = Number(cfg.price);
    if (!isFinite(targetUnit) || targetUnit < 0) return false;
    var variantIdForCart = variant.variantId != null ? variant.variantId : variant.id;
    if (variantIdForCart == null || String(variantIdForCart).trim() === '') {
      variantIdForCart = variant.variantName || variant.name || '';
    }
    if (!variantIdForCart || String(variantIdForCart).trim() === '') return false;
    var targetIds =
      test.targetIds ||
      (test.targetId || test.target_id ? [test.targetId || test.target_id] : null);
    injectPriceTestCartAttributes(
      test.id,
      variantIdForCart,
      getAssignmentProofFromVariant(variant),
      targetIds,
      { targetUnit: targetUnit },
      { applicationMethod: 'direct_price_override' }
    );
    persistRipxLiveDiagnostics('price_cart_attrs:fixed_no_product_id', {
      testId: test.id,
      reason: reason || 'unknown',
      targetUnit: targetUnit,
      variant: sanitizeDiagnosticVariant(variant),
    });
    return true;
  }

  function stateLooksLikePriceCartState(state) {
    if (!state || !state._ripx_price_test) return false;
    if (state.__ripx_shipping_test) return false;
    var activeTest = getActiveTestById(state._ripx_price_test);
    if (testTypeIsPrice(activeTest)) return true;
    return normalizePriceApplicationMethod(state._ripx_price_method) === 'direct_price_override';
  }

  function isPriceDirectOverrideStateIncomplete(state) {
    if (!state || !state._ripx_price_test || !state._ripx_variant) return true;
    var method = String(state._ripx_price_method || '').trim();
    if (method && method !== 'direct_price_override') return false;
    if (!state._ripx_target_unit) return true;
    if (!state._ripx_assignment_sig || !state._ripx_assignment_ts || !state._ripx_assignment_user) {
      return true;
    }
    return false;
  }

  function isRipxCartAddStateReady(state) {
    if (!state || !state._ripx_price_test || !state._ripx_variant) return false;
    // Price-test Cart Transform lines need a target unit and signed assignment proof.
    // Preview must never freeze Add to cart waiting on those proofs — test+variant is enough.
    if (stateLooksLikePriceCartState(state)) {
      if (PREVIEW_MODE || PREVIEW_SIMPLE_MODE) return true;
      return !isPriceDirectOverrideStateIncomplete(state);
    }
    return true;
  }

  function shouldWaitForRipxCartAddState() {
    if (_ripxCartAttributeState) return true;
    if (PREVIEW_MODE && PREVIEW_TEST_ID) return true;
    var tests = Array.isArray(CONFIG.activeTests) ? CONFIG.activeTests : [];
    for (var i = 0; i < tests.length; i += 1) {
      var test = tests[i];
      if (testTypeIsPrice(test) || testTypeIsOffer(test) || testTypeIsShipping(test)) {
        return true;
      }
    }
    return false;
  }

  function waitForRipxCartAttributeStateBeforeAdd(reason) {
    function makeSyntheticPreviewPriceTest() {
      if (!(PREVIEW_MODE && PREVIEW_TEST_ID)) return null;
      // Empty targets until byProduct matrix / storefront-test shape arrives.
      // Seeding the opened PDP as targetIds previously faked matches on wrong products.
      return {
        id: PREVIEW_TEST_ID,
        type: 'price',
        targetType: 'product',
        targetIds: null,
        targetId: null,
        previewSynthetic: true,
      };
    }
    function tryHydratePreviewCartAddState() {
      if (!(PREVIEW_MODE && PREVIEW_TEST_ID)) return Promise.resolve(null);
      return getVariant(PREVIEW_TEST_ID)
        .then(function (variant) {
          if (!variant) return _ripxCartAttributeState || null;
          var test = getActiveTestById(PREVIEW_TEST_ID);
          if (!test && variant.config) {
            test = configLooksLikeShipping(variant.config)
              ? makeSyntheticPreviewShippingTest()
              : makeSyntheticPreviewPriceTest();
          }
          if (test && testTypeIsPrice(test)) {
            seedFixedPriceCartAttributesWithoutProductId(
              test,
              variant,
              reason || 'cart_add_preview'
            );
            var curProductId = getCurrentProductId();
            if (curProductId && variant.config) {
              applyPriceTest(test.id, curProductId, test.targetVariantId || null, variant);
            } else {
              injectPreviewCartAttributesWhenConfigMissing(PREVIEW_TEST_ID, variant);
            }
          } else if (test && testTypeIsShipping(test)) {
            if (_ripxShippingPreviewHandoffDeferred) {
              finalizeShippingPreviewCartHandoff(test, variant, reason || 'cart_add_preview');
            } else {
              injectShippingTestCartAttributes(test, variant, {
                reason: reason || 'cart_add_preview',
              });
            }
          } else {
            var previewVariantId =
              variant.variantId != null && String(variant.variantId).trim()
                ? variant.variantId
                : variant.id != null && String(variant.id).trim()
                  ? variant.id
                  : PREVIEW_VARIANT_ID || PREVIEW_VARIANT_NAME;
            if (previewVariantId) {
              injectPriceTestCartAttributes(
                PREVIEW_TEST_ID,
                previewVariantId,
                getAssignmentProofFromVariant(variant),
                null,
                null,
                null
              );
            }
          }
          return _ripxCartAttributeState || null;
        })
        .catch(function () {
          return _ripxCartAttributeState || null;
        });
    }
    if (isRipxCartAddStateReady(_ripxCartAttributeState)) {
      return Promise.resolve(_ripxCartAttributeState);
    }
    var timeoutMs = 850;
    var timeout = new Promise(function (resolve) {
      setTimeout(function () {
        resolve(null);
      }, timeoutMs);
    });
    var hydrate = tryHydratePreviewCartAddState()
      .then(function (state) {
        if (isRipxCartAddStateReady(state)) return state;
        return getVariantCachePromise();
      })
      .then(function (cache) {
        if (isRipxCartAddStateReady(_ripxCartAttributeState)) return _ripxCartAttributeState;
        var tests = Array.isArray(CONFIG.activeTests) ? CONFIG.activeTests : [];
        for (var i = 0; i < tests.length; i += 1) {
          var test = tests[i];
          if (!testTypeIsPrice(test)) continue;
          var variant = cache && (cache[test.id] || cache[String(test.id)]);
          if (!variant) continue;
          if (seedFixedPriceCartAttributesWithoutProductId(test, variant, reason || 'cart_add')) {
            return _ripxCartAttributeState;
          }
        }
        return isRipxCartAddStateReady(_ripxCartAttributeState) ? _ripxCartAttributeState : null;
      })
      .catch(function () {
        return isRipxCartAddStateReady(_ripxCartAttributeState) ? _ripxCartAttributeState : null;
      });
    return Promise.race([hydrate, timeout]).then(function (state) {
      if (!state && DEBUG) {
        debugLog('cart intercept:', reason || 'cart_add', 'continued without RipX line state');
      }
      return state || null;
    });
  }

  /**
   * Resolve matrix pricing for the current PDP selection.
   *
   * Precedence is intentionally identical to checkout resolve:
   * base config -> root byVariant -> byProduct -> byProduct.byVariant. Keep both paths in sync.
   */
  function getEffectivePriceConfig(cfg, productId, currentVariantId) {
    if (!cfg || typeof cfg !== 'object') return cfg;
    var merged = {};
    for (var baseKey in cfg) {
      if (
        baseKey !== 'byProduct' &&
        baseKey !== 'byVariant' &&
        Object.prototype.hasOwnProperty.call(cfg, baseKey)
      ) {
        merged[baseKey] = cfg[baseKey];
      }
    }

    var rootByVariant = cfg.byVariant;
    if (
      currentVariantId != null &&
      currentVariantId !== '' &&
      rootByVariant &&
      typeof rootByVariant === 'object'
    ) {
      var rootVariantOverride = resolveByVariantEntry(rootByVariant, currentVariantId);
      if (rootVariantOverride && typeof rootVariantOverride === 'object') {
        for (var rootVariantKey in rootVariantOverride) {
          if (Object.prototype.hasOwnProperty.call(rootVariantOverride, rootVariantKey)) {
            merged[rootVariantKey] = rootVariantOverride[rootVariantKey];
          }
        }
      }
    }

    var byProduct = cfg.byProduct;
    if (!byProduct || typeof byProduct !== 'object') return normalizeMergedPriceConfig(cfg, merged);
    var override = resolveByProductEntry(byProduct, productId);
    if (!override || typeof override !== 'object') return normalizeMergedPriceConfig(cfg, merged);
    for (var j in override)
      if (j !== 'byVariant' && Object.prototype.hasOwnProperty.call(override, j))
        merged[j] = override[j];
    var byVariant = override.byVariant;
    if (byVariant && typeof byVariant === 'object') {
      var variantOverride = resolveByVariantEntry(byVariant, currentVariantId);
      // Single-SKU fallback only. Multiple keys + unmatched Shopify variant → refuse wrong price.
      if (!variantOverride || typeof variantOverride !== 'object') {
        var fallbackVariantKeys = Object.keys(byVariant);
        variantOverride =
          fallbackVariantKeys.length === 1 ? byVariant[fallbackVariantKeys[0]] : null;
        if (!variantOverride && fallbackVariantKeys.length > 1) {
          ripxTrace(
            'S7',
            'byVariant matrix miss — multi-SKU, no safe fallback',
            {
              productId: productId,
              shopifyVariantId: currentVariantId,
              matrixKeys: fallbackVariantKeys.slice(0, 8),
            },
            'warn'
          );
        }
      }
      if (variantOverride && typeof variantOverride === 'object') {
        for (var v in variantOverride)
          if (Object.prototype.hasOwnProperty.call(variantOverride, v))
            merged[v] = variantOverride[v];
      }
    }
    return normalizeMergedPriceConfig(cfg, merged);
  }

  /**
   * Parse roundTo from config (number or string, e.g. 0.25 or "0.25"). Returns a positive number or 0 if invalid.
   */
  function parseRoundTo(roundTo) {
    if (roundTo == null) return 0;
    var n = typeof roundTo === 'number' ? roundTo : parseFloat(roundTo, 10);
    return typeof n === 'number' && isFinite(n) && n > 0 ? n : 0;
  }

  /**
   * Apply a price-test assignment to the product page.
   *
   * This function has two jobs: paint the main PDP price and prepare cart/checkout handoff data.
   * It deliberately avoids cart drawers/recommendations so theme cart UI does not get double-painted.
   */
  async function applyPriceTest(testId, productId, variantId, providedVariant) {
    var variant = providedVariant || (await getVariant(testId));
    if (!variant) {
      ripxTrace(
        'S7',
        'applyPriceTest skip — no variant',
        { testId: testId, productId: productId },
        'warn'
      );
      return;
    }
    if (!variant.config) {
      ripxTrace('S7', 'applyPriceTest — config missing, inject preview cart attrs only', {
        testId: testId,
        productId: productId,
      });
      injectPreviewCartAttributesWhenConfigMissing(testId, variant);
      return;
    }

    var variantIdForCart = variant.variantId != null ? variant.variantId : variant.id;
    var currentPdpVariantId = getSelectedVariantId();
    if (currentPdpVariantId == null || String(currentPdpVariantId).trim() === '') {
      var jsonForVariantSelection = getProductJson();
      if (
        jsonForVariantSelection &&
        Array.isArray(jsonForVariantSelection.variants) &&
        jsonForVariantSelection.variants.length > 0
      ) {
        var fallbackSelectedVariant =
          jsonForVariantSelection.selectedVariant || jsonForVariantSelection.variants[0];
        if (fallbackSelectedVariant && fallbackSelectedVariant.id != null) {
          currentPdpVariantId = fallbackSelectedVariant.id;
        }
      }
    }
    var cfg = getEffectivePriceConfig(variant.config, productId, currentPdpVariantId);
    var priceMode = (cfg.priceMode || 'fixed').toLowerCase();
    if (priceMode === 'control') {
      ripxTrace('S7', 'applyPriceTest skip — control arm', {
        testId: testId,
        productId: productId,
      });
      return;
    }

    var priceNum = null;
    var hasByProduct =
      cfg &&
      variant.config &&
      variant.config.byProduct &&
      typeof variant.config.byProduct === 'object' &&
      Object.keys(variant.config.byProduct).length > 0;

    if (priceMode === 'fixed') {
      var rawPrice = cfg.price;
      if (rawPrice === null || rawPrice === undefined || rawPrice === '') {
        ripxTrace(
          'S7',
          'applyPriceTest skip — no effective fixed price (matrix miss or null root)',
          {
            testId: testId,
            productId: productId,
            shopifyVariantId: currentPdpVariantId,
            hasByProduct: !!hasByProduct,
          },
          'warn'
        );
        return;
      }
      priceNum = parseFloat(rawPrice, 10);
    } else if (priceMode === 'amount') {
      var useCompareAt = (cfg.priceBase || 'price').toLowerCase() === 'compare_at';
      var catalog = useCompareAt ? getCatalogCompareAtFromPage() : null;
      if (catalog === null) catalog = getCatalogPriceFromPage();
      if (catalog === null) {
        ripxTrace(
          'S7',
          'applyPriceTest skip — amount mode, no catalog price on page',
          { testId: testId, productId: productId },
          'warn'
        );
        return;
      }
      if (
        cfg.priceDelta === null ||
        cfg.priceDelta === undefined ||
        String(cfg.priceDelta).trim() === ''
      ) {
        ripxTrace('S7', 'applyPriceTest skip — missing priceDelta', { testId: testId }, 'warn');
        return;
      }
      var delta = parseFloat(cfg.priceDelta, 10);
      if (isNaN(delta)) {
        ripxTrace('S7', 'applyPriceTest skip — invalid priceDelta', { testId: testId }, 'warn');
        return;
      }
      priceNum = catalog + delta;
    } else if (priceMode === 'percent') {
      var useCompareAtPct = (cfg.priceBase || 'price').toLowerCase() === 'compare_at';
      var catalogP = useCompareAtPct ? getCatalogCompareAtFromPage() : null;
      if (catalogP === null) catalogP = getCatalogPriceFromPage();
      if (catalogP === null) {
        ripxTrace(
          'S7',
          'applyPriceTest skip — percent mode, no catalog price on page',
          { testId: testId, productId: productId },
          'warn'
        );
        return;
      }
      if (
        cfg.pricePercent === null ||
        cfg.pricePercent === undefined ||
        String(cfg.pricePercent).trim() === ''
      ) {
        ripxTrace('S7', 'applyPriceTest skip — missing pricePercent', { testId: testId }, 'warn');
        return;
      }
      var pct = parseFloat(cfg.pricePercent, 10);
      if (isNaN(pct)) {
        ripxTrace('S7', 'applyPriceTest skip — invalid pricePercent', { testId: testId }, 'warn');
        return;
      }
      priceNum = catalogP * (1 - pct / 100);
    } else {
      ripxTrace(
        'S7',
        'applyPriceTest skip — unknown priceMode',
        { testId: testId, priceMode: priceMode },
        'warn'
      );
      return;
    }

    if (isNaN(priceNum) || !isFinite(priceNum)) {
      ripxTrace('S7', 'applyPriceTest skip — non-finite price', { testId: testId }, 'warn');
      return;
    }
    priceNum = Math.max(0, Math.round(priceNum * 100) / 100);
    var catalogUnitForCheckout = getCatalogPriceFromPage(currentPdpVariantId);
    var discountUnit = null;
    if (catalogUnitForCheckout != null && isFinite(Number(catalogUnitForCheckout))) {
      discountUnit = Math.round((Number(catalogUnitForCheckout) - priceNum) * 100) / 100;
      if (!(discountUnit > 0)) {
        discountUnit = null;
      }
    }
    var roundToVal = parseRoundTo(cfg.roundTo);
    if (roundToVal > 0) {
      priceNum = Math.round(priceNum / roundToVal) * roundToVal;
      priceNum = Math.max(0, Math.round(priceNum * 100) / 100);
      if (catalogUnitForCheckout != null && isFinite(Number(catalogUnitForCheckout))) {
        discountUnit = Math.round((Number(catalogUnitForCheckout) - priceNum) * 100) / 100;
        if (!(discountUnit > 0)) {
          discountUnit = null;
        }
      }
    }
    // Storefront must choose the same application method that checkout will honor. Discounts can
    // lower prices, but increases need native-variant/direct-override style handling.
    var resolvedPriceApplicationMethod = resolveStorefrontPriceApplicationMethod(
      cfg.priceApplicationMethod,
      priceNum,
      catalogUnitForCheckout
    );
    var mappedNativeVariantId = resolveMappedNativeVariantId(cfg, variant);
    var nativeVariantIdForCart =
      resolvedPriceApplicationMethod === 'native_variant_price' ? mappedNativeVariantId : '';
    if (
      resolvedPriceApplicationMethod === 'native_variant_price' &&
      !nativeVariantIdForCart &&
      DEBUG
    ) {
      debugLog(
        'applyPriceTest: native variant method selected but no mapped nativeVariantId found'
      );
    }
    var display = formatShopPrice(priceNum);
    if (!display) {
      ripxTrace(
        'S7',
        'applyPriceTest skip — formatShopPrice empty',
        { testId: testId, priceNum: priceNum },
        'warn'
      );
      return;
    }

    rememberPreviewFocusProductId(productId);
    ripxTrace('S8', 'applyPriceTest paint + cart handoff', {
      testId: testId,
      productId: productId,
      priceNum: priceNum,
      display: display,
      shopifyVariantId: currentPdpVariantId,
      method: resolvedPriceApplicationMethod,
    });
    registerRipxAssignedPrice({
      testId: testId,
      productId: productId,
      variantId: currentPdpVariantId,
      variantIdForCart: variantIdForCart,
      targetUnit: priceNum,
      display: display,
    });

    var currentDisplay = display;

    function recomputeDisplay() {
      if (priceMode === 'fixed') return currentDisplay;
      if (priceMode === 'amount') {
        var useCompareAt = (cfg.priceBase || 'price').toLowerCase() === 'compare_at';
        var catalogAmt = useCompareAt ? getCatalogCompareAtFromPage() : null;
        if (catalogAmt === null) catalogAmt = getCatalogPriceFromPage();
        if (catalogAmt === null) return null;
        var deltaAmt = parseFloat(cfg.priceDelta, 10);
        if (isNaN(deltaAmt)) return null;
        var numAmt = Math.max(0, Math.round((catalogAmt + deltaAmt) * 100) / 100);
        var roundAmt = parseRoundTo(cfg.roundTo);
        if (roundAmt > 0) numAmt = Math.round(numAmt / roundAmt) * roundAmt;
        if (!isFinite(numAmt)) return null;
        return formatShopPrice(numAmt) || null;
      }
      if (priceMode === 'percent') {
        var useCompareAtPct = (cfg.priceBase || 'price').toLowerCase() === 'compare_at';
        var catalogPct = useCompareAtPct ? getCatalogCompareAtFromPage() : null;
        if (catalogPct === null) catalogPct = getCatalogPriceFromPage();
        if (catalogPct === null) return null;
        var pctVal = parseFloat(cfg.pricePercent, 10);
        if (isNaN(pctVal)) return null;
        var numPct = catalogPct * (1 - pctVal / 100);
        numPct = Math.max(0, Math.round(numPct * 100) / 100);
        var roundPct = parseRoundTo(cfg.roundTo);
        if (roundPct > 0) numPct = Math.round(numPct / roundPct) * roundPct;
        if (!isFinite(numPct)) return null;
        return formatShopPrice(numPct) || null;
      }
      return currentDisplay;
    }

    if (variantIdForCart != null && String(variantIdForCart).trim() !== '') {
      var earlySourceVariantIdForCart = normalizeCartVariantId(currentPdpVariantId);
      window.__RIPX_PRICE_TEST_CTX__ = { testId: testId, variantId: variantIdForCart };
      injectPriceTestCartAttributes(
        testId,
        variantIdForCart,
        getAssignmentProofFromVariant(variant),
        [productId],
        { targetUnit: priceNum, discountUnit: discountUnit },
        {
          applicationMethod: resolvedPriceApplicationMethod,
          nativeVariantId: nativeVariantIdForCart,
          sourceVariantId: earlySourceVariantIdForCart,
        }
      );
    }

    var pid = toNumericProductId(productId);
    var pdpGid = getCurrentProductId();
    if (!pid || !pdpGid || toNumericProductId(pdpGid) !== pid) {
      if (DEBUG)
        debugLog(
          'applyPriceTest: skip (need PDP for this product)',
          pid,
          pdpGid ? 'mismatch' : 'no PDP'
        );
      return;
    }

    var vid = variantId ? String(variantId).replace(/\D/g, '') : '';

    var cartUi =
      '.cart-drawer,.cart-notification,#CartDrawer,#mini-cart,.mini-cart,[data-cart-drawer],.drawer--cart,aside.mini-cart,cart-drawer,.header__cart,.site-header__cart,predictive-search';

    function inCartUi(el) {
      return el.closest && el.closest(cartUi);
    }

    var specificSelectors = [];
    var activeTest = getActiveTestById(testId);
    appendConfiguredRegistrySelectors(specificSelectors, 'pdp', 'regular', activeTest);
    appendConfiguredRegistrySelectors(specificSelectors, 'pdp', 'compare_at', activeTest);
    appendConfiguredRegistrySelectors(specificSelectors, 'quickview', 'regular', activeTest);
    appendConfiguredRegistrySelectors(specificSelectors, 'quickview', 'compare_at', activeTest);
    if (pid) {
      specificSelectors.push(
        '.product-price[data-product-id="' + pid + '"]',
        // Dawn leaf nodes (some themes only use price-item--regular without price-item__regular)
        '[data-product-id="' + pid + '"] .price-item--regular',
        'product-info[data-product-id="' + pid + '"] .price-item--regular',
        '[data-product-id="' + pid + '"] .price-item--regular .price-item__regular',
        '[data-product-id="' + pid + '"] .price-item--regular .price',
        '[data-product-id="' + pid + '"] .price-item__regular',
        '[data-product-id="' + pid + '"] .product__price',
        '[data-product-id="' + pid + '"] [data-price-container] .money',
        'product-info[data-product-id="' + pid + '"] .price-item__regular',
        'product-info[data-product-id="' + pid + '"] .price-item--regular .price',
        '[data-product-id="' + pid + '"] .price',
        'product-info[data-product-id="' + pid + '"] .price',
        'product-price[data-product-id="' + pid + '"]'
      );
    }
    if (vid) {
      specificSelectors.push(
        '.price[data-variant-id="' + vid + '"]',
        '[data-variant-id="' + vid + '"] .money',
        '.product-form [data-variant-id="' + vid + '"] .price'
      );
    }

    // Dawn / OS 2.0 themes often use .price-item__regular with no .money — paint those leaves first.
    // Avoid `.price--large` / outer `.price` wrappers: they match one container and wipe inner markup (one painted node).
    var broadSelectors = [
      // Dawn / OS 2.0 leaves (many themes have no .money)
      '.price-item--regular',
      '.price-item--regular .price-item__regular',
      '.price-item--regular .price',
      '.price-item__regular',
      '.price-item--sale',
      '.price-item--sale .price-item__sale .price',
      '.price-item--sale .price-item__sale',
      // Legacy / other themes
      '.product__price',
      '.product-single__price',
      '#ProductPrice',
      '#productPrice',
      '.product .price:not(.price--compare):not(.price--large)',
      '.price-item--sale .price-item__sale .money',
      '.price-item--regular .price-item__regular .money',
      '[data-product-price]',
      '.product-price .money',
      'sale-price .money',
      'span[data-type="price"]',
    ];

    function mainProductRoot() {
      return (
        document.querySelector('product-info[data-product-id="' + pid + '"]') ||
        document.querySelector('.product-single[data-product-id="' + pid + '"]') ||
        document.querySelector('main product-info') ||
        document.querySelector('product-info') ||
        document.querySelector('[data-section-type="product-template"]') ||
        document.querySelector('#MainProduct-template') ||
        document.querySelector('main .product[data-product-id="' + pid + '"]') ||
        document.querySelector('main .product-single') ||
        document.querySelector('.product-template__container')
      );
    }

    var pdpPaintRoot = mainProductRoot();
    var pdpPaintScope = pdpPaintRoot || document.querySelector('main') || document.body;

    function paint() {
      var seen = new WeakSet();
      function paintEl(el) {
        if (!el || seen.has(el) || inCartUi(el)) return;
        var tagU = el.tagName && String(el.tagName).toUpperCase();
        if (tagU === 'S' || tagU === 'DEL' || tagU === 'STRIKE') return;
        // Dawn/OS2: do not replace outer .price blocks that contain real leaf nodes (avoids one-node wipe).
        try {
          if (el.querySelector) {
            var dawnLeaf =
              el.querySelector('.price-item__regular') ||
              el.querySelector('.price-item--sale .price-item__sale .price') ||
              el.querySelector('.price-item--sale .price-item__sale');
            if (dawnLeaf && dawnLeaf !== el) return;
          }
        } catch (e0) {}
        seen.add(el);
        var textWrites = 0;
        var attrWrites = 0;
        // Avoid continuous mutation churn by writing only when value changed.
        if (el.textContent !== currentDisplay) {
          el.textContent = currentDisplay;
          textWrites += 1;
        }
        var variantStr = String(variantIdForCart);
        if (el.getAttribute('data-test-variant') !== variantStr) {
          el.setAttribute('data-test-variant', variantStr);
          attrWrites += 1;
        }
        var testStr = String(testId);
        if (el.getAttribute('data-test-id') !== testStr) {
          el.setAttribute('data-test-id', testStr);
          attrWrites += 1;
        }
        if (el.getAttribute('data-ripx-price') !== '1') {
          el.setAttribute('data-ripx-price', '1');
          attrWrites += 1;
        }
        recordRipxPaintEvent('pdp', textWrites, attrWrites);
        recordRipxPricePaintParity(testId, el, priceNum, 'pdp');
      }
      specificSelectors.forEach(function (sel) {
        try {
          pdpPaintScope.querySelectorAll(sel).forEach(function (el) {
            if (pdpPaintRoot && !pdpPaintRoot.contains(el)) return;
            if (
              el.closest &&
              el.closest(
                '.recommended-products,.related-products,[data-section-type="recently-viewed"],[id*="related"]'
              )
            )
              return;
            paintEl(el);
          });
        } catch (e) {}
      });
      var broadRoot = pdpPaintScope;
      broadSelectors.forEach(function (sel) {
        try {
          broadRoot.querySelectorAll(sel).forEach(function (el) {
            if (pdpPaintRoot && !pdpPaintRoot.contains(el)) return;
            if (!pdpPaintRoot) {
              var holder = el.closest('[data-product-id]');
              if (
                holder &&
                holder.getAttribute('data-product-id') &&
                toNumericProductId(holder.getAttribute('data-product-id')) !== pid
              )
                return;
              if (
                el.closest &&
                el.closest(
                  '.recommended-products,.related-products,[data-section-type="recently-viewed"]'
                )
              )
                return;
            }
            paintEl(el);
          });
        } catch (e) {}
      });
    }

    paint();

    var root =
      pdpPaintRoot ||
      document.querySelector(
        'product-info, [data-section-type="product-template"], main .product'
      ) ||
      document.body;
    try {
      if (root && root !== document.body) root.setAttribute('data-ripx-price-test', String(testId));
    } catch (e) {}
    setTimeout(paint, 400);

    var t = null;
    try {
      var obs = new MutationObserver(function () {
        if (t) clearTimeout(t);
        t = setTimeout(paint, 80);
      });
      obs.observe(root, { childList: true, subtree: true, characterData: false });
    } catch (e) {}

    function recomputeAndPaint() {
      var next = recomputeDisplay();
      if (next) currentDisplay = next;
      if (currentDisplay) paint();
    }
    ['variant:change', 'shopify:section:load', 'product:update'].forEach(function (evt) {
      document.addEventListener(evt, function () {
        setTimeout(recomputeAndPaint, 50);
      });
    });
    var variantInput = document.querySelector(
      'input[name="id"], input[name="variant_id"], [data-variant-picker] input'
    );
    if (variantInput) {
      variantInput.addEventListener('change', function () {
        setTimeout(recomputeAndPaint, 50);
      });
    }

    if (variantIdForCart != null && String(variantIdForCart).trim() !== '') {
      var sourceVariantIdForCart = normalizeCartVariantId(currentPdpVariantId);
      if (!sourceVariantIdForCart) {
        var variantIdInputForCart =
          document.querySelector('form[action*="cart/add"] input[name="id"]') ||
          document.querySelector('form[action*="/cart/add"] input[name="id"]') ||
          document.querySelector('input[name="id"]');
        if (variantIdInputForCart && variantIdInputForCart.value) {
          sourceVariantIdForCart = normalizeCartVariantId(variantIdInputForCart.value);
        }
      }
      if (!sourceVariantIdForCart) {
        var jsonForCart = getProductJson();
        if (jsonForCart && Array.isArray(jsonForCart.variants) && jsonForCart.variants.length > 0) {
          var fallbackSourceVariant = jsonForCart.selectedVariant || jsonForCart.variants[0];
          sourceVariantIdForCart = normalizeCartVariantId(
            fallbackSourceVariant && fallbackSourceVariant.id
          );
        }
      }
      window.__RIPX_PRICE_TEST_CTX__ = { testId: testId, variantId: variantIdForCart };
      // This is the critical bridge from visible PDP changes to actual cart/checkout pricing.
      injectPriceTestCartAttributes(
        testId,
        variantIdForCart,
        getAssignmentProofFromVariant(variant),
        [productId],
        { targetUnit: priceNum, discountUnit: discountUnit },
        {
          applicationMethod: resolvedPriceApplicationMethod,
          nativeVariantId: nativeVariantIdForCart,
          sourceVariantId: sourceVariantIdForCart,
        }
      );
    }
  }

  /**
   * Parse numeric price from displayed string or element (e.g. "$29.99", "€29,99", "1.234,56").
   */
  function parsePriceFromDisplay(val) {
    if (val == null) return null;
    var s = typeof val === 'string' ? val : val.textContent || val.innerText || '';
    if (typeof s !== 'string') return null;
    s = s.trim().replace(/\s/g, '');
    if (!s) return null;
    // "Regularprice$600.00" / stacked sale+compare — prefer last $… group when $ is present.
    if (s.indexOf('$') !== -1) {
      var dollarGroups = s.match(/\$[\d,]+(?:\.\d{2})?/g);
      if (dollarGroups && dollarGroups.length) {
        s = dollarGroups[dollarGroups.length - 1].replace(/\s/g, '');
      }
    }
    var lastComma = s.lastIndexOf(',');
    var lastDot = s.lastIndexOf('.');
    var normalized =
      lastComma > lastDot && lastComma >= 0
        ? s.replace(/\./g, '').replace(',', '.')
        : s.replace(/,/g, '');
    var num = parseFloat(normalized.replace(/[^0-9.-]/g, ''), 10);
    if (isNaN(num)) return null;
    if (s.indexOf('.') === -1 && s.indexOf(',') === -1 && num >= 100) num = num / 100;
    return num;
  }

  function getStableCatalogPriceForElement(el) {
    if (!el) return null;
    var srcAttr = el.getAttribute && el.getAttribute('data-ripx-catalog-src');
    if (srcAttr != null && String(srcAttr).trim() !== '') {
      var parsedSrc = parseFloat(String(srcAttr).trim(), 10);
      if (!isNaN(parsedSrc) && isFinite(parsedSrc)) {
        return parsedSrc;
      }
    }
    var catalog = parsePriceFromDisplay(el);
    if (catalog != null && el.setAttribute) {
      el.setAttribute('data-ripx-catalog-src', String(catalog));
    }
    return catalog;
  }

  function paintPriceNode(el, display, testId, variantIdForCart, scope, targetUnit) {
    if (!el || !display) return;
    var textWrites = 0;
    var attrWrites = 0;
    if (el.textContent !== display) {
      el.textContent = display;
      textWrites += 1;
    }
    if (variantIdForCart != null && String(variantIdForCart).trim() !== '') {
      var variantStr = String(variantIdForCart);
      if (el.getAttribute('data-test-variant') !== variantStr) {
        el.setAttribute('data-test-variant', variantStr);
        attrWrites += 1;
      }
    }
    var testStr = String(testId);
    if (el.getAttribute('data-test-id') !== testStr) {
      el.setAttribute('data-test-id', testStr);
      attrWrites += 1;
    }
    if (el.getAttribute('data-ripx-price') !== '1') {
      el.setAttribute('data-ripx-price', '1');
      attrWrites += 1;
    }
    recordRipxPaintEvent(scope || 'listing', textWrites, attrWrites);
    if (targetUnit != null && isFinite(Number(targetUnit))) {
      recordRipxPricePaintParity(testId, el, Number(targetUnit), scope || 'listing');
    }
  }

  function getConfiguredShopPriceSurfaceMappings() {
    var registry = CONFIG.priceSurfaceRegistry;
    return registry && Array.isArray(registry.shopMappings) ? registry.shopMappings : [];
  }

  function getConfiguredTestPriceSurfaceMappings(test) {
    return test && Array.isArray(test.priceSurfaceMappings) ? test.priceSurfaceMappings : [];
  }

  function extractNumericProductIdFromText(value) {
    var raw = String(value || '').trim();
    if (!raw) return '';
    var gidMatch = raw.match(/Product\/(\d{6,})/i);
    if (gidMatch && gidMatch[1]) return gidMatch[1];
    // Dawn-style IDs often contain both a section/template id and the product id:
    // CardLink-template--21010091114685__featured_collection-8276578566333.
    // The product id is the final long numeric token, not the first one.
    var matches = raw.match(/\d{6,}/g);
    if (matches && matches.length) return matches[matches.length - 1];
    return '';
  }

  function getProductIdForListingCard(card) {
    if (!card) return '';
    var direct =
      (card.getAttribute &&
        (card.getAttribute('data-product-id') ||
          card.getAttribute('data-product') ||
          card.getAttribute('data-productid'))) ||
      '';
    var normalizedDirect = toNumericProductId(direct) || extractNumericProductIdFromText(direct);
    if (normalizedDirect) return normalizedDirect;
    try {
      var withData =
        card.querySelector &&
        card.querySelector('[data-product-id], [data-product], [data-productid]');
      if (withData) {
        var nestedData =
          withData.getAttribute('data-product-id') ||
          withData.getAttribute('data-product') ||
          withData.getAttribute('data-productid') ||
          '';
        var normalizedNested =
          toNumericProductId(nestedData) || extractNumericProductIdFromText(nestedData);
        if (normalizedNested) return normalizedNested;
      }
    } catch (_eDataProduct) {}
    var idSources = [];
    try {
      if (card.id) idSources.push(card.id);
      if (card.getAttribute) {
        idSources.push(card.getAttribute('aria-labelledby') || '');
        idSources.push(card.getAttribute('href') || '');
      }
      if (card.querySelectorAll) {
        card.querySelectorAll('[id], [aria-labelledby], a[href]').forEach(function (node) {
          if (node.id) idSources.push(node.id);
          if (node.getAttribute) {
            idSources.push(node.getAttribute('aria-labelledby') || '');
            idSources.push(node.getAttribute('href') || '');
          }
        });
      }
    } catch (_eIdSources) {}
    for (var i = 0; i < idSources.length; i += 1) {
      var extracted = extractNumericProductIdFromText(idSources[i]);
      if (extracted) return extracted;
    }
    return '';
  }

  function appendConfiguredRegistrySelectors(targetList, surface, role, test) {
    resolveConfiguredPriceSurfaceSelectors(surface, role, { test: test }).forEach(function (sel) {
      if (targetList.indexOf(sel) === -1) {
        targetList.push(sel);
      }
    });
  }

  function appendConfiguredRegistrySelectorsForSurfaces(targetList, surfaces, roles, test) {
    (surfaces || []).forEach(function (surface) {
      (roles || ['regular']).forEach(function (role) {
        appendConfiguredRegistrySelectors(targetList, surface, role, test);
      });
    });
  }

  function hasAnyConfiguredPriceSurfaceMappings(test) {
    return (
      getConfiguredTestPriceSurfaceMappings(test).length > 0 ||
      getConfiguredShopPriceSurfaceMappings().length > 0
    );
  }

  /**
   * Authoritative registry mode must be per-surface: shop PDP-only mappings should not
   * suppress listing heuristics when no PLP/search/home selectors are configured.
   */
  function hasConfiguredPriceSurfaceMappingsForSurfaces(surfaces, roles, test) {
    var list = [];
    appendConfiguredRegistrySelectorsForSurfaces(list, surfaces, roles || ['regular'], test);
    return list.length > 0;
  }

  function resolveConfiguredPriceSurfaceSelectors(surface, role, options) {
    var surfaceKey = String(surface || 'global').toLowerCase();
    var roleKey = String(role || 'regular').toLowerCase();
    var testMaps =
      options && options.test ? getConfiguredTestPriceSurfaceMappings(options.test) : [];
    var shopMaps = getConfiguredShopPriceSurfaceMappings();
    var surfacePasses = surfaceKey === 'global' ? ['global'] : [surfaceKey, 'global'];
    var lists = [testMaps, shopMaps];
    var out = [];
    var seen = {};
    lists.forEach(function (list) {
      surfacePasses.forEach(function (passSurface) {
        var sorted = (list || []).slice().sort(function (a, b) {
          return (Number(b.priority) || 0) - (Number(a.priority) || 0);
        });
        sorted.forEach(function (entry) {
          if (!entry || entry.enabled === false) return;
          if (String(entry.surface || '').toLowerCase() !== passSurface) return;
          if (String(entry.role || 'regular').toLowerCase() !== roleKey) return;
          var sel = String(entry.selector || '').trim();
          if (!sel) return;
          if (seen[sel]) return;
          seen[sel] = true;
          out.push(sel);
        });
      });
    });
    return out;
  }

  /**
   * All-products fallback painter for listing/cart surfaces without product ids.
   * Some themes don't include data-product-id on home/listing cards, which breaks per-product matching.
   * For all-products tests without byProduct overrides, we can still repaint explicit/manual selectors:
   * - fixed mode paints the configured fixed target price
   * - amount/percent computes from the visible catalog number
   */
  function canUseAllProductsGlobalFallback(cfg) {
    if (!cfg || typeof cfg !== 'object') return false;
    if (cfg.byProduct && typeof cfg.byProduct === 'object' && Object.keys(cfg.byProduct).length > 0)
      return false;
    var pm = String(cfg.priceMode || '').toLowerCase();
    return pm === 'fixed' || pm === 'amount' || pm === 'percent';
  }

  function computeAllProductsAdjustedPrice(catalog, cfg) {
    var pm = String(cfg.priceMode || '').toLowerCase();
    if (pm === 'fixed') {
      var fixed = parseFloat(cfg.price, 10);
      return !isNaN(fixed) && isFinite(fixed) ? Math.max(0, Math.round(fixed * 100) / 100) : null;
    }
    if (catalog == null || !isFinite(catalog)) return null;
    if (pm === 'amount') {
      var d = parseFloat(cfg.priceDelta, 10);
      if (isNaN(d)) return null;
      return Math.max(0, Math.round((catalog + d) * 100) / 100);
    }
    if (pm === 'percent') {
      var p = parseFloat(cfg.pricePercent, 10);
      if (isNaN(p)) return null;
      return Math.max(0, Math.round(catalog * (1 - p / 100) * 100) / 100);
    }
    return null;
  }

  /**
   * Prefer leaf nodes so we do not parse concatenated sale/compare text from a parent.
   * Dawn themes often omit `.money` and use `.price-item__regular` inside `.price-item--regular`.
   */
  function isLeafPricePaintNode(el) {
    if (!el || !el.querySelector) return true;
    var innerMoney = el.querySelector('.money');
    if (innerMoney && innerMoney !== el) return false;
    var innerDawn =
      el.querySelector('.price-item__regular') ||
      el.querySelector('.price-item--sale .price') ||
      el.querySelector('.price-item--regular .price:not(.price--compare)');
    if (innerDawn && innerDawn !== el) return false;
    return true;
  }

  /** Dawn / OS 2.0 `cart-drawer` often renders line prices inside Shadow DOM — light-DOM querySelectorAll misses them. */
  function querySelectorAllWithShadowRoots(root, sel) {
    var acc = [];
    function q(node) {
      if (!node) return;
      try {
        if (node.querySelectorAll) {
          node.querySelectorAll(sel).forEach(function (el) {
            acc.push(el);
          });
        }
      } catch (e) {}
    }
    function walk(n) {
      if (!n) return;
      q(n);
      try {
        if (n.shadowRoot) walk(n.shadowRoot);
      } catch (e2) {}
      try {
        if (n.children) {
          for (var i = 0; i < n.children.length; i++) {
            walk(n.children[i]);
          }
        }
      } catch (e3) {}
    }
    walk(root);
    var seen = new WeakSet();
    return acc.filter(function (el) {
      if (!el || seen.has(el)) return false;
      seen.add(el);
      return true;
    });
  }

  /**
   * All-products global fallback: reapply timers and section loads can run this multiple times.
   * We store the original catalog on first paint so deltas are not applied twice to already-adjusted text.
   */
  function paintAllProductsGlobalPrices(testId, variant, scope) {
    if (!variant || !variant.config) return;
    if (
      scope === 'cart' &&
      (shouldDisableCartUiPricePaint() ||
        shouldPreferNativeCartRendering() ||
        shouldBlockCartFallbackPaint())
    )
      return;
    var cfg = variant.config;
    if (!canUseAllProductsGlobalFallback(cfg)) return;
    var pm = String(cfg.priceMode || '').toLowerCase();
    if (pm === 'control') return;

    var cartUi =
      '.cart-drawer,.cart-notification,#CartDrawer,#mini-cart,.mini-cart,[data-cart-drawer],.drawer--cart,aside.mini-cart,cart-drawer,.header__cart,.site-header__cart,predictive-search';
    function inCartUi(el) {
      return el.closest && el.closest(cartUi);
    }
    // Prefer qualified selectors; include Dawn leaves (.price-item__regular) when themes have no .money.
    var sel =
      '.price .money, .product-price .money, [data-product-price], .money, .price-item--regular .price-item__regular, .price-item--regular .price, .price-item__regular, .price-item--regular, .price-item, [data-price], .line-item__price .money, [data-line-item-price], .cart-item__price .money, .cart-item__price';
    var configuredSelectors = [];
    appendConfiguredRegistrySelectorsForSurfaces(
      configuredSelectors,
      scope === 'cart' ? ['cart', 'global'] : getListingPriceSurfaceKeys(),
      scope === 'cart' ? ['regular', 'cart_line'] : ['regular', 'compare_at'],
      getActiveTestById(testId)
    );
    var listingSurfaces = scope === 'cart' ? ['cart', 'global'] : getListingPriceSurfaceKeys();
    var listingRoles = scope === 'cart' ? ['regular', 'cart_line'] : ['regular', 'compare_at'];
    var priceSurfaceMappingsAuthoritative =
      scope !== 'cart' &&
      hasConfiguredPriceSurfaceMappingsForSurfaces(
        listingSurfaces,
        listingRoles,
        getActiveTestById(testId)
      );
    if (priceSurfaceMappingsAuthoritative) {
      if (!configuredSelectors.length) {
        persistRipxLiveDiagnostics('price_surface_mapping_skip', {
          testId: testId,
          scope: scope || null,
          reason: 'no_configured_listing_selector',
          surfaces: getListingPriceSurfaceKeys(),
        });
        return;
      }
      sel = configuredSelectors.join(', ');
    } else if (configuredSelectors.length) {
      sel += ', ' + configuredSelectors.join(', ');
    }
    if (scope === 'cart') {
      sel +=
        ', .cart-item__price, .cart-item__final-price, td.cart-item__price, .cart__item .price, .cart-item .price-item--regular, .cart-item__totals .price, .cart-item__price-wrapper .price, .cart-item__price-wrapper .price--end, .cart-item__details .product-option, .totals__subtotal-value, .totals__footer .totals__value, [data-cart-item-regular-price], [data-cart-item-price]';
    }
    var roots = [];
    if (scope === 'cart') {
      roots = Array.prototype.slice.call(
        document.querySelectorAll(
          '.cart-drawer, cart-drawer, #CartDrawer, .drawer--cart, [data-cart-drawer], #cart-form, form[action*="/cart"], .cart-items, main .cart'
        )
      );
    } else {
      roots = [document.querySelector('main') || document.body];
    }
    var variantIdForCart = variant.variantId != null ? variant.variantId : variant.id;

    roots.forEach(function (root) {
      if (!root) return;
      try {
        var nodes =
          scope === 'cart'
            ? querySelectorAllWithShadowRoots(root, sel)
            : Array.prototype.slice.call(root.querySelectorAll(sel));
        nodes.forEach(function (el) {
          if (!el) return;
          var tgn = el.tagName && String(el.tagName).toUpperCase();
          if (tgn === 'S' || tgn === 'DEL' || tgn === 'STRIKE') return;
          if (!isLeafPricePaintNode(el)) return;
          if (scope === 'listing' && inCartUi(el)) return;
          var catalog = pm === 'fixed' ? 0 : getStableCatalogPriceForElement(el);
          if (pm !== 'fixed' && catalog == null) return;
          var adjusted = computeAllProductsAdjustedPrice(catalog, cfg);
          if (adjusted == null) return;
          var roundToVal = parseRoundTo(cfg.roundTo);
          if (roundToVal > 0) {
            adjusted = Math.round(adjusted / roundToVal) * roundToVal;
            adjusted = Math.max(0, Math.round(adjusted * 100) / 100);
          }
          var display = formatShopPrice(adjusted);
          if (!display) return;
          paintPriceNode(
            el,
            display,
            testId,
            variantIdForCart,
            scope === 'cart' ? 'cart_global_fallback' : 'listing_global_fallback',
            adjusted
          );
        });
      } catch (e) {}
    });
  }

  /** Themes hydrate cards/cart after first paint — schedule a few passes without stacking duplicate deltas. */
  function schedulePaintAllProductsGlobalPrices(testId, variant, scope) {
    recordRipxPaintScheduleEvent('requested');
    if (scope === 'cart' && shouldDisableCartUiPricePaint()) {
      recordRipxPaintScheduleEvent('skippedCartDisabled');
      return;
    }
    var variantKey = variant && (variant.variantId != null ? variant.variantId : variant.id);
    var scheduleKey =
      String(scope || '') + '::' + String(testId || '') + '::' + String(variantKey || '');
    var now = Date.now();
    var lastScheduledAt = Number(_ripxGlobalPaintScheduleAtByKey[scheduleKey] || 0);
    if (now - lastScheduledAt < 120) {
      recordRipxPaintScheduleEvent('deduped');
      return;
    }
    _ripxGlobalPaintScheduleAtByKey[scheduleKey] = now;
    paintAllProductsGlobalPrices(testId, variant, scope);
    var run = function () {
      paintAllProductsGlobalPrices(testId, variant, scope);
    };
    try {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(run);
      }
    } catch (e1) {}
    setTimeout(run, 0);
    setTimeout(run, 120);
    setTimeout(run, 450);
    setTimeout(run, 1200);
    if (scope === 'cart') {
      setTimeout(run, 2200);
      setTimeout(run, 4000);
    }
  }

  /**
   * Apply price test to product cards on collection/homepage/search (non-PDP).
   * Prefers elements with data-product-id / data-variant-id (Intelligems-style tagging) for reliable targeting.
   * Finds [data-product-id] cards matching test targets and paints variant price.
   */
  function applyPriceTestToProductCards(testId, variant, targetIds) {
    if (!variant || !targetIds || !targetIds.length) return;
    if (!variant.config) {
      injectPreviewCartAttributesWhenConfigMissing(testId, variant);
      return;
    }
    var variantIdForCart = variant.variantId != null ? variant.variantId : variant.id;
    var cartUi =
      '.cart-drawer,.cart-notification,#CartDrawer,#mini-cart,.mini-cart,[data-cart-drawer],.drawer--cart,aside.mini-cart,cart-drawer,.header__cart,.site-header__cart,predictive-search';
    function inCartUi(el) {
      return el.closest && el.closest(cartUi);
    }
    var activeTest = getActiveTestById(testId);
    var excludedTargetIds = getExcludedProductIdsForTest(activeTest);
    var filteredTargetIds = targetIds.filter(function (targetId) {
      if (!targetId) return false;
      var normalized = toNumericProductId(targetId);
      if (!normalized) return false;
      return excludedTargetIds.indexOf(normalized) === -1;
    });
    if (!filteredTargetIds.length) return;
    if (variantIdForCart != null && String(variantIdForCart).trim() !== '') {
      window.__RIPX_PRICE_TEST_CTX__ = { testId: testId, variantId: variantIdForCart };
      injectPriceTestCartAttributes(
        testId,
        variantIdForCart,
        getAssignmentProofFromVariant(variant),
        filteredTargetIds,
        null,
        getConfiguredCheckoutMethodProof(variant.config)
      );
    }
    filteredTargetIds.forEach(function (targetId) {
      if (!targetId) return;
      var pid = toNumericProductId(targetId);
      if (!pid) return;
      var cfg = getEffectivePriceConfig(variant.config, targetId, null);
      var checkoutMethodProof = getConfiguredCheckoutMethodProof(cfg);
      var priceMode = cfg && cfg.priceMode ? String(cfg.priceMode).toLowerCase() : 'fixed';
      if (priceMode === 'control') return;
      var priceNum = null;
      if (priceMode === 'fixed') {
        var raw = cfg.price;
        if (raw === null || raw === undefined || raw === '') return;
        priceNum = parseFloat(raw, 10);
      } else if (priceMode === 'amount' || priceMode === 'percent') {
        priceNum = 0;
      }
      if (priceNum == null || isNaN(priceNum) || !isFinite(priceNum)) return;
      priceNum = Math.max(0, Math.round(priceNum * 100) / 100);
      var roundToVal = parseRoundTo(cfg.roundTo);
      if (roundToVal > 0) {
        priceNum = Math.round(priceNum / roundToVal) * roundToVal;
        priceNum = Math.max(0, Math.round(priceNum * 100) / 100);
      }
      var display = formatShopPrice(priceNum);
      if (!display && priceMode === 'fixed') return;
      var allWithProductId = document.querySelectorAll(
        '[data-product-id], .product-card, .grid-product__content, [data-product], .card--product, product-card, .product-card-wrapper, .product-item, .grid__item .card, .collection-list__product'
      );
      allWithProductId.forEach(function (card) {
        if (!card || inCartUi(card)) return;
        var attr = getProductIdForListingCard(card);
        if (!attr || toNumericProductId(attr) !== pid) return;
        var cardPriceNum = priceNum;
        var cardDisplay = display || formatShopPrice(0);
        if (priceMode === 'amount' || priceMode === 'percent') {
          var priceEl = card.querySelector(
            '.price .money, .price, [data-product-price], .money, .price-item--regular, .price-item__regular, .product-price, [data-price]'
          );
          if (priceEl) {
            var catalog = getStableCatalogPriceForElement(priceEl);
            if (catalog != null) {
              if (priceMode === 'amount' && cfg.priceDelta != null) {
                var delta = parseFloat(cfg.priceDelta, 10);
                if (!isNaN(delta)) cardPriceNum = Math.max(0, catalog + delta);
              } else if (priceMode === 'percent' && cfg.pricePercent != null) {
                var pct = parseFloat(cfg.pricePercent, 10);
                if (!isNaN(pct)) cardPriceNum = Math.max(0, catalog * (1 - pct / 100));
              }
              cardPriceNum = Math.round(cardPriceNum * 100) / 100;
              cardDisplay = formatShopPrice(cardPriceNum);
            }
          }
        }
        rememberRipxTargetUnitForProduct(pid, cardPriceNum);
        var cardVariantId = getRipxVariantIdForCard(card);
        if (cardVariantId) {
          rememberRipxTargetUnitForVariant(cardVariantId, cardPriceNum);
        }
        registerRipxAssignedPrice({
          testId: testId,
          productId: pid,
          variantId: cardVariantId,
          variantIdForCart: variantIdForCart,
          targetUnit: cardPriceNum,
          display: cardDisplay,
        });
        if (checkoutMethodProof && checkoutMethodProof.applicationMethod) {
          rememberRipxPriceMethodForProduct(pid, checkoutMethodProof.applicationMethod);
          if (cardVariantId) {
            rememberRipxPriceMethodForVariant(cardVariantId, checkoutMethodProof.applicationMethod);
          }
        }
        var registrySelectors = [];
        var listingSurfaceKeys = getListingPriceSurfaceKeys();
        appendConfiguredRegistrySelectorsForSurfaces(
          registrySelectors,
          listingSurfaceKeys,
          ['regular', 'compare_at'],
          activeTest
        );
        var priceSurfaceMappingsAuthoritative = hasConfiguredPriceSurfaceMappingsForSurfaces(
          listingSurfaceKeys,
          ['regular', 'compare_at'],
          activeTest
        );
        registrySelectors.forEach(function (sel) {
          try {
            card.querySelectorAll(sel).forEach(function (el) {
              if (!el || inCartUi(el)) return;
              paintPriceNode(
                el,
                cardDisplay,
                testId,
                variantIdForCart,
                'listing_cards',
                cardPriceNum
              );
            });
          } catch (eRegistry) {}
        });
        if (!priceSurfaceMappingsAuthoritative) {
          var priceEls = card.querySelectorAll(
            '.price .money, .price, [data-product-price], .money, .price-item--regular, .price-item__regular, .product-price .money, .price-item, [data-price]'
          );
          priceEls.forEach(function (el) {
            if (!el || inCartUi(el)) return;
            paintPriceNode(
              el,
              cardDisplay,
              testId,
              variantIdForCart,
              'listing_cards',
              cardPriceNum
            );
          });
        } else if (!registrySelectors.length) {
          persistRipxLiveDiagnostics('price_surface_mapping_skip', {
            testId: testId,
            scope: 'listing_cards',
            reason: 'no_configured_card_selector',
            productId: pid,
            surfaces: getListingPriceSurfaceKeys(),
          });
        }
      });
    });
    if (filteredTargetIds.length === 1) {
      var singleCfg = getEffectivePriceConfig(variant.config, filteredTargetIds[0], null);
      var singleProof = getConfiguredCheckoutMethodProof(singleCfg);
      if (singleProof) {
        injectPriceTestCartAttributes(
          testId,
          variantIdForCart,
          getAssignmentProofFromVariant(variant),
          filteredTargetIds,
          null,
          singleProof
        );
      }
    }
    applyMappedPriceSelectorsByInferredProduct(testId, variant, filteredTargetIds, 'product_cards');
    applyRipxStateToCartForms(filteredTargetIds);
  }

  function findProductCardRootForPriceNode(node) {
    if (!node || !node.closest) return null;
    return (
      node.closest(
        '[data-product-id], [data-product], .product-card-wrapper, .product-card, product-card, .card-wrapper, .grid__item, .product-item, .collection-list__product, li'
      ) || node.parentElement
    );
  }

  function applyMappedPriceSelectorsByInferredProduct(testId, variant, targetIds, reason) {
    if (!variant || !variant.config || !isProductListingSurface()) return;
    var ids = (targetIds || []).filter(Boolean);
    if (!ids.length) return;
    var activeTest = getActiveTestById(testId);
    var selectors = [];
    appendConfiguredRegistrySelectorsForSurfaces(
      selectors,
      getListingPriceSurfaceKeys(),
      ['regular'],
      activeTest
    );
    if (!selectors.length) return;
    var variantIdForCart = variant.variantId != null ? variant.variantId : variant.id;
    var inspected = 0;
    var matched = 0;
    var painted = 0;
    selectors.forEach(function (selector) {
      var nodes = [];
      try {
        nodes = Array.prototype.slice.call(document.querySelectorAll(selector));
      } catch (eSelector) {
        return;
      }
      inspected += nodes.length;
      nodes.forEach(function (node) {
        var root = findProductCardRootForPriceNode(node);
        var attr = getProductIdForListingCard(root) || getProductIdForListingCard(node);
        if (!attr) return;
        var targetId = null;
        for (var i = 0; i < ids.length; i += 1) {
          if (gidMatches(ids[i], attr) || toNumericProductId(ids[i]) === toNumericProductId(attr)) {
            targetId = ids[i];
            break;
          }
        }
        if (!targetId) return;
        matched += 1;
        var cfg = getEffectivePriceConfig(variant.config, targetId, null);
        var checkoutMethodProof = getConfiguredCheckoutMethodProof(cfg);
        var priceMode = cfg && cfg.priceMode ? String(cfg.priceMode).toLowerCase() : 'fixed';
        if (priceMode === 'control') return;
        var priceNum = null;
        if (priceMode === 'fixed') {
          var raw = cfg.price;
          if (raw === null || raw === undefined || raw === '') return;
          priceNum = parseFloat(raw, 10);
        } else if (priceMode === 'amount' || priceMode === 'percent') {
          var catalog = getStableCatalogPriceForElement(node);
          if (catalog == null) return;
          if (priceMode === 'amount' && cfg.priceDelta != null) {
            var delta = parseFloat(cfg.priceDelta, 10);
            if (isNaN(delta)) return;
            priceNum = catalog + delta;
          } else if (priceMode === 'percent' && cfg.pricePercent != null) {
            var pct = parseFloat(cfg.pricePercent, 10);
            if (isNaN(pct)) return;
            priceNum = catalog * (1 - pct / 100);
          }
        }
        if (priceNum == null || isNaN(priceNum) || !isFinite(priceNum)) return;
        priceNum = Math.max(0, Math.round(priceNum * 100) / 100);
        var roundToVal = parseRoundTo(cfg.roundTo);
        if (roundToVal > 0) {
          priceNum = Math.round(priceNum / roundToVal) * roundToVal;
          priceNum = Math.max(0, Math.round(priceNum * 100) / 100);
        }
        var display = formatShopPrice(priceNum);
        if (!display) return;
        var pid = toNumericProductId(targetId);
        if (pid) rememberRipxTargetUnitForProduct(pid, priceNum);
        if (checkoutMethodProof && checkoutMethodProof.applicationMethod && pid) {
          rememberRipxPriceMethodForProduct(pid, checkoutMethodProof.applicationMethod);
        }
        paintPriceNode(
          node,
          display,
          testId,
          variantIdForCart,
          'selector_inferred_listing',
          priceNum
        );
        painted += 1;
      });
    });
    if (inspected || matched || painted) {
      persistRipxLiveDiagnostics('selector_inferred_listing', {
        testId: testId,
        reason: reason || null,
        selectors: selectors,
        inspected: inspected,
        matched: matched,
        painted: painted,
      });
    }
  }

  /**
   * Collection-targeted price test on a matching collection (or listing) page: paint every visible product card.
   * Uses each card's product id for getEffectivePriceConfig (byProduct / variant picker).
   */
  function applyPriceTestToCollectionListingCards(testId, variant) {
    if (!variant) return;
    if (!variant.config) {
      injectPreviewCartAttributesWhenConfigMissing(testId, variant);
      return;
    }
    var variantIdForCart = variant.variantId != null ? variant.variantId : variant.id;
    if (variantIdForCart != null && String(variantIdForCart).trim() !== '') {
      window.__RIPX_PRICE_TEST_CTX__ = { testId: testId, variantId: variantIdForCart };
      injectPriceTestCartAttributes(
        testId,
        variantIdForCart,
        getAssignmentProofFromVariant(variant),
        null,
        null,
        getConfiguredCheckoutMethodProof(variant.config)
      );
    }
    var cartUi =
      '.cart-drawer,.cart-notification,#CartDrawer,#mini-cart,.mini-cart,[data-cart-drawer],.drawer--cart,aside.mini-cart,cart-drawer,.header__cart,.site-header__cart,predictive-search';
    function inCartUi(el) {
      return el.closest && el.closest(cartUi);
    }
    var allWithProductId = document.querySelectorAll(
      '[data-product-id], .product-card, .grid-product__content, [data-product], .card--product, product-card, .product-card-wrapper, .product-item, .grid__item .card, .collection-list__product'
    );
    var activeTest = getActiveTestById(testId);
    var collectionListingSurfaces = getListingPriceSurfaceKeys();
    var priceSurfaceMappingsAuthoritative = hasConfiguredPriceSurfaceMappingsForSurfaces(
      collectionListingSurfaces,
      ['regular', 'compare_at'],
      activeTest
    );
    var excludedProductIds = getExcludedProductIdsForTest(activeTest);
    allWithProductId.forEach(function (card) {
      if (!card || inCartUi(card)) return;
      var attr = getProductIdForListingCard(card);
      if (!attr) return;
      var pid = toNumericProductId(attr);
      if (!pid) return;
      if (excludedProductIds.indexOf(pid) !== -1) return;
      var targetId = toProductGid(attr) || attr;
      var cfg = getEffectivePriceConfig(variant.config, targetId, null);
      var checkoutMethodProof = getConfiguredCheckoutMethodProof(cfg);
      var priceMode = cfg && cfg.priceMode ? String(cfg.priceMode).toLowerCase() : 'fixed';
      if (priceMode === 'control') return;
      var priceNum = null;
      if (priceMode === 'fixed') {
        var raw = cfg.price;
        if (raw === null || raw === undefined || raw === '') return;
        priceNum = parseFloat(raw, 10);
      } else if (priceMode === 'amount' || priceMode === 'percent') {
        priceNum = 0;
      }
      if (priceNum == null || isNaN(priceNum) || !isFinite(priceNum)) return;
      priceNum = Math.max(0, Math.round(priceNum * 100) / 100);
      var roundToVal = parseRoundTo(cfg.roundTo);
      if (roundToVal > 0) {
        priceNum = Math.round(priceNum / roundToVal) * roundToVal;
        priceNum = Math.max(0, Math.round(priceNum * 100) / 100);
      }
      var display = formatShopPrice(priceNum);
      if (!display && priceMode === 'fixed') return;
      var cardPriceNum = priceNum;
      var cardDisplay = display || formatShopPrice(0);
      if (priceMode === 'amount' || priceMode === 'percent') {
        var priceEl = card.querySelector(
          '.price .money, .price, [data-product-price], .money, .price-item--regular, .price-item__regular, .product-price, [data-price]'
        );
        if (priceEl) {
          var catalog = getStableCatalogPriceForElement(priceEl);
          if (catalog != null) {
            if (priceMode === 'amount' && cfg.priceDelta != null) {
              var delta = parseFloat(cfg.priceDelta, 10);
              if (!isNaN(delta)) cardPriceNum = Math.max(0, catalog + delta);
            } else if (priceMode === 'percent' && cfg.pricePercent != null) {
              var pct = parseFloat(cfg.pricePercent, 10);
              if (!isNaN(pct)) cardPriceNum = Math.max(0, catalog * (1 - pct / 100));
            }
            cardPriceNum = Math.round(cardPriceNum * 100) / 100;
            cardDisplay = formatShopPrice(cardPriceNum);
          }
        }
      }
      rememberRipxTargetUnitForProduct(pid, cardPriceNum);
      var cardVariantId = getRipxVariantIdForCard(card);
      if (cardVariantId) {
        rememberRipxTargetUnitForVariant(cardVariantId, cardPriceNum);
      }
      registerRipxAssignedPrice({
        testId: testId,
        productId: pid,
        variantId: cardVariantId,
        variantIdForCart: variantIdForCart,
        targetUnit: cardPriceNum,
        display: cardDisplay,
      });
      if (checkoutMethodProof && checkoutMethodProof.applicationMethod) {
        rememberRipxPriceMethodForProduct(pid, checkoutMethodProof.applicationMethod);
        if (cardVariantId) {
          rememberRipxPriceMethodForVariant(cardVariantId, checkoutMethodProof.applicationMethod);
        }
      }
      var registrySelectors = [];
      appendConfiguredRegistrySelectorsForSurfaces(
        registrySelectors,
        getListingPriceSurfaceKeys(),
        ['regular', 'compare_at'],
        activeTest
      );
      registrySelectors.forEach(function (sel) {
        try {
          card.querySelectorAll(sel).forEach(function (el) {
            if (!el || inCartUi(el)) return;
            paintPriceNode(
              el,
              cardDisplay,
              testId,
              variantIdForCart,
              'collection_cards',
              cardPriceNum
            );
          });
        } catch (eRegistryCollection) {}
      });
      if (!priceSurfaceMappingsAuthoritative) {
        var priceEls = card.querySelectorAll(
          '.price .money, .price, [data-product-price], .money, .price-item--regular, .price-item__regular, .product-price .money, .price-item, [data-price]'
        );
        priceEls.forEach(function (el) {
          if (!el || inCartUi(el)) return;
          paintPriceNode(
            el,
            cardDisplay,
            testId,
            variantIdForCart,
            'collection_cards',
            cardPriceNum
          );
        });
      } else if (!registrySelectors.length) {
        persistRipxLiveDiagnostics('price_surface_mapping_skip', {
          testId: testId,
          scope: 'collection_cards',
          reason: 'no_configured_card_selector',
          productId: pid,
          surfaces: getListingPriceSurfaceKeys(),
        });
      }
    });
    applyRipxStateToCartForms(null);

    // If the theme lacks data-product-id entirely, try a safe all-products fallback.
    // Fixed all-products tests can paint every configured price selector to the same target price.
    // Amount/percent tests compute from each visible catalog number.
    // Skip global fallback when excluded products are configured, because fallback cannot filter rows safely.
    if (!excludedProductIds.length) {
      schedulePaintAllProductsGlobalPrices(testId, variant, 'listing');
    }
  }

  function getByProductMatrixProductIds(config) {
    var byProduct = config && config.byProduct;
    if (!byProduct || typeof byProduct !== 'object') return [];
    return Object.keys(byProduct).filter(Boolean);
  }

  function productInByProductMatrix(config, productId) {
    var keys = getByProductMatrixProductIds(config);
    if (!keys.length) return null;
    if (!productId) return false;
    return keys.some(function (id) {
      return id && gidMatches(id, productId);
    });
  }

  var _ripxMatrixMismatchNoticeShown = false;
  function showPreviewMatrixMismatchNotice(detail) {
    if (!PREVIEW_MODE || typeof document === 'undefined' || !document.body) return;
    // Once only — appending/updating the banner must not re-enter paint via MutationObserver.
    if (_ripxMatrixMismatchNoticeShown || document.getElementById('ripx-preview-matrix-mismatch')) {
      return;
    }
    _ripxMatrixMismatchNoticeShown = true;
    var matrix = (detail && detail.matrixProductIds) || [];
    var msg =
      'RipX preview: this page is not in the selected arm’s price matrix. ' +
      'Open Preview from the product row that owns this price in RipX (matrix product: ' +
      (matrix[0] || 'unknown') +
      ').';
    var el = document.createElement('div');
    el.id = 'ripx-preview-matrix-mismatch';
    el.setAttribute('role', 'status');
    el.setAttribute('data-ripx-ignore', '1');
    el.textContent = msg;
    el.style.cssText =
      'position:fixed;z-index:2147483646;left:12px;right:12px;bottom:12px;padding:10px 12px;' +
      'background:#0f172a;color:#f8fafc;font:600 12px/1.4 system-ui,sans-serif;' +
      'border-radius:10px;box-shadow:0 10px 30px rgba(15,23,42,.35);';
    try {
      document.body.appendChild(el);
    } catch (_eBanner) {}
    ripxTrace('S7', 'preview matrix mismatch banner', detail || {}, 'warn');
  }

  function alignPreviewTestTargetsToMatrix(test, variant, curProductId) {
    if (!test || !variant || !variant.config) return false;
    var keys = getByProductMatrixProductIds(variant.config);
    if (!keys.length) return false;
    var inMatrix = productInByProductMatrix(variant.config, curProductId) === true;
    if (inMatrix && curProductId) {
      test.targetIds = [curProductId];
      test.targetId = curProductId;
      test.previewSynthetic = false;
      rememberPreviewFocusProductId(curProductId);
      return true;
    }
    // Product id often arrives after bootstrap mount (ShopifyAnalytics). Do not treat
    // "not ready yet" as a matrix miss — that falsely banners + rewrites targetIds to all keys.
    if (!curProductId) {
      return false;
    }
    test.targetIds = keys.slice();
    test.targetId = keys[0] || null;
    test.previewSynthetic = false;
    showPreviewMatrixMismatchNotice({
      testId: test.id,
      currentProductId: curProductId || null,
      matrixProductIds: keys,
    });
    return false;
  }

  function applyPriceTestOnAssignedVariant(test, variant) {
    if (!test || !variant) return;
    if (!testTypeIsPrice(test)) return;
    if (!variant.config) {
      injectPreviewCartAttributesWhenConfigMissing(test.id, variant);
      return;
    }
    var tt = getNormalizedTargetType(test);
    var productScope = isProductScopeTargetType(tt);
    var curProductId = getCurrentProductId();
    var matrixKeys = getByProductMatrixProductIds(variant.config);
    if (PREVIEW_MODE && matrixKeys.length && productScope) {
      var alignedOk = alignPreviewTestTargetsToMatrix(test, variant, curProductId);
      if (!alignedOk && curProductId && isPdpProductPath()) {
        ripxTrace(
          'S6',
          'skip PDP paint — product not in byProduct matrix',
          {
            testId: test.id,
            productId: curProductId,
            matrixProductIds: matrixKeys,
          },
          'warn'
        );
        return;
      }
    }
    var matched = matchesTarget(test);
    if (!matched && PREVIEW_TEST_CONTEXT && productScope) {
      // Listings/cart: allow pipeline so target cards can paint. PDPs must still match
      // target_ids — otherwise one preview arm price paints every product on the site.
      if (tt === 'all-products' || tt === 'all_products') {
        matched = true;
      } else if (isProductListingSurface() || isCartSurface()) {
        matched = true;
      }
    }
    var tids =
      test.targetIds || (test.targetId || test.target_id ? [test.targetId || test.target_id] : []);
    if (
      curProductId &&
      PREVIEW_MODE &&
      PREVIEW_TEST_ID &&
      String(test.id) === String(PREVIEW_TEST_ID)
    ) {
      rememberPreviewFocusProductId(curProductId);
    }
    var pdpProductMatch =
      productScope &&
      matched &&
      curProductId &&
      (tt === 'all-products' ||
        tt === 'all_products' ||
        !tids.length ||
        tids.some(function (id) {
          return id && gidMatches(id, curProductId);
        }));
    if (
      pdpProductMatch &&
      matrixKeys.length &&
      productInByProductMatrix(variant.config, curProductId) === false
    ) {
      pdpProductMatch = false;
    }
    var pdpCollectionMatch =
      tt === 'collection' &&
      curProductId &&
      tids.length &&
      productBelongsToPriceTestCollections(tids);
    ripxTrace('S6', 'price assign decision', {
      testId: test.id,
      matched: !!matched,
      pdpProductMatch: !!pdpProductMatch,
      pdpCollectionMatch: !!pdpCollectionMatch,
      curProductId: curProductId || null,
      targetType: tt,
      targetIds: tids,
      matrixProductIds: matrixKeys,
      previewSynthetic: !!test.previewSynthetic,
    });
    if ((pdpProductMatch || pdpCollectionMatch) && !isExcludedProductForTest(test, curProductId)) {
      applyPriceTest(test.id, curProductId, test.targetVariantId || null, variant);
    } else if (productScope && curProductId && PREVIEW_MODE) {
      ripxTrace(
        'S6',
        'PDP paint not applied',
        {
          testId: test.id,
          matched: !!matched,
          tidsLength: tids.length,
          curProductId: curProductId,
          matrixProductIds: matrixKeys,
        },
        'warn'
      );
    }
    if (!(tids.length || tt === 'all-products' || tt === 'all_products')) return;
    if (tt === 'product' && isProductListingSurface()) {
      applyPriceTestToProductCards(test.id, variant, tids);
    } else if ((tt === 'all-products' || tt === 'all_products') && isProductListingSurface()) {
      applyPriceTestToCollectionListingCards(test.id, variant);
    } else if (tt === 'collection' && matched && isProductListingSurface()) {
      applyPriceTestToCollectionListingCards(test.id, variant);
    }
    if (tt === 'product') {
      applyPriceTestToCart(test.id, variant, tids);
    } else if (tt === 'all-products' || tt === 'all_products') {
      var cartTids = getCartVisibleProductTargetIds();
      if (cartTids.length) {
        applyPriceTestToCart(test.id, variant, cartTids);
      } else if (shouldRunAllProductsCartFallback()) {
        if (hasByProductOverrides(variant.config)) {
          applyPriceTestToCartAllProductsByCartState(test.id, variant);
        } else {
          applyPriceTestToCartAllProductsFallback(test.id, variant);
        }
      }
    }
    auditRipxPaintParityStampedNodes();
  }

  /**
   * Apply price test to cart line items (drawer, cart page). Display only; checkout uses catalog unless Discount Function.
   * Matches rows by data-product-id (and product id in selector) or by data-variant-id when present (best effort for themes without product id on line).
   */
  function applyPriceTestToCart(testId, variant, targetIds) {
    if (!variant || !targetIds || !targetIds.length) return;
    if (!variant.config) {
      injectPreviewCartAttributesWhenConfigMissing(testId, variant);
      return;
    }
    var variantIdForCart = variant.variantId != null ? variant.variantId : variant.id;
    var activeTest = getActiveTestById(testId);
    var excludedProductIds = getExcludedProductIdsForTest(activeTest);
    var filteredTargetIds = targetIds.filter(function (targetId) {
      if (!targetId) return false;
      var normalized = toNumericProductId(targetId);
      if (!normalized) return false;
      return excludedProductIds.indexOf(normalized) === -1;
    });
    if (!filteredTargetIds.length) return;
    if (variantIdForCart != null && String(variantIdForCart).trim() !== '') {
      window.__RIPX_PRICE_TEST_CTX__ = { testId: testId, variantId: variantIdForCart };
      var proofTargetId = filteredTargetIds[0] || null;
      var proofCfg = proofTargetId
        ? getEffectivePriceConfig(variant.config, proofTargetId, null)
        : variant.config;
      injectPriceTestCartAttributes(
        testId,
        variantIdForCart,
        getAssignmentProofFromVariant(variant),
        filteredTargetIds,
        null,
        getConfiguredCheckoutMethodProof(proofCfg)
      );
    }
    if (shouldDisableCartUiPricePaint()) return;
    if (shouldPreferNativeCartRendering() || shouldBlockCartFallbackPaint()) return;
    var cartContainers =
      '.cart-drawer, #CartDrawer, .drawer--cart, [data-cart-drawer], #cart-form, form[action*="/cart"], .cart-items, main .cart';
    var containers = document.querySelectorAll(cartContainers);
    if (!containers.length) return;
    var cartPriceSelectors =
      '.price .money, .price, .line-item__price, [data-line-item-price], .cart-item__price .money, .cart-item__price, .line-item-price, [data-price], .money';
    var registryCartSelectors = [];
    appendConfiguredRegistrySelectors(registryCartSelectors, 'cart', 'cart_line', activeTest);
    appendConfiguredRegistrySelectors(registryCartSelectors, 'cart', 'regular', activeTest);
    function paintCartRow(row, rowDisplay, rowTargetUnit, skipIfPainted) {
      registryCartSelectors.forEach(function (sel) {
        try {
          row.querySelectorAll(sel).forEach(function (el) {
            paintPriceNode(el, rowDisplay, testId, variantIdForCart, 'cart', rowTargetUnit);
          });
        } catch (_eRegistryCart) {}
      });
      var priceEls = row.querySelectorAll(cartPriceSelectors);
      if (skipIfPainted && priceEls.length) {
        var first = priceEls[0];
        if (
          first &&
          first.getAttribute('data-ripx-price') === '1' &&
          first.textContent === rowDisplay
        )
          return;
      }
      priceEls.forEach(function (el) {
        paintPriceNode(el, rowDisplay, testId, variantIdForCart, 'cart', rowTargetUnit);
      });
    }
    filteredTargetIds.forEach(function (targetId) {
      if (!targetId) return;
      var pid = toNumericProductId(targetId);
      if (!pid) return;
      var cfg = getEffectivePriceConfig(variant.config, targetId, null);
      var checkoutMethodProof = getConfiguredCheckoutMethodProof(cfg);
      var priceMode = cfg && cfg.priceMode ? String(cfg.priceMode).toLowerCase() : 'fixed';
      if (priceMode === 'control') return;
      var priceNum = null;
      if (priceMode === 'fixed') {
        var raw = cfg.price;
        if (raw === null || raw === undefined || raw === '') return;
        priceNum = parseFloat(raw, 10);
      } else if (priceMode === 'amount' || priceMode === 'percent') {
        priceNum = 0;
      }
      if (priceNum == null || isNaN(priceNum) || !isFinite(priceNum)) return;
      priceNum = Math.max(0, Math.round(priceNum * 100) / 100);
      var display = formatShopPrice(priceNum);
      if (!display && priceMode === 'fixed') return;
      if (checkoutMethodProof && checkoutMethodProof.applicationMethod) {
        rememberRipxPriceMethodForProduct(pid, checkoutMethodProof.applicationMethod);
      }
      containers.forEach(function (container) {
        var rows = querySelectorAllWithShadowRoots(
          container,
          '[data-product-id="' +
            pid +
            '"], [data-product-id*="' +
            pid +
            '"], [data-line-item-key], .cart-item, [data-cart-item]'
        );
        rows.forEach(function (row) {
          var linePid =
            row.getAttribute('data-product-id') ||
            (row.querySelector('[data-product-id]') &&
              row.querySelector('[data-product-id]').getAttribute('data-product-id'));
          if (!linePid || toNumericProductId(linePid) !== pid) return;
          var rowDisplay = display || formatShopPrice(0);
          var rowTargetUnit = priceNum;
          var priceEls = row.querySelectorAll(cartPriceSelectors);
          if (priceMode !== 'fixed' && priceEls.length) {
            var catalog = parsePriceFromDisplay(priceEls[0]);
            if (catalog != null && cfg) {
              var rowPrice = priceNum;
              if (priceMode === 'amount' && cfg.priceDelta != null) {
                var delta = parseFloat(cfg.priceDelta, 10);
                if (!isNaN(delta)) rowPrice = Math.max(0, catalog + delta);
              } else if (priceMode === 'percent' && cfg.pricePercent != null) {
                var pct = parseFloat(cfg.pricePercent, 10);
                if (!isNaN(pct)) rowPrice = Math.max(0, catalog * (1 - pct / 100));
              }
              rowTargetUnit = Math.round(rowPrice * 100) / 100;
              rowDisplay = formatShopPrice(rowTargetUnit);
            }
          }
          var lineVariantId =
            row.getAttribute('data-variant-id') ||
            (row.querySelector('[data-variant-id]') &&
              row.querySelector('[data-variant-id]').getAttribute('data-variant-id'));
          registerRipxAssignedPrice({
            testId: testId,
            productId: pid,
            variantId: lineVariantId,
            variantIdForCart: variantIdForCart,
            targetUnit: rowTargetUnit,
            display: rowDisplay,
          });
          paintCartRow(row, rowDisplay, rowTargetUnit, false);
        });
      });
    });
    if (variantIdForCart != null && String(variantIdForCart).trim() !== '') {
      var firstTargetId = filteredTargetIds[0];
      if (firstTargetId) {
        var cfg = getEffectivePriceConfig(variant.config, firstTargetId, null);
        var priceMode = cfg && cfg.priceMode ? String(cfg.priceMode).toLowerCase() : 'fixed';
        if (priceMode !== 'control') {
          var priceNum = null;
          if (priceMode === 'fixed' && cfg.price != null) {
            priceNum = parseFloat(cfg.price, 10);
          } else if (priceMode === 'amount' || priceMode === 'percent') {
            priceNum = 0;
          }
          if (priceNum != null && !isNaN(priceNum) && isFinite(priceNum)) {
            priceNum = Math.max(0, Math.round(priceNum * 100) / 100);
            var displayByVariant = formatShopPrice(priceNum);
            var escapedVid =
              typeof CSS !== 'undefined' && CSS.escape
                ? CSS.escape(String(variantIdForCart))
                : String(variantIdForCart).replace(/"|\\/g, '\\$&');
            containers.forEach(function (container) {
              var variantRows = querySelectorAllWithShadowRoots(
                container,
                '[data-variant-id="' + escapedVid + '"]'
              );
              variantRows.forEach(function (row) {
                var linePid =
                  row.getAttribute('data-product-id') ||
                  (row.querySelector('[data-product-id]') &&
                    row.querySelector('[data-product-id]').getAttribute('data-product-id'));
                var linePidNum = linePid ? toNumericProductId(linePid) : '';
                if (
                  linePidNum &&
                  (excludedProductIds.indexOf(linePidNum) !== -1 ||
                    !filteredTargetIds.some(function (id) {
                      return id && toNumericProductId(id) === linePidNum;
                    }))
                )
                  return;
                var rowDisplay = displayByVariant;
                var rowTargetUnit = priceNum;
                if (priceMode === 'amount' || priceMode === 'percent') {
                  var priceEls = row.querySelectorAll(cartPriceSelectors);
                  if (priceEls.length) {
                    var catalog = parsePriceFromDisplay(priceEls[0]);
                    if (catalog != null && cfg) {
                      var rowPrice = catalog;
                      if (priceMode === 'amount' && cfg.priceDelta != null) {
                        var d = parseFloat(cfg.priceDelta, 10);
                        if (!isNaN(d)) rowPrice = Math.max(0, catalog + d);
                      } else if (priceMode === 'percent' && cfg.pricePercent != null) {
                        var p = parseFloat(cfg.pricePercent, 10);
                        if (!isNaN(p)) rowPrice = Math.max(0, catalog * (1 - p / 100));
                      }
                      rowTargetUnit = Math.round(rowPrice * 100) / 100;
                      rowDisplay = formatShopPrice(rowTargetUnit);
                    }
                  }
                }
                registerRipxAssignedPrice({
                  testId: testId,
                  productId: linePidNum || linePid,
                  variantId: variantIdForCart,
                  variantIdForCart: variantIdForCart,
                  targetUnit: rowTargetUnit,
                  display: rowDisplay,
                });
                paintCartRow(row, rowDisplay, rowTargetUnit, true);
              });
            });
          }
        }
      }
    }
  }

  function applyPriceTestToCartAllProductsFallback(testId, variant) {
    if (!variant) return;
    if (!variant.config) {
      injectPreviewCartAttributesWhenConfigMissing(testId, variant);
      return;
    }
    // Ensure line props exist for checkout, even if we can't match rows by product id.
    var variantIdForCart = variant.variantId != null ? variant.variantId : variant.id;
    if (variantIdForCart != null && String(variantIdForCart).trim() !== '') {
      window.__RIPX_PRICE_TEST_CTX__ = { testId: testId, variantId: variantIdForCart };
      var fallbackProof = getConfiguredCheckoutMethodProof(variant.config);
      injectPriceTestCartAttributes(
        testId,
        variantIdForCart,
        getAssignmentProofFromVariant(variant),
        null,
        null,
        fallbackProof
      );
    }
    var activeTest = getActiveTestById(testId);
    var excludedProductIds = getExcludedProductIdsForTest(activeTest);
    if (excludedProductIds.length) {
      return;
    }
    if (shouldDisableCartUiPricePaint()) return;
    if (shouldPreferNativeCartRendering() || shouldBlockCartFallbackPaint()) return;
    schedulePaintAllProductsGlobalPrices(testId, variant, 'cart');
  }

  function hasByProductOverrides(config) {
    return !!(
      config &&
      config.byProduct &&
      typeof config.byProduct === 'object' &&
      Object.keys(config.byProduct).length > 0
    );
  }

  var _ripxAllProductsCartResolveInFlight = {};
  function applyPriceTestToCartAllProductsByCartState(testId, variant) {
    if (!variant || !variant.config || !_ripxNativeFetch) return;
    var key =
      String(testId || '') +
      '::' +
      String((variant && (variant.variantId != null ? variant.variantId : variant.id)) || '');
    if (_ripxAllProductsCartResolveInFlight[key]) return;
    _ripxAllProductsCartResolveInFlight[key] = true;
    _ripxNativeFetch('/cart.js', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    })
      .then(function (response) {
        if (!response || !response.ok) return null;
        return response.json().catch(function () {
          return null;
        });
      })
      .then(function (cartState) {
        if (!cartState || !Array.isArray(cartState.items) || !cartState.items.length) return;
        var seen = {};
        var targetIds = [];
        cartState.items.forEach(function (item) {
          var pid = toNumericProductId(item && item.product_id);
          if (!pid || seen[pid]) return;
          seen[pid] = true;
          targetIds.push('gid://shopify/Product/' + pid);
        });
        if (!targetIds.length) return;
        applyPriceTestToCart(testId, variant, targetIds);
      })
      .catch(function () {})
      .finally(function () {
        delete _ripxAllProductsCartResolveInFlight[key];
      });
  }

  var _ripxThemeClassByTest = {};
  function sanitizeThemeToken(value, fallback) {
    var base =
      value === undefined || value === null
        ? String(fallback || '')
        : String(value || '').trim() || String(fallback || '');
    var token = base
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return token || String(fallback || 'variant');
  }

  function applyThemeVariant(test, variant, options) {
    _ripxThemeStats.counters.attempts += 1;
    _ripxThemeStats.lastEventAt = Date.now();
    if (!test || !variant) {
      recordThemeFallback('missing_payload');
      return { ok: false, reason: 'missing_payload' };
    }
    if (!variant.config) {
      recordThemeFallback('missing_config');
      return { ok: false, reason: 'missing_config' };
    }
    var opts = options && typeof options === 'object' ? options : {};
    if (opts.retried) {
      _ripxThemeStats.counters.retried += 1;
    }
    var cfg = variant.config && typeof variant.config === 'object' ? variant.config : {};
    var templateKey = getTemplateKeyForTest(test);
    var fallbackMode = templateKey === 'template' ? 'template_switch' : 'asset_flag';
    var mode = normalizeThemeMode(cfg.themeMode || cfg.theme_mode, fallbackMode);
    var templateHandle = String(
      cfg.themeTemplateHandle || cfg.theme_template_handle || cfg.template || ''
    ).trim();
    var sectionId = String(cfg.sectionId || cfg.section_id || '').trim();
    var themeId = String(cfg.themeId || cfg.theme_id || '').trim();
    var bodyClass = String(cfg.bodyClass || cfg.body_class || '').trim();
    var testId = String(test.id || '').trim();
    var variantId = String(variant.variantId != null ? variant.variantId : variant.id || '').trim();
    var variantName = String(variant.variantName || variant.name || variantId || 'variant').trim();
    var variantToken = sanitizeThemeToken(variantName || variantId, 'variant');
    var classToken = 'ripx-theme-variant-' + variantToken;
    var root = document.documentElement;
    var body = document.body;

    if (root) {
      if (testId) root.setAttribute('data-ripx-theme-test', testId);
      if (variantId) root.setAttribute('data-ripx-theme-variant', variantId);
      root.setAttribute('data-ripx-theme-mode', mode);
      if (templateHandle) root.setAttribute('data-ripx-theme-template', templateHandle);
      else root.removeAttribute('data-ripx-theme-template');
      if (sectionId) root.setAttribute('data-ripx-theme-section', sectionId);
      else root.removeAttribute('data-ripx-theme-section');
      if (themeId) root.setAttribute('data-ripx-theme-id', themeId);
      else root.removeAttribute('data-ripx-theme-id');
      if (testId) {
        var perTestAttr = 'data-ripx-theme-test-' + sanitizeThemeToken(testId, 'test');
        root.setAttribute(perTestAttr, variantToken);
      }
    }

    if (body) {
      var prevClass = _ripxThemeClassByTest[testId];
      if (prevClass && prevClass !== classToken) {
        try {
          body.classList.remove(prevClass);
        } catch (ePrev) {}
      }
      try {
        body.classList.add(classToken);
      } catch (eClass) {}
      _ripxThemeClassByTest[testId] = classToken;

      if (bodyClass) {
        var prevBodyClassKey = testId + ':custom';
        var prevBodyClass = _ripxThemeClassByTest[prevBodyClassKey];
        if (prevBodyClass && prevBodyClass !== bodyClass) {
          try {
            body.classList.remove(prevBodyClass);
          } catch (ePrevBody) {}
        }
        try {
          body.classList.add(bodyClass);
        } catch (eBodyClass) {}
        _ripxThemeClassByTest[prevBodyClassKey] = bodyClass;
      }
    } else {
      recordThemeFallback('missing_body');
      return { ok: false, reason: 'missing_body' };
    }

    var detail = {
      testId: testId || null,
      variantId: variantId || null,
      variantName: variantName || null,
      mode: mode,
      template: templateHandle || null,
      sectionId: sectionId || null,
      themeId: themeId || null,
      bodyClass: bodyClass || null,
      waitedMs: Number(opts.waitedMs) || 0,
      retried: Boolean(opts.retried),
    };
    try {
      window.__RIPX_THEME_VARIANTS__ = window.__RIPX_THEME_VARIANTS__ || {};
      if (testId) window.__RIPX_THEME_VARIANTS__[testId] = detail;
    } catch (eStore) {}
    try {
      window.dispatchEvent(new CustomEvent('ripx:theme-variant', { detail: detail }));
      document.dispatchEvent(new CustomEvent('ripx:theme-variant', { detail: detail }));
    } catch (eDispatch) {}
    _ripxThemeStats.counters.applied += 1;
    _ripxThemeStats.lastDetail = detail;
    _ripxThemeStats.lastEventAt = Date.now();
    if (DEBUG) debugLog('Theme variant applied', detail);
    return { ok: true, detail: detail };
  }

  function applyThemeVariantWithRetry(test, variant) {
    if (document.body) {
      applyThemeVariant(test, variant);
      return;
    }
    var startedAt = Date.now();
    function tick() {
      if (document.body) {
        applyThemeVariant(test, variant, {
          retried: true,
          waitedMs: Date.now() - startedAt,
        });
        return;
      }
      var elapsed = Date.now() - startedAt;
      if (elapsed >= THEME_APPLY_TIMEOUT_MS) {
        _ripxThemeStats.counters.timedOut += 1;
        recordThemeFallback('body_wait_timeout');
        if (DEBUG) {
          debugLog('Theme apply timed out waiting for body', {
            testId: test && test.id ? test.id : null,
            waitedMs: elapsed,
          });
        }
        return;
      }
      setTimeout(tick, THEME_APPLY_RETRY_MS);
    }
    setTimeout(tick, THEME_APPLY_RETRY_MS);
  }

  function parseCombinedCode(code) {
    if (!code) {
      return { css: '', js: '' };
    }
    const cssMatch = code.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
    const jsMatch = code.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    if (!cssMatch && !jsMatch) {
      return { css: '', js: code.trim() };
    }
    return {
      css: cssMatch ? cssMatch[1].trim() : '',
      js: jsMatch ? jsMatch[1].trim() : '',
    };
  }

  function applyCustomCode(testId, variant) {
    const marker = `ab-test-${testId}`;
    const customCss = variant?.config?.customCss;
    const customJs = variant?.config?.customJs;
    const combinedCode = variant?.config?.code || variant?.code;
    const parsed = combinedCode ? parseCombinedCode(combinedCode) : { css: '', js: '' };

    const cssToApply =
      typeof customCss === 'string' && customCss.trim() ? customCss.trim() : parsed.css || '';
    const jsToApply =
      typeof customJs === 'string' && customJs.trim() ? customJs.trim() : parsed.js || '';

    if (!cssToApply && !jsToApply) {
      return;
    }

    if (cssToApply) {
      const existingStyle = document.querySelector(`style[data-ab-test="${marker}"]`);
      if (existingStyle) {
        existingStyle.remove();
      }
      const styleEl = document.createElement('style');
      styleEl.setAttribute('data-ab-test', marker);
      styleEl.textContent = cssToApply;
      document.head.appendChild(styleEl);
    }

    if (jsToApply) {
      const existingScript = document.querySelector(`script[data-ab-test="${marker}"]`);
      if (existingScript) {
        existingScript.remove();
      }
      const scriptEl = document.createElement('script');
      scriptEl.setAttribute('data-ab-test', marker);
      scriptEl.textContent = jsToApply;
      (document.head || document.documentElement || document.body).appendChild(scriptEl);
    }
  }

  /** Position values from visual editor map to insertAdjacentElement. */
  var VISUAL_RULE_POSITION_MAP = {
    after: 'afterend',
    before: 'beforebegin',
    afterbegin: 'afterbegin',
    beforeend: 'beforeend',
  };

  function getVisualRuleMutationType(rule) {
    var raw = rule && typeof rule.mutation_type === 'string' ? rule.mutation_type : '';
    var type = String(raw || 'none')
      .toLowerCase()
      .trim();
    return type || 'none';
  }

  function applyInlineStyleMutations(el, styleText) {
    if (!el || !el.style || typeof styleText !== 'string') return;
    var declarations = styleText
      .split(';')
      .map(function (part) {
        return String(part || '').trim();
      })
      .filter(Boolean);
    declarations.forEach(function (decl) {
      var colonIndex = decl.indexOf(':');
      if (colonIndex <= 0) return;
      var key = decl.slice(0, colonIndex).trim();
      var value = decl.slice(colonIndex + 1).trim();
      if (!key || !value) return;
      try {
        el.style.setProperty(key, value);
      } catch (e) {}
    });
  }

  function applyVisualRuleMutation(el, rule) {
    if (!el || !rule || typeof rule !== 'object') return;
    var type = getVisualRuleMutationType(rule);
    if (type === 'none') return;
    if (type === 'hide') {
      try {
        el.style.setProperty('display', 'none', 'important');
      } catch (e) {}
      return;
    }
    if (type === 'show') {
      try {
        el.style.removeProperty('display');
        el.style.removeProperty('visibility');
      } catch (e) {}
      if (typeof el.removeAttribute === 'function') {
        try {
          el.removeAttribute('hidden');
        } catch (e) {}
      }
      return;
    }
    if (type === 'set_text') {
      var nextText =
        rule.mutation_text === undefined || rule.mutation_text === null
          ? ''
          : String(rule.mutation_text);
      el.textContent = nextText;
      return;
    }
    if (type === 'set_attr') {
      var attrName =
        typeof rule.mutation_attribute === 'string' ? rule.mutation_attribute.trim() : '';
      if (!attrName) return;
      var attrValue =
        rule.mutation_attribute_value === undefined || rule.mutation_attribute_value === null
          ? ''
          : String(rule.mutation_attribute_value);
      try {
        if (attrValue) {
          el.setAttribute(attrName, attrValue);
        } else {
          el.removeAttribute(attrName);
        }
      } catch (e) {}
      return;
    }
    if (type === 'set_style') {
      applyInlineStyleMutations(el, String(rule.mutation_style || ''));
    }
  }

  /**
   * Apply visual editor rules (selector + css/js + position) in preview/visual editor mode.
   * Injects style/script nodes relative to the first element matching each rule's selector.
   */
  function applyVisualEditorRules(testId, variant) {
    var rules = variant?.config?.visual_editor_rules;
    if (!Array.isArray(rules) || rules.length === 0) return;
    var markerPrefix = 'ab-test-ve-' + String(testId || 'preview') + '-';
    document.querySelectorAll('[data-ab-test-ve]').forEach(function (node) {
      var val = node.getAttribute('data-ab-test-ve');
      if (val && val.indexOf(markerPrefix) === 0) node.remove();
    });
    rules.forEach(function (rule, index) {
      if (!rule || typeof rule !== 'object') return;
      var selector = typeof rule.selector === 'string' ? rule.selector.trim() : '';
      if (!selector) return;
      var css = typeof rule.css === 'string' ? rule.css.trim() : '';
      var js = typeof rule.js === 'string' ? rule.js.trim() : '';
      var mutationType = getVisualRuleMutationType(rule);
      if (!css && !js && mutationType === 'none') return;
      var position = VISUAL_RULE_POSITION_MAP[rule.position] || 'afterend';
      var el;
      try {
        el = document.querySelector(selector);
      } catch (e) {
        return;
      }
      if (!el || !el.insertAdjacentElement) return;
      if (mutationType !== 'none') {
        applyVisualRuleMutation(el, rule);
      }
      var marker = markerPrefix + index;
      if (js) {
        var scriptEl = document.createElement('script');
        scriptEl.setAttribute('data-ab-test-ve', marker);
        scriptEl.textContent = js;
        el.insertAdjacentElement(position, scriptEl);
      }
      if (css) {
        var styleEl = document.createElement('style');
        styleEl.setAttribute('data-ab-test-ve', marker);
        styleEl.textContent = css;
        el.insertAdjacentElement(position, styleEl);
      }
    });
  }

  /**
   * Build a short, unique CSS selector for an element (for visual editor picker).
   * Prefers: id, then data-* (e.g. data-product-id, data-variant-id for Shopify), then tag.class, then path.
   * Skips non-element nodes (e.g. document, text nodes) and ensures tagName is safe for selectors.
   */
  function getSelectorForElement(el) {
    if (!el || typeof el.tagName !== 'string') return '';
    if (el.nodeType !== 1) return ''; /* ELEMENT_NODE */
    var tag = el.tagName.toLowerCase();
    if (!tag) return '';

    if (
      el.id &&
      typeof el.id === 'string' &&
      /^[a-zA-Z][\w-]*$/.test(el.id) &&
      !/^\d+$/.test(el.id)
    ) {
      try {
        if (document.querySelector('#' + CSS.escape(el.id)) === el) {
          return '#' + CSS.escape(el.id);
        }
      } catch (e) {}
    }

    var dataAttrs = [
      'data-product-id',
      'data-variant-id',
      'data-section-id',
      'data-block-id',
      'data-id',
    ];
    for (var d = 0; d < dataAttrs.length; d++) {
      var val = el.getAttribute(dataAttrs[d]);
      if (val != null && String(val).trim()) {
        try {
          var escaped = String(val).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          var dataSel = '[' + dataAttrs[d] + '="' + escaped + '"]';
          if (document.querySelector(tag + dataSel) === el) return tag + dataSel;
          if (document.querySelector(dataSel) === el) return dataSel;
        } catch (e) {}
      }
    }
    if (el.attributes) {
      for (var a = 0; a < el.attributes.length; a++) {
        var attr = el.attributes[a];
        if (
          attr.name &&
          attr.name.indexOf('data-') === 0 &&
          attr.value &&
          !/^(data-ember|data-react|data-v-)/i.test(attr.name)
        ) {
          try {
            var escapedA = String(attr.value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            var ds = '[' + attr.name + '="' + escapedA + '"]';
            if (document.querySelector(tag + ds) === el) return tag + ds;
            if (document.querySelector(ds) === el) return ds;
          } catch (e) {}
        }
      }
    }

    var classes =
      el.className && typeof el.className === 'string'
        ? el.className.trim().split(/\s+/).filter(Boolean)
        : [];
    for (var c = 0; c < classes.length; c++) {
      var cls = classes[c];
      if (/^[a-zA-Z_][\w-]*$/.test(cls) && !/^(ng-|ember|react|data-|js-)/i.test(cls)) {
        try {
          var sel = tag + '.' + CSS.escape(cls);
          if (document.querySelector(sel) === el) return sel;
        } catch (e) {}
      }
    }

    var path = [];
    var current = el;
    while (current && current !== document.body) {
      var part = current.tagName.toLowerCase();
      var parent = current.parentElement;
      if (parent) {
        var siblings = parent.children;
        for (var i = 0; i < siblings.length; i++) {
          if (siblings[i] === current) {
            part += ':nth-child(' + (i + 1) + ')';
            break;
          }
        }
      }
      path.unshift(part);
      current = parent;
    }
    return path.length ? path.join(' > ') : tag;
  }

  /**
   * Visual editor element picker: overlay, highlight hovered element, on click send selector to opener or copy.
   * Runs in the embedded editor iframe or a tab opened from the editor with ab_visual_picker=1.
   */
  function postVisualEditorStatus(type, details) {
    var payload = Object.assign(
      {
        type: type,
        source: 'ripx-visual-editor',
        href: String(window.location.href || ''),
        version: SCRIPT_VERSION,
      },
      details || {}
    );
    try {
      if (window.opener && !window.opener.closed) window.opener.postMessage(payload, '*');
    } catch (_eOpenerPost) {}
    try {
      if (IN_IFRAME && window.parent && window.parent !== window)
        window.parent.postMessage(payload, '*');
    } catch (_eParentPost) {}
  }

  function toPreviewDocumentProxyUrl(storeUrl) {
    var apiBase = resolvePreviewDocumentApiUrl();
    if (!apiBase) return '';
    var shopUrl = withVisualPickerQueryParams(storeUrl);
    if (!shopUrl) return '';
    try {
      var doc = new URL(apiBase, window.location.origin);
      doc.searchParams.set('url', shopUrl);
      var launcher =
        CONFIG && CONFIG.previewLauncherParams && typeof CONFIG.previewLauncherParams === 'object'
          ? CONFIG.previewLauncherParams
          : {};
      Object.keys(launcher).forEach(function (key) {
        var value = launcher[key];
        if (value !== null && value !== undefined && String(value).trim() !== '') {
          doc.searchParams.set(key, String(value).trim());
        }
      });
      if (!doc.searchParams.get('parent_origin')) {
        try {
          var parentOrigin = getPreviewParam('parent_origin');
          if (parentOrigin) doc.searchParams.set('parent_origin', parentOrigin);
        } catch (_eParentOrigin) {}
      }
      return doc.toString();
    } catch (_eDoc) {
      return '';
    }
  }

  function shouldProxyStorefrontNavigationUrl(resolvedUrl, shopHost) {
    if (!resolvedUrl) return false;
    if (resolvedUrl.protocol !== 'http:' && resolvedUrl.protocol !== 'https:') return false;
    var targetHost = String(resolvedUrl.hostname || '').toLowerCase();
    if (shopHost && targetHost !== shopHost && targetHost.indexOf('.myshopify.com') === -1) {
      return false;
    }
    return true;
  }

  function rewriteAnchorHrefsForPreviewProxy(root) {
    if (!PREVIEW_DOCUMENT_PROXY) return;
    if (!resolvePreviewDocumentApiUrl()) return;
    var shopHost = String(CONFIG.shopDomain || PREVIEW_TENANT_DOMAIN || '')
      .trim()
      .toLowerCase();
    var scope = root && root.querySelectorAll ? root : document;
    try {
      scope.querySelectorAll('a[href]').forEach(function (anchor) {
        var rawHref = anchor.getAttribute('href');
        if (!rawHref || rawHref.charAt(0) === '#') return;
        var lowered = String(rawHref).trim().toLowerCase();
        if (
          lowered.indexOf('javascript:') === 0 ||
          lowered.indexOf('mailto:') === 0 ||
          lowered.indexOf('tel:') === 0
        ) {
          return;
        }
        try {
          var resolved = new URL(rawHref, document.baseURI || window.location.href);
          if (!shouldProxyStorefrontNavigationUrl(resolved, shopHost)) return;
          var proxied = toPreviewDocumentProxyUrl(resolved.toString());
          if (proxied) anchor.setAttribute('href', proxied);
        } catch (_eRewrite) {}
      });
    } catch (_eScope) {}
  }

  function installPreviewDocumentProxyNavigation() {
    if (!PREVIEW_DOCUMENT_PROXY) return;
    if (window.__RIPX_PREVIEW_DOCUMENT_NAV__) return;
    window.__RIPX_PREVIEW_DOCUMENT_NAV__ = true;
    var shopHost = String(CONFIG.shopDomain || PREVIEW_TENANT_DOMAIN || '')
      .trim()
      .toLowerCase();
    rewriteAnchorHrefsForPreviewProxy(document);
    try {
      var rewriteTimer = null;
      var observer = new MutationObserver(function () {
        if (rewriteTimer) clearTimeout(rewriteTimer);
        rewriteTimer = setTimeout(function () {
          rewriteAnchorHrefsForPreviewProxy(document);
        }, 120);
      });
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
    } catch (_eObserver) {}
    document.addEventListener(
      'click',
      function (e) {
        if (document.body && document.body.getAttribute('data-ripx-picker-active') === '1') {
          return;
        }
        if (e.defaultPrevented) return;
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        var anchor = e.target && e.target.closest ? e.target.closest('a[href]') : null;
        if (!anchor) return;
        var bar = document.getElementById('ripx-visual-picker-bar');
        if (bar && bar.contains(e.target)) return;
        var rawHref = anchor.getAttribute('href');
        if (!rawHref || rawHref.charAt(0) === '#') return;
        var lowered = String(rawHref).trim().toLowerCase();
        if (lowered.indexOf('javascript:') === 0 || lowered.indexOf('mailto:') === 0) return;
        try {
          var resolved = new URL(rawHref, document.baseURI || window.location.href);
          if (!shouldProxyStorefrontNavigationUrl(resolved, shopHost)) return;
          var proxied = toPreviewDocumentProxyUrl(resolved.toString());
          if (!proxied || proxied === window.location.href) return;
          e.preventDefault();
          e.stopPropagation();
          window.location.assign(proxied);
        } catch (_eNav) {}
      },
      true
    );
  }

  function installSimplePreviewSessionPersistence() {
    if (!(PREVIEW_MODE && PREVIEW_SIMPLE_MODE)) return;
    if (window.__RIPX_SIMPLE_PREVIEW_SESSION__) return;
    window.__RIPX_SIMPLE_PREVIEW_SESSION__ = true;
    // Simple customer-view previews persist test+variant in sessionStorage (see writePersistedPreviewCtx).
    // Do not intercept link clicks: themes rely on default navigation / in-page JS (cart drawer, quick
    // view, etc.). Re-adding ab_preview_* on every click then stripping via replaceState caused visible
    // URL flicker and broke cart drawers that use <a href="/cart"> handlers.
  }

  function initVisualPicker() {
    if (
      !IN_IFRAME &&
      !HAS_VISUAL_PICKER_OPENER &&
      !PREVIEW_DOCUMENT_PROXY &&
      !window.__RIPX_FORCE_PICKER__
    ) {
      return;
    }
    if (!document.body) {
      setTimeout(initVisualPicker, 50);
      return;
    }
    if (document.getElementById('ripx-visual-picker-overlay')) {
      postVisualEditorStatus('ripx-visual-picker-ready', { duplicate: true });
      return;
    }
    var overlay = document.createElement('div');
    overlay.id = 'ripx-visual-picker-overlay';
    overlay.setAttribute(
      'style',
      'position:fixed;inset:0;z-index:2147483646;pointer-events:auto;cursor:crosshair;background:transparent;'
    );
    var box = document.createElement('div');
    box.id = 'ripx-visual-picker-highlight';
    box.setAttribute(
      'style',
      'position:fixed;border:2px solid #E85D04;background:rgba(232,93,4,0.15);pointer-events:none;' +
        'border-radius:4px;box-sizing:border-box;transition:top 0.05s,left 0.05s,width 0.05s,height 0.05s;z-index:2147483647;'
    );
    var bar = document.createElement('div');
    bar.id = 'ripx-visual-picker-bar';
    bar.setAttribute(
      'style',
      'position:fixed;top:0;left:0;right:0;z-index:2147483648;pointer-events:auto;' +
        'background:#1a1a1a;color:#fff;padding:10px 16px;font-family:system-ui,sans-serif;' +
        'font-size:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;box-shadow:0 2px 8px rgba(0,0,0,0.3);'
    );
    var label = document.createElement('span');
    label.id = 'ripx-visual-picker-label';
    label.textContent = PRICE_SURFACE_PICK_MODE
      ? 'Click a price node to map it for RipX price surfaces. The selector will be sent back to the wizard.'
      : 'Click an element to select it. Selector will be sent to the editor or copy below.';
    label.setAttribute('style', 'flex:1;min-width:120px;');
    var selectorInput = document.createElement('input');
    selectorInput.type = 'text';
    selectorInput.readOnly = true;
    selectorInput.placeholder = 'Selector will appear here after click';
    selectorInput.setAttribute(
      'style',
      'flex:1;min-width:160px;max-width:320px;padding:6px 10px;border:1px solid #444;border-radius:4px;' +
        'background:#2a2a2a;color:#e5e5e5;font-family:monospace;font-size:12px;'
    );
    var copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy selector';
    copyBtn.setAttribute(
      'style',
      'background:#E85D04;color:#fff;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:13px;'
    );
    copyBtn.onclick = function () {
      var val = selectorInput.value.trim();
      if (!val) return;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(val).then(function () {
            copyBtn.textContent = 'Copied!';
            setTimeout(function () {
              copyBtn.textContent = 'Copy selector';
            }, 2000);
          });
        }
      } catch (e) {}
    };
    var sendBtn = document.createElement('button');
    sendBtn.textContent = 'Send to RipX';
    sendBtn.setAttribute(
      'style',
      'background:#059669;color:#fff;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;'
    );
    function inferPickerPriceSurfaceFromHref(href) {
      return getPriceSurfaceHintFromHref(href);
    }

    function inferPickerPriceSurfaceRoleFromElement(el) {
      if (!el) return null;
      var current = el;
      for (var hop = 0; hop < 4 && current; hop++) {
        var classes =
          current.className && typeof current.className === 'string'
            ? current.className.toLowerCase()
            : '';
        if (
          classes.indexOf('compare') !== -1 ||
          classes.indexOf('was-price') !== -1 ||
          classes.indexOf('price--compare') !== -1
        ) {
          return 'compare_at';
        }
        if (classes.indexOf('unit-price') !== -1 || classes.indexOf('unit_price') !== -1) {
          return 'unit';
        }
        if (classes.indexOf('installment') !== -1) {
          return 'installment';
        }
        if (classes.indexOf('savings') !== -1) {
          return 'savings';
        }
        if (classes.indexOf('cart-item') !== -1 || classes.indexOf('line-item') !== -1) {
          return 'cart_line';
        }
        current = current.parentElement;
      }
      return 'regular';
    }

    function postVisualSelector(selector, el) {
      var payload = {
        type: 'ripx-visual-selector',
        selector: selector,
        source: 'ripx-picker',
        pageUrl: String(window.location.href || ''),
        surfaceHint: inferPickerPriceSurfaceFromHref(window.location.href),
        roleHint: inferPickerPriceSurfaceRoleFromElement(el),
      };
      try {
        if (window.opener && !window.opener.closed) window.opener.postMessage(payload, '*');
      } catch (_eOpenerPost) {}
      try {
        if (IN_IFRAME && window.parent && window.parent !== window)
          window.parent.postMessage(payload, '*');
      } catch (_eParentPost) {}
    }

    sendBtn.onclick = function () {
      var val = selectorInput.value.trim();
      if (!val) return;
      postVisualSelector(val);
      if (window.opener && !window.opener.closed) {
        sendBtn.textContent = 'Sent!';
        setTimeout(function () {
          sendBtn.textContent = 'Send to RipX';
        }, 2000);
      } else {
        sendBtn.textContent = 'Open from editor tab';
        setTimeout(function () {
          sendBtn.textContent = 'Send to RipX';
        }, 2500);
      }
    };
    var closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.setAttribute(
      'style',
      'background:#444;color:#fff;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:13px;'
    );
    closeBtn.onclick = function () {
      try {
        if (IN_IFRAME && window.parent && window.parent !== window) {
          window.parent.postMessage(
            { type: 'ripx-close-price-picker', source: 'ripx-picker' },
            '*'
          );
        } else if (window.opener && !window.opener.closed) {
          window.close();
        }
      } catch (_eClose) {}
    };
    bar.appendChild(label);
    bar.appendChild(selectorInput);
    bar.appendChild(copyBtn);
    bar.appendChild(sendBtn);
    bar.appendChild(closeBtn);
    document.body.appendChild(overlay);
    document.body.appendChild(box);
    document.body.appendChild(bar);
    try {
      var pickerPad = bar.offsetHeight || 56;
      document.documentElement.style.setProperty('--ripx-picker-bar-height', pickerPad + 'px');
      if (document.body) {
        document.body.style.paddingTop = pickerPad + 'px';
        document.body.setAttribute('data-ripx-picker-active', '1');
      }
    } catch (_ePickerPad) {}
    installPreviewDocumentProxyNavigation();
    postVisualEditorStatus('ripx-visual-picker-ready', {
      mode: IN_IFRAME ? 'iframe' : PREVIEW_DOCUMENT_PROXY ? 'preview-document' : 'opener',
    });

    var barHeight = bar.offsetHeight;

    function setHighlight(rect) {
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        box.style.display = 'none';
        return;
      }
      box.style.display = 'block';
      box.style.top = rect.top + barHeight + 'px';
      box.style.left = rect.left + 'px';
      box.style.width = rect.width + 'px';
      box.style.height = rect.height + 'px';
    }

    function onSelectorChosen(selector, el) {
      selectorInput.value = selector;
      postVisualSelector(selector, el);
      if (IN_IFRAME || (window.opener && !window.opener.closed)) {
        label.textContent = 'Selector sent to RipX. You can pick another element or close.';
        label.setAttribute('style', 'flex:1;min-width:120px;color:#34d399;');
      } else {
        label.textContent = 'Copy the selector below and paste it in the editor.';
        label.setAttribute('style', 'flex:1;min-width:120px;color:#fbbf24;');
      }
    }

    function pickTargetElementAt(clientX, clientY) {
      overlay.style.pointerEvents = 'none';
      var el =
        pickPriceAwareElementAt(clientX, clientY) || document.elementFromPoint(clientX, clientY);
      overlay.style.pointerEvents = 'auto';
      if (!el || el === overlay || el === box || el === bar || bar.contains(el)) {
        return null;
      }
      return el;
    }

    function elementLooksLikePriceNode(node) {
      if (!node || node.nodeType !== 1 || !node.tagName) return false;
      if (node === overlay || node === box || node === bar || bar.contains(node)) return false;
      var tagName = String(node.tagName || '').toLowerCase();
      if (tagName === 'a' || tagName === 'button') return false;
      var classes =
        node.className && typeof node.className === 'string' ? node.className.toLowerCase() : '';
      var attrs = '';
      try {
        attrs = Array.prototype.slice
          .call(node.attributes || [])
          .map(function (attr) {
            return String(attr.name || '') + '=' + String(attr.value || '');
          })
          .join(' ')
          .toLowerCase();
      } catch (_eAttrs) {}
      var text = String(node.textContent || '').trim();
      var hasPriceText =
        /(?:[$€£¥₹৳]|usd|eur|gbp|cad|aud|sale|from)\s*[-+]?\d/i.test(text) ||
        /[-+]?\d[\d,]*(?:\.\d{2})?\s*(?:[$€£¥₹৳]|usd|eur|gbp|cad|aud)/i.test(text);
      var hasPriceHint =
        /(price|money|amount|compare|sale|regular|unit-price|was-price|cost)/i.test(
          classes + ' ' + attrs
        );
      if (!hasPriceText && !hasPriceHint) return false;
      if (!isLeafPricePaintNode(node)) return false;
      return true;
    }

    function getPricePickerCandidateSelectors() {
      var selectors = [
        '.price .money',
        '.product-price .money',
        '[data-product-price]',
        '.money',
        '.price-item--regular .price-item__regular',
        '.price-item--regular .price',
        '.price-item__regular',
        '.price-item--regular',
        '.price-item',
        '[data-price]',
      ];
      try {
        appendConfiguredRegistrySelectorsForSurfaces(
          selectors,
          getListingPriceSurfaceKeys(),
          ['regular', 'compare_at', 'unit', 'installment', 'savings'],
          getActiveTestById(PREVIEW_TEST_ID)
        );
      } catch (_eRegistrySelectors) {}
      return selectors.filter(function (selector, index) {
        return selector && selectors.indexOf(selector) === index;
      });
    }

    function findPriceCandidateNearPoint(clientX, clientY) {
      var selectors = getPricePickerCandidateSelectors().join(',');
      if (!selectors) return null;
      var best = null;
      var bestScore = Infinity;
      try {
        document.querySelectorAll(selectors).forEach(function (node) {
          if (!elementLooksLikePriceNode(node)) return;
          var rect = node.getBoundingClientRect();
          if (!rect || rect.width <= 0 || rect.height <= 0) return;
          var contains =
            clientX >= rect.left &&
            clientX <= rect.right &&
            clientY >= rect.top &&
            clientY <= rect.bottom;
          var dx = contains ? 0 : Math.max(rect.left - clientX, 0, clientX - rect.right);
          var dy = contains ? 0 : Math.max(rect.top - clientY, 0, clientY - rect.bottom);
          var distance = Math.sqrt(dx * dx + dy * dy);
          if (distance > 24) return;
          var area = Math.max(1, rect.width * rect.height);
          var score = distance * 100000 + area;
          if (score < bestScore) {
            best = node;
            bestScore = score;
          }
        });
      } catch (_eFindPrice) {}
      return best;
    }

    function pickPriceAwareElementAt(clientX, clientY) {
      if (!PRICE_SURFACE_PICK_MODE) return null;
      var stacked = [];
      try {
        stacked = document.elementsFromPoint ? document.elementsFromPoint(clientX, clientY) : [];
      } catch (_eStacked) {}
      for (var i = 0; i < stacked.length; i += 1) {
        var node = stacked[i];
        if (elementLooksLikePriceNode(node)) return node;
        try {
          var nested =
            node && node.querySelector
              ? node.querySelector(getPricePickerCandidateSelectors().join(','))
              : null;
          if (elementLooksLikePriceNode(nested)) return nested;
        } catch (_eNestedPrice) {}
      }
      return findPriceCandidateNearPoint(clientX, clientY);
    }

    function stopPickerEvent(e) {
      if (!e) return;
      if (bar && bar.contains(e.target)) return;
      try {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      } catch (_eStopPicker) {}
    }

    function handlePickerPointer(e, choose) {
      if (bar && bar.contains(e.target)) return;
      stopPickerEvent(e);
      if (!choose) return;
      var el = pickTargetElementAt(e.clientX, e.clientY);
      if (!el) return;
      var selector = getSelectorForElement(el);
      if (selector) onSelectorChosen(selector, el);
    }

    overlay.addEventListener(
      'mousemove',
      function (e) {
        var el = pickTargetElementAt(e.clientX, e.clientY);
        if (!el) {
          setHighlight(null);
          if (!selectorInput.value) {
            label.textContent = PRICE_SURFACE_PICK_MODE
              ? 'Click a price node to map it for RipX price surfaces. The selector will be sent back to the wizard.'
              : 'Click an element to select it. Selector will be sent to the editor or copy below.';
            label.setAttribute('style', 'flex:1;min-width:120px;');
          }
          return;
        }
        var rect = el.getBoundingClientRect();
        setHighlight({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
        var sel = getSelectorForElement(el);
        label.textContent = sel
          ? el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + ' \u2192 ' + sel
          : el.tagName.toLowerCase();
        label.setAttribute('style', 'flex:1;min-width:120px;');
      },
      { passive: true }
    );

    overlay.addEventListener(
      'click',
      function (e) {
        handlePickerPointer(e, true);
      },
      true
    );
    overlay.addEventListener(
      'mousedown',
      function (e) {
        if (e.button !== 0) return;
        handlePickerPointer(e, false);
      },
      true
    );
    overlay.addEventListener(
      'pointerdown',
      function (e) {
        if (e.button !== 0) return;
        handlePickerPointer(e, false);
      },
      true
    );
    document.addEventListener(
      'pointerdown',
      function (e) {
        if (e.button !== 0) return;
        handlePickerPointer(e, false);
      },
      true
    );
    document.addEventListener(
      'mousedown',
      function (e) {
        if (e.button !== 0) return;
        handlePickerPointer(e, false);
      },
      true
    );
    document.addEventListener(
      'click',
      function (e) {
        handlePickerPointer(e, true);
      },
      true
    );
  }

  /**
   * Visual editor: in iframe. Prevent navigation, click-to-select, send selector to parent.
   * Only run when embedded (defensive: never run on live site).
   */
  var visualEditorEmbedInitialized = false;
  function initVisualEditorEmbed() {
    if (typeof window.parent !== 'undefined' && window.self === window.top) return;
    if (visualEditorEmbedInitialized) return;
    if (!document.body) {
      setTimeout(initVisualEditorEmbed, 25);
      return;
    }
    if (document.getElementById('ripx-visual-editor-overlay')) {
      postVisualEditorStatus('ripx-visual-editor-ready', { duplicate: true });
      return;
    }
    visualEditorEmbedInitialized = true;
    var targetWindow = window.parent;
    if (!targetWindow) return;

    var overlay = document.createElement('div');
    overlay.id = 'ripx-visual-editor-overlay';
    overlay.setAttribute('style', 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;');
    var box = document.createElement('div');
    box.id = 'ripx-visual-editor-highlight';
    box.setAttribute(
      'style',
      'position:fixed;border:2px solid #E85D04;background:rgba(232,93,4,0.2);pointer-events:none;' +
        'border-radius:4px;box-sizing:border-box;transition:top 0.05s,left 0.05s,width 0.05s,height 0.05s;'
    );
    var hint = document.createElement('div');
    hint.setAttribute(
      'style',
      'position:fixed;bottom:12px;left:50%;transform:translateX(-50%);z-index:2147483647;' +
        'padding:8px 14px;background:#1a1a1a;color:#fff;font-size:13px;border-radius:6px;' +
        'box-shadow:0 2px 8px rgba(0,0,0,0.3);pointer-events:none;'
    );
    hint.textContent = 'Click an element to select — selector will appear in the panel';
    document.body.appendChild(overlay);
    document.body.appendChild(box);
    document.body.appendChild(hint);
    postVisualEditorStatus('ripx-visual-editor-ready', { mode: 'iframe' });

    function setHighlight(rect) {
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        box.style.display = 'none';
        return;
      }
      box.style.display = 'block';
      box.style.top = rect.top + 'px';
      box.style.left = rect.left + 'px';
      box.style.width = rect.width + 'px';
      box.style.height = rect.height + 'px';
    }

    function getTargetUnderCursor(clientX, clientY) {
      var list = document.elementsFromPoint ? document.elementsFromPoint(clientX, clientY) : [];
      for (var i = 0; i < list.length; i++) {
        var node = list[i];
        if (node && node !== overlay && node !== box && !(hint && hint.contains(node))) return node;
      }
      var fallback = document.elementFromPoint(clientX, clientY);
      if (
        fallback &&
        fallback !== overlay &&
        fallback !== box &&
        !(hint && hint.contains(fallback))
      )
        return fallback;
      return null;
    }

    var lastClientX = -1;
    var lastClientY = -1;
    var rafScheduled = false;
    function updateHighlightAtCursor() {
      var el = getTargetUnderCursor(lastClientX, lastClientY);
      if (!el) {
        setHighlight(null);
        return;
      }
      var rect = el.getBoundingClientRect();
      setHighlight({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    }

    document.addEventListener(
      'mousemove',
      function (e) {
        lastClientX = e.clientX;
        lastClientY = e.clientY;
        if (!rafScheduled) {
          rafScheduled = true;
          requestAnimationFrame(function () {
            rafScheduled = false;
            updateHighlightAtCursor();
          });
        }
      },
      { passive: true }
    );

    function onScrollOrResize() {
      if (lastClientX >= 0 && lastClientY >= 0) updateHighlightAtCursor();
    }
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);

    function handleSelectClick(e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      var el = getTargetUnderCursor(e.clientX, e.clientY);
      if (!el) return;
      var selector = '';
      try {
        selector = getSelectorForElement(el) || '';
      } catch (err) {}
      if (selector && targetWindow && !targetWindow.closed) {
        try {
          targetWindow.postMessage(
            {
              type: 'ripx-visual-selector',
              selector: selector,
              source: 'ripx-visual-editor',
              pageUrl: String(window.location.href || ''),
              surfaceHint: getPriceSurfaceHintFromHref(window.location.href),
            },
            '*'
          );
        } catch (err) {}
      }
    }

    document.addEventListener('mousedown', handleSelectClick, true);
  }

  /**
   * Track checkout completion
   */
  function trackCheckout() {
    // This would be called on the order confirmation page
    if (window.Shopify?.checkout) {
      const orderId = window.Shopify.checkout.order_id;
      const totalPrice = window.Shopify.checkout.total_price;

      // Get all active test variants from the page
      const testVariants = document.querySelectorAll('[data-test-variant]');

      testVariants.forEach(element => {
        const testId = element.getAttribute('data-test-id');
        const variantId = element.getAttribute('data-test-variant');

        if (testId && variantId) {
          trackConversion(testId, variantId, parseFloat(totalPrice) / 100, {
            order_id: orderId,
          });
        }
      });
    }
  }

  /**
   * Cookie helpers
   */
  function setCookie(name, value, days) {
    const date = new Date();
    date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
    const expires = 'expires=' + date.toUTCString();
    const secure = window.location && window.location.protocol === 'https:' ? ';Secure' : '';
    document.cookie =
      encodeURIComponent(name) +
      '=' +
      encodeURIComponent(value) +
      ';' +
      expires +
      ';path=/;SameSite=Lax' +
      secure;
  }

  function getCookie(name) {
    const nameEQ = encodeURIComponent(name) + '=';
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) === ' ') c = c.substring(1, c.length);
      if (c.indexOf(nameEQ) === 0) {
        try {
          return decodeURIComponent(c.substring(nameEQ.length, c.length));
        } catch (_eDecodeCookie) {
          return c.substring(nameEQ.length, c.length);
        }
      }
    }
    return null;
  }

  /** @deprecated use formatShopPrice */
  function formatPrice(price) {
    return formatShopPrice(price);
  }

  /**
   * Normalize a numeric or GID to full Shopify Product GID
   */
  function toProductGid(id) {
    if (!id) return null;
    var s = String(id).trim();
    if (s.indexOf('gid://shopify/Product/') === 0) return s;
    var num = s.replace(/\D/g, '');
    return num ? 'gid://shopify/Product/' + num : null;
  }

  function toVariantGid(id) {
    if (!id) return null;
    var s = String(id).trim();
    if (s.indexOf('gid://shopify/ProductVariant/') === 0) return s;
    var num = s.replace(/\D/g, '');
    return num ? 'gid://shopify/ProductVariant/' + num : null;
  }

  function reportCatalogProductView() {
    if (!CONFIG.apiUrl || !hasValidConfig) return;
    var productId = getCurrentProductId();
    if (!productId) return;
    var variantRaw = getSelectedVariantId();
    var variantId = variantRaw ? toVariantGid(variantRaw) : null;
    var visitorKey = getUserId();
    var storageKey = 'ripx_catalog_pv_' + String(productId).replace(/\W+/g, '_');
    try {
      if (window.sessionStorage && window.sessionStorage.getItem(storageKey)) return;
      if (window.sessionStorage) window.sessionStorage.setItem(storageKey, '1');
    } catch (_storageErr) {}

    var shopDomain = getShopDomain();
    var body = JSON.stringify({
      shop_domain: shopDomain,
      site: !shopDomain ? window.location.hostname : null,
      product_id: productId,
      variant_id: variantId,
      visitor_key: visitorKey,
    });
    var endpoint = CONFIG.apiUrl + '/track/catalog-product-view';
    try {
      if (navigator.sendBeacon) {
        var beaconBody =
          typeof Blob === 'function' ? new Blob([body], { type: 'application/json' }) : body;
        navigator.sendBeacon(endpoint, beaconBody);
        return;
      }
    } catch (_beaconErr) {}
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
      keepalive: true,
      credentials: 'omit',
      mode: 'cors',
    }).catch(function () {});
  }

  /**
   * Normalize a numeric or GID to full Shopify Collection GID
   */
  function toCollectionGid(id) {
    if (!id) return null;
    var s = String(id).trim();
    if (s.indexOf('gid://shopify/Collection/') === 0) return s;
    var num = s.replace(/\D/g, '');
    return num ? 'gid://shopify/Collection/' + num : null;
  }

  /**
   * Get current product ID on PDP (Shopify meta, data attributes, or theme JSON script). Returns GID or null.
   */
  function getCurrentProductId() {
    if (window.ShopifyAnalytics?.meta?.product?.id) {
      return toProductGid(window.ShopifyAnalytics.meta.product.id);
    }
    if (window.Shopify?.meta?.product?.id) {
      return toProductGid(window.Shopify.meta.product.id);
    }
    // Prefer PDP roots before any global [data-product-id] (cards/recommendations often render first).
    var primary =
      document.querySelector('product-info[data-product-id]') ||
      document.querySelector('.product-single[data-product-id]') ||
      document.querySelector('main [data-product-id][data-product]') ||
      document.querySelector('main .product[data-product-id]') ||
      document.querySelector('main [data-product-id]');
    if (primary) {
      var primaryId = primary.getAttribute('data-product-id');
      if (primaryId) return toProductGid(primaryId);
    }
    // Theme fallback: many themes put product JSON in a script tag (e.g. #ProductJson, [data-product-json])
    var script = document.querySelector(
      '#ProductJson, script[type="application/json"][data-product-json], script[data-section-type="product-template"], script[data-section-type="product"]'
    );
    if (script && script.textContent) {
      try {
        var data = JSON.parse(script.textContent);
        var id = data.id || data.product_id || (data.product && data.product.id);
        if (id) return toProductGid(id);
      } catch (e) {}
    }
    var el = document.querySelector('[data-product-id]');
    if (el) {
      var id = el.getAttribute('data-product-id');
      if (id) return toProductGid(id);
    }
    // Late / alternate shapes: same script as getProductJson (product nested only).
    var gj = getProductJson();
    if (gj && gj.product && gj.product.id != null) {
      return toProductGid(gj.product.id);
    }
    return null;
  }

  /**
   * Get current collection ID on collection page (Shopify meta, data attributes, or theme JSON script). Returns GID or null.
   * Works when ShopifyAnalytics/Shopify.meta are not yet set (e.g. local dev, theme dev, or async script order).
   */
  function getCurrentCollectionId() {
    if (window.ShopifyAnalytics?.meta?.collection?.id) {
      return toCollectionGid(window.ShopifyAnalytics.meta.collection.id);
    }
    if (window.Shopify?.meta?.collection?.id) {
      return toCollectionGid(window.Shopify.meta.collection.id);
    }
    var el = document.querySelector(
      '[data-collection-id], body[data-collection-id], html[data-collection-id]'
    );
    if (el) {
      var id = el.getAttribute('data-collection-id');
      if (id) return toCollectionGid(id);
    }
    // Meta tag fallback (some themes set this)
    var meta = document.querySelector('meta[name="collection-id"], meta[property="collection:id"]');
    if (meta && meta.content) {
      var id = meta.getAttribute('content');
      if (id) return toCollectionGid(id);
    }
    // Theme fallback: many themes put collection JSON in a script tag (e.g. #CollectionJson, Dawn-style)
    var script = document.querySelector(
      '#CollectionJson, script[type="application/json"][data-collection-json], script[data-section-type="collection"]'
    );
    if (script && script.textContent) {
      try {
        var data = JSON.parse(script.textContent);
        var id = data.id || data.collection_id || (data.collection && data.collection.id);
        if (id) return toCollectionGid(id);
      } catch (e) {}
    }
    // JSON-LD fallback: some themes output Collection in structured data
    var jsonLd = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < jsonLd.length; i++) {
      try {
        var ld = JSON.parse(jsonLd[i].textContent);
        var item = Array.isArray(ld) ? ld[0] : ld;
        if (item && (item['@type'] === 'CollectionPage' || item['@type'] === 'ItemList')) {
          var url = item.url || (item.mainEntity && item.mainEntity.url);
          if (url && url.indexOf('/collections/') !== -1) {
            var num = url.replace(/.*\/collections\/[^/]*\/?(\d+).*/, '$1').replace(/\D/g, '');
            if (num) return toCollectionGid(num);
          }
        }
      } catch (e) {}
    }
    return null;
  }

  /**
   * Get current product or collection ID for backward compatibility (product first).
   */
  function getCurrentTargetId() {
    return getCurrentProductId() || getCurrentCollectionId();
  }

  /**
   * Check if two GIDs refer to the same resource (handles trailing slashes, numeric suffix, and full GID)
   */
  function gidMatches(a, b) {
    if (!a || !b) return false;
    var sa = String(a).trim();
    var sb = String(b).trim();
    if (sa === sb) return true;
    if (sa.indexOf(sb) === 0 && (sa.length === sb.length || sa.charAt(sb.length) === '/'))
      return true;
    if (sb.indexOf(sa) === 0 && (sb.length === sa.length || sb.charAt(sa.length) === '/'))
      return true;
    var trailA = sa.replace(/.*\/(\d+)\/?$/, '$1') || sa;
    var trailB = sb.replace(/.*\/(\d+)\/?$/, '$1') || sb;
    if (trailA === trailB && trailA !== '') {
      var typeA =
        sa.indexOf('/Product/') !== -1
          ? 'Product'
          : sa.indexOf('/Collection/') !== -1
            ? 'Collection'
            : '';
      var typeB =
        sb.indexOf('/Product/') !== -1
          ? 'Product'
          : sb.indexOf('/Collection/') !== -1
            ? 'Collection'
            : '';
      // Accept numeric <-> GID matching when one side has no explicit type.
      // This keeps legacy numeric target IDs compatible with modern GID current IDs.
      if (typeA === typeB && typeA !== '') return true;
      if (typeA !== '' && typeB === '') return true;
      if (typeA === '' && typeB !== '') return true;
    }
    return false;
  }

  /**
   * URLs where product cards may appear (collection, home, search, CMS pages with grids).
   * Path-based so we still run price listing when meta product id is missing or wrong.
   */
  function isProductListingSurface() {
    var p = getEffectivePreviewPathname() || '/';
    if (p === '/' || p === '') return true;
    if (p.indexOf('/collections/') === 0) return true;
    if (p.indexOf('/search') === 0) return true;
    if (p.indexOf('/pages/') === 0) return true;
    return false;
  }

  function isCartSurface() {
    var p = getEffectivePreviewPathname();
    return p === '/cart' || p.indexOf('/cart/') === 0;
  }

  /** Cart drawer / mini-cart exists in DOM (even on PDP). Used so all-products price paint runs outside /cart. */
  function hasCartUiInDom() {
    try {
      return !!document.querySelector(
        '.cart-drawer, cart-drawer, #CartDrawer, [data-cart-drawer], #cart-form, form[action*="/cart"], .cart-items, .cart__contents, aside.mini-cart'
      );
    } catch (e) {
      return false;
    }
  }

  function shouldRunAllProductsCartFallback() {
    return isCartSurface() || hasCartUiInDom();
  }

  /**
   * Product ids visible in cart UI only (drawer / cart page), including Shadow DOM.
   * IMPORTANT: Do not use document-wide `[data-product-id]` — on PDP that matches the main product
   * and forces applyPriceTestToCart instead of the all-products cart fallback + shadow-aware paint.
   */
  function getCartVisibleProductTargetIds() {
    var seen = {};
    var out = [];
    var cartRootsSel =
      '.cart-drawer, cart-drawer, #CartDrawer, .drawer--cart, [data-cart-drawer], #cart-form, form[action*="/cart"], .cart-items, main .cart, .cart__contents, aside.mini-cart';
    var roots;
    try {
      roots = document.querySelectorAll(cartRootsSel);
    } catch (e) {
      return [];
    }
    if (!roots.length) return [];
    var lineSel =
      '.cart-item [data-product-id], .cart-item[data-product-id], [data-cart-item] [data-product-id], [data-cart-item][data-product-id], [data-line-item-key] [data-product-id], [data-product-id]';
    function considerEl(el) {
      if (!el || !el.getAttribute) return;
      var raw = el.getAttribute('data-product-id') || '';
      if (!raw.trim()) return;
      var pid = toNumericProductId(raw);
      if (!pid || seen[pid]) return;
      seen[pid] = true;
      out.push(toProductGid(raw) || 'gid://shopify/Product/' + pid);
    }
    Array.prototype.forEach.call(roots, function (root) {
      querySelectorAllWithShadowRoots(root, lineSel).forEach(considerEl);
    });
    return out;
  }

  /**
   * Product-targeted price test: may show test prices on listing surfaces even when matchesTarget is false (no PDP product id).
   */
  function shouldRunPriceTestOnListingSurface(test) {
    if (!testTypeIsPrice(test)) return false;
    var tt = getNormalizedTargetType(test);
    if (!isProductScopeTargetType(tt)) return false;
    if (tt === 'all-products' || tt === 'all_products') return isProductListingSurface();
    var tids =
      test.targetIds || (test.targetId || test.target_id ? [test.targetId || test.target_id] : []);
    if (!tids || !tids.length) return false;
    return isProductListingSurface();
  }

  function shouldRunShippingTestOnListingSurface(test) {
    if (!testTypeIsShipping(test)) return false;
    var tt = getNormalizedTargetType(test);
    if (!isProductScopeTargetType(tt)) return false;
    return isProductListingSurface();
  }

  function isProductScopeTargetType(targetType) {
    var tt = String(targetType || '').toLowerCase();
    return tt === 'product' || tt === 'all-products' || tt === 'all_products';
  }

  function getExcludedProductIdsForTest(test) {
    if (!test || typeof test !== 'object') return [];
    var raw =
      test.excludedProductIds ||
      (test.segments && test.segments.excluded_product_ids) ||
      (test.segments && test.segments.excludedProductIds) ||
      [];
    if (typeof raw === 'string') {
      raw = raw
        .split(/[\n,]+/)
        .map(function (value) {
          return String(value || '').trim();
        })
        .filter(Boolean);
    }
    if (!Array.isArray(raw)) return [];
    var seen = {};
    var out = [];
    raw.forEach(function (id) {
      var normalized = toNumericProductId(id);
      if (!normalized || seen[normalized]) return;
      seen[normalized] = true;
      out.push(normalized);
    });
    return out;
  }

  function isExcludedProductForTest(test, productId) {
    var pid = toNumericProductId(productId);
    if (!pid) return false;
    var excluded = getExcludedProductIdsForTest(test);
    if (!excluded.length) return false;
    return excluded.indexOf(pid) !== -1;
  }

  function getActiveTestById(testId) {
    var tests = (CONFIG && Array.isArray(CONFIG.activeTests) ? CONFIG.activeTests : []) || [];
    for (var i = 0; i < tests.length; i++) {
      var test = tests[i];
      if (test && String(test.id || '') === String(testId || '')) {
        return test;
      }
    }
    return null;
  }

  function normalizeOfferCodeToken(rawValue, fallback) {
    var token = String(rawValue || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 20);
    return token || String(fallback || 'VARIANT');
  }

  function buildOfferValueToken(config) {
    var cfg = config && typeof config === 'object' ? config : {};
    var discountType = normalizeOfferDiscountType(cfg);
    if (discountType === 'free_shipping') {
      return 'SHIP';
    }
    var numericValue = parseOfferDiscountValue(cfg);
    var valueToken = isFinite(numericValue)
      ? String(numericValue).replace('.', '_')
      : discountType === 'fixed'
        ? 'FIXED'
        : 'PCT';
    if (discountType === 'fixed') {
      return valueToken + 'OFF';
    }
    return valueToken + 'PCT';
  }

  function buildAutoOfferCodeName(test, variant) {
    var cfg = variant && variant.config && typeof variant.config === 'object' ? variant.config : {};
    var testToken = normalizeOfferCodeToken(test && (test.name || test.id), 'TEST').slice(0, 14);
    var variantToken = normalizeOfferCodeToken(
      variant && (variant.variantName || variant.name || variant.variantId || variant.id),
      'VARIANT'
    ).slice(0, 14);
    var offerToken = normalizeOfferCodeToken(buildOfferValueToken(cfg), 'OFFER').slice(0, 14);
    return ('RIPX-' + testToken + '-' + variantToken + '-' + offerToken).slice(0, 48);
  }

  function getOfferConfigCandidates(config) {
    var base = config && typeof config === 'object' ? config : {};
    var out = [base];
    var nestedKeys = ['offer', 'discount', 'offer_config', 'offerConfig'];
    for (var i = 0; i < nestedKeys.length; i += 1) {
      var key = nestedKeys[i];
      var nested = base[key];
      if (nested && typeof nested === 'object') {
        out.push(nested);
      }
    }
    return out;
  }

  function normalizeExplicitOfferCode(rawValue) {
    var code = String(rawValue === null || rawValue === undefined ? '' : rawValue).trim();
    if (!code) return '';
    if (code.length > 64) return '';
    if (!/^[A-Za-z0-9_-]+$/.test(code)) return '';
    return code;
  }

  function resolveExplicitOfferCodeFromConfig(config, labelPrefix) {
    var sourceKeys = [
      'discount_code_name',
      'discountCodeName',
      'discount_code',
      'discountCode',
      'code_name',
      'codeName',
      'coupon_code',
      'couponCode',
      'coupon',
      'code',
    ];
    var nestedLabels = ['', 'offer', 'discount', 'offer_config', 'offerConfig'];
    var candidates = getOfferConfigCandidates(config);
    for (var i = 0; i < candidates.length; i += 1) {
      var cfg = candidates[i];
      for (var j = 0; j < sourceKeys.length; j += 1) {
        var key = sourceKeys[j];
        var code = normalizeExplicitOfferCode(cfg[key]);
        if (code) {
          var nestedLabel = nestedLabels[i];
          var sourcePath = nestedLabel ? nestedLabel + '.' + key : key;
          return {
            codeName: code,
            sourceKey: key,
            sourceLabel: String(labelPrefix || 'config') + '.' + sourcePath,
          };
        }
      }
    }
    return null;
  }

  function resolveOfferCodeForVariant(test, variant) {
    var cfg = variant && variant.config && typeof variant.config === 'object' ? variant.config : {};
    var explicit = resolveExplicitOfferCodeFromConfig(cfg, 'config');
    if (explicit) {
      return explicit;
    }
    var variantLevel = resolveExplicitOfferCodeFromConfig(variant, 'variant');
    if (variantLevel) {
      return variantLevel;
    }
    return {
      codeName: buildAutoOfferCodeName(test, variant),
      sourceKey: 'auto',
      sourceLabel: 'auto-generated',
    };
  }

  function getOfferCodeNameForVariant(test, variant) {
    return resolveOfferCodeForVariant(test, variant).codeName;
  }
  function normalizeOfferDiscountType(config) {
    var cfgCandidates = getOfferConfigCandidates(config);
    var raw = '';
    for (var i = 0; i < cfgCandidates.length; i += 1) {
      var cfg = cfgCandidates[i];
      raw = String(
        cfg.discount_type || cfg.discountType || cfg.offer_type || cfg.offerType || cfg.type || ''
      )
        .trim()
        .toLowerCase();
      if (raw) break;
    }
    if (
      raw === 'percent' ||
      raw === 'percentage' ||
      raw === 'pct' ||
      raw === 'percent_off' ||
      raw === 'percentage_off'
    ) {
      return 'percent';
    }
    if (
      raw === 'fixed' ||
      raw === 'fixed_amount' ||
      raw === 'amount' ||
      raw === 'flat' ||
      raw === 'flat_amount' ||
      raw === 'money'
    ) {
      return 'fixed';
    }
    if (
      raw === 'free_shipping' ||
      raw === 'free-shipping' ||
      raw === 'freeshipping' ||
      raw === 'free shipping'
    ) {
      return 'free_shipping';
    }
    if (!raw) {
      var inferredValue = parseOfferDiscountValue(config);
      if (isFinite(inferredValue) && inferredValue > 0) return 'percent';
    }
    return raw;
  }
  function parseOfferDiscountValue(config) {
    var cfgCandidates = getOfferConfigCandidates(config);
    for (var i = 0; i < cfgCandidates.length; i += 1) {
      var cfg = cfgCandidates[i];
      var valueCandidates = [
        cfg.discount_value,
        cfg.discountValue,
        cfg.discount_amount,
        cfg.discountAmount,
        cfg.value,
        cfg.amount,
        cfg.percent,
        cfg.percentage,
        cfg.pct,
      ];
      for (var j = 0; j < valueCandidates.length; j += 1) {
        var raw = valueCandidates[j];
        if (raw === null || raw === undefined || String(raw).trim() === '') continue;
        var n = Number(raw);
        if (isFinite(n) && n !== 0) return Math.abs(n);
      }
    }
    return NaN;
  }
  function isActionableOfferConfig(config) {
    var discountType = normalizeOfferDiscountType(config);
    if (discountType === 'free_shipping') return true;
    if (resolveExplicitOfferCodeFromConfig(config, 'config')) return true;
    if (discountType !== 'percent' && discountType !== 'fixed') return false;
    var numericValue = parseOfferDiscountValue(config);
    return isFinite(numericValue) && numericValue > 0;
  }
  function getOfferTargetProductIdsForCartAttrs(test) {
    var tt = getNormalizedTargetType(test);
    if (tt !== 'product') return null;
    var ids =
      test &&
      (test.targetIds ||
        (test.targetId || test.target_id ? [test.targetId || test.target_id] : []));
    return Array.isArray(ids) && ids.length > 0 ? ids : null;
  }
  function injectOfferTestCartAttributes(test, variant) {
    if (!test || !variant || !testTypeIsOffer(test)) return;
    var tt = getNormalizedTargetType(test);
    if (!isProductScopeTargetType(tt)) return;
    var cfg = variant && variant.config && typeof variant.config === 'object' ? variant.config : {};
    if (!isActionableOfferConfig(cfg)) return;
    var variantIdForCart = variant.variantId != null ? variant.variantId : variant.id;
    if (variantIdForCart == null || String(variantIdForCart).trim() === '') return;
    injectPriceTestCartAttributes(
      test.id,
      variantIdForCart,
      getAssignmentProofFromVariant(variant),
      getOfferTargetProductIdsForCartAttrs(test),
      null,
      { applicationMethod: 'discounted_checkout_price' },
      {
        discountType: normalizeOfferDiscountType(cfg),
        discountValue: parseOfferDiscountValue(cfg),
        codeName: resolveOfferCodeForVariant(test, variant).codeName,
      }
    );
  }
  function getShippingTargetProductIdsForCartAttrs(test) {
    var tt = getNormalizedTargetType(test);
    if (tt !== 'product') return null;
    var ids =
      test &&
      (test.targetIds ||
        (test.targetId || test.target_id ? [test.targetId || test.target_id] : []));
    return Array.isArray(ids) && ids.length > 0 ? ids : null;
  }
  function resolveShippingVariantIdForCart(variant) {
    if (!variant || typeof variant !== 'object') return '';
    var candidates = [
      variant.variantId,
      variant.variant_id,
      variant.id,
      variant.variantName,
      variant.variant_name,
      variant.name,
      variant.index,
      variant.variant_index,
    ];
    for (var i = 0; i < candidates.length; i += 1) {
      var value = candidates[i];
      if (value === undefined || value === null) continue;
      var normalized = String(value).trim();
      if (normalized) return normalized;
    }
    return '';
  }
  function injectShippingTestCartAttributes(test, variant, opts) {
    var options = opts && typeof opts === 'object' ? opts : {};
    if (!test || !variant || !testTypeIsShipping(test)) return;
    var tt = getNormalizedTargetType(test);
    var variantIdForCart = resolveShippingVariantIdForCart(variant);
    if (!variantIdForCart) return;
    var assignmentKey = buildShippingAssignmentKey(test, variant);
    if (!options.force && assignmentKey && assignmentKey === _ripxShippingAssignmentKey) {
      return;
    }
    var lightweight =
      options.lightweight === true ||
      (!options.force &&
        options.lightweight !== false &&
        shouldUseLightweightShippingPreviewPdpHandoff());
    clearRipxPriceOnlyCartHints();
    injectPriceTestCartAttributes(
      test.id,
      variantIdForCart,
      getAssignmentProofFromVariant(variant),
      getShippingTargetProductIdsForCartAttrs(test),
      null,
      null,
      null,
      { skipDomApply: lightweight }
    );
    if (_ripxCartAttributeState && typeof _ripxCartAttributeState === 'object') {
      _ripxCartAttributeState.__ripx_shipping_test = true;
      delete _ripxCartAttributeState._ripx_price_method;
      delete _ripxCartAttributeState._ripx_target_unit;
      delete _ripxCartAttributeState._ripx_discount_unit;
      delete _ripxCartAttributeState.__ripx_price_application_method;
    }
    if (assignmentKey) {
      _ripxShippingAssignmentKey = assignmentKey;
    }
    if (lightweight) {
      _ripxShippingPreviewHandoffDeferred = true;
      recordShippingDebugStep('shipping_assignment_deferred', {
        testId: test.id || null,
        variant: variantIdForCart,
        targetType: tt,
        reason: options.reason || 'lightweight_pdp',
      });
      return;
    }
    _ripxShippingPreviewHandoffDeferred = false;
    clearRipxPriceOnlyCartHints();
    recordShippingDebugStep('shipping_assignment_injected', {
      testId: test.id || null,
      variant: variantIdForCart,
      targetType: tt,
      targetProductIds: getShippingTargetProductIdsForCartAttrs(test),
      reason: options.reason || 'shipping-assignment',
    });
    if (options.skipCartSync) return;
    syncRipxCartLevelAttributes(options.reason || 'shipping-assignment');
    if (options.skipRepairBurst) return;
    scheduleRipxCartPropsRepairBurst(options.reason || 'shipping-assignment');
  }

  var OFFER_CODE_APPLY_STATE_KEY = '__ripx_offer_code_apply_v1__';
  function normalizeOfferCodeStateKey(codeName) {
    return String(codeName || '')
      .trim()
      .toUpperCase();
  }
  function readOfferCodeApplyState() {
    try {
      if (!window.sessionStorage) return {};
      var raw = window.sessionStorage.getItem(OFFER_CODE_APPLY_STATE_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }
  function writeOfferCodeApplyState(state) {
    try {
      if (!window.sessionStorage) return;
      window.sessionStorage.setItem(OFFER_CODE_APPLY_STATE_KEY, JSON.stringify(state || {}));
    } catch (e) {}
  }
  function hasOfferCodeApplyAttempted(codeName) {
    var key = normalizeOfferCodeStateKey(codeName);
    if (!key) return false;
    var state = readOfferCodeApplyState();
    return !!state[key];
  }
  function markOfferCodeApplyAttempt(codeName) {
    var key = normalizeOfferCodeStateKey(codeName);
    if (!key) return;
    var state = readOfferCodeApplyState();
    state[key] = 1;
    writeOfferCodeApplyState(state);
  }
  function hasMatchingDiscountParam(codeName) {
    var key = normalizeOfferCodeStateKey(codeName);
    if (!key) return false;
    try {
      var params = new URLSearchParams(window.location.search || '');
      var candidates = ['discount', 'discount_code', 'code'];
      for (var i = 0; i < candidates.length; i += 1) {
        var raw = params.get(candidates[i]);
        if (normalizeOfferCodeStateKey(raw) === key) return true;
      }
    } catch (e) {}
    return false;
  }
  function buildOfferCodeApplyUrl(codeName) {
    var code = String(codeName || '').trim();
    if (!code) return null;
    var redirectPath = (window.location.pathname || '/') + (window.location.search || '');
    return (
      '/discount/' + encodeURIComponent(code) + '?redirect=' + encodeURIComponent(redirectPath)
    );
  }
  function applyOfferCodeOnStorefront(codeName, options) {
    var opts = options && typeof options === 'object' ? options : {};
    var code = String(codeName || '').trim();
    if (!code || PREVIEW_MODE) return false;
    if (!opts.force && hasOfferCodeApplyAttempted(code)) return false;
    if (!opts.force && hasMatchingDiscountParam(code)) return false;
    var url = buildOfferCodeApplyUrl(code);
    if (!url) return false;
    markOfferCodeApplyAttempt(code);
    try {
      window.location.assign(url);
      return true;
    } catch (e) {
      return false;
    }
  }
  function copyOfferCodeNameToClipboard(codeName) {
    var code = String(codeName || '').trim();
    if (!code) return false;
    try {
      if (
        !navigator ||
        !navigator.clipboard ||
        typeof navigator.clipboard.writeText !== 'function'
      ) {
        return false;
      }
      navigator.clipboard.writeText(code).catch(function () {});
      return true;
    } catch (e) {
      return false;
    }
  }
  function getCartStateAppliedDiscountCodes(cartState) {
    var seen = {};
    var out = [];
    function pushCode(raw) {
      var token = normalizeOfferCodeStateKey(raw);
      if (!token || seen[token]) return;
      seen[token] = 1;
      out.push(token);
    }
    if (!cartState || typeof cartState !== 'object') return out;
    var topLevelCodes = Array.isArray(cartState.discount_codes) ? cartState.discount_codes : [];
    topLevelCodes.forEach(function (row) {
      if (row && typeof row === 'object') {
        pushCode(row.code || row.title || '');
      } else {
        pushCode(row);
      }
    });
    var levelApps = Array.isArray(cartState.cart_level_discount_applications)
      ? cartState.cart_level_discount_applications
      : [];
    levelApps.forEach(function (row) {
      if (!row || typeof row !== 'object') return;
      pushCode(row.code || row.title || '');
    });
    var items = Array.isArray(cartState.items) ? cartState.items : [];
    items.forEach(function (item) {
      var discounts = Array.isArray(item && item.discounts) ? item.discounts : [];
      discounts.forEach(function (row) {
        if (!row || typeof row !== 'object') return;
        pushCode(row.code || row.title || '');
      });
    });
    return out;
  }
  function cartStateHasOfferCodeApplied(cartState, codeName) {
    var key = normalizeOfferCodeStateKey(codeName);
    if (!key) return false;
    var codes = getCartStateAppliedDiscountCodes(cartState);
    return codes.indexOf(key) !== -1;
  }
  function getOfferCodeDiagnostics(codeName) {
    if (PREVIEW_MODE) {
      return { status: 'preview', label: 'Preview only' };
    }
    var cartState =
      _ripxCartNativeState && _ripxCartNativeState.cart ? _ripxCartNativeState.cart : null;
    if (cartStateHasOfferCodeApplied(cartState, codeName)) {
      return { status: 'applied', label: 'Applied' };
    }
    if (hasOfferCodeApplyAttempted(codeName)) {
      if (hasMatchingDiscountParam(codeName)) {
        return { status: 'failed', label: 'Not applied' };
      }
      return { status: 'pending', label: 'Pending check' };
    }
    return { status: 'generated', label: 'Generated' };
  }
  function getOfferCodeStatusStyles(status) {
    var s = String(status || '')
      .trim()
      .toLowerCase();
    if (s === 'applied') {
      return {
        background: 'rgba(22,163,74,0.16)',
        border: 'rgba(22,163,74,0.35)',
        color: '#166534',
      };
    }
    if (s === 'failed') {
      return {
        background: 'rgba(239,68,68,0.12)',
        border: 'rgba(239,68,68,0.35)',
        color: '#991b1b',
      };
    }
    if (s === 'pending') {
      return {
        background: 'rgba(234,179,8,0.14)',
        border: 'rgba(234,179,8,0.35)',
        color: '#854d0e',
      };
    }
    if (s === 'preview') {
      return {
        background: 'rgba(100,116,139,0.12)',
        border: 'rgba(100,116,139,0.3)',
        color: '#334155',
      };
    }
    return {
      background: 'rgba(100,116,139,0.08)',
      border: 'rgba(100,116,139,0.22)',
      color: '#334155',
    };
  }
  function getOfferCodeStatusHelpText(status) {
    var s = String(status || '')
      .trim()
      .toLowerCase();
    if (s === 'applied') return 'Applied: code is active in this cart.';
    if (s === 'pending')
      return 'Pending check: apply attempt made; waiting for cart state refresh.';
    if (s === 'failed') return 'Not applied: discount link loaded but cart has no matching code.';
    if (s === 'preview') return 'Preview only: no discount apply is attempted in preview mode.';
    return 'Generated: code exists and is ready to apply.';
  }
  function getOfferCodeStatusLegendText() {
    return 'Applied=green, Pending=amber, Not applied=red, Generated=gray, Preview=slate.';
  }
  function getOfferRuntimeParseMeta(config) {
    var cfg = config && typeof config === 'object' ? config : {};
    var discountType = normalizeOfferDiscountType(cfg);
    var numericValue = parseOfferDiscountValue(cfg);
    return {
      discountType: discountType || 'unknown',
      discountValue:
        isFinite(numericValue) && numericValue > 0 ? String(Math.abs(numericValue)) : 'n/a',
    };
  }

  function shouldShowOfferCodeOnCart(test) {
    if (!testTypeIsOffer(test)) return false;
    if (!(isCartSurface() || hasCartUiInDom())) return false;

    var tt = getNormalizedTargetType(test);
    if (!isProductScopeTargetType(tt)) return false;
    var cartIds = getCartVisibleProductTargetIds();
    if (!cartIds.length) return false;

    if (tt === 'all-products' || tt === 'all_products') {
      return cartIds.some(function (pid) {
        return !isExcludedProductForTest(test, pid);
      });
    }

    var ids =
      test.targetIds || (test.targetId || test.target_id ? [test.targetId || test.target_id] : []);
    if (!ids.length) return false;
    return cartIds.some(function (pid) {
      if (isExcludedProductForTest(test, pid)) return false;
      return ids.some(function (id) {
        return id && gidMatches(id, pid);
      });
    });
  }

  function shouldShowShippingTestOnCart(test) {
    if (!testTypeIsShipping(test)) return false;
    if (!(isCartSurface() || hasCartUiInDom())) return false;

    var tt = getNormalizedTargetType(test);
    if (!isProductScopeTargetType(tt)) return false;
    var cartIds = getCartVisibleProductTargetIds();
    if (!cartIds.length) return false;

    if (tt === 'all-products' || tt === 'all_products') {
      return cartIds.some(function (pid) {
        return !isExcludedProductForTest(test, pid);
      });
    }

    var ids =
      test.targetIds || (test.targetId || test.target_id ? [test.targetId || test.target_id] : []);
    if (!ids.length) return false;
    return cartIds.some(function (pid) {
      if (isExcludedProductForTest(test, pid)) return false;
      return ids.some(function (id) {
        return id && gidMatches(id, pid);
      });
    });
  }

  function clearOfferCodeNotices() {
    try {
      var existing = document.querySelector('[data-ripx-offer-code-container]');
      if (existing && existing.parentNode) {
        existing.parentNode.removeChild(existing);
      }
    } catch (e) {}
  }

  function getOfferCodeNoticeContainer() {
    try {
      var existing = document.querySelector('[data-ripx-offer-code-container]');
      if (existing) return existing;
      var mount =
        document.querySelector(
          '[data-ripx-native-cart-block], .cart__footer, .cart-footer, form[action*="/cart"], .cart__contents, .cart-drawer__footer, .drawer--cart, aside.mini-cart'
        ) || null;
      if (!mount) return null;
      var container = document.createElement('div');
      container.setAttribute('data-ripx-offer-code-container', '1');
      container.style.margin = '12px 0';
      container.style.padding = '10px 12px';
      container.style.borderRadius = '10px';
      container.style.border = '1px solid rgba(232,93,4,0.32)';
      container.style.background = 'rgba(232,93,4,0.08)';
      var legend = document.createElement('div');
      legend.setAttribute('data-ripx-offer-code-legend', '1');
      legend.style.fontSize = '10px';
      legend.style.color = '#334155';
      legend.style.opacity = '0.9';
      legend.style.marginBottom = '6px';
      legend.textContent = getOfferCodeStatusLegendText();
      container.appendChild(legend);
      if (mount.firstChild) mount.insertBefore(container, mount.firstChild);
      else mount.appendChild(container);
      return container;
    } catch (e) {
      return null;
    }
  }

  function upsertOfferCodeNotice(test, variant, options) {
    var opts = options && typeof options === 'object' ? options : {};
    if (!shouldShowOfferCodeOnCart(test) || !variant) return;
    if (!isActionableOfferConfig(variant.config)) return;
    var codeInfo = resolveOfferCodeForVariant(test, variant);
    var codeName = codeInfo.codeName;
    if (!codeName) return;

    var container = getOfferCodeNoticeContainer();
    if (!container) return;
    var testId = String((test && test.id) || '');
    if (!testId) return;

    var row = null;
    var rows = container.querySelectorAll('[data-ripx-offer-code-test]');
    Array.prototype.forEach.call(rows, function (node) {
      if (row) return;
      if (String(node.getAttribute('data-ripx-offer-code-test') || '') === testId) {
        row = node;
      }
    });

    if (!row) {
      row = document.createElement('div');
      row.setAttribute('data-ripx-offer-code-test', testId);
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.justifyContent = 'space-between';
      row.style.gap = '8px';
      row.style.flexWrap = 'wrap';
      row.style.margin = '4px 0';
      container.appendChild(row);
    }

    var label =
      'Offer code (' + String(variant.variantName || variant.name || 'Variant').trim() + '):';
    row.textContent = '';
    row.style.alignItems = 'flex-start';
    var left = document.createElement('span');
    left.style.fontSize = '12px';
    left.style.color = '#0f172a';
    left.textContent = label;
    var rightWrap = document.createElement('div');
    rightWrap.style.display = 'flex';
    rightWrap.style.alignItems = 'center';
    rightWrap.style.gap = '8px';
    rightWrap.style.flexWrap = 'wrap';
    var right = document.createElement('strong');
    right.style.fontSize = '12px';
    right.style.letterSpacing = '0.04em';
    right.textContent = codeName;
    rightWrap.appendChild(right);
    var sourceBadge = document.createElement('span');
    sourceBadge.style.fontSize = '10px';
    sourceBadge.style.padding = '2px 6px';
    sourceBadge.style.borderRadius = '999px';
    sourceBadge.style.border = '1px solid rgba(100,116,139,0.22)';
    sourceBadge.style.background = 'rgba(100,116,139,0.08)';
    sourceBadge.style.color = '#334155';
    sourceBadge.textContent =
      'src: ' + String(codeInfo.sourceKey === 'auto' ? 'auto' : codeInfo.sourceKey);
    sourceBadge.title = 'Code source: ' + String(codeInfo.sourceLabel || 'auto-generated');
    rightWrap.appendChild(sourceBadge);
    var diag = getOfferCodeDiagnostics(codeName);
    var parseMeta = getOfferRuntimeParseMeta(variant.config);
    var diagStyle = getOfferCodeStatusStyles(diag.status);
    var statusBadge = document.createElement('span');
    statusBadge.style.fontSize = '10px';
    statusBadge.style.padding = '2px 6px';
    statusBadge.style.borderRadius = '999px';
    statusBadge.style.border = '1px solid ' + String(diagStyle.border || 'rgba(100,116,139,0.22)');
    statusBadge.style.background = String(diagStyle.background || 'rgba(100,116,139,0.08)');
    statusBadge.style.color = String(diagStyle.color || '#334155');
    statusBadge.textContent = String(diag.label || 'Generated');
    statusBadge.title =
      getOfferCodeStatusHelpText(diag.status) +
      ' Source: ' +
      String(codeInfo.sourceLabel || 'auto-generated') +
      '. Parsed: ' +
      String(parseMeta.discountType) +
      '/' +
      String(parseMeta.discountValue) +
      '. ' +
      getOfferCodeStatusLegendText();
    rightWrap.appendChild(statusBadge);
    if (DEBUG) {
      var parseBadge = document.createElement('span');
      parseBadge.style.fontSize = '10px';
      parseBadge.style.padding = '2px 6px';
      parseBadge.style.borderRadius = '999px';
      parseBadge.style.border = '1px dashed rgba(15,23,42,0.25)';
      parseBadge.style.background = 'rgba(255,255,255,0.65)';
      parseBadge.style.color = '#1e293b';
      parseBadge.textContent =
        'cfg: ' + String(parseMeta.discountType) + '/' + String(parseMeta.discountValue);
      parseBadge.title =
        'Runtime offer parse (debug): type=' +
        String(parseMeta.discountType) +
        ', value=' +
        String(parseMeta.discountValue);
      rightWrap.appendChild(parseBadge);
    }
    row.setAttribute('data-ripx-offer-code-status', String(diag.status || 'generated'));
    row.setAttribute('data-ripx-offer-code-source', String(codeInfo.sourceKey || 'auto'));
    if (isCartSurface()) {
      var applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.style.fontSize = '11px';
      applyBtn.style.padding = '4px 8px';
      applyBtn.style.borderRadius = '8px';
      applyBtn.style.border = '1px solid rgba(15,23,42,0.2)';
      applyBtn.style.background = '#fff';
      applyBtn.style.cursor = 'pointer';
      applyBtn.textContent = 'Apply';
      applyBtn.addEventListener('click', function () {
        applyOfferCodeOnStorefront(codeName, { force: true });
      });
      rightWrap.appendChild(applyBtn);
    }
    var copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.style.fontSize = '11px';
    copyBtn.style.padding = '4px 8px';
    copyBtn.style.borderRadius = '8px';
    copyBtn.style.border = '1px solid rgba(15,23,42,0.2)';
    copyBtn.style.background = '#fff';
    copyBtn.style.cursor = 'pointer';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', function () {
      copyOfferCodeNameToClipboard(codeName);
    });
    rightWrap.appendChild(copyBtn);
    row.appendChild(left);
    row.appendChild(rightWrap);

    if (isCartSurface() && !opts.skipStatusRefresh) {
      fetchRipxCartNativeState().then(function () {
        upsertOfferCodeNotice(test, variant, { skipStatusRefresh: true, skipAutoApply: true });
      });
    }
    if (isCartSurface() && !opts.skipAutoApply) {
      applyOfferCodeOnStorefront(codeName, { force: false });
    }
  }

  /**
   * Check if current page matches test target (single or multiple); supports product and collection.
   */
  function matchesTarget(test) {
    var ids =
      test.targetIds || (test.targetId || test.target_id ? [test.targetId || test.target_id] : []);
    if (!ids.length) return true;

    var targetType = getNormalizedTargetType(test);
    var current = null;
    if (isProductScopeTargetType(targetType)) {
      current = getCurrentProductId();
      if (current && isExcludedProductForTest(test, current)) return false;
    } else if (targetType === 'collection') {
      current = getCurrentCollectionId();
    } else {
      current = getCurrentTargetId();
    }
    if (!current) return false;
    return ids.some(function (id) {
      return id && gidMatches(id, current);
    });
  }

  /**
   * Collection GIDs linked to the current PDP product (theme Product JSON / meta). Empty if unknown.
   */
  function getCollectionGidsLinkedToCurrentProduct() {
    var out = [];
    function pushUnique(g) {
      if (!g) return;
      var i = 0;
      for (; i < out.length; i++) {
        if (gidMatches(out[i], g)) return;
      }
      out.push(g);
    }
    try {
      var script = document.querySelector(
        '#ProductJson, script[type="application/json"][data-product-json], script[data-section-type="product"]'
      );
      if (script && script.textContent) {
        var data = JSON.parse(script.textContent);
        var cols = data.collections || (data.product && data.product.collections);
        if (Array.isArray(cols)) {
          cols.forEach(function (c) {
            if (c == null) return;
            if (typeof c === 'number' || typeof c === 'string') pushUnique(toCollectionGid(c));
            else if (typeof c === 'object' && c.id != null) pushUnique(toCollectionGid(c.id));
          });
        }
      }
    } catch (e) {}
    try {
      var p =
        window.ShopifyAnalytics &&
        window.ShopifyAnalytics.meta &&
        window.ShopifyAnalytics.meta.product;
      if (p && p.collectionId) pushUnique(toCollectionGid(p.collectionId));
    } catch (e2) {}
    return out;
  }

  /**
   * True if current product (PDP) belongs to any of the test's target collections.
   */
  function productBelongsToPriceTestCollections(collectionTargetIds) {
    if (!collectionTargetIds || !collectionTargetIds.length) return false;
    var onProduct = getCollectionGidsLinkedToCurrentProduct();
    if (!onProduct.length) return false;
    return collectionTargetIds.some(function (tid) {
      if (!tid) return false;
      return onProduct.some(function (c) {
        return gidMatches(tid, c);
      });
    });
  }

  /**
   * Whether this test's storefront logic should run (target match, product cards on listings, or collection test on PDP with product-in-collection data).
   */
  function shouldRunPriceTestOnCurrentPage(test) {
    if (!test) return false;
    if (matchesTarget(test)) return true;
    if (testTypeIsOffer(test) && shouldShowOfferCodeOnCart(test)) return true;
    if (testTypeIsShipping(test) && shouldShowShippingTestOnCart(test)) return true;
    if (shouldRunPriceTestOnListingSurface(test)) return true;
    if (shouldRunShippingTestOnListingSurface(test)) return true;
    if (testTypeIsPrice(test) || testTypeIsShipping(test)) {
      var tt = getNormalizedTargetType(test);
      if (isProductScopeTargetType(tt) && isCartSurface()) {
        return true;
      }
      if (testTypeIsPrice(test) && tt === 'collection' && getCurrentProductId()) {
        var cids =
          test.targetIds ||
          (test.targetId || test.target_id ? [test.targetId || test.target_id] : []);
        if (productBelongsToPriceTestCollections(cids)) return true;
      }
    }
    // Preview: run price pipeline on listings/cart so target cards still paint. For
    // product-targeted tests, only match the targeted PDP — never every product page
    // (that painted one arm price site-wide during sticky preview).
    if (
      PREVIEW_TEST_CONTEXT &&
      (testTypeIsPrice(test) || testTypeIsShipping(test)) &&
      isProductScopeTargetType(getNormalizedTargetType(test))
    ) {
      var ttPv = getNormalizedTargetType(test);
      if (ttPv === 'all-products' || ttPv === 'all_products') {
        return true;
      }
      if (isProductListingSurface()) return true;
      if (isCartSurface()) return true;
      var pathPv = getEffectivePreviewPathname();
      if (pathPv.indexOf('/products/') !== -1 && pathPv.length > '/products/'.length + 1) {
        return matchesTarget(test);
      }
    }
    return false;
  }

  /**
   * Heatmap: buffer and flush click/scroll events
   */
  const heatmapBuffer = [];
  const HEATMAP_FLUSH_INTERVAL = 10000;
  const HEATMAP_CAPTURE_VERSION = 'full-page-v2';

  function getHeatmapCollectionConfig() {
    var config = CONFIG.heatmapCollection || {};
    var sampleRate = Number(config.sampleRate);
    if (!Number.isFinite(sampleRate)) sampleRate = 1;
    return {
      enabled: config.enabled !== false,
      sampleRate: Math.max(0, Math.min(1, sampleRate)),
    };
  }

  const HEATMAP_COLLECTION_CONFIG = getHeatmapCollectionConfig();
  const HEATMAP_SESSION_INCLUDED = Math.random() < HEATMAP_COLLECTION_CONFIG.sampleRate;

  function shouldCollectHeatmap() {
    return (
      hasValidConfig &&
      !PREVIEW_MODE &&
      HEATMAP_COLLECTION_CONFIG.enabled &&
      HEATMAP_SESSION_INCLUDED
    );
  }

  function clampHeatmapValue(value, min, max) {
    var numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return Math.max(min, Math.min(max, numeric));
  }

  function getHeatmapViewportDimensions() {
    return {
      width: Math.max(0, Number(window.innerWidth) || 0),
      height: Math.max(0, Number(window.innerHeight) || 0),
    };
  }

  function hasLikelyScrollableContainer() {
    try {
      var nodes = document.querySelectorAll('body *');
      var limit = Math.min(nodes.length, 250);
      for (var i = 0; i < limit; i += 1) {
        var node = nodes[i];
        var style = window.getComputedStyle ? window.getComputedStyle(node) : null;
        if (!style) continue;
        var overflowY = String(style.overflowY || '').toLowerCase();
        if (
          (overflowY === 'auto' || overflowY === 'scroll') &&
          node.scrollHeight > node.clientHeight + 80
        ) {
          return true;
        }
      }
    } catch (_eScrollable) {}
    return false;
  }

  function getHeatmapPageDimensions() {
    var doc = document.documentElement || {};
    var body = document.body || {};
    var viewport = getHeatmapViewportDimensions();
    var widthCandidates = [
      Number(doc.scrollWidth) || 0,
      Number(body.scrollWidth) || 0,
      Number(doc.offsetWidth) || 0,
      Number(body.offsetWidth) || 0,
      viewport.width,
    ];
    var heightCandidates = [
      Number(doc.scrollHeight) || 0,
      Number(body.scrollHeight) || 0,
      Number(doc.offsetHeight) || 0,
      Number(body.offsetHeight) || 0,
      viewport.height,
    ];
    var width = Math.max.apply(Math, widthCandidates);
    var height = Math.max.apply(Math, heightCandidates);
    return {
      width: width,
      height: height,
      heightSource:
        height === (Number(doc.scrollHeight) || 0)
          ? 'document'
          : height === (Number(body.scrollHeight) || 0)
            ? 'body'
            : 'fallback',
      scrollContainerDetected: hasLikelyScrollableContainer(),
    };
  }

  function captureHeatmapEvent(testId, variantId, eventType, data) {
    if (!shouldCollectHeatmap()) return;
    var viewport = getHeatmapViewportDimensions();
    heatmapBuffer.push({
      test_id: testId,
      variant_id: variantId,
      page_url: window.location.href,
      event_type: eventType,
      device: getDeviceType(),
      country: getCountryCode(),
      viewport_width: viewport.width || null,
      viewport_height: viewport.height || null,
      capture_version: HEATMAP_CAPTURE_VERSION,
      ...data,
    });
  }

  function flushHeatmap(sync) {
    if (heatmapBuffer.length === 0) return;
    const events = heatmapBuffer.splice(0, heatmapBuffer.length);
    const shopDomain = getShopDomain();
    const body = JSON.stringify({
      shop_domain: shopDomain,
      site: !shopDomain ? window.location.hostname : null,
      events,
    });

    if (sync && navigator.sendBeacon) {
      var beaconBody =
        typeof Blob === 'function' ? new Blob([body], { type: 'application/json' }) : body;
      navigator.sendBeacon(`${CONFIG.apiUrl}/track/heatmap`, beaconBody);
    } else {
      fetch(`${CONFIG.apiUrl}/track/heatmap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }).catch(function () {});
    }
  }

  function initHeatmap() {
    if (!shouldCollectHeatmap()) return;

    getVariantCachePromise().then(function (cache) {
      const pageUrl = window.location.href;

      document.addEventListener(
        'click',
        function (e) {
          if (!hasConsent()) return;
          const viewport = getHeatmapViewportDimensions();
          if (!viewport.width || !viewport.height) return;
          const pageDimensions = getHeatmapPageDimensions();
          if (!pageDimensions.width || !pageDimensions.height) return;
          const x = clampHeatmapValue((e.clientX / viewport.width) * 100, 0, 100);
          const y = clampHeatmapValue((e.clientY / viewport.height) * 100, 0, 100);
          const pageX = clampHeatmapValue(e.pageX, 0, pageDimensions.width);
          const pageY = clampHeatmapValue(e.pageY, 0, pageDimensions.height);
          CONFIG.activeTests.forEach(function (test) {
            if (!matchesTarget(test)) return;
            const v = cache[test.id];
            if (!v || !v.variantId) return;
            captureHeatmapEvent(test.id, v.variantId, 'click', {
              x,
              y,
              page_x: pageX,
              page_y: pageY,
              page_width: pageDimensions.width,
              page_height: pageDimensions.height,
              page_height_source: pageDimensions.heightSource,
              scroll_container_detected: pageDimensions.scrollContainerDetected,
            });
          });
        },
        true
      );

      var scrollThrottle = null;
      window.addEventListener(
        'scroll',
        function () {
          if (!hasConsent()) return;
          if (scrollThrottle) return;
          scrollThrottle = setTimeout(function () {
            scrollThrottle = null;
            const viewport = getHeatmapViewportDimensions();
            const pageDimensions = getHeatmapPageDimensions();
            if (!viewport.height || !pageDimensions.height) return;
            const depth = clampHeatmapValue(
              ((window.scrollY + viewport.height) / pageDimensions.height) * 100,
              0,
              100
            );
            CONFIG.activeTests.forEach(function (test) {
              if (!matchesTarget(test)) return;
              const v = cache[test.id];
              if (!v || !v.variantId) return;
              captureHeatmapEvent(test.id, v.variantId, 'scroll', {
                scroll_depth: depth,
                page_width: pageDimensions.width,
                page_height: pageDimensions.height,
                page_height_source: pageDimensions.heightSource,
                scroll_container_detected: pageDimensions.scrollContainerDetected,
              });
            });
          }, 200);
        },
        { passive: true }
      );
    });

    setInterval(function () {
      flushHeatmap(false);
    }, HEATMAP_FLUSH_INTERVAL);

    window.addEventListener('beforeunload', function () {
      flushHeatmap(true);
    });
  }

  function installPreviewDebugFloatingPanel() {
    if (!PREVIEW_MODE) return;
    if (typeof document === 'undefined') return;
    if (document.getElementById('ripx-preview-debug-fab')) return;
    if (!document.body) return;
    var PANEL_STATE_KEY = '__ripx_preview_debug_panel_state_v1__';

    function readPanelState() {
      try {
        if (!window.sessionStorage) return {};
        var raw = window.sessionStorage.getItem(PANEL_STATE_KEY);
        if (!raw) return {};
        var parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch (e) {
        return {};
      }
    }

    function writePanelState(next) {
      try {
        if (!window.sessionStorage) return;
        window.sessionStorage.setItem(PANEL_STATE_KEY, JSON.stringify(next || {}));
      } catch (e) {}
    }

    var fab = document.createElement('button');
    fab.id = 'ripx-preview-debug-fab';
    fab.type = 'button';
    fab.textContent = 'RipX QA';
    fab.style.position = 'fixed';
    fab.style.right = '16px';
    fab.style.bottom = '16px';
    fab.style.zIndex = '2147483646';
    fab.style.border = '1px solid rgba(255,255,255,0.35)';
    fab.style.background = 'linear-gradient(135deg, #0f172a 0%, #1f2937 100%)';
    fab.style.color = '#ffffff';
    fab.style.borderRadius = '999px';
    fab.style.padding = '9px 14px';
    fab.style.fontSize = '12px';
    fab.style.fontWeight = '600';
    fab.style.letterSpacing = '0.2px';
    fab.style.cursor = 'pointer';
    fab.style.boxShadow = '0 8px 22px rgba(2,6,23,0.4)';

    var panel = document.createElement('div');
    panel.id = 'ripx-preview-debug-panel';
    panel.style.position = 'fixed';
    panel.style.right = '16px';
    panel.style.bottom = '58px';
    panel.style.width = '420px';
    panel.style.maxWidth = 'calc(100vw - 24px)';
    panel.style.maxHeight = '68vh';
    panel.style.overflow = 'auto';
    panel.style.zIndex = '2147483646';
    panel.style.background = '#ffffff';
    panel.style.color = '#0f172a';
    panel.style.border = '1px solid rgba(15,23,42,0.14)';
    panel.style.borderRadius = '14px';
    panel.style.boxShadow = '0 18px 40px rgba(15,23,42,0.24)';
    panel.style.padding = '12px';
    panel.style.display = 'none';
    panel.style.backdropFilter = 'blur(4px)';

    var header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.gap = '10px';
    header.style.marginBottom = '10px';

    var titleWrap = document.createElement('div');
    var title = document.createElement('div');
    title.style.fontWeight = '700';
    title.style.fontSize = '14px';
    title.textContent = 'RipX Preview Console';
    var subtitle = document.createElement('div');
    subtitle.style.fontSize = '11px';
    subtitle.style.color = '#475569';
    subtitle.textContent = 'Preview diagnostics for bucketing, attributes, and cart';
    titleWrap.appendChild(title);
    titleWrap.appendChild(subtitle);

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.style.border = '1px solid rgba(15,23,42,0.15)';
    closeBtn.style.background = '#fff';
    closeBtn.style.color = '#0f172a';
    closeBtn.style.borderRadius = '8px';
    closeBtn.style.padding = '4px 8px';
    closeBtn.style.fontSize = '12px';
    closeBtn.style.cursor = 'pointer';

    header.appendChild(titleWrap);
    header.appendChild(closeBtn);

    var badges = document.createElement('div');
    badges.style.display = 'flex';
    badges.style.gap = '6px';
    badges.style.flexWrap = 'wrap';
    badges.style.marginBottom = '10px';

    function makeBadge(label, tone) {
      var b = document.createElement('span');
      b.textContent = label;
      b.style.display = 'inline-flex';
      b.style.alignItems = 'center';
      b.style.padding = '3px 8px';
      b.style.borderRadius = '999px';
      b.style.fontSize = '11px';
      b.style.fontWeight = '600';
      b.style.border = '1px solid rgba(15,23,42,0.12)';
      if (tone === 'success') {
        b.style.background = 'rgba(22,163,74,0.12)';
        b.style.color = '#166534';
      } else if (tone === 'warning') {
        b.style.background = 'rgba(245,158,11,0.15)';
        b.style.color = '#92400e';
      } else {
        b.style.background = 'rgba(232,93,4,0.12)';
        b.style.color = '#0c4a6e';
      }
      return b;
    }

    var details = document.createElement('pre');
    details.style.margin = '0';
    details.style.padding = '10px';
    details.style.borderRadius = '8px';
    details.style.background = '#f8fafc';
    details.style.border = '1px solid rgba(15,23,42,0.1)';
    details.style.fontSize = '11px';
    details.style.whiteSpace = 'pre-wrap';
    details.style.wordBreak = 'break-word';

    var cartDetails = document.createElement('pre');
    cartDetails.style.margin = '0';
    cartDetails.style.padding = '10px';
    cartDetails.style.borderRadius = '8px';
    cartDetails.style.background = '#f8fafc';
    cartDetails.style.border = '1px solid rgba(15,23,42,0.1)';
    cartDetails.style.fontSize = '11px';
    cartDetails.style.whiteSpace = 'pre-wrap';
    cartDetails.style.wordBreak = 'break-word';
    cartDetails.textContent = 'Run "Check cart props" to inspect current /cart.js line properties.';

    var healthDetails = document.createElement('pre');
    healthDetails.style.margin = '0';
    healthDetails.style.padding = '10px';
    healthDetails.style.borderRadius = '8px';
    healthDetails.style.background = '#f8fafc';
    healthDetails.style.border = '1px solid rgba(15,23,42,0.1)';
    healthDetails.style.fontSize = '11px';
    healthDetails.style.whiteSpace = 'pre-wrap';
    healthDetails.style.wordBreak = 'break-word';
    healthDetails.textContent = 'Run "Preview health" to fetch one-shot readiness diagnostics.';

    function makeSection(titleText, bodyNode) {
      var wrap = document.createElement('div');
      wrap.style.marginBottom = '10px';
      var t = document.createElement('div');
      t.textContent = titleText;
      t.style.fontSize = '12px';
      t.style.fontWeight = '600';
      t.style.marginBottom = '6px';
      t.style.color = '#334155';
      wrap.appendChild(t);
      wrap.appendChild(bodyNode);
      return wrap;
    }

    var snippet = document.createElement('pre');
    snippet.style.margin = '0';
    snippet.style.padding = '8px';
    snippet.style.borderRadius = '8px';
    snippet.style.background = '#f8fafc';
    snippet.style.border = '1px solid rgba(15,23,42,0.1)';
    snippet.style.fontSize = '11px';
    snippet.style.whiteSpace = 'pre-wrap';
    snippet.style.wordBreak = 'break-word';
    snippet.textContent = [
      'RipX.printDebugGuide()',
      'RipX.debugTrace()',
      'RipX.debugStatus()',
      'RipX.debugPaintStats()',
      'RipX.debugCart()',
      'document.querySelectorAll(\'[data-ripx-price="1"]\').length',
      'window.__RIPX_TRACE_STEPS__',
      'window.__RIPX_PRICE_TEST_CTX__',
    ].join('\n');

    var actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '8px';
    actions.style.marginTop = '8px';
    actions.style.flexWrap = 'wrap';

    var refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.textContent = 'Refresh';
    refreshBtn.style.border = '1px solid rgba(15,23,42,0.2)';
    refreshBtn.style.background = '#fff';
    refreshBtn.style.borderRadius = '6px';
    refreshBtn.style.padding = '6px 8px';
    refreshBtn.style.fontSize = '12px';
    refreshBtn.style.cursor = 'pointer';

    var copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copy checks';
    copyBtn.style.border = '1px solid rgba(15,23,42,0.2)';
    copyBtn.style.background = '#fff';
    copyBtn.style.borderRadius = '6px';
    copyBtn.style.padding = '6px 8px';
    copyBtn.style.fontSize = '12px';
    copyBtn.style.cursor = 'pointer';

    var runAllBtn = document.createElement('button');
    runAllBtn.type = 'button';
    runAllBtn.textContent = 'Run all checks';
    runAllBtn.style.border = '1px solid rgba(15,23,42,0.2)';
    runAllBtn.style.background = '#0f172a';
    runAllBtn.style.color = '#fff';
    runAllBtn.style.borderRadius = '6px';
    runAllBtn.style.padding = '6px 10px';
    runAllBtn.style.fontSize = '12px';
    runAllBtn.style.cursor = 'pointer';

    var runHealthBtn = document.createElement('button');
    runHealthBtn.type = 'button';
    runHealthBtn.textContent = 'Preview health';
    runHealthBtn.style.border = '1px solid rgba(15,23,42,0.2)';
    runHealthBtn.style.background = '#fff';
    runHealthBtn.style.borderRadius = '6px';
    runHealthBtn.style.padding = '6px 8px';
    runHealthBtn.style.fontSize = '12px';
    runHealthBtn.style.cursor = 'pointer';

    var runDebugBtn = document.createElement('button');
    runDebugBtn.type = 'button';
    runDebugBtn.textContent = 'Run debugStatus';
    runDebugBtn.style.border = '1px solid rgba(15,23,42,0.2)';
    runDebugBtn.style.background = '#fff';
    runDebugBtn.style.borderRadius = '6px';
    runDebugBtn.style.padding = '6px 8px';
    runDebugBtn.style.fontSize = '12px';
    runDebugBtn.style.cursor = 'pointer';

    var runCartBtn = document.createElement('button');
    runCartBtn.type = 'button';
    runCartBtn.textContent = 'Check cart props';
    runCartBtn.style.border = '1px solid rgba(15,23,42,0.2)';
    runCartBtn.style.background = '#fff';
    runCartBtn.style.borderRadius = '6px';
    runCartBtn.style.padding = '6px 8px';
    runCartBtn.style.fontSize = '12px';
    runCartBtn.style.cursor = 'pointer';

    var runTraceBtn = document.createElement('button');
    runTraceBtn.type = 'button';
    runTraceBtn.textContent = 'Dump trace';
    runTraceBtn.style.border = '1px solid rgba(15,23,42,0.2)';
    runTraceBtn.style.background = '#fff';
    runTraceBtn.style.borderRadius = '6px';
    runTraceBtn.style.padding = '6px 8px';
    runTraceBtn.style.fontSize = '12px';
    runTraceBtn.style.cursor = 'pointer';

    function renderBadges() {
      badges.innerHTML = '';
      var hasCtx = !!(window.__RIPX_PRICE_TEST_CTX__ && window.__RIPX_PRICE_TEST_CTX__.testId);
      var hasAttrs = !!(_ripxCartAttributeState && _ripxCartAttributeState._ripx_price_test);
      var hasVariant = !!(PREVIEW_VARIANT_ID || PREVIEW_VARIANT_NAME);
      var paintCount = 0;
      try {
        paintCount = document.querySelectorAll('[data-ripx-price="1"]').length;
      } catch (_ePc) {}
      badges.appendChild(
        makeBadge(hasCtx ? 'Context: ready' : 'Context: missing', hasCtx ? 'success' : 'warning')
      );
      badges.appendChild(
        makeBadge(
          hasAttrs ? 'Cart attrs: ready' : 'Cart attrs: pending',
          hasAttrs ? 'success' : 'warning'
        )
      );
      badges.appendChild(
        makeBadge(
          hasVariant ? 'Variant: selected' : 'Variant: unknown',
          hasVariant ? 'info' : 'warning'
        )
      );
      badges.appendChild(
        makeBadge(
          paintCount > 0 ? 'Paint: ' + paintCount : 'Paint: 0',
          paintCount > 0 ? 'success' : 'warning'
        )
      );
    }

    function refreshDetails() {
      var ctx = window.__RIPX_PRICE_TEST_CTX__ || null;
      var attr = _ripxCartAttributeState
        ? {
            priceTest: _ripxCartAttributeState._ripx_price_test || null,
            variant: _ripxCartAttributeState._ripx_variant || null,
            shop: _ripxCartAttributeState._ripx_shop || null,
            priceMethod: _ripxCartAttributeState._ripx_price_method || null,
          }
        : null;
      var payload = {
        version: SCRIPT_VERSION,
        previewMode: PREVIEW_MODE,
        testId: PREVIEW_TEST_ID || null,
        variantId: PREVIEW_VARIANT_ID || null,
        variantName: PREVIEW_VARIANT_NAME || null,
        context: ctx,
        cartAttrs: attr,
      };
      renderBadges();
      details.textContent = JSON.stringify(payload, null, 2);
    }

    function runPreviewHealthCheck() {
      if (!CONFIG.apiUrl) {
        healthDetails.textContent = 'preview-health unavailable: apiUrl missing in runtime config.';
        return;
      }
      if (!PREVIEW_TEST_ID) {
        healthDetails.textContent = 'preview-health unavailable: ab_preview_test is missing.';
        return;
      }
      healthDetails.textContent = 'Running preview-health...';
      var hp = new URLSearchParams();
      hp.set('test_id', String(PREVIEW_TEST_ID));
      appendTrackTenantParams(hp);
      if (PREVIEW_VARIANT_ID) hp.set('variant_id', String(PREVIEW_VARIANT_ID));
      if (PREVIEW_VARIANT_NAME) hp.set('variant_name', String(PREVIEW_VARIANT_NAME));
      var uid = getUserId();
      if (uid) hp.set('user_id', String(uid));
      fetchWithTimeout(
        CONFIG.apiUrl + '/track/preview-health?' + hp.toString(),
        { method: 'GET' },
        8000
      )
        .then(function (r) {
          return r.ok ? r.json() : Promise.resolve({ success: false, status: r.status });
        })
        .then(function (out) {
          var summary = {
            success: !!out.success,
            score: out && out.health ? out.health.score : null,
            level: out && out.health ? out.health.level : null,
            preview: out && out.preview ? out.preview : null,
            checks: out && out.health ? out.health.checks || [] : [],
            error: out && out.error ? out.error : null,
          };
          healthDetails.textContent = JSON.stringify(summary, null, 2);
        })
        .catch(function (err) {
          healthDetails.textContent =
            'preview-health failed: ' + (err && (err.message || String(err)));
        });
    }

    refreshBtn.addEventListener('click', refreshDetails);
    copyBtn.addEventListener('click', function () {
      var txt = snippet.textContent || '';
      if (!navigator || !navigator.clipboard || !navigator.clipboard.writeText) return;
      navigator.clipboard.writeText(txt).catch(function () {});
    });
    runDebugBtn.addEventListener('click', function () {
      if (!window.RipX || typeof window.RipX.debugStatus !== 'function') return;
      details.textContent = 'Running debugStatus...';
      renderBadges();
      window.RipX.debugStatus()
        .then(function (out) {
          var summary = {
            version: out && out.version ? out.version : SCRIPT_VERSION,
            preview: out && out.preview ? out.preview : null,
            requestedTestId: out ? out.requestedTestId : null,
            variant:
              out && out.variant
                ? {
                    id: out.variant.variantId || out.variant.id || null,
                    name: out.variant.variantName || out.variant.name || null,
                  }
                : null,
            cartAttrs: out && out.diagnostics ? out.diagnostics.cartAttributeState || null : null,
            network: out && out.network ? out.network : null,
          };
          renderBadges();
          details.textContent = JSON.stringify(summary, null, 2);
        })
        .catch(function (err) {
          details.textContent = 'debugStatus failed: ' + (err && (err.message || String(err)));
        });
    });
    runCartBtn.addEventListener('click', function () {
      cartDetails.textContent = 'Checking /cart.js ...';
      fetch('/cart.js', { method: 'GET' })
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .then(function (cart) {
          if (!cart || !Array.isArray(cart.items)) {
            cartDetails.textContent = 'cart.js unavailable or empty.';
            return;
          }
          var rows = cart.items.map(function (item) {
            return {
              title: item && item.title ? item.title : null,
              variant_id: item ? item.variant_id : null,
              properties: item && item.properties ? item.properties : {},
            };
          });
          cartDetails.textContent = JSON.stringify({ items: rows }, null, 2);
        })
        .catch(function (err) {
          cartDetails.textContent =
            'cart.js check failed: ' + (err && (err.message || String(err)));
        });
    });
    runTraceBtn.addEventListener('click', function () {
      var snap = dumpRipxTrace({ log: true });
      details.textContent = JSON.stringify(
        {
          focusProductId: snap.previewFocusProductId,
          stepCount: snap.steps.length,
          last: snap.last,
          steps: snap.steps.slice(-20),
          guide: RIPX_DEBUG_GUIDE_LINES,
        },
        null,
        2
      );
      renderBadges();
    });
    runAllBtn.addEventListener('click', function () {
      runPreviewHealthCheck();
      runDebugBtn.click();
      runCartBtn.click();
      runTraceBtn.click();
    });
    runHealthBtn.addEventListener('click', runPreviewHealthCheck);
    fab.addEventListener('click', function () {
      var open = panel.style.display === 'block';
      panel.style.display = open ? 'none' : 'block';
      writePanelState({ open: !open });
      if (!open) runAllBtn.click();
    });
    closeBtn.addEventListener('click', function () {
      panel.style.display = 'none';
      writePanelState({ open: false });
    });

    panel.appendChild(header);
    panel.appendChild(badges);
    panel.appendChild(makeSection('Preview health', healthDetails));
    panel.appendChild(makeSection('Preview state', details));
    panel.appendChild(makeSection('Cart line properties', cartDetails));
    panel.appendChild(makeSection('Quick checks', snippet));
    actions.appendChild(refreshBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(runAllBtn);
    actions.appendChild(runHealthBtn);
    actions.appendChild(runDebugBtn);
    actions.appendChild(runCartBtn);
    actions.appendChild(runTraceBtn);
    panel.appendChild(actions);
    document.body.appendChild(panel);
    document.body.appendChild(fab);
    var persisted = readPanelState();
    if (persisted && persisted.open) {
      panel.style.display = 'block';
      runAllBtn.click();
    } else {
      refreshDetails();
    }
  }

  /**
   * Initialize on page load
   */
  function init() {
    if (_ripxInitStarted) return;
    _ripxInitStarted = true;
    if (PREVIEW_DOCUMENT_PROXY) {
      installPreviewDocumentProxyNavigation();
    }
    if (PREVIEW_SIMPLE_MODE) {
      installSimplePreviewSessionPersistence();
    }
    if (VISUAL_PICKER_ACTIVE) {
      initVisualPicker();
    }
    function run() {
      persistRipxLiveDiagnostics('runtime_init', {
        activeTestsCount: (CONFIG.activeTests || []).length,
        previewMode: PREVIEW_MODE,
        validConfig: hasValidConfig,
      });
      if (!PREVIEW_SIMPLE_MODE) installPreviewDebugFloatingPanel();
      if (PREVIEW_MODE && !PREVIEW_SIMPLE_MODE) {
        try {
          setInterval(function () {
            installPreviewDebugFloatingPanel();
          }, 1500);
        } catch (ePanelWatch) {}
      }
      if (PREVIEW_MODE && PREVIEW_TEST_ID && (PREVIEW_VARIANT_ID || PREVIEW_VARIANT_NAME)) {
        if (
          !(_ripxShippingPreviewHandoffDeferred && shouldUseLightweightShippingPreviewPdpHandoff())
        ) {
          bootstrapPreviewCartAttributeSeed(null, 'runtime_init');
        }
      }

      if (
        window.location.pathname.includes('/thank_you') ||
        window.location.pathname.includes('/orders/')
      ) {
        trackCheckout();
      }

      if (!CONFIG.apiUrl) {
        console.warn('AB Test Tracker: apiUrl not configured');
        recordRipxSkip('runtime', 'missing_api_url', {});
        return;
      }
      reportCatalogProductView();
      // Install cart/add guards before async bucketing finishes. The guards read the latest
      // _ripxCartAttributeState at submit/fetch time, closing races with fast add-to-cart clicks.
      installRipxCartAddInterceptors();

      const activeTests = CONFIG.activeTests || [];
      if (!PREVIEW_MODE && activeTests.length > 0) {
        ensureBatchFetched();
      }

      if (DEBUG && activeTests.length === 0 && !(PREVIEW_MODE && PREVIEW_TEST_ID)) {
        debugLog(
          'No active tests in config. Ensure the test is Running and the script is loaded with the correct shop (e.g. App Proxy or ?shop=xxx.myshopify.com).'
        );
      }

      (async function runWithPreviewTestMerge() {
        var testsToRun = activeTests.slice();
        if (PREVIEW_MODE && !PREVIEW_TEST_ID) {
          if (DEBUG) {
            debugLog(
              'Preview mode is enabled without ab_preview_test. Skipping bucketing to avoid analytics pollution.'
            );
          }
          testsToRun = [];
        }
        if (PREVIEW_MODE && PREVIEW_TEST_ID) {
          var mergeMeta = {
            previewTestId: String(PREVIEW_TEST_ID),
            hadTestInEmbeddedConfig: testsToRun.some(function (t) {
              return String(t.id) === String(PREVIEW_TEST_ID);
            }),
            previewStorefrontTestFetched: false,
            previewStorefrontTestFetchDeferred: false,
            usedSyntheticFallback: false,
          };
          var hasPreview = testsToRun.some(function (t) {
            return String(t.id) === String(PREVIEW_TEST_ID);
          });
          if (!hasPreview) {
            // Start preview immediately with a synthetic fallback test and fetch the exact
            // storefront test shape in background so first paint is not blocked on network.
            // Price synthetics stay product-scoped (never all-products). Seed the opened
            // PDP id when known so first paint is not skipped waiting on target_ids.
            var syntheticType =
              String(PREVIEW_TEST_TYPE || '')
                .trim()
                .toLowerCase() === 'shipping' || resolvePreviewLooksLikeShipping(null)
                ? 'shipping'
                : 'price';
            var syntheticFocusPid = null;
            try {
              syntheticFocusPid = getCurrentProductId();
            } catch (_eSynPid) {
              syntheticFocusPid = null;
            }
            if (syntheticFocusPid) rememberPreviewFocusProductId(syntheticFocusPid);
            ripxTrace('S1', 'init synthetic price preview', {
              productId: syntheticFocusPid,
              type: syntheticType,
              targetIds: null,
            });
            testsToRun.push(
              syntheticType === 'shipping'
                ? {
                    id: PREVIEW_TEST_ID,
                    type: 'shipping',
                    targetType: 'all-products',
                    targetIds: null,
                    targetId: null,
                  }
                : {
                    id: PREVIEW_TEST_ID,
                    type: 'price',
                    targetType: 'product',
                    // Empty until variant matrix / preview-storefront-test arrives.
                    targetIds: null,
                    targetId: null,
                    previewSynthetic: true,
                  }
            );
            mergeMeta.usedSyntheticFallback = true;
            mergeMeta.previewStorefrontTestFetchDeferred = true;
            fetchPreviewStorefrontTestShape(PREVIEW_TEST_ID)
              .then(function (extraTest) {
                if (!extraTest || !extraTest.id) return;
                var current = Array.isArray(CONFIG.activeTests) ? CONFIG.activeTests.slice() : [];
                var replaced = false;
                for (var i = 0; i < current.length; i += 1) {
                  if (String(current[i] && current[i].id) === String(PREVIEW_TEST_ID)) {
                    current[i] = extraTest;
                    replaced = true;
                    break;
                  }
                }
                if (!replaced) current.push(extraTest);
                CONFIG.activeTests = current.filter(function (t) {
                  return String(t && t.id) === String(PREVIEW_TEST_ID);
                });
                try {
                  window.__RIPX_PREVIEW_MERGE__ = Object.assign(
                    {},
                    typeof window.__RIPX_PREVIEW_MERGE__ === 'object'
                      ? window.__RIPX_PREVIEW_MERGE__
                      : {},
                    {
                      previewStorefrontTestFetched: true,
                      previewStorefrontTestFetchDeferred: true,
                    }
                  );
                } catch (_eMergeUpdate) {}
                if (testTypeIsShipping(extraTest)) {
                  getVariant(PREVIEW_TEST_ID)
                    .then(function (variant) {
                      if (!variant) return;
                      if (_ripxShippingPreviewHandoffDeferred) {
                        finalizeShippingPreviewCartHandoff(
                          extraTest,
                          variant,
                          'preview_storefront_test_merge'
                        );
                      } else {
                        bootstrapPreviewCartAttributeSeed(variant, 'preview_storefront_test_merge');
                      }
                    })
                    .catch(function () {});
                }
                if (window.RipX && typeof window.RipX.reapplyPriceTests === 'function') {
                  setTimeout(function () {
                    try {
                      window.RipX.reapplyPriceTests();
                    } catch (_eReapplyPreview) {}
                  }, 0);
                }
              })
              .catch(function () {
                if (DEBUG) {
                  debugLog(
                    'Preview: deferred preview-storefront-test fetch failed — using synthetic fallback.'
                  );
                }
              });
          }
          testsToRun = testsToRun.filter(function (t) {
            return String(t && t.id) === String(PREVIEW_TEST_ID);
          });
          mergeMeta.previewOnlyMode = true;
          CONFIG.activeTests = testsToRun;
          try {
            window.__RIPX_PREVIEW_MERGE__ = mergeMeta;
          } catch (eMerge) {}
        }
        installGoalMetricCatalogTriggers(testsToRun);
        var guardEnabled = hasAntiFlickerEligibleTests(testsToRun);
        if (guardEnabled)
          installAntiFlickerGuard(
            getAntiFlickerTimeoutForTests(testsToRun),
            getAntiFlickerGuardModeForTests(testsToRun),
            testsToRun
          );
        clearOfferCodeNotices();

        testsToRun.forEach(function (test) {
          const shouldTrackAntiFlicker = guardEnabled && shouldUseAntiFlickerForTest(test);
          if (shouldTrackAntiFlicker) markAntiFlickerPending();
          if (!shouldRunPriceTestOnCurrentPage(test)) {
            recordRipxSkip(test.id, 'target_mismatch', {
              targetType: test.targetType || test.target_type || 'page',
              currentProductId: getCurrentProductId() || null,
              currentCollectionId: getCurrentCollectionId() || null,
              pathname: window.location.pathname || '',
            });
            ripxTrace(
              'S3',
              'test skipped — shouldRunPriceTestOnCurrentPage=false',
              {
                testId: test.id,
                type: test.type || null,
                targetType: test.targetType || test.target_type || 'page',
                targetIds:
                  test.targetIds ||
                  (test.targetId || test.target_id ? [test.targetId || test.target_id] : []),
                currentProductId: getCurrentProductId() || null,
              },
              'warn'
            );
            if (DEBUG) {
              var targetType = test.targetType || test.target_type || 'page';
              var ids =
                test.targetIds ||
                (test.targetId || test.target_id ? [test.targetId || test.target_id] : []);
              debugLog(
                'Test skipped (target mismatch):',
                test.id,
                'targetType=' + targetType,
                'targetIds=' + (ids.length ? ids.join(',') : 'any'),
                'current product=' + (getCurrentProductId() || 'none'),
                'current collection=' + (getCurrentCollectionId() || 'none')
              );
            }
            if (shouldTrackAntiFlicker) markAntiFlickerDone();
            return;
          }
          ripxTrace('S3', 'test will run on page', {
            testId: test.id,
            type: test.type || null,
            targetType: test.targetType || test.target_type || null,
          });
          getVariant(test.id).then(
            function (variant) {
              var antiFlickerDeferred = false;
              try {
                if (!variant) {
                  recordRipxSkip(test.id, 'no_variant_assigned', {
                    previewMode: PREVIEW_MODE,
                    targetType: test.targetType || test.target_type || null,
                  });
                  if (DEBUG) {
                    debugLog(
                      'Test skipped (no variant assigned):',
                      test.id,
                      '- URL/segment may not match. Check targeting (URL pattern, device, etc.) or open with ?ab_preview=1 for preview.'
                    );
                  }
                  return;
                }
                recordRipxAssignment(test.id, variant, PREVIEW_MODE ? 'preview' : 'live');
                var tt = getNormalizedTargetType(test);
                var productScope = isProductScopeTargetType(tt);
                var matched = matchesTarget(test);
                seedFixedPriceCartAttributesWithoutProductId(test, variant, 'assigned');
                if (!matched && PREVIEW_TEST_CONTEXT && testTypeIsPrice(test) && productScope) {
                  if (tt === 'all-products' || tt === 'all_products') {
                    matched = true;
                  } else if (isProductListingSurface() || isCartSurface()) {
                    matched = true;
                  }
                }
                if (matched && testTypeIsPrice(test) && variant && !variant.config) {
                  injectPreviewCartAttributesWhenConfigMissing(test.id, variant);
                }
                if (testTypeIsOffer(test)) {
                  var offerTargetType = getNormalizedTargetType(test);
                  var shouldInjectOfferAttrs =
                    offerTargetType === 'all-products' ||
                    offerTargetType === 'all_products' ||
                    matched ||
                    isProductListingSurface() ||
                    shouldRunAllProductsCartFallback();
                  if (shouldInjectOfferAttrs) {
                    injectOfferTestCartAttributes(test, variant);
                  }
                }
                if (testTypeIsShipping(test)) {
                  var shippingTargetType = getNormalizedTargetType(test);
                  var shouldInjectShippingAttrs = false;
                  if (isCartSurface() || hasCartUiInDom()) {
                    shouldInjectShippingAttrs = shouldShowShippingTestOnCart(test);
                  } else if (shouldRunShippingTestOnListingSurface(test)) {
                    shouldInjectShippingAttrs = true;
                  } else if (
                    shippingTargetType === 'all-products' ||
                    shippingTargetType === 'all_products'
                  ) {
                    var shippingCurrentProductId = getCurrentProductId();
                    shouldInjectShippingAttrs = shippingCurrentProductId
                      ? !isExcludedProductForTest(test, shippingCurrentProductId)
                      : matched;
                  } else {
                    shouldInjectShippingAttrs = matched;
                  }
                  if (shouldInjectShippingAttrs) {
                    if (_ripxShippingPreviewHandoffDeferred) {
                      finalizeShippingPreviewCartHandoff(test, variant, 'assigned');
                    } else {
                      injectShippingTestCartAttributes(test, variant, { reason: 'assigned' });
                    }
                  }
                }
                if (testTypeIsOffer(test) && shouldShowOfferCodeOnCart(test)) {
                  upsertOfferCodeNotice(test, variant);
                }
                if (matched) {
                  var previewFocusTest =
                    PREVIEW_MODE && String(test.id) === String(PREVIEW_TEST_ID);
                  if (
                    variant &&
                    variant.config &&
                    (testTypeIsThemeFamily(test) || variantConfigLooksTheme(variant.config))
                  ) {
                    applyThemeVariantWithRetry(test, variant);
                  }
                  if (
                    !previewFocusTest &&
                    !testTypeIsPrice(test) &&
                    variant.config &&
                    typeof variant.config.url === 'string' &&
                    variant.config.url.trim()
                  ) {
                    var rawUrl = variant.config.url.trim();
                    try {
                      var dest = new URL(rawUrl, window.location.href);
                      var cur = window.location;
                      var sameOriginPath =
                        dest.origin === cur.origin &&
                        dest.pathname === cur.pathname &&
                        (dest.search || '') === (cur.search || '');
                      if (!sameOriginPath) {
                        if (DEBUG) debugLog('Split-URL redirect', dest.toString());
                        window.location.href = dest.toString();
                        return;
                      }
                    } catch (e) {
                      if (DEBUG) debugLog('Split-URL invalid URL', rawUrl);
                    }
                  }
                  if (!previewFocusTest) {
                    applyCustomCode(test.id, variant);
                    applyVisualEditorRules(test.id, variant);
                  }
                }

                var tids =
                  test.targetIds ||
                  (test.targetId || test.target_id ? [test.targetId || test.target_id] : []);
                if (testTypeIsPrice(test)) {
                  try {
                    if (
                      deferPdpPriceApplyUntilProductId(
                        test,
                        variant,
                        tt,
                        tids,
                        shouldTrackAntiFlicker
                      )
                    ) {
                      antiFlickerDeferred = shouldTrackAntiFlicker;
                    }
                    applyPriceTestOnAssignedVariant(test, variant);
                  } catch (ePriceAssign) {
                    persistRipxLiveDiagnostics('price_apply_error', {
                      testId: test.id,
                      phase: 'assigned_variant',
                      message: ePriceAssign && (ePriceAssign.message || String(ePriceAssign)),
                    });
                    if (typeof console !== 'undefined' && console.warn) {
                      console.warn('[RipX] price apply failed', ePriceAssign);
                    }
                  }
                }
                var previewFocusAppliesLater =
                  previewFocusTest &&
                  !testTypeIsPrice(test) &&
                  !(
                    variant &&
                    variant.config &&
                    (testTypeIsThemeFamily(test) || variantConfigLooksTheme(variant.config))
                  );
                if (!previewFocusAppliesLater) {
                  markRipxTimingOnce('first_variant_apply_completed', {
                    testId: test.id || null,
                    type: test.type || null,
                    source: PREVIEW_MODE ? 'preview' : 'live',
                    matched: !!matched,
                  });
                }
              } finally {
                if (shouldTrackAntiFlicker && !antiFlickerDeferred) markAntiFlickerDone();
              }
            },
            function () {
              if (shouldTrackAntiFlicker) markAntiFlickerDone();
            }
          );
        });

        // Preview mode: apply the preview variant's CSS/JS and visual editor rules
        if (PREVIEW_MODE && PREVIEW_TEST_ID) {
          getVariant(PREVIEW_TEST_ID).then(function (variant) {
            if (variant) {
              var previewVariantIdForCart =
                variant.variantId != null ? variant.variantId : variant.id;
              if (
                (previewVariantIdForCart == null ||
                  String(previewVariantIdForCart).trim() === '') &&
                (PREVIEW_VARIANT_ID || PREVIEW_VARIANT_NAME)
              ) {
                previewVariantIdForCart = PREVIEW_VARIANT_ID || PREVIEW_VARIANT_NAME;
              }
              if (
                previewVariantIdForCart != null &&
                String(previewVariantIdForCart).trim() !== ''
              ) {
                var previewTestForCart = getActiveTestById(PREVIEW_TEST_ID);
                var shippingPreviewContext = resolvePreviewCartShippingContext(variant);
                if (shippingPreviewContext && shippingPreviewContext.test) {
                  if (_ripxShippingPreviewHandoffDeferred) {
                    finalizeShippingPreviewCartHandoff(
                      shippingPreviewContext.test,
                      shippingPreviewContext.variant || variant,
                      'preview_focus'
                    );
                  } else {
                    injectShippingTestCartAttributes(
                      shippingPreviewContext.test,
                      shippingPreviewContext.variant || variant,
                      { reason: 'preview_focus' }
                    );
                  }
                } else if (previewTestForCart && testTypeIsShipping(previewTestForCart)) {
                  if (_ripxShippingPreviewHandoffDeferred) {
                    finalizeShippingPreviewCartHandoff(
                      previewTestForCart,
                      variant,
                      'preview_focus'
                    );
                  } else {
                    injectShippingTestCartAttributes(previewTestForCart, variant, {
                      reason: 'preview_focus',
                    });
                  }
                } else {
                  injectPriceTestCartAttributes(
                    PREVIEW_TEST_ID,
                    previewVariantIdForCart,
                    getAssignmentProofFromVariant(variant),
                    null,
                    null,
                    { applicationMethod: 'direct_price_override' }
                  );
                }
              } else {
                injectPreviewCartAttributesWhenConfigMissing(PREVIEW_TEST_ID, variant);
              }
              applyCustomCode(PREVIEW_TEST_ID, variant);
              applyVisualEditorRules(PREVIEW_TEST_ID, variant);
              var previewTest = getActiveTestById(PREVIEW_TEST_ID);
              if (previewTest) {
                try {
                  applyPriceTestOnAssignedVariant(previewTest, variant);
                } catch (ePreviewPrice) {
                  persistRipxLiveDiagnostics('price_apply_error', {
                    testId: PREVIEW_TEST_ID,
                    phase: 'preview_focus',
                    message: ePreviewPrice && (ePreviewPrice.message || String(ePreviewPrice)),
                  });
                  if (typeof console !== 'undefined' && console.warn) {
                    console.warn('[RipX] preview price apply failed', ePreviewPrice);
                  }
                }
              }
              markRipxTimingOnce('first_variant_apply_completed', {
                testId: PREVIEW_TEST_ID || null,
                type: previewTest ? previewTest.type || null : null,
                source: 'preview_focus',
                matched: true,
              });
            }
          });
        }

        initHeatmap();

        if (shouldRunAllProductsCartFallback()) {
          if (!(PREVIEW_MODE && PREVIEW_TEST_ID && !previewFocusLooksLikePrice())) {
            scheduleRipxCartNativeStateRefreshBurst();
          }
        }

        function shouldScheduleDynamicPriceReapply() {
          if (PREVIEW_MODE && PREVIEW_TEST_ID && !previewFocusLooksLikePrice()) {
            return false;
          }
          return true;
        }

        // Re-apply price tests for dynamic content. Paint functions are idempotent, so stable nodes
        // are skipped while AJAX sections, cart drawers, and predictive-search cards can still catch up.
        function reapplyPriceTestsOnly() {
          if (antiFlickerState.active) {
            _ripxPriceReapplyQueuedAfterAf = true;
            return;
          }
          if (!hasValidConfig || !CONFIG.activeTests || CONFIG.activeTests.length === 0) return;
          CONFIG.activeTests.forEach(function (test) {
            if (!testTypeIsPrice(test)) return;
            if (!shouldRunPriceTestOnCurrentPage(test)) return;
            var tt = getNormalizedTargetType(test);
            var productScope = isProductScopeTargetType(tt);
            var tids =
              test.targetIds ||
              (test.targetId || test.target_id ? [test.targetId || test.target_id] : []);
            if (!productScope && tt !== 'collection' && tids.length === 0) return;
            getVariant(test.id).then(function (variant) {
              if (!variant) return;
              injectPreviewCartAttributesWhenConfigMissing(test.id, variant);
              seedFixedPriceCartAttributesWithoutProductId(test, variant, 'reapply');
              if (!variant.config) return;
              var curPid = getCurrentProductId();
              var matchedNow = matchesTarget(test);
              if (!matchedNow && PREVIEW_TEST_CONTEXT && testTypeIsPrice(test) && productScope) {
                if (tt === 'all-products' || tt === 'all_products') {
                  matchedNow = true;
                } else if (isProductListingSurface() || isCartSurface()) {
                  matchedNow = true;
                }
              }
              if (
                productScope &&
                matchedNow &&
                curPid &&
                !isExcludedProductForTest(test, curPid) &&
                (tt === 'all-products' ||
                  tt === 'all_products' ||
                  !tids.length ||
                  tids.some(function (id) {
                    return id && gidMatches(id, curPid);
                  }))
              ) {
                applyPriceTest(test.id, curPid, test.targetVariantId || null, variant);
              }
              if (tt === 'collection' && curPid && productBelongsToPriceTestCollections(tids)) {
                applyPriceTest(test.id, curPid, test.targetVariantId || null, variant);
              }
              if (tt === 'product' && isProductListingSurface()) {
                applyPriceTestToProductCards(test.id, variant, tids);
              } else if (
                (tt === 'all-products' || tt === 'all_products') &&
                isProductListingSurface()
              ) {
                applyPriceTestToCollectionListingCards(test.id, variant);
              } else if (tt === 'collection' && matchedNow && isProductListingSurface()) {
                applyPriceTestToCollectionListingCards(test.id, variant);
              }
              if (tt === 'product') {
                applyPriceTestToCart(test.id, variant, tids);
              } else if (tt === 'all-products' || tt === 'all_products') {
                var cartTids = getCartVisibleProductTargetIds();
                if (cartTids.length) {
                  applyPriceTestToCart(test.id, variant, cartTids);
                } else if (shouldRunAllProductsCartFallback()) {
                  if (hasByProductOverrides(variant.config)) {
                    applyPriceTestToCartAllProductsByCartState(test.id, variant);
                  } else {
                    applyPriceTestToCartAllProductsFallback(test.id, variant);
                  }
                }
              }
            });
          });
          setTimeout(auditRipxPaintParityStampedNodes, 150);
        }
        function hasDynamicPriceSurface() {
          return isProductListingSurface() || isCartSurface() || hasCartUiInDom() || !!cartUiRoot();
        }
        function schedulePriceReapply(delayMs, dynamicOnly) {
          if (!shouldScheduleDynamicPriceReapply()) return;
          setTimeout(function () {
            if (antiFlickerState.active) {
              _ripxPriceReapplyQueuedAfterAf = true;
              return;
            }
            if (dynamicOnly && !hasDynamicPriceSurface()) return;
            reapplyPriceTestsOnly();
          }, delayMs);
        }
        schedulePriceReapply(900, false);
        schedulePriceReapply(2500, true);
        ['shopify:section:load', 'cart:updated', 'cart:refresh', 'drawer:open'].forEach(
          function (evt) {
            document.addEventListener(evt, function () {
              schedulePriceReapply(80, true);
            });
          }
        );
        document.addEventListener('shopify:section:load', function () {
          if (!shouldScheduleDynamicPriceReapply()) return;
          setTimeout(reapplyPriceTestsOnly, 300);
        });
        var lastCartReapplyAt = 0;
        var cartReapply = function () {
          var now = Date.now();
          if (now - lastCartReapplyAt < 400) return;
          lastCartReapplyAt = now;
          scheduleRipxCartNativeStateRefreshBurst();
          setTimeout(reapplyPriceTestsOnly, 180);
          setTimeout(reapplyPriceTestsOnly, 700);
        };
        if (document.body) {
          document.body.addEventListener('click', function (e) {
            var t = e.target;
            if (!t || !t.closest) return;
            if (
              t.closest(
                'a[href*="/cart"], .cart-icon, #cart-icon-bubble, [data-cart-drawer-toggle], .header__icon--cart, .site-header__cart, [data-cart-toggle], .js-drawer-open-cart, button[aria-label*="cart" i]'
              )
            ) {
              cartReapply();
            }
          });
        }
        ['cart:open', 'cart-drawer:open', 'cart:updated', 'shopify:cart:change'].forEach(
          function (evt) {
            try {
              document.addEventListener(evt, cartReapply, false);
            } catch (e) {}
          }
        );
        if (PREVIEW_MODE && PREVIEW_TEST_ID && previewFocusLooksLikePrice()) {
          // Price-preview-only stabilization. Shipping/simple customer previews do not need this
          // watchdog; on production themes it hammered cart fetches + form rewrites until crash.
          if (_ripxPreviewStabilityTimer) {
            clearInterval(_ripxPreviewStabilityTimer);
            _ripxPreviewStabilityTimer = null;
          }
          var previewStabilityTicks = 0;
          _ripxPreviewStabilityTimer = setInterval(function () {
            previewStabilityTicks += 1;
            try {
              reapplyPriceTestsOnly();
              applyRipxStateToCartForms(_ripxCartFormTargetProductIds);
              scheduleRipxCartNativeStateRefreshBurst();
              if (typeof maybeRepairRipxCartLineProperties === 'function') {
                maybeRepairRipxCartLineProperties('preview-watchdog');
              }
            } catch (_e) {}
            if (previewStabilityTicks >= 90) {
              clearInterval(_ripxPreviewStabilityTimer);
              _ripxPreviewStabilityTimer = null;
            }
          }, 2000);
          try {
            window.addEventListener(
              'beforeunload',
              function () {
                if (_ripxPreviewStabilityTimer) {
                  clearInterval(_ripxPreviewStabilityTimer);
                  _ripxPreviewStabilityTimer = null;
                }
              },
              { once: true }
            );
          } catch (_eUnload) {}
        }
        _ripxReapplyPriceTestsImpl = reapplyPriceTestsOnly;
        if (window.RipX) {
          window.RipX.reapplyPriceTests = reapplyPriceTestsOnly;
          window.RipX.reapplyCartFormRipxProps = function () {
            applyRipxStateToCartForms(_ripxCartFormTargetProductIds);
          };
        }
        ripxTrace('S4', 'reapplyPriceTests wired', {
          queuedAfterAf: !!_ripxPriceReapplyQueuedAfterAf,
        });
        if (_ripxPriceReapplyQueuedAfterAf && !antiFlickerState.active) {
          _ripxPriceReapplyQueuedAfterAf = false;
          flushQueuedPriceReapply('wired');
        }
      })();
    }

    whenConsent(run);
  }

  // Start batch variant fetch immediately (overlaps with page load, reduces flicker)
  ensureBatchFetched();

  // Ping backend when script loads so the dashboard can show "Script detected" for standalone
  if (hasValidConfig && CONFIG.shopDomain) {
    var pingParam = CONFIG.shopDomain.indexOf('.myshopify.com') !== -1 ? 'shop=' : 'site=';
    var pingUrl =
      CONFIG.apiUrl + '/track/ping?' + pingParam + encodeURIComponent(CONFIG.shopDomain);
    try {
      fetchWithTimeout(pingUrl, { method: 'GET', keepalive: true }, 5000).catch(function () {});
    } catch (e) {}
  }

  function initSafely() {
    try {
      init();
    } catch (eInit) {
      try {
        if (typeof console !== 'undefined' && console.error) {
          console.error('[RipX] init failed', eInit);
        }
      } catch (_eLog) {}
      // Retry once in case theme DOM/APIs were not ready yet.
      try {
        setTimeout(function () {
          try {
            init();
          } catch (_eRetry) {}
        }, 50);
      } catch (_eTimer) {}
    }
  }

  // Export before init() runs. The init flow installs reapply hooks onto window.RipX; exporting
  // after init meant those hooks could remain unavailable in customer preview sessions.
  const api = {
    getVariant,
    trackConversion,
    trackEvent,
    trackRecommendationEvent,
    evaluateFeatureFlags,
    applyPriceTest,
    reapplyPriceTests: null,
    reapplyCartFormRipxProps: null,
    setDebug: function (enabled, options) {
      var persist = !(options && options.persist === false);
      var next = setDebugEnabled(!!enabled, persist);
      if (typeof console !== 'undefined' && console.info) {
        console.info(
          '[RipX] debug',
          next ? 'enabled' : 'disabled',
          persist ? '(persisted)' : '(session)'
        );
      }
      return next;
    },
    setTrace: function (enabled, options) {
      var persist = !(options && options.persist === false);
      var next = setTraceEnabled(!!enabled, persist);
      if (typeof console !== 'undefined' && console.info) {
        console.info(
          '[RipX] trace',
          next ? 'enabled' : 'disabled',
          persist ? '(persisted)' : '(session)'
        );
      }
      if (next) printRipxDebugGuide();
      return next;
    },
    debugTrace: dumpRipxTrace,
    printDebugGuide: printRipxDebugGuide,
    debugCart: debugCartSnapshot,
    debugShippingFlow,
    buildSimulateHidePayload,
    clearShippingDebugTrail,
    debugStatus,
    debugGoalMetrics,
    testGoalMetricEvent,
    liveDiagnostics,
    qa: liveDiagnostics,
    debugPaintStats: debugPaintStats,
    debugThemeStats: debugThemeStats,
    version: SCRIPT_VERSION,
  };
  window.ABTestTracker = api;
  window.RipX = api;
  try {
    ripxTrace('S0', 'RipX storefront boot', {
      version: SCRIPT_VERSION,
      preview: !!PREVIEW_MODE,
      previewTestId: PREVIEW_TEST_ID || null,
      simple: !!PREVIEW_SIMPLE_MODE,
      debug: !!DEBUG,
      trace: isRipxTraceConsoleEnabled(),
      href: window.location.href,
    });
    if (PREVIEW_MODE && typeof console !== 'undefined' && console.info) {
      console.info(
        '[RipX] Preview debug: RipX.printDebugGuide() | RipX.debugTrace() | RipX.setTrace(true) | ?ab_preview_trace=1'
      );
    }
  } catch (_eBootTrace) {}

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSafely);
  } else {
    initSafely();
  }

  // Element selection / visual editor: only when ab_visual_editor=1 AND in iframe. Never runs on live site.
  if (VISUAL_EDITOR_EMBED) {
    function runVisualEditorEmbed() {
      if (document.body) {
        initVisualEditorEmbed();
      } else {
        setTimeout(runVisualEditorEmbed, 5);
      }
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', runVisualEditorEmbed, { once: true });
    } else {
      runVisualEditorEmbed();
    }
  }

  /**
   * One-shot debug bundle: URL vs session preview, runtime config, API probes, getVariant, DOM/theme probes.
   * Call after load: await window.RipX.debugStatus('uuid') or await window.RipX.debugStatus()
   * @param {string} [testId]
   * @returns {Promise<object>}
   */
  async function debugStatus(testId) {
    if (!hasValidConfig) {
      return {
        ok: false,
        error: 'no_valid_config',
        hint: 'AB_TEST_RUNTIME_CONFIG.apiUrl missing — script not injected or blocked.',
      };
    }
    var tid =
      testId != null && String(testId).trim() !== ''
        ? String(testId).trim()
        : PREVIEW_TEST_ID || null;
    var variant = null;
    var variantError = null;
    if (tid) {
      try {
        if (PREVIEW_MODE) {
          variant = await getVariant(tid);
        } else {
          variantError =
            'Skipped live getVariant() to avoid creating a saved assignment; see network.liveVariants.variants for the non-persistent diagnostic result.';
        }
      } catch (e) {
        variantError = e && (e.message || String(e));
      }
    }
    var sp = new URLSearchParams(window.location.search || '');
    var sess = null;
    try {
      sess = window.sessionStorage && window.sessionStorage.getItem('__ripx_preview_ctx_v1__');
    } catch (e2) {
      sess = null;
    }

    var pathLower = (window.location.pathname || '').toLowerCase();
    var isPdp =
      pathLower.indexOf('/products/') !== -1 && pathLower.length > '/products/'.length + 1;
    var isPasswordPage = pathLower.indexOf('/password') !== -1;

    var network = { preview: null, previewStorefrontTest: null, liveVariants: null };
    if (tid && CONFIG.apiUrl) {
      try {
        var pp = new URLSearchParams();
        pp.set('test_id', tid);
        appendTrackTenantParams(pp);
        if (PREVIEW_VARIANT_ID) pp.set('variant_id', PREVIEW_VARIANT_ID);
        if (PREVIEW_VARIANT_NAME) pp.set('variant_name', PREVIEW_VARIANT_NAME);
        var uid = getUserId();
        if (uid) pp.set('user_id', String(uid));
        var rp = await fetchWithTimeout(
          CONFIG.apiUrl + '/track/preview?' + pp.toString(),
          { method: 'GET' },
          8000
        );
        network.preview = { status: rp.status, ok: rp.ok };
      } catch (ep) {
        network.preview = { error: ep && (ep.message || String(ep)) };
      }
      try {
        var ps = new URLSearchParams();
        ps.set('test_id', tid);
        appendTrackTenantParams(ps);
        var rs = await fetchWithTimeout(
          CONFIG.apiUrl + '/track/preview-storefront-test?' + ps.toString(),
          { method: 'GET' },
          8000
        );
        network.previewStorefrontTest = { status: rs.status, ok: rs.ok };
      } catch (es) {
        network.previewStorefrontTest = { error: es && (es.message || String(es)) };
      }
    }
    if (!PREVIEW_MODE && CONFIG.apiUrl && (tid || (CONFIG.activeTests || []).length > 0)) {
      try {
        var lv = new URLSearchParams();
        var liveTestIds = tid
          ? [tid]
          : (CONFIG.activeTests || [])
              .map(function (t) {
                return t && t.id;
              })
              .filter(Boolean);
        lv.set('user_id', getUserId());
        lv.set('shop_domain', getShopDomain());
        lv.set('test_ids', liveTestIds.join(','));
        lv.set('device', getDeviceType());
        lv.set('operating_system', getOperatingSystem());
        lv.set('customer', getCustomerType());
        lv.set('country', getCountryCode() || '');
        lv.set('traffic_source', getTrafficSource());
        lv.set('current_url', window.location.href || '');
        lv.set('current_pathname', window.location.pathname || '/');
        lv.set('session_count', '1');
        // Diagnostic probe should not create a saved live assignment while inspecting.
        // Backend still runs the same eligibility + selection path, but skips persistence.
        lv.set('preview_session', '1');
        lv.set('ripx_diag', 'debugStatus');
        lv.set('referrer', document.referrer || '');
        var livePid = getCurrentProductId();
        var liveCid = getCurrentCollectionId();
        if (livePid) lv.set('current_product_id', livePid);
        if (liveCid) lv.set('current_collection_id', liveCid);
        var liveResponse = await fetchWithTimeout(
          CONFIG.apiUrl + '/track/variants?' + lv.toString(),
          { method: 'GET' },
          8000
        );
        var liveBody = null;
        try {
          liveBody = await liveResponse.clone().json();
        } catch (_eLiveJson) {}
        network.liveVariants = {
          status: liveResponse.status,
          ok: liveResponse.ok,
          diagnosticOnly: true,
          backendDiagnostics: liveBody && liveBody.diagnostics ? liveBody.diagnostics : null,
          assignedTestIds:
            liveBody && liveBody.variants && typeof liveBody.variants === 'object'
              ? Object.keys(liveBody.variants)
              : [],
          variants: liveBody && liveBody.variants ? liveBody.variants : null,
        };
      } catch (eLive) {
        network.liveVariants = { error: eLive && (eLive.message || String(eLive)) };
      }
    }

    var cart = { ok: false, error: null, itemCount: 0, ripxItems: [], missingByLine: [] };
    if (_ripxNativeFetch) {
      try {
        var cartResponse = await _ripxNativeFetch('/cart.js', {
          method: 'GET',
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
        });
        cart.ok = !!(cartResponse && cartResponse.ok);
        cart.status = cartResponse ? cartResponse.status : null;
        var cartBody = cartResponse
          ? await cartResponse
              .clone()
              .json()
              .catch(function () {
                return null;
              })
          : null;
        var cartItems = cartBody && Array.isArray(cartBody.items) ? cartBody.items : [];
        cart.itemCount = cartItems.length;
        cartItems.forEach(function (item) {
          var props =
            item && item.properties && typeof item.properties === 'object' ? item.properties : {};
          var hasRipx =
            !!props._ripx_price_test ||
            !!props._ripx_variant ||
            !!props._ripx_target_unit ||
            !!props._ripx_discount_unit ||
            !!props._ripx_price_method;
          if (!hasRipx) return;
          var summary = {
            title: item.title || null,
            productId: item.product_id || null,
            variantId: item.variant_id || null,
            price: item.price || null,
            finalPrice: item.final_price || null,
            finalLinePrice: item.final_line_price || null,
            priceTest: props._ripx_price_test || null,
            assignmentVariant: props._ripx_variant || null,
            targetUnit: props._ripx_target_unit || null,
            discountUnit: props._ripx_discount_unit || null,
            priceMethod: props._ripx_price_method || null,
            hasAssignmentSig: !!props._ripx_assignment_sig,
            hasAssignmentTs: !!props._ripx_assignment_ts,
            hasAssignmentUser: !!props._ripx_assignment_user,
          };
          cart.ripxItems.push(summary);
          var missing = [];
          if (!summary.priceTest) missing.push('_ripx_price_test');
          if (!summary.assignmentVariant) missing.push('_ripx_variant');
          var shippingLine =
            resolvePreviewLooksLikeShipping({ config: variant && variant.config }) ||
            (CONFIG.activeTests || []).some(function (t) {
              return (
                t &&
                testTypeIsShipping(t) &&
                String(t.id) === String(summary.priceTest || PREVIEW_TEST_ID || '')
              );
            });
          if (!shippingLine && !summary.priceMethod) missing.push('_ripx_price_method');
          if (!summary.hasAssignmentSig) missing.push('_ripx_assignment_sig');
          if (!summary.hasAssignmentTs) missing.push('_ripx_assignment_ts');
          if (!summary.hasAssignmentUser) missing.push('_ripx_assignment_user');
          if (
            !shippingLine &&
            summary.priceMethod !== 'native_variant_price' &&
            summary.priceMethod !== 'direct_price_override' &&
            !summary.discountUnit &&
            !summary.targetUnit
          ) {
            missing.push('_ripx_discount_unit_or_target_unit');
          }
          if (missing.length) {
            cart.missingByLine.push({
              title: summary.title,
              productId: summary.productId,
              variantId: summary.variantId,
              missing: missing,
            });
          }
        });
        cart.hasRipxLines = cart.ripxItems.length > 0;
        cart.readyForCheckoutDiscount = cart.ripxItems.some(function (item) {
          return (
            item.priceTest &&
            item.assignmentVariant &&
            item.priceMethod !== 'direct_price_override' &&
            item.priceMethod !== 'native_variant_price' &&
            item.hasAssignmentSig &&
            item.hasAssignmentTs &&
            item.hasAssignmentUser &&
            (item.discountUnit || item.targetUnit)
          );
        });
        cart.readyForCartTransform = cart.ripxItems.some(function (item) {
          return item.priceMethod === 'direct_price_override' && item.targetUnit;
        });
        cart.readyForShippingCheckout = cart.ripxItems.some(function (item) {
          return (
            item.priceTest &&
            item.assignmentVariant &&
            item.hasAssignmentSig &&
            item.hasAssignmentTs &&
            item.hasAssignmentUser &&
            !item.priceMethod &&
            !item.targetUnit
          );
        });
      } catch (eCart) {
        cart.error = eCart && (eCart.message || String(eCart));
      }
    } else {
      cart.error = 'native_fetch_unavailable';
    }

    var scripts = [];
    try {
      var list = document.querySelectorAll('script[src]');
      for (var si = 0; si < list.length; si++) {
        var src = list[si].getAttribute('src') || '';
        if (
          src.indexOf('ripx') !== -1 ||
          src.indexOf('track/script') !== -1 ||
          src.indexOf('echologyx') !== -1
        ) {
          scripts.push(src);
        }
      }
    } catch (eScr) {}

    var activeTestsSummary = [];
    try {
      (CONFIG.activeTests || []).forEach(function (t) {
        if (!t) return;
        activeTestsSummary.push({
          id: t.id,
          type: t.type,
          targetType: t.targetType || t.target_type,
        });
      });
    } catch (eAct) {}

    var shippingCallbackHealth = null;
    try {
      var currentApiHost = '';
      if (CONFIG.apiUrl) {
        currentApiHost = new URL(String(CONFIG.apiUrl)).host;
      }
      var carrierResources = [];
      var resources =
        variant &&
        variant.config &&
        variant.config.metadata &&
        Array.isArray(variant.config.metadata.shipping_resources)
          ? variant.config.metadata.shipping_resources
          : [];
      resources.forEach(function (resource) {
        if (!resource || typeof resource !== 'object') return;
        var adapter = String(resource.adapter || resource.resource_type || '').trim();
        if (adapter !== 'carrier_service') return;
        var callbackUrl = String(resource.callback_url || '').trim();
        if (!callbackUrl) return;
        var callbackHost = '';
        try {
          callbackHost = new URL(callbackUrl).host;
        } catch (_eCbHost) {}
        carrierResources.push({
          id: resource.id || null,
          title: resource.title || null,
          callback_host: callbackHost || null,
          callback_url: callbackUrl,
          stale: !!(currentApiHost && callbackHost && callbackHost !== currentApiHost),
        });
      });
      var staleCallbacks = carrierResources.filter(function (entry) {
        return entry.stale;
      });
      shippingCallbackHealth = {
        current_api_host: currentApiHost || null,
        carrier_resources: carrierResources,
        stale_count: staleCallbacks.length,
        stale_callbacks: staleCallbacks,
        checkout_blocked_by_stale_callback: staleCallbacks.length > 0,
      };
    } catch (_eShipHealth) {}

    return {
      ok: true,
      version: SCRIPT_VERSION,
      loaded: !!window.__RIPX_LOADED__,
      href: window.location.href,
      pathname: window.location.pathname || '',
      isPasswordPage: isPasswordPage,
      pageKind: isPdp ? 'pdp' : pathLower === '/' || pathLower === '' ? 'home' : 'other',
      consent: {
        consentRequired: consentRequired,
        hasConsent: hasConsent(),
        bypassPreview: !!(PREVIEW_TEST_ID && (PREVIEW_VARIANT_ID || PREVIEW_VARIANT_NAME)),
      },
      runtime: {
        apiUrl: CONFIG.apiUrl,
        shopDomain: CONFIG.shopDomain,
        activeTestsCount: (CONFIG.activeTests || []).length,
        activeTestsSummary: activeTestsSummary,
      },
      preview: {
        mode: PREVIEW_MODE,
        testContext: PREVIEW_TEST_CONTEXT,
        testId: PREVIEW_TEST_ID,
        variantId: PREVIEW_VARIANT_ID,
        variantName: PREVIEW_VARIANT_NAME,
        urlParams: {
          ab_preview: sp.get('ab_preview'),
          ab_preview_simple: sp.get('ab_preview_simple'),
          ab_preview_test: sp.get('ab_preview_test'),
          ab_preview_variant: sp.get('ab_preview_variant'),
          ab_preview_variant_name: sp.get('ab_preview_variant_name'),
        },
        sessionStorage: sess,
        merge:
          typeof window.__RIPX_PREVIEW_MERGE__ === 'object' ? window.__RIPX_PREVIEW_MERGE__ : null,
      },
      ripXApi: {
        reapplyPriceTestsType: window.RipX ? typeof window.RipX.reapplyPriceTests : 'n/a',
        debugPaintStatsType: window.RipX ? typeof window.RipX.debugPaintStats : 'n/a',
        debugThemeStatsType: window.RipX ? typeof window.RipX.debugThemeStats : 'n/a',
      },
      requestedTestId: tid,
      variant: variant,
      variantError: variantError,
      network,
      cart,
      scriptSrcHints: scripts,
      dom: {
        dataRipxPriceCount: document.querySelectorAll('[data-ripx-price="1"]').length,
        priceItemRegular: document.querySelectorAll('.price-item--regular').length,
        money: document.querySelectorAll('.money').length,
        productJsonScript: !!document.querySelector(
          '#ProductJson, script[type="application/json"][data-product-json], script[data-section-type="product"]'
        ),
      },
      diagnostics: {
        getCurrentProductId: getCurrentProductId(),
        hasProductJson: !!getProductJson(),
        cartAttributeState: _ripxCartAttributeState
          ? {
              priceTest: _ripxCartAttributeState._ripx_price_test || null,
              variant: _ripxCartAttributeState._ripx_variant || null,
              shop: _ripxCartAttributeState._ripx_shop || null,
              shippingTest: !!_ripxCartAttributeState.__ripx_shipping_test,
              targetUnit: _ripxCartAttributeState._ripx_target_unit || null,
              discountUnit: _ripxCartAttributeState._ripx_discount_unit || null,
              priceMethod: _ripxCartAttributeState._ripx_price_method || null,
              offerDiscountType: _ripxCartAttributeState._ripx_offer_discount_type || null,
              offerCodeName: _ripxCartAttributeState._ripx_offer_code_name || null,
              hasAssignmentSig: !!_ripxCartAttributeState._ripx_assignment_sig,
              hasAssignmentTs: !!_ripxCartAttributeState._ripx_assignment_ts,
              hasAssignmentUser: !!_ripxCartAttributeState._ripx_assignment_user,
            }
          : null,
        cartFormTargetProductIds: Array.isArray(_ripxCartFormTargetProductIds)
          ? _ripxCartFormTargetProductIds.slice()
          : _ripxCartFormTargetProductIds || null,
        rememberedTargetUnits: Object.assign({}, _ripxTargetUnitByProductId),
        rememberedDiscountUnits: Object.assign({}, _ripxDiscountUnitByProductId),
        rememberedPriceMethods: Object.assign({}, _ripxPriceMethodByProductId),
        rememberedVariantTargetUnits: Object.assign({}, _ripxTargetUnitByVariantId),
        rememberedVariantDiscountUnits: Object.assign({}, _ripxDiscountUnitByVariantId),
        rememberedVariantPriceMethods: Object.assign({}, _ripxPriceMethodByVariantId),
        hasCartUiInDom: typeof hasCartUiInDom === 'function' ? hasCartUiInDom() : null,
        shouldRunAllProductsCartFallback:
          typeof shouldRunAllProductsCartFallback === 'function'
            ? shouldRunAllProductsCartFallback()
            : null,
        cartDrawerOpenShadowRoot: (function () {
          try {
            var el = document.querySelector('cart-drawer');
            return el && el.shadowRoot ? true : el ? false : null;
          } catch (eCd) {
            return null;
          }
        })(),
        nativeCartState: {
          fetchedAt:
            _ripxCartNativeState && _ripxCartNativeState.fetchedAt
              ? new Date(_ripxCartNativeState.fetchedAt).toISOString()
              : null,
          hasDiscounts:
            _ripxCartNativeState && typeof _ripxCartNativeState.hasDiscounts === 'boolean'
              ? _ripxCartNativeState.hasDiscounts
              : null,
          uiMatches:
            _ripxCartNativeState && typeof _ripxCartNativeState.uiMatches === 'boolean'
              ? _ripxCartNativeState.uiMatches
              : null,
          expectedSubtotalCents:
            _ripxCartNativeState &&
            _ripxCartNativeState.expectedSubtotalCents !== undefined &&
            _ripxCartNativeState.expectedSubtotalCents !== null
              ? _ripxCartNativeState.expectedSubtotalCents
              : null,
          displayedSubtotalCents:
            _ripxCartNativeState &&
            _ripxCartNativeState.displayedSubtotalCents !== undefined &&
            _ripxCartNativeState.displayedSubtotalCents !== null
              ? _ripxCartNativeState.displayedSubtotalCents
              : null,
          markerCount: cartUiNativeMarkerCount(),
          fallbackPaintCount: cartUiFallbackPaintCount(),
          preferNativeRendering: shouldPreferNativeCartRendering(),
        },
        paintStats: getRipxPaintStatsSnapshot(),
        themeStats: getRipxThemeStatsSnapshot(),
        antiFlicker: getAntiFlickerDiagnostics(),
      },
      checkout: {
        storefrontScriptRunsOnHostedCheckout: false,
        note: 'checkout.shopify.com does not load the RipX storefront script. Shipping checkout uses carrier-service callbacks plus delivery customization driven by _ripx_price_test/_ripx_variant line properties.',
      },
      shipping: shippingCallbackHealth,
      interpret: {
        if_password_page: isPasswordPage
          ? 'RipX does not run on /password — enter the store first.'
          : null,
        if_preview_ok_but_no_paint:
          variant && variant.isPreview && variant.config && !isPasswordPage
            ? isPdp && !getCurrentProductId()
              ? 'Variant OK but getCurrentProductId was null — Shopify meta/ProductJson may load late; deploy latest script (PDP retry + getProductJson fallback).'
              : 'Variant OK — if dataRipxPriceCount is 0, theme selectors may not match; check dom.priceItemRegular vs .money.'
            : null,
        if_network_preview_not_ok:
          network.preview && network.preview.status && network.preview.status >= 400
            ? 'GET /track/preview failed — tenant, test id, or variant params.'
            : null,
        if_stale_shipping_callback:
          shippingCallbackHealth && shippingCallbackHealth.checkout_blocked_by_stale_callback
            ? 'Saved carrier-service callback host does not match runtime apiUrl. Re-run Shipping Apply on the current tunnel, then empty cart and preview again.'
            : null,
        if_shipping_cart_has_price_method:
          cart.ripxItems &&
          cart.ripxItems.some(function (item) {
            return !!item.priceMethod;
          })
            ? 'Cart line still has _ripx_price_method from price-preview seeding. Empty cart, hard refresh, and add again after deploying the latest storefront script.'
            : null,
        if_no_paint_check_trace:
          isPdp && document.querySelectorAll('[data-ripx-price="1"]').length === 0
            ? 'No painted price nodes. Run RipX.debugTrace() and look for S6/S7 skip reasons (target mismatch, matrix miss, null root price).'
            : null,
        if_matrix_product_mismatch: (function () {
          try {
            var cfg = variant && variant.config ? variant.config : null;
            var keys = getByProductMatrixProductIds(cfg);
            var cur = getCurrentProductId();
            if (!isPdp || !keys.length || !cur) return null;
            if (productInByProductMatrix(cfg, cur) === false) {
              return (
                'This PDP (' +
                cur +
                ') is not in the arm byProduct matrix (' +
                keys.join(', ') +
                '). Open Preview from that product’s row in RipX Variations — do not reuse a sticky preview on another PDP.'
              );
            }
          } catch (_eMm) {}
          return null;
        })(),
        if_atc_ok_but_no_line_props:
          PREVIEW_MODE &&
          (!(_ripxCartAttributeState && _ripxCartAttributeState._ripx_target_unit) ||
            (cart.itemCount > 0 && !cart.hasRipxLines))
            ? 'Preview ATC is non-blocking — theme add works even before RipX props hydrate. Re-add after S8 paint, or RipX.debugCart().'
            : null,
      },
      trace: getRipxTraceSnapshot(),
      nextSteps: RIPX_DEBUG_GUIDE_LINES,
    };
  }

  function liveDiagnostics(options) {
    var opts = options && typeof options === 'object' ? options : {};
    var snapshot = persistRipxLiveDiagnostics('manual_snapshot', {
      includeStorage: opts.includeStorage === true,
    });
    if (opts.log !== false && typeof console !== 'undefined') {
      if (console.groupCollapsed) console.groupCollapsed('[RipX] live diagnostics');
      if (console.log) {
        console.log('snapshot', snapshot);
        console.log('sessionStorage key', RIPX_LIVE_DIAGNOSTICS_KEY);
        console.log('localStorage key', RIPX_LIVE_DIAGNOSTICS_KEY);
        console.log('history key', RIPX_LIVE_DIAGNOSTICS_HISTORY_KEY);
        console.log(
          'cookie',
          RIPX_LIVE_DIAGNOSTICS_COOKIE,
          getCookie(RIPX_LIVE_DIAGNOSTICS_COOKIE)
        );
      }
      if (console.table) {
        console.table(
          Object.keys(snapshot.assignments || {}).map(function (testId) {
            var assignment = snapshot.assignments[testId] || {};
            return {
              testId: testId,
              variantId: assignment.variantId || '',
              variantName: assignment.variantName || '',
              reason: assignment.reason || '',
              at: assignment.at || '',
            };
          })
        );
      }
      if (console.groupEnd) console.groupEnd();
    }
    return snapshot;
  }

  // Test-only hooks (enabled when host page predefines window.__RIPX_TEST_HOOKS__ object).
  if (window.__RIPX_TEST_HOOKS__ && typeof window.__RIPX_TEST_HOOKS__ === 'object') {
    window.__RIPX_TEST_HOOKS__.getRipxCartAttrsPayload = getRipxCartAttrsPayload;
    window.__RIPX_TEST_HOOKS__.patchCartAddBodyForRipx = patchCartAddBodyForRipx;
    window.__RIPX_TEST_HOOKS__.installRipxCartAddInterceptors = installRipxCartAddInterceptors;
    window.__RIPX_TEST_HOOKS__.isCartAddPath = isCartAddPath;
    window.__RIPX_TEST_HOOKS__.pathnameFromCartUrl = pathnameFromCartUrl;
    window.__RIPX_TEST_HOOKS__.debugDescribeCartAddBody = debugDescribeCartAddBody;
    window.__RIPX_TEST_HOOKS__.looksLikeCartAddNearMiss = looksLikeCartAddNearMiss;
    window.__RIPX_TEST_HOOKS__.previewMode = PREVIEW_MODE;
    window.__RIPX_TEST_HOOKS__.previewSimpleMode = PREVIEW_SIMPLE_MODE;
    window.__RIPX_TEST_HOOKS__.shippingPreviewHandoffDeferred = function () {
      return !!_ripxShippingPreviewHandoffDeferred;
    };
    window.__RIPX_TEST_HOOKS__.shouldUseLightweightShippingPreviewPdpHandoff =
      shouldUseLightweightShippingPreviewPdpHandoff;
    window.__RIPX_TEST_HOOKS__.finalizeShippingPreviewCartHandoff =
      finalizeShippingPreviewCartHandoff;
    window.__RIPX_TEST_HOOKS__.previewTestContext = PREVIEW_TEST_CONTEXT;
    window.__RIPX_TEST_HOOKS__.previewTestId = PREVIEW_TEST_ID;
    window.__RIPX_TEST_HOOKS__.previewSessionId = PREVIEW_SESSION_ID;
    window.__RIPX_TEST_HOOKS__.getUserId = getUserId;
    window.__RIPX_TEST_HOOKS__.ensureBatchFetched = ensureBatchFetched;
    window.__RIPX_TEST_HOOKS__.getVariantCachePromise = getVariantCachePromise;
    window.__RIPX_TEST_HOOKS__.getAntiFlickerDiagnostics = getAntiFlickerDiagnostics;
    window.__RIPX_TEST_HOOKS__.deferPdpPriceApplyUntilProductId = deferPdpPriceApplyUntilProductId;
    window.__RIPX_TEST_HOOKS__.shouldRunPriceTestOnCurrentPage = shouldRunPriceTestOnCurrentPage;
    window.__RIPX_TEST_HOOKS__.shouldShowShippingTestOnCart = shouldShowShippingTestOnCart;
    window.__RIPX_TEST_HOOKS__.injectShippingTestCartAttributes = injectShippingTestCartAttributes;
    window.__RIPX_TEST_HOOKS__.rememberRipxTargetUnitForVariant = rememberRipxTargetUnitForVariant;
    window.__RIPX_TEST_HOOKS__.rememberRipxPriceMethodForVariant =
      rememberRipxPriceMethodForVariant;
    window.__RIPX_TEST_HOOKS__.rememberRipxDiscountUnitForVariant =
      rememberRipxDiscountUnitForVariant;
    window.__RIPX_TEST_HOOKS__.setRipxCartAttributeState = function (payload) {
      _ripxCartAttributeState = payload || null;
    };
    window.__RIPX_TEST_HOOKS__.getRipxCartAttributeState = function () {
      return _ripxCartAttributeState;
    };
    window.__RIPX_TEST_HOOKS__.getRipxCartFormTargetProductIds = function () {
      return Array.isArray(_ripxCartFormTargetProductIds)
        ? _ripxCartFormTargetProductIds.slice()
        : _ripxCartFormTargetProductIds || null;
    };
  }
  debugLog('init', 'v' + SCRIPT_VERSION);
  window.__RIPX_LOADED__ = true;
  window.__RIPX_LOADING__ = false;
  window.__RIPX_LOADING_AT__ = 0;
})();
