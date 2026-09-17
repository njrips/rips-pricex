import { beforeEach, describe, expect, it, vi } from 'vitest';

const SHOP = 'demo.myshopify.com';

const readClassicWizardDraft = vi.fn();
const saveWizardDraftEverywhere = vi.fn(async () => ({
  local: true,
  server: true,
  skipped: false,
}));

vi.mock('../classicExperimentHelpers', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    readClassicWizardDraft: (...args) => readClassicWizardDraft(...args),
  };
});

vi.mock('../classicWizardDraftSync', () => ({
  saveWizardDraftEverywhere: (...args) => saveWizardDraftEverywhere(...args),
}));

let duplicateClassicExperimentAsDraft;
let buildWizardSnapshotFromExperiment;
let createClassicExperimentId;

beforeEach(async () => {
  readClassicWizardDraft.mockReset();
  saveWizardDraftEverywhere.mockClear();
  ({
    duplicateClassicExperimentAsDraft,
    buildWizardSnapshotFromExperiment,
    createClassicExperimentId,
  } = await import('../classicExperimentDuplicate'));
});

describe('buildWizardSnapshotFromExperiment', () => {
  it('rebuilds a snapshot from inbox plans', () => {
    const id = createClassicExperimentId();
    const snapshot = buildWizardSnapshotFromExperiment(
      {
        title: 'Holiday pricing',
        status: 'running',
        experimentType: 'price_test',
        plans: [
          {
            id: 'p1',
            product_id: 'prod-1',
            variant_id: 'v1',
            status: 'running',
            test_id: 'test-1',
            price_arms: [
              { id: 'control', role: 'control', allocation_percent: 50, price: 10 },
              { id: 'var_a', role: 'challenger', allocation_percent: 50, price: 12 },
            ],
            metadata: {
              audience_ui: { primaryMetric: 'revenue_per_visitor', minSampleSize: '5000' },
            },
          },
        ],
      },
      id
    );

    expect(snapshot?.name).toBe('Holiday pricing');
    expect(snapshot?.experimentType).toBe('price_test');
    expect(snapshot?.selectedIds).toEqual(['v1']);
    expect(snapshot?.variations).toHaveLength(2);
    expect(snapshot?.plans?.[0]?.status).toBe('draft');
    expect(snapshot?.plans?.[0]?.test_id).toBeUndefined();
    expect(snapshot?.plans?.[0]?.metadata?.experiment_id).toBe(id);
  });
});

describe('duplicateClassicExperimentAsDraft', () => {
  it('writes a new draft with a copy suffix from a saved wizard draft', async () => {
    readClassicWizardDraft.mockReturnValue({
      experiment_id: 'exp_old',
      name: 'Spring pricing',
      step: 2,
      selectedIds: ['v1'],
    });

    const result = await duplicateClassicExperimentAsDraft(SHOP, {
      id: 'exp_old',
      wizardDraft: { experiment_id: 'exp_old', step: 2 },
    });

    expect(result.ok).toBe(true);
    expect(result.experimentId).not.toBe('exp_old');
    expect(saveWizardDraftEverywhere).toHaveBeenCalledWith(
      SHOP,
      expect.objectContaining({
        experiment_id: result.experimentId,
        name: 'Spring pricing (copy)',
        step: 2,
        selectedIds: ['v1'],
      })
    );
  });

  it('falls back to inbox plans when no wizard draft exists', async () => {
    readClassicWizardDraft.mockReturnValue(null);
    const result = await duplicateClassicExperimentAsDraft(SHOP, {
      id: 'exp_live',
      title: 'Holiday pricing',
      plans: [
        {
          id: 'p1',
          variant_id: 'v1',
          price_arms: [
            { id: 'control', role: 'control', allocation_percent: 50 },
            { id: 'var_a', role: 'challenger', allocation_percent: 50 },
          ],
          metadata: { audience_ui: { primaryMetric: 'revenue_per_visitor' } },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(saveWizardDraftEverywhere).toHaveBeenCalled();
  });

  it('refuses when there is no saved setup to copy', async () => {
    readClassicWizardDraft.mockReturnValue(null);
    const result = await duplicateClassicExperimentAsDraft(SHOP, { id: 'exp_empty', plans: [] });
    expect(result.ok).toBe(false);
    expect(saveWizardDraftEverywhere).not.toHaveBeenCalled();
  });
});
