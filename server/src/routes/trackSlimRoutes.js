/**
 * Price-test track + proxy surface for RipsPriceX storefront runtime.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { query } = require('../utils/database');
const { getActiveTestsForStorefront, getTestById } = require('../models/test');
const {
  buildStorefrontRuntimeConfig,
  buildEarlyStorefrontAntiFlickerBootstrap,
  getStorefrontScriptCacheControl,
  mapTestToStorefrontPayload,
  SCRIPT_VERSION,
} = require('../utils/storefrontScriptRuntime');
const { listGoalMetricDefinitions } = require('../models/goalMetricDefinition');
const { getShopPriceSurfaceMappings } = require('../services/priceSurfaceRegistryService');
const abTestEngine = require('../services/abTestEngine');
const logger = require('../utils/logger');

const router = express.Router();

function loadScriptBody() {
  const p = path.resolve(__dirname, '../../../storefront/storefront-script.js');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '/* missing storefront script */';
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
  try {
    if (shop) {
      const [tests, goals, surfaces] = await Promise.all([
        getActiveTestsForStorefront(shop),
        listGoalMetricDefinitions(shop).catch(() => []),
        getShopPriceSurfaceMappings(shop).catch(() => []),
      ]);
      activeTests = (tests || []).filter((t) => t.type === 'price' || t.type === 'pricing');
      goalMetricDefinitions = goals || [];
      shopPriceSurfaceMappings = surfaces || [];
    }
  } catch (err) {
    logger.warn('active tests load failed', { message: err.message });
  }

  const config = buildStorefrontRuntimeConfig(
    shop,
    activeTests,
    req,
    goalMetricDefinitions,
    { shopMappings: shopPriceSurfaceMappings },
    {
      runtimeSource: 'ripspricex-track',
    }
  );
  // apiUrl comes from resolvePublicAppUrl(req) inside buildStorefrontRuntimeConfig —
  // do not re-stamp RIPSPRICEX_PUBLIC_API_BASE here (stale after tunnel rotation).

  const early = buildEarlyStorefrontAntiFlickerBootstrap
    ? buildEarlyStorefrontAntiFlickerBootstrap(config)
    : '';
  const body = `${early}\nwindow.AB_TEST_RUNTIME_CONFIG=${JSON.stringify(config)};\n${loadScriptBody()}`;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', getStorefrontScriptCacheControl?.() || 'public, max-age=60');
  res.send(body);
}

router.get('/script.js', serveScript);
router.get('/script.js/script.js', serveScript);

router.get('/storefront-script-health', (_req, res) => {
  res.json({ ok: true, version: SCRIPT_VERSION, service: 'ripspricex' });
});

router.get('/ping', (req, res) => {
  res.json({ ok: true, shop: resolveShop(req) || null });
});

router.get('/variants', async (req, res) => {
  try {
    const shop = resolveShop(req);
    const userId = String(req.query.user_id || req.query.userId || crypto.randomUUID());
    let testIds = [];
    if (req.query.test_ids) {
      testIds = String(req.query.test_ids)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (req.query.test_id) {
      testIds = [String(req.query.test_id).trim()];
    }
    if (!shop || !testIds.length) {
      return res.status(400).json({ error: 'shop and test_id(s) required' });
    }
    const context = {
      url: req.query.url || req.query.page_url || '',
      path: req.query.path || '',
      preview: req.query.preview === '1' || req.query.ab_preview === '1',
    };
    const result = await abTestEngine.getVariantsBatch(testIds, userId, shop, context);
    res.json({ success: true, variants: result, user_id: userId });
  } catch (err) {
    logger.error('variants failed', { message: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.get('/variant', async (req, res) => {
  try {
    const shop = resolveShop(req);
    const userId = String(req.query.user_id || req.query.userId || crypto.randomUUID());
    const testId = String(req.query.test_id || '').trim();
    if (!shop || !testId) {
      return res.status(400).json({ error: 'shop and test_id required' });
    }
    const context = {
      url: req.query.url || '',
      path: req.query.path || '',
      preview: req.query.preview === '1',
    };
    const result = await abTestEngine.getVariantsBatch([testId], userId, shop, context);
    res.json({ success: true, variant: result?.[testId] || null, variants: result, user_id: userId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get(['/preview', '/preview-storefront-test'], async (req, res) => {
  try {
    const { findVariantForPreviewQuery } = require('../utils/previewVariantMatch');
    const { signPriceAssignment } = require('../utils/priceAssignmentSignature');
    const shop = resolveShop(req);
    const testId = String(req.query.test_id || '').trim();
    if (!shop || !testId) {
      return res.status(400).json({ error: 'shop and test_id required' });
    }
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

    let variantOut = forced;
    if (forced) {
      const forcedId =
        forced.id !== undefined && forced.id !== null ? String(forced.id).trim() : '';
      const issuedAtMs = Date.now();
      const hmac = forcedId
        ? signPriceAssignment({
            testId,
            variantId: forcedId,
            userId,
            shopDomain: shop,
            issuedAtMs,
          })
        : null;
      // Cart Transform only checks presence of proof attrs; HMAC is preferred when secret exists.
      variantOut = {
        ...forced,
        assignment_sig: hmac || `preview:${testId}:${forcedId || 'arm'}`,
        assignment_ts: String(issuedAtMs),
        assignment_user: userId,
      };
    }

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
    res.status(500).json({ error: err.message });
  }
});

router.get(['/preview-document', '/preview-document/'], async (req, res) => {
  try {
    const { servePreviewDocument } = require('./previewDocument');
    return servePreviewDocument(req, res);
  } catch (err) {
    logger.error('preview-document failed', { message: err.message, stack: err.stack });
    res.status(500).type('html').send(`<!-- preview-document error: ${err.message} -->`);
  }
});

router.get(['/preview-launch', '/preview-launch/'], async (req, res) => {
  try {
    const { servePreviewLaunch } = require('./previewDocument');
    return servePreviewLaunch(req, res);
  } catch (err) {
    logger.error('preview-launch failed', { message: err.message, stack: err.stack });
    res.status(500).type('html').send(`<!-- preview-launch error: ${err.message} -->`);
  }
});

router.post('/catalog-product-view', async (req, res) => {
  try {
    const shop = resolveShop(req);
    const productId = String(req.body?.product_id || req.body?.productId || '').trim();
    if (!shop || !productId) {
      return res.status(400).json({ error: 'shop and product_id required' });
    }
    const day = new Date().toISOString().slice(0, 10);
    const sessionKey = String(req.body?.session_key || req.body?.user_id || 'anon');
    await query(
      `INSERT INTO catalog_product_view_daily (shop_domain, product_id, day, views, sessions)
       VALUES ($1, $2, $3::date, 1, 1)
       ON CONFLICT (shop_domain, product_id, day)
       DO UPDATE SET views = catalog_product_view_daily.views + 1`,
      [shop, productId, day]
    ).catch(() => {});
    await query(
      `INSERT INTO catalog_product_view_sessions (shop_domain, product_id, session_key, day)
       VALUES ($1, $2, $3, $4::date)
       ON CONFLICT DO NOTHING`,
      [shop, productId, sessionKey, day]
    ).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post(['/', '/event', '/events'], async (req, res) => {
  try {
    const shop = resolveShop(req);
    const body = req.body || {};
    const testId = body.test_id || body.testId;
    const variantId = body.variant_id || body.variantId;
    const userId = body.user_id || body.userId || 'anon';
    const eventType = body.event_type || body.eventType || body.type || 'view';
    if (!shop || !testId || !variantId) {
      return res.status(400).json({ error: 'shop, test_id, variant_id required' });
    }
    await query(
      `INSERT INTO events (test_id, variant_id, user_id, shop_domain, event_type, event_name, event_value, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        testId,
        String(variantId),
        String(userId),
        shop,
        String(eventType),
        body.event_name || null,
        Number(body.event_value || body.value || 0) || 0,
        JSON.stringify(body.metadata || {}),
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
      const { createPricePreviewBootstrapHandlers, PRICE_PREVIEW_BOOTSTRAP_CSP } = require(
        './pricePreviewBootstrap'
      );
      const validatePreviewBootstrapRequest = async (request, response) => {
        const shop = resolveShop(request);
        const targetUrl = String(request.query.url || request.query.target || '').trim();
        if (!shop || !targetUrl) {
          response.status(400).type('html').send('<!-- missing shop or url -->');
          return null;
        }
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
      res.status(500).type('html').send(`<!-- preview bootstrap error: ${err.message} -->`);
    }
  }
);

module.exports = router;
