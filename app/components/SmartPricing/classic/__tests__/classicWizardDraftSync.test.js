// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../services/smartPricingApi', () => ({
  getSmartPricingWizardDrafts: vi.fn(),
  saveSmartPricingWizardDraft: vi.fn(),
  deleteSmartPricingWizardDraft: vi.fn(),
}));

import {
  deleteSmartPricingWizardDraft,
  getSmartPricingWizardDrafts,
  saveSmartPricingWizardDraft,
} from '../../../../services/smartPricingApi';
import { readClassicWizardDrafts, writeClassicWizardDraft } from '../classicExperimentHelpers';
import {
  forgetWizardDraftEverywhere,
  loadWizardDrafts,
  mergeWizardDrafts,
  saveWizardDraftEverywhere,
  shouldPreferWizardDraft,
} from '../classicWizardDraftSync';

const SHOP = 'demo.myshopify.com';

describe('mergeWizardDrafts', () => {
  it('prefers whichever copy was saved later', () => {
    // The server holds what another device last saved; the browser holds edits
    // made since the last write reached it. Neither wins by default.
    const merged = mergeWizardDrafts(
      [{ experiment_id: 'exp_1', name: 'Local, newer', saved_at: '2026-02-02T00:00:00.000Z' }],
      [{ experiment_id: 'exp_1', name: 'Server, older', saved_at: '2026-01-01T00:00:00.000Z' }]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe('Local, newer');
  });

  it('takes the server copy when it is the newer one', () => {
    const merged = mergeWizardDrafts(
      [{ experiment_id: 'exp_1', name: 'Local, older', saved_at: '2026-01-01T00:00:00.000Z' }],
      [{ experiment_id: 'exp_1', name: 'Server, newer', saved_at: '2026-03-03T00:00:00.000Z' }]
    );

    expect(merged[0].name).toBe('Server, newer');
  });

  it('keeps drafts only one side knows about', () => {
    const merged = mergeWizardDrafts(
      [{ experiment_id: 'exp_local', saved_at: '2026-01-02T00:00:00.000Z' }],
      [{ experiment_id: 'exp_server', saved_at: '2026-01-01T00:00:00.000Z' }]
    );

    expect(merged.map(d => d.experiment_id)).toEqual(['exp_local', 'exp_server']);
  });

  it('drops entries with no experiment id to address them by', () => {
    expect(mergeWizardDrafts([{ name: 'Nameless' }], [{ experiment_id: '  ' }])).toEqual([]);
  });

  it('survives either side being absent', () => {
    expect(mergeWizardDrafts(null, undefined)).toEqual([]);
  });

  it('at the same timestamp, keeps the copy that still has its pricing table', () => {
    const at = '2026-02-02T00:00:00.000Z';
    const merged = mergeWizardDrafts(
      [
        {
          experiment_id: 'exp_1',
          saved_at: at,
          plans: [{ id: 'p1' }, { id: 'p2' }],
        },
      ],
      [
        {
          experiment_id: 'exp_1',
          saved_at: at,
          plans: [],
          plans_omitted: true,
        },
      ]
    );

    expect(merged[0].plans).toHaveLength(2);
    expect(merged[0].plans_omitted).toBeUndefined();
  });
});

describe('shouldPreferWizardDraft', () => {
  it('prefers a newer timestamp', () => {
    expect(
      shouldPreferWizardDraft(
        { saved_at: '2026-03-01T00:00:00.000Z' },
        { saved_at: '2026-02-01T00:00:00.000Z' }
      )
    ).toBe(true);
  });

  it('prefers more plans when timestamps match', () => {
    const at = '2026-02-02T00:00:00.000Z';
    expect(
      shouldPreferWizardDraft(
        { saved_at: at, plans: [{ id: 'p1' }] },
        { saved_at: at, plans: [] }
      )
    ).toBe(true);
  });
});

describe('loadWizardDrafts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('returns both copies as one list', async () => {
    writeClassicWizardDraft(SHOP, { experiment_id: 'exp_local', name: 'Local one' });
    getSmartPricingWizardDrafts.mockResolvedValue({
      drafts: [{ experiment_id: 'exp_server', name: 'Server one', saved_at: '2026-01-01' }],
    });

    const { drafts, reachedServer } = await loadWizardDrafts(SHOP);

    expect(reachedServer).toBe(true);
    expect(drafts.map(d => d.name).sort()).toEqual(['Local one', 'Server one']);
  });

  it('still shows the local copy when the server cannot be reached', async () => {
    // An experiments page that cannot reach the network still has drafts to
    // show, and saying a merchant has none would be worse than showing these.
    writeClassicWizardDraft(SHOP, { experiment_id: 'exp_local', name: 'Local one' });
    getSmartPricingWizardDrafts.mockRejectedValue(new Error('offline'));

    const { drafts, reachedServer } = await loadWizardDrafts(SHOP);

    expect(reachedServer).toBe(false);
    expect(drafts.map(d => d.name)).toEqual(['Local one']);
  });
});

describe('saveWizardDraftEverywhere', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    saveSmartPricingWizardDraft.mockResolvedValue({});
  });

  it('writes both copies', async () => {
    const result = await saveWizardDraftEverywhere(SHOP, {
      experiment_id: 'exp_1',
      name: 'Spring pricing',
    });

    expect(result).toMatchObject({ local: true, server: true });
    expect(readClassicWizardDrafts(SHOP)[0].name).toBe('Spring pricing');
    expect(saveSmartPricingWizardDraft).toHaveBeenCalled();
  });

  it('sends the stamped copy, so both sides agree on when it was saved', async () => {
    await saveWizardDraftEverywhere(SHOP, { experiment_id: 'exp_1', name: 'Spring pricing' });

    const sent = saveSmartPricingWizardDraft.mock.calls[0][1];
    expect(sent.saved_at).toBe(readClassicWizardDrafts(SHOP)[0].saved_at);
  });

  it('reports the browser copy alone when the request fails', async () => {
    saveSmartPricingWizardDraft.mockRejectedValue(new Error('offline'));

    const result = await saveWizardDraftEverywhere(SHOP, {
      experiment_id: 'exp_1',
      name: 'Spring pricing',
    });

    expect(result).toMatchObject({ local: true, server: false });
    expect(readClassicWizardDrafts(SHOP)[0].name).toBe('Spring pricing');
  });

  it('still tries the server when browser storage is blocked', async () => {
    // With localStorage refusing writes the server copy is the only one that
    // can exist, which makes it more worth attempting rather than less.
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    const result = await saveWizardDraftEverywhere(SHOP, {
      experiment_id: 'exp_1',
      name: 'Spring pricing',
    });

    expect(result).toMatchObject({ local: false, server: true });
    expect(saveSmartPricingWizardDraft).toHaveBeenCalled();
    setItem.mockRestore();
  });

  it('passes on that the server kept a newer copy instead of this one', async () => {
    // The request succeeded, but the save did not land. Reported as a plain
    // success the merchant carried on believing their edit was stored.
    saveSmartPricingWizardDraft.mockResolvedValue({ superseded: true, evicted: [] });

    const result = await saveWizardDraftEverywhere(SHOP, {
      experiment_id: 'exp_1',
      name: 'Spring pricing',
    });

    expect(result).toMatchObject({ server: true, superseded: true });
  });

  it('passes on which older draft the five-draft cap discarded', async () => {
    saveSmartPricingWizardDraft.mockResolvedValue({
      superseded: false,
      evicted: [{ experiment_id: 'exp_old', name: 'Winter pricing' }],
    });

    const result = await saveWizardDraftEverywhere(SHOP, {
      experiment_id: 'exp_1',
      name: 'Spring pricing',
    });

    expect(result.evicted).toEqual([{ experiment_id: 'exp_old', name: 'Winter pricing' }]);
  });

  it('reports a plain save as neither superseded nor evicting anything', async () => {
    saveSmartPricingWizardDraft.mockResolvedValue({});

    const result = await saveWizardDraftEverywhere(SHOP, {
      experiment_id: 'exp_1',
      name: 'Spring pricing',
    });

    expect(result).toMatchObject({ server: true, superseded: false });
    expect(result.evicted).toEqual([]);
  });

  it('separates a draft the server turned down from one it never got', async () => {
    // Over the size cap, most often. "Could not reach the server, try again"
    // sent merchants to retry a draft that can never be saved.
    const refusal = new Error('Draft is too large to save on the server');
    refusal.response = { status: 400 };
    saveSmartPricingWizardDraft.mockRejectedValue(refusal);

    const result = await saveWizardDraftEverywhere(SHOP, {
      experiment_id: 'exp_1',
      name: 'Spring pricing',
    });

    expect(result).toMatchObject({ server: false, refused: true });
    expect(result.reason).toContain('too large');
  });

  it('does not call a network failure a refusal', async () => {
    saveSmartPricingWizardDraft.mockRejectedValue(new Error('Network Error'));

    const result = await saveWizardDraftEverywhere(SHOP, {
      experiment_id: 'exp_1',
      name: 'Spring pricing',
    });

    expect(result).toMatchObject({ server: false, refused: false });
  });

  it('does not call a server fault a refusal either, because retrying may work', async () => {
    const boom = new Error('Internal Server Error');
    boom.response = { status: 500 };
    saveSmartPricingWizardDraft.mockRejectedValue(boom);

    const result = await saveWizardDraftEverywhere(SHOP, {
      experiment_id: 'exp_1',
      name: 'Spring pricing',
    });

    expect(result.refused).toBe(false);
  });

  it('saves nothing for a wizard that was only opened', async () => {
    const result = await saveWizardDraftEverywhere(SHOP, { experiment_id: 'exp_1' });

    expect(result.skipped).toBe(true);
    expect(saveSmartPricingWizardDraft).not.toHaveBeenCalled();
    expect(readClassicWizardDrafts(SHOP)).toEqual([]);
  });
});

describe('a draft too large for the server', () => {
  const tooLarge = () => {
    const err = new Error('Draft is too large to save on the server');
    err.response = { status: 400, data: { reason: 'draft_too_large' } };
    return err;
  };

  const bigSnapshot = () => ({
    experiment_id: 'exp_1',
    name: 'Spring pricing',
    selectedIds: ['gid://shopify/ProductVariant/2000'],
    audience: { segment: 'all_visitors', trafficAllocation: 100 },
    plans: [
      {
        id: 'SP-0',
        variant_id: 'gid://shopify/ProductVariant/2000',
        price_arms: [{ id: 'control', price: 10 }],
        learning_path: [{ round: 1 }],
        metadata: { experiment_id: 'exp_1', audience_ui: { segment: 'all_visitors' } },
      },
    ],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('sends a compacted draft in the first place', async () => {
    saveSmartPricingWizardDraft.mockResolvedValue({});

    await saveWizardDraftEverywhere(SHOP, bigSnapshot());

    const sent = saveSmartPricingWizardDraft.mock.calls[0][1];
    expect(sent.plans[0]).not.toHaveProperty('learning_path');
    expect(sent.plans[0].metadata).not.toHaveProperty('audience_ui');
  });

  it('tries again without the pricing table when the server still refuses', async () => {
    saveSmartPricingWizardDraft.mockRejectedValueOnce(tooLarge()).mockResolvedValueOnce({});

    const result = await saveWizardDraftEverywhere(SHOP, bigSnapshot());

    expect(saveSmartPricingWizardDraft).toHaveBeenCalledTimes(2);
    const retried = saveSmartPricingWizardDraft.mock.calls[1][1];
    expect(retried.plans).toEqual([]);
    expect(retried.plans_omitted).toBe(true);
    // What the merchant actually chose still reaches their other devices.
    expect(retried.selectedIds).toEqual(['gid://shopify/ProductVariant/2000']);
    expect(retried.audience).toEqual({ segment: 'all_visitors', trafficAllocation: 100 });
    expect(result).toMatchObject({ local: true, server: true, plansOmitted: true });
  });

  it('leaves the browser copy whole, table and all', async () => {
    saveSmartPricingWizardDraft.mockRejectedValueOnce(tooLarge()).mockResolvedValueOnce({});

    await saveWizardDraftEverywhere(SHOP, bigSnapshot());

    // The device in front of the merchant loses nothing; only the synced copy
    // is short, because only the synced copy has a ceiling.
    expect(readClassicWizardDrafts(SHOP)[0].plans).toHaveLength(1);
  });

  it('does not retry a refusal that a smaller draft would not fix', async () => {
    const err = new Error('draft.experiment_id is required');
    err.response = { status: 400, data: { reason: 'experiment_id_required' } };
    saveSmartPricingWizardDraft.mockRejectedValue(err);

    const result = await saveWizardDraftEverywhere(SHOP, bigSnapshot());

    expect(saveSmartPricingWizardDraft).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ server: false, refused: true });
  });

  it('reports the original refusal when the second attempt fails too', async () => {
    saveSmartPricingWizardDraft.mockRejectedValue(tooLarge());

    const result = await saveWizardDraftEverywhere(SHOP, bigSnapshot());

    expect(saveSmartPricingWizardDraft).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ server: false, refused: true });
    expect(result.reason).toContain('too large');
  });
});

describe('forgetWizardDraftEverywhere', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    deleteSmartPricingWizardDraft.mockResolvedValue({});
  });

  it('removes both copies', async () => {
    writeClassicWizardDraft(SHOP, { experiment_id: 'exp_1', name: 'Spring pricing' });

    expect(await forgetWizardDraftEverywhere(SHOP, 'exp_1')).toBe(true);
    expect(readClassicWizardDrafts(SHOP)).toEqual([]);
    expect(deleteSmartPricingWizardDraft).toHaveBeenCalledWith(SHOP, 'exp_1');
  });

  it('keeps the local copy when the server delete fails', async () => {
    // Clearing here first would leave the failure with nothing to retry from:
    // the surviving server row is merged straight back on the next refresh, so
    // the merchant deletes the same draft over and over. Keeping both until
    // the server agrees is the only answer that can be told the truth about.
    writeClassicWizardDraft(SHOP, { experiment_id: 'exp_1', name: 'Spring pricing' });
    deleteSmartPricingWizardDraft.mockRejectedValue(new Error('offline'));

    expect(await forgetWizardDraftEverywhere(SHOP, 'exp_1')).toBe(false);
    expect(readClassicWizardDrafts(SHOP).map(d => d.experiment_id)).toEqual(['exp_1']);
  });

  it('deletes the server copy before touching the local one', async () => {
    writeClassicWizardDraft(SHOP, { experiment_id: 'exp_1', name: 'Spring pricing' });
    let localAtRequestTime = null;
    deleteSmartPricingWizardDraft.mockImplementation(async () => {
      localAtRequestTime = readClassicWizardDrafts(SHOP).map(d => d.experiment_id);
      return {};
    });

    await forgetWizardDraftEverywhere(SHOP, 'exp_1');

    expect(localAtRequestTime).toEqual(['exp_1']);
    expect(readClassicWizardDrafts(SHOP)).toEqual([]);
  });
});
