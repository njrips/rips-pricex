/** Keep in sync with storefront/storefront-script.js offer PDP paint. */
export const OFFER_PDP_MESSAGE_ATTR = 'data-ripx-offer-pdp-message';
export const OFFER_PDP_TEST_ATTR = 'data-ripx-offer-test';
export const OFFER_PDP_STACK_ATTR = 'data-ripx-offer-pdp';
export const OFFER_PDP_CUTOUT_ATTR = 'data-ripx-offer-pdp-cutout';
export const OFFER_PDP_HOST_PAINTED_ATTR = 'data-ripx-offer-cutout-painted';
export const OFFER_PDP_HOST_HIDDEN_ATTR = 'data-ripx-offer-cutout-hidden';

/** Horizon `product-price`, then Dawn `.price`, then common wrappers. */
export const OFFER_PDP_HOST_SELECTOR =
  'product-price, .price, .product__price, .product-price, .product-single__price, [data-price-container], sale-price, .product-form__price';

/** Skip recommendation / complementary cards even when they sit inside the product section. */
export const OFFER_PDP_RELATED_SEL =
  '.recommended-products,.related-products,product-recommendations,.product-recommendations,[data-section-type="recently-viewed"],[id*="related"],[id*="recommend"],[id*="complementary"],.complementary-products';

/**
 * Prefer the outer price block so the message sits below the amount, not inside the money node.
 */
export function resolveOfferPdpMessageHost(el) {
  if (!el || typeof el.closest !== 'function') return el || null;
  const horizon = el.closest('product-price');
  if (horizon) return horizon;
  const priceBlock = el.closest('.price');
  if (priceBlock) return priceBlock;
  const themed = el.closest(
    '.product__price, .product-price, .product-single__price, [data-price-container], sale-price, .product-form__price'
  );
  return themed || el;
}

/**
 * Climb out of shadow roots so the stack sits in light DOM after product-price / .price
 * (below the theme cutout), instead of inside a flex price row that clips the message.
 */
export function resolveOfferPdpLightHost(el) {
  let node = el;
  while (node) {
    const root = typeof node.getRootNode === 'function' ? node.getRootNode() : null;
    if (root && root !== node && root.host) {
      node = root.host;
      continue;
    }
    break;
  }
  return resolveOfferPdpMessageHost(node);
}

export function isOfferPdpInjectedNode(node) {
  if (!node || typeof node.hasAttribute !== 'function') return false;
  return (
    node.hasAttribute(OFFER_PDP_STACK_ATTR) ||
    node.hasAttribute(OFFER_PDP_MESSAGE_ATTR) ||
    node.hasAttribute(OFFER_PDP_CUTOUT_ATTR)
  );
}

/**
 * Stay put when the node is already in the offer-message chain after the host
 * (one or more tests can stack). Move when the parent differs or it is elsewhere.
 */
export function offerPdpMessageNodeNeedsMove(node, host) {
  if (!node || !host) return true;
  if (node.parentNode && host.parentNode && node.parentNode !== host.parentNode) return true;
  let walk = host.nextElementSibling;
  while (walk) {
    if (walk === node) return false;
    if (!isOfferPdpInjectedNode(walk)) break;
    walk = walk.nextElementSibling;
  }
  return true;
}
