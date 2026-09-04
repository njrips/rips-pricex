/**
 * Actionable hints appended to checkout readiness messages.
 */

const SETTINGS_INSTALLATION_TAB = 'Settings → Installation';
const SETTINGS_PRICE_SURFACES_TAB = 'Settings → Price surfaces';

function withHint(message, hint) {
  const base = String(message || '').trim();
  const extra = String(hint || '').trim();
  if (!extra) {
    return base;
  }
  if (base.toLowerCase().includes(extra.toLowerCase())) {
    return base;
  }
  return `${base} ${extra}`;
}

function enrichCheckoutReadinessCheck(check = {}) {
  const id = String(check?.id || '').trim();
  let message = String(check?.message || '').trim();
  let actionPath = null;

  if (id === 'pricing_direct_price_override_ready' && check.ok === false) {
    actionPath = `${SETTINGS_INSTALLATION_TAB} → Cart transform → Ensure`;
    message = withHint(
      message,
      `Fix in Priceify: open ${actionPath}, then re-run Setup or Review.`
    );
  } else if (id === 'pricing_assignment_signing_ready' && check.ok === false) {
    actionPath =
      'Server env: RIPX_PRICE_ASSIGNMENT_SIGNATURE_SECRET or RIPX_CHECKOUT_PRICE_SECRET';
    message = withHint(message, `Set ${actionPath} on the API host and redeploy.`);
  } else if (id === 'pricing_shopify_plus_required' && check.ok === false) {
    actionPath = 'Shopify Admin → upgrade to Plus, or use a partner development store for testing';
    message = withHint(
      message,
      'Cart Transform price tests are not available on standard Shopify plans.'
    );
  } else if (id === 'pricing_storefront_surface_mapping' && check.ok === false) {
    actionPath = SETTINGS_PRICE_SURFACES_TAB;
    message = withHint(message, `Map selectors under ${actionPath}.`);
  } else if (id === 'pricing_storefront_surface_coverage' && check.ok === false) {
    actionPath = SETTINGS_PRICE_SURFACES_TAB;
    message = withHint(message, `Complete missing selector mappings under ${actionPath}.`);
  } else if (id === 'shopify_access_token_present' && check.ok === false) {
    actionPath = 'Shopify Admin → Apps → Priceify (re-open the app to refresh the offline token)';
    message = withHint(message, `Reconnect via ${actionPath}.`);
  } else if (id === 'storefront_runtime_ready' && check.ok === false) {
    actionPath = `${SETTINGS_INSTALLATION_TAB} → theme app embed and app proxy`;
    message = withHint(message, `Verify storefront setup under ${actionPath} or open Setup.`);
  } else if (id === 'shopify_oauth_health' && check.ok === false) {
    actionPath = 'Shopify Admin → Apps → Priceify (open in a fresh session)';
    message = withHint(message, `Reconnect the store via ${actionPath}.`);
  }

  return {
    ...check,
    message,
    ...(actionPath ? { action_path: actionPath } : {}),
  };
}

module.exports = {
  enrichCheckoutReadinessCheck,
  SETTINGS_INSTALLATION_TAB,
  SETTINGS_PRICE_SURFACES_TAB,
};
