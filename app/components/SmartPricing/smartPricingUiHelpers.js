import { formatCurrency } from './smartPricingConstants';

export function formatConfidenceBadge(plan) {
  const days = plan?.statistical_design?.estimated_duration_days;
  const rating = plan?.statistical_design?.power_rating;
  if (rating === 'underpowered') {
    return {
      tone: 'warning',
      label: days ? `Needs more time · ~${days} days` : 'Needs more time',
      hint: 'Try 2 prices or launch later',
    };
  }
  return {
    tone: 'success',
    label: days ? `Ready · ~${days} days` : 'Ready',
    hint: 'Good confidence this finishes on time',
  };
}

export function formatSafetyBadge(plan) {
  const checks = Array.isArray(plan?.guardrail_checks) ? plan.guardrail_checks : [];
  const passed = checks.filter(c => c.passed).length;
  const total = checks.length;
  if (total === 0) return { tone: 'info', label: 'Safety checks pending' };
  if (passed === total) return { tone: 'success', label: 'Safe to launch' };
  return {
    tone: 'critical',
    label: `${total - passed} safety issue${total - passed === 1 ? '' : 's'}`,
  };
}

export function summarizePlanForLaunch(plan) {
  const prices = (plan?.price_arms || [])
    .map(arm => formatCurrency(arm.price, plan.currency))
    .join(' · ');
  const badge = formatConfidenceBadge(plan);
  return {
    title: plan?.title || 'Product',
    prices,
    days: plan?.statistical_design?.estimated_duration_days,
    confidenceLabel: badge.label,
  };
}

/** Safe plans skip the launch confirmation modal. */
export function planCanLaunchWithoutConfirm(plan) {
  const safety = formatSafetyBadge(plan);
  const confidence = formatConfidenceBadge(plan);
  return safety.tone === 'success' && confidence.tone !== 'warning';
}

export function plansCanLaunchWithoutConfirm(plans = []) {
  return plans.length > 0 && plans.every(planCanLaunchWithoutConfirm);
}

export function planStatusLabel(plan) {
  if (plan?.status === 'applied') {
    return { tone: 'success', label: 'Applied' };
  }
  if (plan?.status === 'winner_ready') {
    return { tone: 'attention', label: 'Apply price' };
  }
  if (plan?.status === 'running' || plan?.test_id) {
    return { tone: 'success', label: 'Live' };
  }
  if (!planCanLaunchWithoutConfirm(plan)) {
    return { tone: 'warning', label: 'Review' };
  }
  return { tone: 'info', label: 'Ready' };
}

/** Five-step merchant journey shown in the Smart Pricing stepper. */
export const SMART_PRICING_FLOW = [
  { id: 'setup', label: 'Setup' },
  { id: 'pick', label: 'Pick products' },
  { id: 'review', label: 'Review plans' },
  { id: 'launch', label: 'Launch tests' },
  { id: 'winner', label: 'Apply winner' },
];

/**
 * Resolve active step index for inbox / wizard / setup screens.
 * @param {'setup'|'pick'|'review'|'launch'|'winner'} screen
 * @param {{ hasWinnerReady?: boolean, hasRunning?: boolean, hasQueued?: boolean, isEmpty?: boolean }} state
 */
export function resolveSmartPricingFlowIndex(screen, state = {}) {
  const screenIndex = {
    setup: 0,
    pick: 1,
    review: 2,
    launch: 3,
    winner: 4,
  };
  if (screen && screenIndex[screen] !== undefined) {
    return screenIndex[screen];
  }
  if (state.hasWinnerReady) return 4;
  if (state.hasRunning) return 3;
  if (state.hasQueued) return 2;
  if (state.isEmpty) return 1;
  return 2;
}

export function isSmartPricingTest(test) {
  const metadata = test?.metadata && typeof test.metadata === 'object' ? test.metadata : {};
  return (
    metadata.smart_pricing_source === 'smart_pricing' || Boolean(metadata.smart_pricing_plan_id)
  );
}

export function isSmartPricingWinnerReady(test, linkedPlan = null) {
  const isStopped = test?.status === 'stopped' || test?.status === 'completed';
  const personalizationMode = String(test?.personalization_mode || '')
    .trim()
    .toLowerCase();
  const winnerApplied = personalizationMode === 'personalized' || personalizationMode === 'rollout';
  if (linkedPlan?.status === 'applied') {
    return false;
  }
  return linkedPlan?.status === 'winner_ready' || (isStopped && !winnerApplied);
}

export function buildSmartPricingPlanFromTest(test, linkedPlan = null) {
  if (!test?.id) {
    return null;
  }
  const metadata = test?.metadata && typeof test.metadata === 'object' ? test.metadata : {};
  const planId = linkedPlan?.id || metadata.smart_pricing_plan_id || '';
  return {
    ...(linkedPlan || {}),
    id: planId || `test-${test.id}`,
    test_id: test.id,
    title: linkedPlan?.title || test.name || 'Smart Pricing test',
    status: linkedPlan?.status || test.status,
  };
}

export function resolveSmartPricingPlanContext(test, shopDomain) {
  if (!isSmartPricingTest(test)) {
    return null;
  }
  const metadata = test?.metadata && typeof test.metadata === 'object' ? test.metadata : {};
  const planId = metadata.smart_pricing_plan_id ? String(metadata.smart_pricing_plan_id) : '';
  const inboxBase = `/app`;
  return {
    planId,
    inboxUrl: inboxBase,
    planStudioUrl: planId ? `${inboxBase}/plans/${encodeURIComponent(planId)}` : inboxBase,
  };
}

/** Footer line for plan preview grids — reflects dominant scenario preset. */
export function summarizePlansPreset(plans = []) {
  const counts = new Map();
  (Array.isArray(plans) ? plans : []).forEach(plan => {
    const preset = String(plan?.scenario_preset || 'recommended').trim();
    counts.set(preset, (counts.get(preset) || 0) + 1);
  });
  if (!counts.size) return 'Balanced';
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'recommended';
  const labels = {
    conservative: 'Safe',
    recommended: 'Balanced',
    aggressive: 'Bold',
  };
  return labels[dominant] || 'Balanced';
}

export function groupInboxPlans(plans = []) {
  const queued = [];
  const winnerReady = [];
  const live = [];
  const applied = [];
  const archived = [];

  (Array.isArray(plans) ? plans : []).forEach(plan => {
    if (plan.archived === true) {
      archived.push(plan);
      return;
    }
    if (plan.status === 'winner_ready') {
      winnerReady.push(plan);
      return;
    }
    if (plan.status === 'applied') {
      applied.push(plan);
      return;
    }
    if (
      plan.status === 'running' ||
      (plan.test_id &&
        plan.status !== 'queued' &&
        plan.status !== 'draft' &&
        plan.status !== 'applied' &&
        plan.status !== 'winner_ready')
    ) {
      live.push(plan);
      return;
    }
    if (plan.status === 'queued' || plan.status === 'draft') {
      queued.push(plan);
    }
  });

  return {
    queued,
    winnerReady,
    live,
    applied,
    archived,
    runningTab: [...live, ...applied],
    draftTab: [...winnerReady, ...queued],
    counts: {
      ready: queued.length,
      live: live.length,
      winner: winnerReady.length,
      applied: applied.length,
      archived: archived.length,
      running: live.length + applied.length,
      draft: winnerReady.length + queued.length,
    },
    sections: [
      { id: 'winner', title: 'Winners ready', plans: winnerReady, tone: 'success' },
      { id: 'ready', title: 'Ready to launch', plans: queued, tone: 'info' },
      { id: 'live', title: 'Live tests', plans: live, tone: 'attention' },
      { id: 'applied', title: 'Applied', plans: applied, tone: 'subdued' },
      { id: 'archived', title: 'Archived', plans: archived, tone: 'subdued' },
    ].filter(section => section.plans.length > 0),
  };
}

export function filterPlansByQuery(plans = [], query = '') {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  if (!q) return Array.isArray(plans) ? plans : [];
  return (Array.isArray(plans) ? plans : []).filter(plan => {
    const haystack = [
      plan.title,
      plan.id,
      plan.variant_id,
      plan.product_id,
      plan.status,
      plan.test_id,
    ]
      .map(v => String(v || '').toLowerCase())
      .join(' ');
    return haystack.includes(q);
  });
}

export const COMMAND_CENTER_TABS = [
  { id: 'running', label: 'Running' },
  { id: 'draft', label: 'Draft' },
  { id: 'archived', label: 'Archived' },
  { id: 'settings', label: 'Settings' },
];

/** @deprecated Import from `./classic/classicCreateSteps` — re-exported for older callers. */
export { CLASSIC_CREATE_STEPS } from './classic/classicCreateSteps';

export const CREATE_WIZARD_STEPS = [
  { id: 'pick', label: 'AI product list' },
  { id: 'configure', label: 'Set test prices' },
  { id: 'audience', label: 'Audience & goals' },
  { id: 'preview', label: 'Review & launch' },
];

/** Simplified 3-step Create flow (default) — skips dedicated audience step. */
export const CREATE_WIZARD_STEPS_SIMPLE = [
  { id: 'pick', label: 'AI product list', internalStep: 0 },
  { id: 'configure', label: 'Set test prices', internalStep: 1 },
  { id: 'preview', label: 'Review & launch', internalStep: 3 },
];

export function mapSimpleStepToInternal(simpleIndex) {
  const row = CREATE_WIZARD_STEPS_SIMPLE[simpleIndex];
  return row?.internalStep ?? 0;
}

export function mapInternalStepToSimple(internalStep) {
  const idx = CREATE_WIZARD_STEPS_SIMPLE.findIndex(s => s.internalStep === internalStep);
  return idx >= 0 ? idx : internalStep === 2 ? 1 : 0;
}

/**
 * Single next action for Command Center — one CTA, plain language.
 */
export function resolveNextSmartPricingAction({
  grouped,
  checkoutReady,
  hasAnyPlans = false,
} = {}) {
  if (checkoutReady === false) {
    return {
      kind: 'setup',
      title: 'Finish setup before launching',
      body: 'Checkout price tests need a working checkout connection. Fix this in Settings first.',
      cta: 'Open settings',
      tab: 'settings',
    };
  }
  const winnerCount = grouped?.winnerReady?.length ?? 0;
  if (winnerCount > 0) {
    return {
      kind: 'apply',
      title:
        winnerCount === 1
          ? '1 test finished — apply the winning price'
          : `${winnerCount} tests finished — apply winning prices`,
      body: 'Publish the best price to Shopify when you are ready. Nothing changes until you confirm.',
      cta: 'Apply winners',
      tab: 'draft',
    };
  }
  const queuedCount = grouped?.queued?.length ?? 0;
  if (queuedCount > 0) {
    return {
      kind: 'launch',
      title:
        queuedCount === 1
          ? '1 price test ready to go live'
          : `${queuedCount} price tests ready to go live`,
      body: 'Review the suggested test prices, then launch. AI never starts tests without you.',
      cta: 'Review & launch',
      tab: 'draft',
    };
  }
  const liveCount = grouped?.live?.length ?? 0;
  if (liveCount > 0) {
    return {
      kind: 'monitor',
      title: liveCount === 1 ? '1 test is running' : `${liveCount} tests are running`,
      body: 'Check back for results. We optimize profit per visit, not just conversion.',
      cta: 'View running tests',
      tab: 'running',
    };
  }
  if (!hasAnyPlans) {
    return {
      kind: 'create',
      title: 'Start your first AI price test',
      body: 'We rank your products and suggest safe test prices. You pick what to launch.',
      cta: 'Quick start',
      tab: 'draft',
      express: true,
    };
  }
  return {
    kind: 'create',
    title: 'Create another price test',
    body: 'Pick new products or let AI suggest the next best opportunities.',
    cta: 'Create new test',
    route: 'create',
  };
}

/** Sectioned plan lists for Command Center tabs (wireframe inbox grouping). */
export function getTabPlanSections(activeTabId, grouped, tabPlans = []) {
  const idSet = new Set((Array.isArray(tabPlans) ? tabPlans : []).map(p => p.id));
  const pick = list => (Array.isArray(list) ? list : []).filter(p => idSet.has(p.id));

  if (activeTabId === 'running') {
    return [
      { id: 'live', title: 'Live tests', plans: pick(grouped.live) },
      { id: 'applied', title: 'Winners applied', plans: pick(grouped.applied) },
    ].filter(section => section.plans.length > 0);
  }
  if (activeTabId === 'draft') {
    return [
      { id: 'winner', title: 'Apply winning price', plans: pick(grouped.winnerReady) },
      { id: 'ready', title: 'Ready to go live', plans: pick(grouped.queued) },
    ].filter(section => section.plans.length > 0);
  }
  if (activeTabId === 'archived') {
    return tabPlans.length ? [{ id: 'archived', title: 'Archived plans', plans: tabPlans }] : [];
  }
  return tabPlans.length ? [{ id: 'all', title: '', plans: tabPlans }] : [];
}

/** Best guess at Round 2 base price after Round 1 winner apply. */
export function inferRound2BasePrice(plan) {
  const learningRound2 = Array.isArray(plan?.learning_path)
    ? plan.learning_path.find(row => row.round === 2)
    : null;
  const previewPrices = learningRound2?.candidate_arms_preview;
  if (Array.isArray(previewPrices) && previewPrices.length > 0) {
    const mid = previewPrices[Math.floor(previewPrices.length / 2)];
    if (Number.isFinite(Number(mid))) return Number(mid);
  }

  const arms = Array.isArray(plan?.price_arms) ? plan.price_arms : [];
  const nonControl = arms.filter(arm => arm.role !== 'control');
  const pool = nonControl.length ? nonControl : arms;
  if (!pool.length) return Number(plan?.current_price) || 0;
  return pool.reduce((best, arm) => (Number(arm.price) > Number(best.price) ? arm : best), pool[0])
    .price;
}

export function formatGuardrailPricePreview(basePrice, maxChangePercent = 15, currency = 'USD') {
  const base = Number(basePrice);
  const pct = Number(maxChangePercent);
  if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(pct)) return null;
  const delta = base * (pct / 100);
  const floor = Math.max(0, Math.round((base - delta) * 100) / 100);
  const ceiling = Math.round((base + delta) * 100) / 100;
  try {
    const fmt = n => new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n);
    return `${fmt(floor)} – ${fmt(ceiling)} at ±${pct}%`;
  } catch {
    return `$${floor.toFixed(2)} – $${ceiling.toFixed(2)} at ±${pct}%`;
  }
}
