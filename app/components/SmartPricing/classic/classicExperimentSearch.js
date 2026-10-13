import { formatClassicStatusLabel, getPlanProductTitle } from './classicExperimentHelpers';

/** Words in the query; every one has to appear somewhere in the test. */
export function classicSearchTerms(query) {
  return String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .map(term => term.trim())
    .filter(Boolean);
}

/** `gid://shopify/Product/123` is searched as `123` too, which is what a merchant sees. */
function withNumericId(value) {
  const text = String(value || '');
  const tail = /\/(\d+)$/.exec(text);
  return tail ? [text, tail[1]] : [text];
}

function planSearchText(plan) {
  const meta = plan?.metadata && typeof plan.metadata === 'object' ? plan.metadata : {};
  return [
    plan?.title,
    getPlanProductTitle(plan),
    plan?.product_title,
    plan?.variant_title,
    meta.variant_title,
    plan?.product_type,
    plan?.vendor,
    plan?.sku,
    plan?.handle || plan?.product_handle || meta.handle,
    plan?.hypothesis || meta.hypothesis,
    plan?.id,
    plan?.test_id,
    ...withNumericId(plan?.product_id),
    ...withNumericId(plan?.variant_id),
  ];
}

/**
 * Everything a merchant might type to find a test: its name, hypothesis,
 * type, owner, status, goal, and each product it covers.
 */
export function classicExperimentSearchText(experiment) {
  const plans = Array.isArray(experiment?.plans) ? experiment.plans : [];
  const draft = experiment?.wizardDraft || null;
  const status = experiment?.archived ? 'archived' : experiment?.status;
  const metric = String(experiment?.primaryMetric || '');
  return [
    experiment?.title,
    experiment?.hypothesis,
    experiment?.typeLabel,
    experiment?.owner,
    status,
    status ? formatClassicStatusLabel(status, experiment?.experimentType) : '',
    metric,
    metric.replace(/_/g, ' '),
    experiment?.id,
    draft?.name,
    draft?.hypothesis,
    ...plans.flatMap(planSearchText),
  ]
    .map(value => String(value || '').toLowerCase())
    .filter(Boolean)
    .join('\n');
}

/**
 * Whether the experiment matches the search box.
 *
 * Matched as a whole, not plan by plan: filtering plans first showed an
 * experiment with only the products that matched, and worked its status out
 * from that subset.
 */
export function classicExperimentMatchesQuery(experiment, query) {
  const terms = classicSearchTerms(query);
  if (!terms.length) return true;
  const text = classicExperimentSearchText(experiment);
  return terms.every(term => text.includes(term));
}
