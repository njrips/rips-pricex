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
const abTestEngine = require('../services/abTestEngine');
const logger = require('../utils/logger');

const router = express.Router();

function loadScriptBody() {
  const p = path.resolve(__dirname, '../../../storefront/storefront-script.js');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '/* missing storefront script */';
}

function resolveShop(req) {
  return String(
    req.query.shop ||
      req.query.domain ||
      req.get('X-Shopify-Shop-Domain') ||
      req.body?.shop ||
      ''
  )
    .toLowerCase()
    .trim();
}

async function serveScript(req, res) {
  const shop = resolveShop(req);
  let activeTests = [];
  try {
    if (shop) {
      const tests = await getActiveTestsForStorefront(shop);
      activeTests = (tests || []).filter((t) => t.type === 'price' || t.type === 'pricing');
    }
  } catch (err) {
    logger.warn('active tests load failed', { message: err.message });
  }

  const config = buildStorefrontRuntimeConfig(shop, activeTests, req, [], {}, {
    runtimeSource: 'ripspricex-track',
  });
  // Prefer public API base when set (tunnel / production)
  if (process.env.RIPSPRICEX_PUBLIC_API_BASE) {
    config.apiUrl = String(process.env.RIPSPRICEX_PUBLIC_API_BASE).replace(/\/+$/, '');
    if (!config.apiUrl.endsWith('/api')) {
      config.apiUrl = `${config.apiUrl}/api`;
    }
  }

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

router.get('/preview', async (req, res) => {
  try {
    const shop = resolveShop(req);
    const testId = String(req.query.test_id || '').trim();
    if (!shop || !testId) {
      return res.status(400).json({ error: 'shop and test_id required' });
    }
    const test = await getTestById(testId);
    if (!test || test.shop_domain !== shop) {
      return res.status(404).json({ error: 'Test not found' });
    }
    const variants = Array.isArray(test.variants) ? test.variants : [];
    const forced =
      variants.find((v) => String(v.id) === String(req.query.variant_id)) ||
      variants.find((v) => String(v.name) === String(req.query.variant)) ||
      variants[0] ||
      null;
    res.json({
      success: true,
      test: mapTestToStorefrontPayload(test),
      variant: forced,
      preview: true,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/preview-storefront-test', async (req, res) => {
  req.url = '/preview';
  return router.handle(req, res);
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
