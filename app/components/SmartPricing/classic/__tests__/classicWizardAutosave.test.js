import { describe, expect, it } from 'vitest';
import {
  buildWizardResumeSearch,
  selectUnlistedWizardDrafts,
  shouldAutosaveWizardSnapshot,
  wizardDraftStepLabel,
  wizardSnapshotHasMerchantInput,
} from '../classicWizardAutosave';

describe('wizardSnapshotHasMerchantInput', () => {
  it('is false for a wizard nobody has touched', () => {
    expect(wizardSnapshotHasMerchantInput({ experiment_id: 'exp_1', step: 0 })).toBe(false);
    expect(wizardSnapshotHasMerchantInput(null)).toBe(false);
  });

  it('ignores whitespace typed into a text field', () => {
    expect(wizardSnapshotHasMerchantInput({ name: '   ', hypothesis: '' })).toBe(false);
  });

  it('is true once anything has been named, picked, or priced', () => {
    expect(wizardSnapshotHasMerchantInput({ name: 'Spring pricing' })).toBe(true);
    expect(wizardSnapshotHasMerchantInput({ hypothesis: 'Higher converts' })).toBe(true);
    expect(wizardSnapshotHasMerchantInput({ collectionId: 'gid://shopify/Collection/1' })).toBe(true);
    expect(wizardSnapshotHasMerchantInput({ selectedIds: ['v1'] })).toBe(true);
    expect(wizardSnapshotHasMerchantInput({ plans: [{ id: 'plan_1' }] })).toBe(true);
    expect(wizardSnapshotHasMerchantInput({ priceOverrides: { 'v1::b': '12.00' } })).toBe(true);
    expect(wizardSnapshotHasMerchantInput({ offerByArm: { b: { discount_value: 10 } } })).toBe(true);
    expect(wizardSnapshotHasMerchantInput({ goalByPlan: { plan_1: { goal: 'revenue' } } })).toBe(true);
  });

  it('does not count empty collections as input', () => {
    expect(
      wizardSnapshotHasMerchantInput({ selectedIds: [], plans: [], priceOverrides: {} })
    ).toBe(false);
  });
});

describe('shouldAutosaveWizardSnapshot', () => {
  it('needs an experiment id to save under', () => {
    expect(shouldAutosaveWizardSnapshot({ name: 'Spring pricing' })).toBe(false);
    expect(shouldAutosaveWizardSnapshot({ experiment_id: '  ', name: 'Spring pricing' })).toBe(false);
  });

  it('saves an identified wizard the merchant has filled in', () => {
    expect(shouldAutosaveWizardSnapshot({ experiment_id: 'exp_1', name: 'Spring pricing' })).toBe(
      true
    );
  });

  it('leaves an untouched wizard unsaved so visiting create writes no draft', () => {
    expect(shouldAutosaveWizardSnapshot({ experiment_id: 'exp_1', step: 0 })).toBe(false);
  });
});

describe('buildWizardResumeSearch', () => {
  it('names the draft and the step so a refresh lands in the same place', () => {
    const search = buildWizardResumeSearch('', { experimentId: 'exp_1', stepIndex: 3 });
    expect(new URLSearchParams(search).get('resume')).toBe('exp_1');
    expect(new URLSearchParams(search).get('step')).toBe('audience');
  });

  it('returns null when the URL already says this, so the router is left alone', () => {
    expect(
      buildWizardResumeSearch(new URLSearchParams('resume=exp_1&step=audience'), {
        experimentId: 'exp_1',
        stepIndex: 3,
      })
    ).toBeNull();
  });

  it('rewrites a stale step', () => {
    const search = buildWizardResumeSearch(new URLSearchParams('resume=exp_1&step=setup'), {
      experimentId: 'exp_1',
      stepIndex: 1,
    });
    expect(new URLSearchParams(search).get('step')).toBe('variations');
  });

  it('keeps other query parameters', () => {
    const search = buildWizardResumeSearch(new URLSearchParams('shop=demo.myshopify.com'), {
      experimentId: 'exp_1',
      stepIndex: 0,
    });
    expect(new URLSearchParams(search).get('shop')).toBe('demo.myshopify.com');
  });

  it('has nothing to write without an id or a real step', () => {
    expect(buildWizardResumeSearch('', { experimentId: '', stepIndex: 0 })).toBeNull();
    expect(buildWizardResumeSearch('', { experimentId: 'exp_1', stepIndex: 99 })).toBeNull();
  });
});

describe('selectUnlistedWizardDrafts', () => {
  const started = { experiment_id: 'exp_1', name: 'Only in the browser' };
  const listed = { experiment_id: 'exp_2', name: 'Already a draft row' };

  it('keeps drafts that have no row on the experiments page', () => {
    expect(selectUnlistedWizardDrafts([started], ['exp_2'])).toEqual([started]);
  });

  it('drops drafts the Drafts list already shows', () => {
    expect(selectUnlistedWizardDrafts([started, listed], ['exp_2'])).toEqual([started]);
  });

  it('drops drafts holding nothing the merchant entered', () => {
    expect(selectUnlistedWizardDrafts([{ experiment_id: 'exp_3', step: 0 }], [])).toEqual([]);
  });

  it('drops drafts with no id to resume by', () => {
    expect(selectUnlistedWizardDrafts([{ name: 'No id' }], [])).toEqual([]);
  });

  it('tolerates missing or ragged inputs', () => {
    expect(selectUnlistedWizardDrafts(null, null)).toEqual([]);
    expect(selectUnlistedWizardDrafts([started], [null, '', '  '])).toEqual([started]);
  });
});

describe('wizardDraftStepLabel', () => {
  it('names the step the draft was left on', () => {
    expect(wizardDraftStepLabel({ step: 0 })).toBe('Step 1 of 5 · Basics');
    expect(wizardDraftStepLabel({ step: 3 })).toBe('Step 4 of 5 · Audience');
  });

  it('says nothing when the step is missing or out of range', () => {
    expect(wizardDraftStepLabel({})).toBe('');
    expect(wizardDraftStepLabel({ step: 12 })).toBe('');
    expect(wizardDraftStepLabel(null)).toBe('');
  });
});
