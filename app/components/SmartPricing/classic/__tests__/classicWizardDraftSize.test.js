import { describe, expect, it } from 'vitest';

import {
  compactWizardSnapshot,
  DROPPED_DRAFT_PLAN_FIELDS,
  omitPlansFromSnapshot,
  prepareWizardSnapshotForSave,
  wizardSnapshotBytes,
} from '../classicWizardDraftSize';

const audience = {
  segment: 'all_visitors',
  trafficAllocation: 100,
  primaryMetric: 'revenue_per_visitor',
  secondaryMetrics: ['conversion_rate', 'aov'],
  guardrails: [{ id: 'revenue_guard', metric: 'revenue_per_visitor', threshold: 10 }],
  targetCountries: [],
  targetDevices: [],
};

function planFixture(index = 0) {
  return {
    id: `SP-${index}`,
    product_id: `gid://shopify/Product/${1000 + index}`,
    variant_id: `gid://shopify/ProductVariant/${2000 + index}`,
    title: 'Canvas Tote',
    current_price: 38.9,
    currency: 'USD',
    price_arms: [
      { id: 'control', role: 'control', label: 'Control', price: 38.9, allocation_percent: 50 },
      { id: 'var_a', role: 'variant', label: 'Variation A', price: 42.9, allocation_percent: 50 },
    ],
    guardrail_checks: [{ id: 'margin', passed: true }],
    statistical_design: { estimated_duration_days: 21, power_rating: 'good' },
    learning_path: [{ round: 1, candidate_arms_preview: [30, 35, 40] }],
    variant_count_options: [{ count: 2 }, { count: 3 }],
    arm_projections: [{ arm_id: 'var_a', projected_ppv: 1.2 }],
    recommended_variant_count: 2,
    variant_count_rationale: 'At 900 daily visitors, 2 variants balances power and duration.',
    ai_summary: 'Strong seller with room to move.',
    schema_version: '1.0.0',
    shop_domain: 'demo.myshopify.com',
    traffic_split_strategy: 'equal',
    metadata: {
      classic_wizard: true,
      experiment_id: 'exp_1',
      product_title: 'Canvas Tote',
      audience_ui: audience,
    },
  };
}

function snapshotFixture(productCount = 1) {
  return {
    experiment_id: 'exp_1',
    step: 4,
    name: 'Q4 pricing',
    audience,
    selectedIds: Array.from(
      { length: productCount },
      (_, i) => `gid://shopify/ProductVariant/${2000 + i}`
    ),
    plans: Array.from({ length: productCount }, (_, i) => planFixture(i)),
  };
}

describe('compactWizardSnapshot', () => {
  it('drops the preview material nothing reads back', () => {
    const [plan] = compactWizardSnapshot(snapshotFixture()).plans;

    DROPPED_DRAFT_PLAN_FIELDS.forEach(field => {
      expect(plan).not.toHaveProperty(field);
    });
  });

  it('keeps everything the launch needs', () => {
    // These are what `/plans/launch` and the review preflight read off a plan
    // they are sent, and a restored draft is what they get sent.
    const [plan] = compactWizardSnapshot(snapshotFixture()).plans;

    expect(plan).toMatchObject({
      id: 'SP-0',
      product_id: 'gid://shopify/Product/1000',
      variant_id: 'gid://shopify/ProductVariant/2000',
      current_price: 38.9,
      currency: 'USD',
    });
    expect(plan.price_arms).toHaveLength(2);
    expect(plan.statistical_design).toEqual({ estimated_duration_days: 21, power_rating: 'good' });
  });

  it('keeps guardrail_checks, so the review step can still block a bad launch', () => {
    // An absent list counts as a pass in `planGuardrailsPass`, so dropping
    // this would retire the margin and checkout blockers for precisely the
    // large experiments that most need them.
    const [plan] = compactWizardSnapshot(snapshotFixture()).plans;

    expect(plan.guardrail_checks).toEqual([{ id: 'margin', passed: true }]);
  });

  it('strips the copy of the audience stamped into every plan', () => {
    const compact = compactWizardSnapshot(snapshotFixture(3));

    compact.plans.forEach(plan => {
      expect(plan.metadata).not.toHaveProperty('audience_ui');
      expect(plan.metadata.experiment_id).toBe('exp_1');
    });
    // Kept once, where the wizard restores it from and where the launch
    // re-stamps every plan from.
    expect(compact.audience).toEqual(audience);
  });

  it('leaves the original snapshot alone', () => {
    const snapshot = snapshotFixture();
    compactWizardSnapshot(snapshot);

    expect(snapshot.plans[0].learning_path).toBeDefined();
    expect(snapshot.plans[0].metadata.audience_ui).toEqual(audience);
  });

  it('roughly halves what a draft costs to store', () => {
    const snapshot = snapshotFixture(40);
    const before = wizardSnapshotBytes(snapshot);
    const after = wizardSnapshotBytes(compactWizardSnapshot(snapshot));

    expect(after).toBeLessThan(before * 0.6);
  });

  it('passes through a draft saved before any products were chosen', () => {
    const early = { experiment_id: 'exp_1', name: 'Q4 pricing' };

    expect(compactWizardSnapshot(early)).toBe(early);
  });
});

describe('prepareWizardSnapshotForSave', () => {
  it('clears plans_omitted once the pricing table is back', () => {
    const snapshot = {
      ...snapshotFixture(2),
      plans_omitted: true,
    };

    const prepared = prepareWizardSnapshotForSave(snapshot);

    expect(prepared.plans).toHaveLength(2);
    expect(prepared).not.toHaveProperty('plans_omitted');
  });

  it('keeps plans_omitted when the table is still empty', () => {
    const snapshot = {
      experiment_id: 'exp_1',
      plans: [],
      plans_omitted: true,
    };

    expect(prepareWizardSnapshotForSave(snapshot)).toEqual(snapshot);
  });
});

describe('omitPlansFromSnapshot', () => {
  it('keeps every choice the merchant made', () => {
    const reduced = omitPlansFromSnapshot(snapshotFixture(3));

    expect(reduced).toMatchObject({
      experiment_id: 'exp_1',
      name: 'Q4 pricing',
      audience,
    });
    expect(reduced.selectedIds).toHaveLength(3);
  });

  it('empties the pricing table and says it did', () => {
    // `plans_omitted` is what tells a restore this draft is a step short,
    // rather than one saved before the merchant reached the Products step.
    const reduced = omitPlansFromSnapshot(snapshotFixture(3));

    expect(reduced.plans).toEqual([]);
    expect(reduced.plans_omitted).toBe(true);
  });

  it('leaves a draft with no plans untouched', () => {
    const early = { experiment_id: 'exp_1', plans: [] };

    expect(omitPlansFromSnapshot(early)).toBe(early);
  });
});
