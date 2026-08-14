/**
 * Session / shop context for RipsPriceX Express API.
 */

function getShopDomain(req) {
  const fromHeader =
    req.get('X-Shopify-Shop-Domain') ||
    req.get('X-RipPriceX-Shop') ||
    req.query.shop ||
    req.query.shop_domain ||
    req.query.domain ||
    req.query.site;
  const shop = String(fromHeader || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0];
  return shop || null;
}

function requireShop(req, res, next) {
  const shop = getShopDomain(req);
  if (!shop) {
    return res.status(401).json({ error: 'Shop domain required' });
  }
  req.shopDomain = shop;
  // Optional bearer / body token for install sync
  if (req.body?.access_token || req.body?.accessToken) {
    req.shopifyAccessToken = req.body.access_token || req.body.accessToken;
  }
  if (req.get('X-Shopify-Access-Token')) {
    req.shopifyAccessToken = req.get('X-Shopify-Access-Token');
  }
  next();
}

module.exports = { getShopDomain, requireShop };
