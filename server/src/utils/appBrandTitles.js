/**
 * Recognising this app's own Shopify Functions in a merchant's shop.
 *
 * Shopify only gives us a function's title and API type, so picking ours out of
 * a shop that may also run other apps' functions comes down to matching the
 * title against the names we ship extensions under. Three call sites each kept
 * their own copy of that list, which is why renaming the app to Priceify
 * silently orphaned every shop whose function is still titled "Pricify …".
 *
 * Old names must stay here permanently: the title in a shop is whatever it was
 * when the extension was last deployed there, not what the current source says.
 */

/** Lowercase substrings that identify a function as ours. */
const APP_FUNCTION_TITLE_TOKENS = Object.freeze([
  'priceify',
  // Shipped as "Pricify …" before the 2026-09 rename. Shops keep that title
  // until the extension is redeployed, and some never will be.
  'pricify',
  'ripspricex',
  'rips price',
  'ripx',
]);

/**
 * @param {string} title a Shopify function title
 * @returns {boolean} whether the title names one of this app's functions
 */
function titleLooksLikeAppFunction(title) {
  const normalized = String(title || '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return false;
  }
  return APP_FUNCTION_TITLE_TOKENS.some(token => normalized.includes(token));
}

module.exports = {
  APP_FUNCTION_TITLE_TOKENS,
  titleLooksLikeAppFunction,
};
