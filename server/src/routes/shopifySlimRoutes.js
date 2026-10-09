const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireShop } = require('../middleware/shopContext');
const { getShopSession } = require('../models/shopSession');
const shopifyService = require('../services/shopifyService');
const { publicErrorMessage } = require('../utils/publicError');

const router = express.Router();

async function accessToken(req) {
  const { resolveShopifyAdminToken } = require('../utils/shopifyAdminToken');
  const session = await getShopSession(req.shopDomain).catch(() => null);
  return resolveShopifyAdminToken({
    requestToken: req.shopifyAccessToken,
    sessionToken: session?.access_token,
  });
}

router.get(
  '/store-resources',
  requireShop,
  asyncHandler(async (req, res) => {
    const token = await accessToken(req);
    const type = String(req.query.type || 'collection');
    const first = Math.min(Number(req.query.first) || 40, 100);
    // Passed through to Shopify's own resource query, which is how a caller
    // asks for something narrower — `published_status:published` for a product
    // that a storefront preview can actually load, for instance.
    const search = String(req.query.query || '').trim();
    if (!token) {
      return res.json({ success: true, resources: [], collections: [] });
    }
    try {
      if (type === 'product' && typeof shopifyService.listProducts === 'function') {
        const result = await shopifyService.listProducts(
          req.shopDomain,
          token,
          search,
          first,
          null
        );
        // listProducts pages, so it answers with { list, pageInfo } where
        // listCollections answers with a bare array.
        const products = Array.isArray(result) ? result : result?.list || [];
        return res.json({ success: true, resources: products, products });
      }
      if (type === 'collection' && typeof shopifyService.listCollections === 'function') {
        const collections = await shopifyService.listCollections(
          req.shopDomain,
          token,
          search,
          first,
          null
        );
        return res.json({ success: true, resources: collections, collections });
      }
    } catch (err) {
      return res.status(502).json({
        success: false,
        error: publicErrorMessage(err, 'Shopify request failed'),
        resources: [],
      });
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
      return res.status(502).json({ error: publicErrorMessage(err, 'Shopify request failed') });
    }
  })
);

module.exports = router;
