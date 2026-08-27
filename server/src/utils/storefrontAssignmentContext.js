/**
 * Map storefront /track/variant(s) query params into abTestEngine eligibility context.
 * The browser already sends current_url, current_product_id, device, etc.
 */

function truthyFlag(value) {
  const raw = String(value == null ? '' : value)
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function parseJsTargetingResults(raw) {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function assignmentContextFromQuery(query = {}, extras = {}) {
  const q = query && typeof query === 'object' ? query : {};
  const currentUrl = String(q.current_url || q.url || q.page_url || '').trim();
  const currentPathname = String(q.current_pathname || q.path || '').trim();
  return {
    url: currentUrl,
    path: currentPathname,
    preview: truthyFlag(q.preview) || truthyFlag(q.ab_preview),
    current_url: currentUrl,
    current_pathname: currentPathname,
    current_product_id: String(q.current_product_id || '').trim(),
    current_collection_id: String(q.current_collection_id || '').trim(),
    device: String(q.device || '').trim(),
    operating_system: String(q.operating_system || '').trim(),
    customer: String(q.customer || '').trim(),
    country: String(q.country || '').trim(),
    traffic_source: String(q.traffic_source || '').trim(),
    referrer: String(q.referrer || '').trim(),
    utm_source: String(q.utm_source || '').trim(),
    utm_medium: String(q.utm_medium || '').trim(),
    session_count: q.session_count,
    js_targeting_passed: q.js_targeting_passed,
    user_agent: extras.userAgent || extras.user_agent || '',
    user_ip: extras.userIp || extras.user_ip || '',
  };
}

function jsTargetingOverridesFromQuery(query = {}) {
  const q = query && typeof query === 'object' ? query : {};
  const parsed = parseJsTargetingResults(q.js_targeting_results);
  const overrides = {};
  Object.keys(parsed).forEach(id => {
    overrides[String(id)] = {
      js_targeting_passed: parsed[id] === true || parsed[id] === 'true' || parsed[id] === 1,
    };
  });
  const testId = String(q.test_id || '').trim();
  if (testId && q.js_targeting_passed != null && String(q.js_targeting_passed).trim() !== '') {
    overrides[testId] = {
      ...(overrides[testId] || {}),
      js_targeting_passed: truthyFlag(q.js_targeting_passed),
    };
  }
  return overrides;
}

module.exports = {
  assignmentContextFromQuery,
  jsTargetingOverridesFromQuery,
};
