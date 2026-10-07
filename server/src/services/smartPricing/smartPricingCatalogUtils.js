function normalizeShopDomain(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function normalizeVariantGid(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  if (raw.startsWith('gid://shopify/ProductVariant/')) {
    return raw;
  }
  const numeric = raw.replace(/\D/g, '');
  if (numeric) {
    return `gid://shopify/ProductVariant/${numeric}`;
  }
  return raw;
}

function normalizeProductGid(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  if (raw.startsWith('gid://shopify/Product/')) {
    return raw;
  }
  const numeric = raw.replace(/\D/g, '');
  if (numeric) {
    return `gid://shopify/Product/${numeric}`;
  }
  return raw;
}

function normalizeCollectionGid(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  if (raw.startsWith('gid://shopify/Collection/')) {
    return raw;
  }
  const numeric = raw.replace(/\D/g, '');
  if (numeric) {
    return `gid://shopify/Collection/${numeric}`;
  }
  return raw;
}

function extractGidNumericId(gid) {
  const match = String(gid || '').match(/\/(\d+)$/);
  return match ? match[1] : '';
}

function parseMoney(value) {
  const num = Number.parseFloat(String(value ?? '').trim());
  return Number.isFinite(num) ? num : 0;
}

/** Unique Shopify products represented in SKU / opportunity rows. */
function countUniqueCatalogProducts(rows = []) {
  const keys = new Set();
  (Array.isArray(rows) ? rows : []).forEach(row => {
    const productId = normalizeProductGid(row?.product_id);
    if (productId) {
      keys.add(productId);
      return;
    }
    const variantId = normalizeVariantGid(row?.variant_id);
    if (variantId) keys.add(variantId);
  });
  return keys.size;
}

function isExcludedProductType(productType = '', tags = []) {
  const type = String(productType || '')
    .trim()
    .toLowerCase();
  const tagList = Array.isArray(tags)
    ? tags.map(tag =>
        String(tag || '')
          .trim()
          .toLowerCase()
      )
    : [];
  if (type.includes('gift card') || type.includes('gift_card')) {
    return true;
  }
  if (tagList.some(tag => tag.includes('gift-card') || tag === 'gift card')) {
    return true;
  }
  return false;
}

module.exports = {
  normalizeShopDomain,
  normalizeVariantGid,
  normalizeProductGid,
  normalizeCollectionGid,
  extractGidNumericId,
  parseMoney,
  isExcludedProductType,
  countUniqueCatalogProducts,
};
