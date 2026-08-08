/**
 * Classic Smart Pricing: group per-SKU inbox plans into experiment rows.
 */

export function classicWizardDraftKey(domain) {
  return `ripx_sp_classic_wizard_${String(domain || 'default')}`;
}

export function readClassicWizardDraft(domain) {
  try {
    const raw = localStorage.getItem(classicWizardDraftKey(domain));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function writeClassicWizardDraft(domain, snapshot) {
  const payload = {
    ...(snapshot || {}),
    saved_at: new Date().toISOString(),
  };
  localStorage.setItem(classicWizardDraftKey(domain), JSON.stringify(payload));
  return payload;
}

export function clearClassicWizardDraft(domain) {
  localStorage.removeItem(classicWizardDraftKey(domain));
}

export function getPlanExperimentId(plan) {
  return (
    String(plan?.metadata?.experiment_id || plan?.experiment_id || plan?.batch_id || '').trim() ||
    null
  );
}

export function getPlanExperimentTitle(plan) {
  const metaTitle = String(plan?.metadata?.experiment_title || plan?.experiment_title || '').trim();
  if (metaTitle) return metaTitle;
  const raw = String(plan?.title || '').trim();
  const sep = raw.indexOf(' · ');
  if (sep > 0) return raw.slice(0, sep).trim() || 'Untitled experiment';
  return raw || 'Untitled experiment';
}

export function getPlanProductTitle(plan) {
  return (
    String(plan?.product_title || plan?.metadata?.product_title || '').trim() ||
    (() => {
      const raw = String(plan?.title || '').trim();
      const sep = raw.indexOf(' · ');
      return sep > 0 ? raw.slice(sep + 3).trim() : raw;
    })() ||
    'Product'
  );
}

function statusRank(plan) {
  if (plan?.archived) return 0;
  if (plan?.status === 'running' || plan?.test_id) return 50;
  if (plan?.status === 'winner_ready') return 40;
  if (plan?.status === 'applied' || plan?.status === 'completed') return 35;
  if (plan?.status === 'paused') return 30;
  if (plan?.status === 'queued' || plan?.status === 'draft') return 20;
  return 10;
}

export function rollupExperimentStatus(plans = []) {
  const rows = Array.isArray(plans) ? plans : [];
  if (!rows.length) return 'draft';
  if (rows.every(p => p.archived)) return 'archived';
  if (rows.some(p => p.status === 'running' || p.test_id)) return 'running';
  if (rows.some(p => p.status === 'paused')) return 'paused';
  if (rows.some(p => p.status === 'winner_ready')) return 'winner_ready';
  if (rows.some(p => p.status === 'applied' || p.status === 'completed')) return 'completed';
  if (rows.some(p => p.status === 'queued' || p.status === 'draft')) return 'draft';
  return rows[0]?.status || 'draft';
}

/** Short type label for experiment list sublines (Figma: "AB · Owner"). */
export function formatExperimentTypeLabel(raw) {
  const key = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const map = {
    ab: 'AB',
    a_b: 'AB',
    ab_test: 'AB',
    multivariate: 'MULTIVARIATE',
    split_url: 'SPLIT URL',
    feature_flag: 'FEATURE FLAG',
    price_test: 'PRICE',
    offer_test: 'OFFER',
    price: 'PRICE',
  };
  if (map[key]) return map[key];
  if (!key) return 'PRICE';
  return key.replace(/_/g, ' ').toUpperCase();
}

export function groupPlansIntoExperiments(plans = []) {
  const buckets = new Map();

  (Array.isArray(plans) ? plans : []).forEach(plan => {
    if (!plan?.id) return;
    let experimentId = getPlanExperimentId(plan);
    let title = getPlanExperimentTitle(plan);

    if (!experimentId) {
      const raw = String(plan.title || '').trim();
      const sep = raw.indexOf(' · ');
      if (sep > 0) {
        title = raw.slice(0, sep).trim() || title;
        experimentId = `title:${title.toLowerCase()}`;
      } else {
        experimentId = `plan:${plan.id}`;
        title = raw || title;
      }
    }

    if (!buckets.has(experimentId)) {
      buckets.set(experimentId, {
        id: experimentId,
        title,
        plans: [],
      });
    }
    buckets.get(experimentId).plans.push(plan);
  });

  return Array.from(buckets.values())
    .map(group => {
      const sortedPlans = [...group.plans].sort((a, b) => statusRank(b) - statusRank(a));
      const representative = sortedPlans[0];
      const visitors = sortedPlans.reduce(
        (sum, p) => sum + (Number(p.analytics?.visitors ?? p.visitors) || 0),
        0
      );
      const liftValues = sortedPlans
        .map(p => p.analytics?.lift_pct ?? p.lift_pct)
        .filter(v => v !== null && v !== undefined && Number.isFinite(Number(v)))
        .map(Number);
      const confidenceValues = sortedPlans
        .map(p => p.analytics?.confidence_pct ?? p.confidence_pct)
        .filter(v => v !== null && v !== undefined && Number.isFinite(Number(v)))
        .map(Number);
      const lift =
        liftValues.length > 0 ? liftValues.reduce((a, b) => a + b, 0) / liftValues.length : null;
      const confidence = confidenceValues.length > 0 ? Math.max(...confidenceValues) : null;
      const status = rollupExperimentStatus(sortedPlans);
      const primaryMetric =
        representative?.goal?.primary_metric ||
        representative?.objective ||
        representative?.metadata?.audience_ui?.primaryMetric ||
        'Profit per visitor';

      const typeRaw =
        representative?.experiment_type ||
        representative?.metadata?.experiment_type ||
        representative?.test_type ||
        'price_test';
      const typeLabel = formatExperimentTypeLabel(typeRaw);

      return {
        id: group.id,
        title: group.title || getPlanExperimentTitle(representative),
        plans: sortedPlans,
        productCount: sortedPlans.length,
        status,
        primaryMetric,
        visitors: visitors || null,
        lift,
        confidence,
        representative,
        typeLabel,
        owner:
          representative?.owner_name ||
          representative?.created_by_name ||
          representative?.owner ||
          'You',
        hypothesis: representative?.hypothesis || representative?.metadata?.hypothesis || '',
        archived: sortedPlans.every(p => p.archived),
      };
    })
    .sort((a, b) => {
      const aTime = Date.parse(a.representative?.updated_at || a.representative?.created_at || 0);
      const bTime = Date.parse(b.representative?.updated_at || b.representative?.created_at || 0);
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    });
}

export function findExperimentByPlanId(plans, planId) {
  const needle = String(planId || '').trim();
  if (!needle) return null;
  const experiments = groupPlansIntoExperiments(plans);
  return (
    experiments.find(exp => exp.plans.some(p => p.id === needle)) ||
    experiments.find(exp => exp.id === needle) ||
    experiments.find(exp => exp.plans.some(p => String(p.test_id || '').trim() === needle)) ||
    null
  );
}

export function findPlanInCatalog(plans, planId) {
  const needle = String(planId || '').trim();
  if (!needle) return null;
  const list = Array.isArray(plans) ? plans : [];
  return (
    list.find(p => p.id === needle) ||
    list.find(p => String(p.test_id || '').trim() === needle) ||
    null
  );
}

export function stampClassicExperimentMetadata(
  plans,
  { experimentId, experimentTitle, hypothesis, audienceUi, experimentType }
) {
  const id = String(experimentId || '').trim();
  const title = String(experimentTitle || '').trim();
  const type = String(experimentType || '').trim() || null;
  return (Array.isArray(plans) ? plans : []).map(plan => ({
    ...plan,
    title: title
      ? `${title} · ${getPlanProductTitle(plan)}`.replace(/\s·\s$/, '').trim()
      : plan.title,
    hypothesis: hypothesis ?? plan.hypothesis,
    batch_id: plan.batch_id || id || plan.batch_id,
    experiment_id: id || plan.experiment_id,
    experiment_type: type || plan.experiment_type,
    metadata: {
      ...(plan.metadata || {}),
      classic_wizard: true,
      experiment_id: id || plan.metadata?.experiment_id,
      experiment_title: title || plan.metadata?.experiment_title,
      experiment_type: type || plan.metadata?.experiment_type || plan.experiment_type,
      product_title: getPlanProductTitle(plan),
      hypothesis: hypothesis ?? plan.metadata?.hypothesis,
      audience_ui: audienceUi ?? plan.metadata?.audience_ui,
    },
  }));
}

export function upsertExperimentPlansInInbox(existingPlans, nextPlans, experimentId) {
  const id = String(experimentId || '').trim();
  const nextIds = new Set((nextPlans || []).map(p => p.id).filter(Boolean));
  const kept = (existingPlans || []).filter(plan => {
    if (nextIds.has(plan.id)) return false;
    if (!id) return true;
    return getPlanExperimentId(plan) !== id;
  });
  return [...(nextPlans || []), ...kept];
}
