/**
 * Price-test track + proxy surface for RipsPriceX storefront runtime.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const { query } = require('../utils/database');
const { getActiveTestsForStorefront, getTestById } = require('../models/test');
const {
  buildStorefrontRuntimeConfig,
  buildEarlyStorefrontAntiFlickerBootstrap,
  getStorefrontScriptCacheControl,
  mapTestToStorefrontPayload,
  isStorefrontEmbeddedTestType,
  SCRIPT_VERSION,
} = require('../utils/storefrontScriptRuntime');
const { withAssignmentProof, signAssignedVariants } = require('../utils/assignmentProof');
const {
  normalizeEventValue,
  assignmentProofFailure,
  MAX_BATCH_TEST_IDS,
} = require('../utils/trackedEventIntegrity');
const { listGoalMetricDefinitions } = require('../models/goalMetricDefinition');
const { getShopPriceSurfaceMappings } = require('../services/priceSurfaceRegistryService');
const abTestEngine = require('../services/abTestEngine');
const {
  assignmentContextFromQuery,
  jsTargetingOverridesFromQuery,
} = require('../utils/storefrontAssignmentContext');
const logger = require('../utils/logger');
const { createTrackRateLimit } = require('../middleware/trackRateLimit');
const { verifyAppProxySignature } = require('../utils/appProxySignature');
const { publicErrorMessage } = require('../utils/publicError');

const router = express.Router();
const trackRateLimit = createTrackRateLimit();
router.use((req, res, next) => (req.method === 'POST' ? trackRateLimit(req, res, next) : next()));

router.use((req, res, next) => {
  if (!String(req.baseUrl || '').endsWith('/proxy')) return next();
  const secret = String(process.env.SHOPIFY_API_SECRET || '').trim();
  if (!secret || !verifyAppProxySignature(req.query, secret)) {
    return res.status(401).json({ error: 'Invalid app proxy signature' });
  }
  return next();
});

const installedShopCache = new Map();

/** 'installed' | 'not_installed' | 'unavailable' */
async function shopInstallStatus(shop) {
  const cachedUntil = installedShopCache.get(shop) || 0;
  if (cachedUntil > Date.now()) return 'installed';
  try {
    const result = await query(
      `SELECT 1
         FROM shop_sessions
        WHERE LOWER(TRIM(shop_domain)) = $1
          AND access_token IS NOT NULL
          AND BTRIM(access_token) <> ''
        LIMIT 1`,
      [shop]
    );
    if ((result.rowCount || 0) < 1) return 'not_installed';
    installedShopCache.set(shop, Date.now() + 60_000);
    return 'installed';
  } catch (error) {
    logger.error('installed shop check failed', { shop, message: error.message });
    return 'unavailable';
  }
}

async function requireInstalledShop(req, res) {
  const shop = resolveShop(req);
  if (!shop) return null;
  const status = await shopInstallStatus(shop);
  if (status === 'not_installed') {
    res.status(403).json({ error: 'Shop is not installed' });
    return null;
  }
  if (status === 'unavailable') {
    res.status(503).json({ error: 'Shop install status unavailable' });
    return null;
  }
  return shop;
}

/** A *.myshopify.com preview target names its shop even when the link dropped shop=. */
function previewTargetShop(targetUrl) {
  try {
    const host = new URL(String(targetUrl || '')).hostname.toLowerCase();
    return host.endsWith('.myshopify.com') ? host : '';
  } catch {
    return '';
  }
}

const gzip = promisify(zlib.gzip);
const brotliCompress = promisify(zlib.brotliCompress);
const STOREFRONT_SCRIPT_PATH = path.resolve(__dirname, '../../../storefront/storefront-script.js');
let scriptBodyCache = { mtimeMs: -1, body: '' };

function loadScriptBody() {
  let stat;
  try {
    stat = fs.statSync(STOREFRONT_SCRIPT_PATH);
  } catch {
    return '/* missing storefront script */';
  }
  if (stat.mtimeMs !== scriptBodyCache.mtimeMs) {
    scriptBodyCache = {
      mtimeMs: stat.mtimeMs,
      body: fs.readFileSync(STOREFRONT_SCRIPT_PATH, 'utf8'),
    };
  }
  return scriptBodyCache.body;
}

const COMPRESSED_SCRIPT_CACHE_MAX = 64;
const compressedScriptCache = new Map();

function pickScriptEncoding(req) {
  const accepted = String(req.get('Accept-Encoding') || '').toLowerCase();
  if (/\bbr\b/.test(accepted)) return 'br';
  if (/\bgzip\b/.test(accepted)) return 'gzip';
  return '';
}

async function compressScriptBody(body, encoding) {
  const key = `${encoding}:${crypto.createHash('sha1').update(body).digest('base64')}`;
  const cached = compressedScriptCache.get(key);
  if (cached) {
    compressedScriptCache.delete(key);
    compressedScriptCache.set(key, cached);
    return cached;
  }
  const compressed =
    encoding === 'br'
      ? await brotliCompress(body, {
          params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
            [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
          },
        })
      : await gzip(body, { level: 6 });
  compressedScriptCache.set(key, compressed);
  if (compressedScriptCache.size > COMPRESSED_SCRIPT_CACHE_MAX) {
    compressedScriptCache.delete(compressedScriptCache.keys().next().value);
  }
  return compressed;
}

function resolveShop(req) {
  // Storefront appendTrackTenantParams uses shop_domain= (Shopify) or site= (standalone).
  // Older clients / App Proxy use shop=. Accept all aliases.
  return String(
    req.query.shop ||
      req.query.shop_domain ||
      req.query.domain ||
      req.query.site ||
      req.get('X-Shopify-Shop-Domain') ||
      req.body?.shop ||
      req.body?.shop_domain ||
      req.body?.site ||
      ''
  )
    .toLowerCase()
    .trim();
}

async function serveScript(req, res) {
  const shop = resolveShop(req);
  let activeTests = [];
  let goalMetricDefinitions = [];
  let shopPriceSurfaceMappings = [];
  let globalAssetsRuntime = { beforeRuntime: '', afterRuntime: '' };
  try {
    if (shop) {
      const {
        getShopGlobalAssets,
        globalAssetsRuntimeSource,
      } = require('../services/shopGlobalAssetsService');
      const [tests, goals, surfaces, globalAssets] = await Promise.all([
        getActiveTestsForStorefront(shop).catch(err => {
          logger.warn('active tests load failed', { shop, message: err.message });
          return [];
        }),
        listGoalMetricDefinitions(shop).catch(() => []),
        getShopPriceSurfaceMappings(shop).catch(() => []),
        getShopGlobalAssets(shop).catch(err => {
          logger.warn('global storefront snippets load failed', { shop, message: err.message });
          return null;
        }),
      ]);
      activeTests = (tests || []).filter((t) => isStorefrontEmbeddedTestType(t.type));
      goalMetricDefinitions = goals || [];
      shopPriceSurfaceMappings = surfaces || [];
      if (globalAssets) {
        globalAssetsRuntime = globalAssetsRuntimeSource(globalAssets);
      }
    }
  } catch (err) {
    logger.warn('active tests load failed', { message: err.message });
  }

  let config;
  try {
    config = buildStorefrontRuntimeConfig(
      shop,
      activeTests,
      req,
      goalMetricDefinitions,
      { shopMappings: shopPriceSurfaceMappings },
      {
        runtimeSource: 'ripspricex-track',
      }
    );
  } catch (err) {
    logger.error('storefront runtime config failed', { message: err.message });
    config = {
      apiUrl: '',
      shopDomain: shop || null,
      version: SCRIPT_VERSION,
      runtimeSource: 'ripspricex-track-fallback',
      activeTests: [],
      goalMetricDefinitions: [],
      priceSurfaceRegistry: { version: 1, shopMappings: [] },
    };
  }
  // apiUrl comes from resolvePublicAppUrl(req) inside buildStorefrontRuntimeConfig —
  // do not re-stamp RIPSPRICEX_PUBLIC_API_BASE here (stale after tunnel rotation).
  if (shop && config.runtimeSource !== 'ripspricex-track-fallback') {
    try {
      require('../services/storefrontHintService').noteServedStorefrontConfig(shop, config);
    } catch (err) {
      logger.warn('storefront hint note failed', { shop, message: err.message });
    }
  }

  let early = '';
  try {
    early = buildEarlyStorefrontAntiFlickerBootstrap
      ? buildEarlyStorefrontAntiFlickerBootstrap(
          config.activeTests,
          config.priceSurfaceRegistry
        )
      : '';
  } catch (err) {
    logger.warn('early anti-flicker bootstrap failed', { message: err.message });
  }
  const body =
    `${early}\nwindow.AB_TEST_RUNTIME_CONFIG=${JSON.stringify(config)};\n` +
    `${globalAssetsRuntime.beforeRuntime}${loadScriptBody()}\n${globalAssetsRuntime.afterRuntime}`;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader(
    'Cache-Control',
    getStorefrontScriptCacheControl?.({
      hasGlobalCustomAssets: Boolean(
        globalAssetsRuntime.beforeRuntime || globalAssetsRuntime.afterRuntime
      ),
    }) || 'public, max-age=60'
  );
  res.setHeader('Vary', 'Accept-Encoding');
  const encoding = pickScriptEncoding(req);
  if (encoding) {
    try {
      const compressed = await compressScriptBody(body, encoding);
      res.setHeader('Content-Encoding', encoding);
      res.send(compressed);
      return;
    } catch (err) {
      logger.warn('storefront script compression failed', { encoding, message: err.message });
    }
  }
  res.send(body);
}

router.get('/script.js', serveScript);
router.get('/script.js/script.js', serveScript);

router.get('/storefront-script-health', (_req, res) => {
  res.json({ ok: true, version: SCRIPT_VERSION, service: 'ripspricex' });
});

router.post('/client-error', (req, res) => {
  const payload = req.body && typeof req.body === 'object' ? req.body : {};
  const shop = resolveShop(req).slice(0, 255);
  const error = String(payload.error || 'ripx_storefront_error').slice(0, 160);
  let page = '';
  try {
    const parsed = new URL(String(payload.url || ''));
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      page = `${parsed.origin}${parsed.pathname}`.slice(0, 500);
    }
  } catch {
    page = '';
  }
  const rawMetadata =
    payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
  const metadata = {
    reason: String(rawMetadata.reason || '').slice(0, 160),
    version: String(rawMetadata.version || '').slice(0, 40),
    preview: rawMetadata.preview === true,
    fallbackConfigured: rawMetadata.fallbackConfigured === true,
    attemptCount: Math.max(0, Math.min(100, Number(rawMetadata.attemptCount) || 0)),
  };
  logger.warn('storefront client error', { shop: shop || null, error, page: page || null, metadata });
  return res.status(202).json({ ok: true });
});

router.get('/ping', (req, res) => {
  res.json({ ok: true, shop: resolveShop(req) || null });
});

router.get('/variants', async (req, res) => {
  try {
    const shop = await requireInstalledShop(req, res);
    if (!shop && res.headersSent) return undefined;
    const userId = String(req.query.user_id || req.query.userId || crypto.randomUUID());
    let testIds = [];
    if (req.query.test_ids) {
      testIds = String(req.query.test_ids)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        // A shop cannot have more live tests than this, and the list arrives
        // from an open endpoint that turns each id into DB and assignment work.
        // Uncapped, one request could ask for thousands.
        .slice(0, MAX_BATCH_TEST_IDS);
    } else if (req.query.test_id) {
      testIds = [String(req.query.test_id).trim()];
    }
    if (!shop || !testIds.length) {
      return res.status(400).json({ error: 'shop and test_id(s) required' });
    }
    const context = assignmentContextFromQuery(req.query, {
      userAgent: req.get('user-agent'),
      userIp: req.ip,
    });
    const result = await abTestEngine.getVariantsBatch(
      testIds,
      userId,
      shop,
      context,
      jsTargetingOverridesFromQuery(req.query)
    );
    res.json({
      success: true,
      variants: signAssignedVariants(result, { userId, shopDomain: shop }),
      user_id: userId,
    });
  } catch (err) {
    logger.error('variants failed', { message: err.message });
    res.status(500).json({ error: publicErrorMessage(err) });
  }
});

router.get('/variant', async (req, res) => {
  try {
    const shop = await requireInstalledShop(req, res);
    if (!shop && res.headersSent) return undefined;
    const userId = String(req.query.user_id || req.query.userId || crypto.randomUUID());
    const testId = String(req.query.test_id || '').trim();
    if (!shop || !testId) {
      return res.status(400).json({ error: 'shop and test_id required' });
    }
    const context = assignmentContextFromQuery(req.query, {
      userAgent: req.get('user-agent'),
      userIp: req.ip,
    });
    const result = await abTestEngine.getVariantsBatch(
      [testId],
      userId,
      shop,
      context,
      jsTargetingOverridesFromQuery(req.query)
    );
    const signed = signAssignedVariants(result, { userId, shopDomain: shop });
    res.json({
      success: true,
      variant: signed?.[testId] || null,
      variants: signed,
      user_id: userId,
    });
  } catch (err) {
    logger.error('variant failed', { message: err.message });
    res.status(500).json({ error: publicErrorMessage(err) });
  }
});

router.get(['/preview', '/preview-storefront-test'], async (req, res) => {
  try {
    const { findVariantForPreviewQuery } = require('../utils/previewVariantMatch');
    const shop = resolveShop(req);
    const testId = String(req.query.test_id || '').trim();
    if (!shop || !testId) {
      return res.status(400).json({ error: 'shop and test_id required' });
    }
    const installedShop = await requireInstalledShop(req, res);
    if (!installedShop) return undefined;
    const test = await getTestById(testId, shop);
    if (!test || test.shop_domain !== shop) {
      return res.status(404).json({ error: 'Test not found' });
    }
    const variants = Array.isArray(test.variants) ? test.variants : [];
    const variantId = String(
      req.query.variant_id || req.query.variantId || req.query.variant || ''
    ).trim();
    const variantName = String(
      req.query.variant_name || req.query.variantName || ''
    ).trim();
    const userId = String(req.query.user_id || req.query.userId || '').trim() ||
      `ripx_preview_${crypto.randomUUID().slice(0, 12)}`;
    // Prefer soft match (UUID + "$884.94 Variation A" ↔ "Variation A"). Never silently
    // fall through to variants[0] (usually Control) when the client asked for a name/id.
    const forced =
      findVariantForPreviewQuery(variants, {
        variant_id: variantId || undefined,
        variant_name: variantName || undefined,
      }) ||
      (!variantId && !variantName ? variants[0] : null) ||
      null;
    if ((variantId || variantName) && !forced) {
      logger.warn('preview variant unmatched', {
        shop,
        testId,
        variantId: variantId || null,
        variantName: variantName || null,
        available: variants.map((v) => ({ id: v?.id, name: v?.name })),
      });
    }

    const variantOut = forced
      ? withAssignmentProof(forced, { testId, userId, shopDomain: shop })
      : forced;

    res.json({
      success: true,
      test: mapTestToStorefrontPayload(test),
      variant: variantOut,
      preview: true,
      matched: Boolean(forced),
      user_id: userId,
      match_query: {
        variant_id: variantId || null,
        variant_name: variantName || null,
      },
    });
  } catch (err) {
    logger.error('preview failed', { message: err.message });
    res.status(500).json({ error: publicErrorMessage(err) });
  }
});

router.get(['/preview-document', '/preview-document/'], async (req, res) => {
  const { servePreviewDocument, buildErrorPage } = require('./previewDocument');
  const parentOrigin = String(req.query.parent_origin || '').trim();
  // The admin modal shows this document as-is, so every failure has to be a page
  // that says what went wrong; a bare comment or JSON reads as a blank preview.
  const sendError = (status, title, message, reason) =>
    res
      .status(status)
      .type('html')
      .send(buildErrorPage({ title, message, parentOrigin, reason }));
  try {
    const shop = resolveShop(req) || previewTargetShop(req.query.url || req.query.target);
    if (!shop) {
      return sendError(
        400,
        'Shop not specified',
        'Open the picker from the Priceify app in your Shopify admin so it knows which store to preview.',
        'missing_shop'
      );
    }
    const status = await shopInstallStatus(shop);
    if (status === 'not_installed') {
      return sendError(
        403,
        'Priceify is not connected to this store',
        'Open Priceify from this store\u2019s Shopify admin to reconnect it, then try Pick again.',
        'not_installed'
      );
    }
    if (status === 'unavailable') {
      return sendError(
        503,
        'Preview unavailable',
        'Priceify could not confirm this store right now. Try Pick again in a moment.',
        'install_status_unavailable'
      );
    }
    return servePreviewDocument(req, res, { shop });
  } catch (err) {
    logger.error('preview-document failed', { message: err.message, stack: err.stack });
    return sendError(
      500,
      'Preview unavailable',
      'Something went wrong loading your storefront. Try Pick again.',
      'server_error'
    );
  }
});

router.get(['/preview-launch', '/preview-launch/'], async (req, res) => {
  try {
    const { servePreviewLaunch } = require('./previewDocument');
    return servePreviewLaunch(req, res);
  } catch (err) {
    logger.error('preview-launch failed', { message: err.message, stack: err.stack });
    res.status(500).type('html').send(`<!-- preview-launch error: ${publicErrorMessage(err)} -->`);
  }
});

const EXPOSURE_TEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The storefront showed this shopper a product these tests price. Product
 * price tests launched since migration 010 count a visitor from here rather
 * than from the assignment, which every page view makes. Only the first
 * exposure is kept, and only for an assignment that already exists.
 */
router.post('/exposure', async (req, res) => {
  try {
    const shop = resolveShop(req);
    const body = req.body || {};
    const userId = String(body.user_id || body.userId || '').trim();
    const testIds = [
      ...new Set(
        (Array.isArray(body.test_ids) ? body.test_ids : [])
          .map(id => String(id || '').trim().toLowerCase())
          .filter(id => EXPOSURE_TEST_ID_RE.test(id))
      ),
    ].slice(0, MAX_BATCH_TEST_IDS);
    if (!shop || !userId || !testIds.length) {
      return res.status(400).json({ error: 'shop, user_id, test_ids required' });
    }
    const installedShop = await requireInstalledShop(req, res);
    if (!installedShop) return undefined;
    const result = await query(
      `UPDATE test_assignments
       SET exposed_at = NOW()
       WHERE exposed_at IS NULL
         AND user_id = $1
         AND LOWER(TRIM(shop_domain)) = $2
         AND test_id = ANY($3::uuid[])
         AND test_id IN (
           SELECT id FROM tests WHERE LOWER(TRIM(shop_domain)) = $2
         )`,
      [userId, String(shop).toLowerCase().trim(), testIds]
    ).catch(err => {
      // Before migration 010 there is no column to stamp, and nothing reads it.
      if (err?.code === '42703') return { rowCount: 0 };
      throw err;
    });
    res.json({ ok: true, exposed: result.rowCount || 0 });
  } catch (err) {
    res.status(500).json({ error: publicErrorMessage(err) });
  }
});

router.post('/catalog-product-view', async (req, res) => {
  try {
    const shop = await requireInstalledShop(req, res);
    if (!shop && res.headersSent) return undefined;
    const productId = String(req.body?.product_id || req.body?.productId || '').trim();
    if (!shop || !productId) {
      return res.status(400).json({ error: 'shop and product_id required' });
    }
    const day = new Date().toISOString().slice(0, 10);
    // The storefront sends `visitor_key`. Reading only the other two names put
    // every shopper under 'anon', so each product counted one visitor a day.
    const sessionKey = String(
      req.body?.visitor_key || req.body?.session_key || req.body?.user_id || 'anon'
    );
    // The session row goes first so the day's rollup knows whether this view
    // came from a visitor it has already counted. The rollup used to set
    // sessions to 1 on insert and never touch it again, leaving a column that
    // read "1 visitor" no matter how many people saw the product.
    const session = await query(
      `INSERT INTO catalog_product_view_sessions (shop_domain, product_id, session_key, day)
       VALUES ($1, $2, $3, $4::date)
       ON CONFLICT DO NOTHING
       RETURNING session_key`,
      [shop, productId, sessionKey, day]
    ).catch(err => {
      // A dropped view costs an estimate a little accuracy, but silence here
      // once hid the whole measured-traffic feature being switched off.
      logger.warn('catalog product view session insert failed', {
        shop,
        message: err?.message,
      });
      return null;
    });
    const newVisitor = (session?.rows?.length || 0) > 0 ? 1 : 0;
    await query(
      `INSERT INTO catalog_product_view_daily (shop_domain, product_id, day, views, sessions)
       VALUES ($1, $2, $3::date, 1, $4)
       ON CONFLICT (shop_domain, product_id, day)
       DO UPDATE SET views = catalog_product_view_daily.views + 1,
                     sessions = catalog_product_view_daily.sessions + $4`,
      [shop, productId, day, newVisitor]
    ).catch(err => {
      logger.warn('catalog product view rollup insert failed', {
        shop,
        message: err?.message,
      });
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: publicErrorMessage(err) });
  }
});

router.post(['/', '/event', '/events'], async (req, res) => {
  try {
    const shop = await requireInstalledShop(req, res);
    if (!shop && res.headersSent) return undefined;
    const body = req.body || {};
    const testId = body.test_id || body.testId;
    const variantId = body.variant_id || body.variantId;
    const userId = body.user_id || body.userId || 'anon';
    const eventType = body.event_type || body.eventType || body.type || 'view';
    if (!shop || !testId || !variantId) {
      return res.status(400).json({ error: 'shop, test_id, variant_id required' });
    }
    const proofFailure = assignmentProofFailure(shop, body);
    if (proofFailure) {
      logger.warn('rejected a tracked event carrying a bad assignment proof', {
        shop,
        testId: String(testId),
        eventType: String(eventType),
        reason: proofFailure,
      });
      return res.status(403).json({ error: 'invalid assignment', reason: proofFailure });
    }
    const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
    const orderId = String(metadata.order_id ?? '').trim();
    // The storefront posts one conversion per painted price node on the order
    // page, and again on every reload. Analytics sums event_value, so each
    // repeat added the whole order total to revenue while conversions, counted
    // per distinct visitor, stayed put — quietly inflating revenue per visitor.
    // Idempotency is keyed on the order, which is the only thing that tells two
    // posts apart from a genuine second purchase. The conflict target is left
    // unnamed so this still runs on a database that has not taken migration 009
    // yet, where naming the index would raise 42P10 and drop the event instead.
    const dedupeConversion = String(eventType) === 'conversion' && orderId !== '';
    const inserted = await query(
      `INSERT INTO events (test_id, variant_id, user_id, shop_domain, event_type, event_name, event_value, metadata)
       SELECT $1::uuid, $2, $3, $4, $5, $6, $7, $8::jsonb
       WHERE EXISTS (
         SELECT 1
           FROM tests t
          WHERE t.id = $1::uuid
            AND LOWER(TRIM(t.shop_domain)) = LOWER(TRIM($4))
            AND EXISTS (
              SELECT 1
                FROM jsonb_array_elements(
                  CASE
                    WHEN jsonb_typeof(t.variants) = 'array' THEN t.variants
                    ELSE '[]'::jsonb
                  END
                ) variant
               WHERE variant->>'id' = $2
            )
       )
       ${dedupeConversion ? 'ON CONFLICT DO NOTHING' : ''}`,
      [
        testId,
        String(variantId),
        String(userId),
        shop,
        String(eventType),
        body.event_name || null,
        normalizeEventValue(body.event_value ?? body.value),
        JSON.stringify(metadata),
      ]
    );
    if ((inserted.rowCount || 0) < 1 && !dedupeConversion) {
      return res.status(403).json({ error: 'unknown test' });
    }
    res.json({ ok: true });
  } catch (err) {
    // The test was purged between the check above and the insert: a page
    // opened before the delete is still posting. Same answer as any unknown test.
    if (err?.code === '23503') {
      return res.status(403).json({ error: 'unknown test' });
    }
    logger.error('track event failed', { message: err.message });
    res.status(500).json({ error: publicErrorMessage(err) });
  }
});

router.get(
  [
    '/price-preview-bootstrap-v1',
    '/script.js/price-preview-bootstrap-v1',
    '/price-preview-bootstrap-v1/',
  ],
  async (req, res) => {
    try {
      // The bootstrap handler sets its own Content-Security-Policy.
      const { createPricePreviewBootstrapHandlers } = require('./pricePreviewBootstrap');
      const validatePreviewBootstrapRequest = async (request, response) => {
        const shop = resolveShop(request);
        const targetUrl = String(request.query.url || request.query.target || '').trim();
        if (!shop || !targetUrl) {
          response.status(400).type('html').send('<!-- missing shop or url -->');
          return null;
        }
        const installedShop = await requireInstalledShop(request, response);
        if (!installedShop) return null;
        return {
          normalizedShop: shop,
          shopDomain: shop,
          targetUrl,
          storefrontPassword:
            request.query.storefront_password || request.query.password || null,
        };
      };
      const { servePricePreviewBootstrap } = createPricePreviewBootstrapHandlers({
        validatePreviewBootstrapRequest,
        SCRIPT_VERSION,
      });
      // Patch hardcoded ripx script path inside built HTML via env for APP_URL
      return servePricePreviewBootstrap(req, res);
    } catch (err) {
      logger.error('price preview bootstrap failed', { message: err.message, stack: err.stack });
      res.status(500).type('html').send(`<!-- preview bootstrap error: ${publicErrorMessage(err)} -->`);
    }
  }
);

module.exports = router;
