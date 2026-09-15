jest.mock('../../../utils/database', () => ({
  query: jest.fn(),
}));

const { query } = require('../../../utils/database');
const {
  getShopWizardDrafts,
  saveShopWizardDraft,
  deleteShopWizardDraft,
  MAX_WIZARD_DRAFTS,
  MAX_DRAFT_BYTES,
} = require('../smartPricingWizardDraftStore');

const SHOP = 'demo.myshopify.com';

/**
 * A key_value_store standing in for the real one, so a save and the read that
 * follows it see the same thing rather than each test hand-feeding rows.
 *
 * The writes honour the same compare-and-set the store relies on, so a test
 * can put two savers in flight at once and see what the real table would do.
 */
function useFakeStore(seed = {}) {
  const rows = new Map(Object.entries(seed));
  query.mockImplementation(async (sql, params) => {
    const text = sql.trim();
    if (/^SELECT/i.test(text)) {
      const value = rows.get(params[0]);
      return { rows: value === undefined ? [] : [{ value }] };
    }
    if (/^INSERT/i.test(text)) {
      if (rows.has(params[0])) return { rows: [], rowCount: 0 };
      rows.set(params[0], params[1]);
      return { rows: [], rowCount: 1 };
    }
    // UPDATE ... WHERE key = $1 AND value = $3
    if (rows.get(params[0]) !== params[2]) return { rows: [], rowCount: 0 };
    rows.set(params[0], params[1]);
    return { rows: [], rowCount: 1 };
  });
  return rows;
}

const stamped = (id, savedAt, extra = {}) => ({
  experiment_id: id,
  saved_at: savedAt,
  ...extra,
});

describe('smartPricingWizardDraftStore', () => {
  beforeEach(() => {
    query.mockReset();
  });

  it('stores a draft and reads it back', async () => {
    useFakeStore();
    await saveShopWizardDraft(SHOP, { experiment_id: 'exp_1', name: 'Spring pricing' });

    const drafts = await getShopWizardDrafts(SHOP);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].name).toBe('Spring pricing');
  });

  it('keeps fields it knows nothing about', async () => {
    // The wizard gains controls release by release. A store that validated its
    // shape would drop the merchant's work every time one was added.
    useFakeStore();
    await saveShopWizardDraft(SHOP, {
      experiment_id: 'exp_1',
      name: 'Spring pricing',
      someFutureStep: { answer: 42 },
    });

    const drafts = await getShopWizardDrafts(SHOP);
    expect(drafts[0].someFutureStep).toEqual({ answer: 42 });
  });

  it('replaces a draft rather than listing it twice', async () => {
    useFakeStore();
    await saveShopWizardDraft(SHOP, { experiment_id: 'exp_1', name: 'First name', step: 0 });
    await saveShopWizardDraft(SHOP, { experiment_id: 'exp_1', name: 'Second name', step: 2 });

    const drafts = await getShopWizardDrafts(SHOP);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ name: 'Second name', step: 2 });
  });

  it('keeps the stamp the browser sent, which says when the edit happened', async () => {
    useFakeStore();
    const { saved } = await saveShopWizardDraft(SHOP, stamped('exp_1', '2026-02-02T00:00:00.000Z'));

    expect(saved.saved_at).toBe('2026-02-02T00:00:00.000Z');
  });

  it('stamps a draft that arrives without one', async () => {
    useFakeStore();
    const before = Date.now();
    const { saved } = await saveShopWizardDraft(SHOP, { experiment_id: 'exp_1' });

    expect(Date.parse(saved.saved_at)).toBeGreaterThanOrEqual(before - 1000);
  });

  it('drops the least recently saved draft past the cap', async () => {
    useFakeStore();
    for (let index = 0; index < MAX_WIZARD_DRAFTS + 2; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await saveShopWizardDraft(SHOP, { experiment_id: `exp_${index}`, name: `Draft ${index}` });
    }

    const drafts = await getShopWizardDrafts(SHOP);
    expect(drafts).toHaveLength(MAX_WIZARD_DRAFTS);
    // The two oldest are gone, not the two most recent.
    expect(drafts.map(d => d.experiment_id)).toContain(`exp_${MAX_WIZARD_DRAFTS + 1}`);
    expect(drafts.map(d => d.experiment_id)).not.toContain('exp_0');
  });

  it('names the draft the cap discarded rather than dropping it in silence', async () => {
    // The browser caps at the same number, so the local copy goes too: there
    // is no other copy to recover it from, and a merchant who was told
    // nothing came back to Drafts to find work missing.
    useFakeStore();
    for (let index = 0; index < MAX_WIZARD_DRAFTS; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await saveShopWizardDraft(SHOP, { experiment_id: `exp_${index}`, name: `Draft ${index}` });
    }

    const result = await saveShopWizardDraft(SHOP, {
      experiment_id: 'exp_new',
      name: 'Spring pricing',
    });

    expect(result.evicted).toEqual([{ experiment_id: 'exp_0', name: 'Draft 0' }]);
  });

  it('reports nothing evicted while the shop is under the cap', async () => {
    useFakeStore();
    const result = await saveShopWizardDraft(SHOP, { experiment_id: 'exp_1', name: 'Spring' });

    expect(result.evicted).toEqual([]);
  });

  it('does not report an eviction when the save only replaced an existing draft', async () => {
    useFakeStore();
    for (let index = 0; index < MAX_WIZARD_DRAFTS; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await saveShopWizardDraft(SHOP, { experiment_id: `exp_${index}`, name: `Draft ${index}` });
    }

    const result = await saveShopWizardDraft(SHOP, { experiment_id: 'exp_0', name: 'Draft 0' });

    expect(result.evicted).toEqual([]);
  });

  /**
   * The wizard fires a save on each Continue without waiting for the last one,
   * so these arrive out of order and, across two tabs, interleave.
   */
  describe('concurrent saves', () => {
    it('does not let a late save rewind the draft to an earlier step', async () => {
      useFakeStore();
      await saveShopWizardDraft(SHOP, stamped('exp_1', '2026-02-02T00:00:03.000Z', { step: 3 }));
      // Step 2 was saved first but reaches the server second.
      await saveShopWizardDraft(SHOP, stamped('exp_1', '2026-02-02T00:00:02.000Z', { step: 2 }));

      const drafts = await getShopWizardDrafts(SHOP);
      expect(drafts[0].step).toBe(3);
    });

    it('reports the copy it kept, not the one it discarded', async () => {
      useFakeStore();
      await saveShopWizardDraft(SHOP, stamped('exp_1', '2026-02-02T00:00:03.000Z', { step: 3 }));
      const { saved } = await saveShopWizardDraft(
        SHOP,
        stamped('exp_1', '2026-02-02T00:00:02.000Z', { step: 2 })
      );

      expect(saved.step).toBe(3);
    });

    it('says the save was superseded rather than letting it pass for stored', async () => {
      // These stamps are browser clocks from different devices. A phone a few
      // minutes fast pins the draft, and every later save from the laptop is
      // discarded -- so answering a plain "saved" to those is a lie the
      // merchant goes on to act on.
      useFakeStore();
      const first = await saveShopWizardDraft(
        SHOP,
        stamped('exp_1', '2026-02-02T00:00:03.000Z', { step: 3 })
      );
      const second = await saveShopWizardDraft(
        SHOP,
        stamped('exp_1', '2026-02-02T00:00:02.000Z', { step: 2 })
      );

      expect(first.superseded).toBe(false);
      expect(second.superseded).toBe(true);
    });

    it('keeps both drafts when two tabs save different ones at once', async () => {
      // Every draft for a shop shares one row, so a plain read-modify-write
      // meant the second writer put back a list that never held the first.
      useFakeStore();
      await Promise.all([
        saveShopWizardDraft(SHOP, stamped('exp_a', '2026-02-02T00:00:01.000Z')),
        saveShopWizardDraft(SHOP, stamped('exp_b', '2026-02-02T00:00:02.000Z')),
      ]);

      const drafts = await getShopWizardDrafts(SHOP);
      expect(drafts.map(d => d.experiment_id).sort()).toEqual(['exp_a', 'exp_b']);
    });

    it('keeps the surviving drafts when a save and a delete overlap', async () => {
      useFakeStore();
      await saveShopWizardDraft(SHOP, stamped('exp_a', '2026-02-02T00:00:01.000Z'));

      await Promise.all([
        saveShopWizardDraft(SHOP, stamped('exp_b', '2026-02-02T00:00:02.000Z')),
        deleteShopWizardDraft(SHOP, 'exp_a'),
      ]);

      const drafts = await getShopWizardDrafts(SHOP);
      expect(drafts.map(d => d.experiment_id)).toEqual(['exp_b']);
    });

    it('gives up rather than looping forever when the row never settles', async () => {
      // Every write loses its compare-and-set. Better to fail the request than
      // spin, and the browser copy still has the merchant's work.
      query.mockImplementation(async sql =>
        /^SELECT/i.test(sql.trim()) ? { rows: [{ value: '[]' }] } : { rows: [], rowCount: 0 }
      );

      await expect(saveShopWizardDraft(SHOP, { experiment_id: 'exp_1' })).rejects.toThrow(
        /kept changing/
      );
    });
  });

  it('refuses a draft with no experiment id', async () => {
    useFakeStore();
    const result = await saveShopWizardDraft(SHOP, { name: 'Nameless' });

    expect(result.saved).toBeNull();
    expect(result.reason).toBe('experiment_id_required');
  });

  it('refuses an oversized draft instead of filling the row with it', async () => {
    useFakeStore();
    const result = await saveShopWizardDraft(SHOP, {
      experiment_id: 'exp_1',
      selectedIds: ['x'.repeat(MAX_DRAFT_BYTES)],
    });

    expect(result.saved).toBeNull();
    expect(result.reason).toBe('draft_too_large');
  });

  it('forgets one draft and leaves the rest', async () => {
    useFakeStore();
    await saveShopWizardDraft(SHOP, { experiment_id: 'exp_1' });
    await saveShopWizardDraft(SHOP, { experiment_id: 'exp_2' });

    await deleteShopWizardDraft(SHOP, 'exp_1');

    const drafts = await getShopWizardDrafts(SHOP);
    expect(drafts.map(d => d.experiment_id)).toEqual(['exp_2']);
  });

  it('keeps one shop out of another shop\u2019s drafts', async () => {
    useFakeStore();
    await saveShopWizardDraft(SHOP, { experiment_id: 'exp_1' });

    expect(await getShopWizardDrafts('other.myshopify.com')).toEqual([]);
  });

  it('treats the same shop written two ways as one shop', async () => {
    useFakeStore();
    await saveShopWizardDraft(' Demo.MyShopify.com ', { experiment_id: 'exp_1' });

    expect(await getShopWizardDrafts(SHOP)).toHaveLength(1);
  });

  it('reports no drafts rather than throwing when the row is unreadable', async () => {
    // A list that cannot be parsed must not take the experiments page down with
    // it -- the experiments that do exist are still worth showing.
    useFakeStore({ 'smart_pricing_wizard_drafts.demo.myshopify.com': '{not json' });

    expect(await getShopWizardDrafts(SHOP)).toEqual([]);
  });

  it('reports no drafts when the shop is missing', async () => {
    useFakeStore();
    expect(await getShopWizardDrafts('')).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
