const SECRET_KEY = /token|secret|password|authorization|access_token|refresh_token/i;

function sanitizeDiagnostics(value, depth = 0) {
  if (depth > 6 || value == null) return value == null ? null : undefined;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeDiagnostics(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) continue;
      out[key] = sanitizeDiagnostics(nested, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') return value.slice(0, 500);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return undefined;
}

function pickRecentPlans(plans) {
  const list = Array.isArray(plans) ? plans : [];
  return list.slice(0, 5).map((plan) => ({
    id: plan.id || plan.plan_id || null,
    title: plan.title || plan.name || null,
    status: plan.status || null,
    test_id: plan.test_id || null,
  }));
}

function pickReadinessSnapshot(readiness) {
  if (!readiness || typeof readiness !== 'object') return {};
  const surface =
    readiness.price_surface && typeof readiness.price_surface === 'object'
      ? readiness.price_surface
      : {};
  return {
    checkout_ready: readiness.ready === true,
    live_api_checked: readiness.live_api_checked === true,
    checks_passed: Number.isFinite(Number(readiness.checks_passed))
      ? Number(readiness.checks_passed)
      : null,
    checks_total: Number.isFinite(Number(readiness.checks_total))
      ? Number(readiness.checks_total)
      : null,
    failed_checks: Array.isArray(readiness.failed_checks)
      ? readiness.failed_checks.slice(0, 8)
      : [],
    discount_function_available: readiness.discount_function_available === true,
    automatic_discount_available: readiness.automatic_discount_available === true,
    cart_transforms_lookup_status: readiness.cart_transforms_lookup_status || null,
    price_surface_ready: surface.ready === true,
    price_surface_status: surface.status || null,
    price_surface_configured: Number.isFinite(Number(surface.configured_shop))
      ? Number(surface.configured_shop)
      : null,
  };
}

function previewLastMessage(body, max = 120) {
  const text = String(body || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  const limit = Math.max(24, Number(max) || 120);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function yesNo(value) {
  return value === true ? 'yes' : 'no';
}

function summarizeDiagnostics(diagnostics) {
  const d = diagnostics && typeof diagnostics === 'object' ? diagnostics : {};
  const failed = Array.isArray(d.failed_checks) ? d.failed_checks.filter(Boolean) : [];
  const checks =
    d.checks_passed != null && d.checks_total != null
      ? `${d.checks_passed}/${d.checks_total}`
      : '—';
  return [
    ['Shop', d.shop || '—'],
    ['Plan', d.plan_handle || '—'],
    ['Entitled', yesNo(d.entitled === true)],
    ['Entitlement', d.entitlement_status || '—'],
    ['Checkout ready', yesNo(d.checkout_ready === true)],
    ['Live Shopify check', yesNo(d.live_api_checked === true)],
    ['Checks', checks],
    ['Theme prices mapped', yesNo(d.price_surface_ready === true)],
    ['Discount function', yesNo(d.discount_function_available === true)],
    ['Cart transforms', d.cart_transforms_lookup_status || '—'],
    ['Running tests', d.running_price_tests != null ? String(d.running_price_tests) : '—'],
    ['Offline session', yesNo(d.has_offline_session === true)],
    ['Failed checks', failed.length ? failed.join('; ') : 'none'],
  ];
}

module.exports = {
  SECRET_KEY,
  sanitizeDiagnostics,
  pickRecentPlans,
  pickReadinessSnapshot,
  previewLastMessage,
  summarizeDiagnostics,
};
