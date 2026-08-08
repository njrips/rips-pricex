const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireShop } = require('../middleware/shopContext');
const { getShopSession } = require('../models/shopSession');
const shopifyService = require('../services/shopifyService');

const router = express.Router();

async function accessToken(req) {
  if (req.shopifyAccessToken) return req.shopifyAccessToken;
  const session = await getShopSession(req.shopDomain).catch(() => null);
  return session?.access_token || process.env.SHOPIFY_ACCESS_TOKEN || '';
}

router.get(
  '/store-resources',
  requireShop,
  asyncHandler(async (req, res) => {
    const token = await accessToken(req);
    const type = String(req.query.type || 'collection');
    const first = Math.min(Number(req.query.first) || 40, 100);
    if (!token) {
      return res.json({ success: true, resources: [], collections: [] });
    }
    try {
      if (type === 'collection' && typeof shopifyService.listCollections === 'function') {
        const collections = await shopifyService.listCollections(
          req.shopDomain,
          token,
          '',
          first,
          null
        );
        return res.json({ success: true, resources: collections, collections });
      }
    } catch (err) {
      return res.status(502).json({ success: false, error: err.message, resources: [] });
    }
    return res.json({ success: true, resources: [], collections: [] });
  })
);

router.get(
  '/products/:productId',
  requireShop,
  asyncHandler(async (req, res) => {
    const token = await accessToken(req);
    const productId = decodeURIComponent(req.params.productId);
    if (!token) {
      return res.status(401).json({ error: 'No Shopify access token for shop' });
    }
    try {
      const product =
        typeof shopifyService.getProductWithVariants === 'function'
          ? await shopifyService.getProductWithVariants(req.shopDomain, token, productId)
          : await shopifyService.getProduct(req.shopDomain, token, productId);
      return res.json({ success: true, product });
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
  })
);

module.exports = router;
