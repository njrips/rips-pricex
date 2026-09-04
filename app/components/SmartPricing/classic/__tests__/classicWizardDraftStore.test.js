// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLASSIC_WIZARD_DRAFT_LIMIT,
  classicWizardDraftKey,
  clearClassicWizardDraft,
  readClassicWizardDraft,
  readClassicWizardDrafts,
  writeClassicWizardDraft,
} from '../classicExperimentHelpers';

const SHOP = 'demo.myshopify.com';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/**
 * Saves in a fixed order, oldest first.
 *
 * The store orders by `saved_at`, and real writes land inside the same
 * millisecond, so the clock has to move between them.
 */
function saveInOrder(ids) {
  let clock = Date.parse('2026-01-01T00:00:00.000Z');
  vi.useFakeTimers();
  ids.forEach(id => {
    clock += 60000;
    vi.setSystemTime(clock);
    writeClassicWizardDraft(SHOP, { experiment_id: id, name: `Name ${id}` });
  });
  vi.useRealTimers();
}

/** jsdom serves storage methods off the prototype, so the spy belongs there. */
function failSetItem(onCall) {
  return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(onCall);
}

describe('wizard draft store', () => {
  it('keeps a second experiment without destroying the first', () => {
    saveInOrder(['exp_1', 'exp_2']);

    expect(readClassicWizardDraft(SHOP, 'exp_1')?.name).toBe('Name exp_1');
    expect(readClassicWizardDraft(SHOP, 'exp_2')?.name).toBe('Name exp_2');
  });

  it('updates a draft in place rather than duplicating it', () => {
    writeClassicWizardDraft(SHOP, { experiment_id: 'exp_1', name: 'First try' });
    writeClassicWizardDraft(SHOP, { experiment_id: 'exp_1', name: 'Renamed' });

    expect(readClassicWizardDrafts(SHOP)).toHaveLength(1);
    expect(readClassicWizardDraft(SHOP, 'exp_1').name).toBe('Renamed');
  });

  it('returns the most recently saved draft when no id is given', () => {
    saveInOrder(['exp_1', 'exp_2']);

    expect(readClassicWizardDraft(SHOP).experiment_id).toBe('exp_2');
    expect(readClassicWizardDrafts(SHOP).map(d => d.experiment_id)).toEqual(['exp_2', 'exp_1']);
  });

  it('stamps saved_at on every write', () => {
    writeClassicWizardDraft(SHOP, { experiment_id: 'exp_1' });

    expect(Date.parse(readClassicWizardDraft(SHOP, 'exp_1').saved_at)).toBeGreaterThan(0);
  });

  it('drops the oldest once the limit is reached', () => {
    const ids = Array.from({ length: CLASSIC_WIZARD_DRAFT_LIMIT + 2 }, (_, i) => `exp_${i}`);
    saveInOrder(ids);

    const kept = readClassicWizardDrafts(SHOP).map(d => d.experiment_id);
    expect(kept).toHaveLength(CLASSIC_WIZARD_DRAFT_LIMIT);
    expect(kept).toContain(ids[ids.length - 1]);
    expect(kept).not.toContain(ids[0]);
    expect(kept).not.toContain(ids[1]);
  });

  it('reads a draft written by an older build that stored just one', () => {
    localStorage.setItem(
      classicWizardDraftKey(SHOP),
      JSON.stringify({ experiment_id: 'exp_old', name: 'Saved before the upgrade', step: 2 })
    );

    expect(readClassicWizardDraft(SHOP, 'exp_old').name).toBe('Saved before the upgrade');
    expect(readClassicWizardDrafts(SHOP)).toHaveLength(1);
  });

  it('does not lose an older build\u2019s draft when a new one is saved', () => {
    localStorage.setItem(
      classicWizardDraftKey(SHOP),
      JSON.stringify({ experiment_id: 'exp_old', name: 'Saved before the upgrade' })
    );

    writeClassicWizardDraft(SHOP, { experiment_id: 'exp_new', name: 'Saved after' });

    expect(readClassicWizardDraft(SHOP, 'exp_old').name).toBe('Saved before the upgrade');
    expect(readClassicWizardDraft(SHOP, 'exp_new').name).toBe('Saved after');
  });

  it('gives up the oldest draft rather than the write, when storage is full', () => {
    saveInOrder(['exp_1', 'exp_2']);
    const real = Storage.prototype.setItem;
    let calls = 0;
    const spy = failSetItem(function quotaOnFirstTry(key, value) {
      calls += 1;
      // Full for anything holding more than two drafts.
      if (calls === 1) {
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      }
      return real.call(this, key, value);
    });

    const saved = writeClassicWizardDraft(SHOP, { experiment_id: 'exp_3', name: 'Big one' });
    spy.mockRestore();

    expect(saved.experiment_id).toBe('exp_3');
    const kept = readClassicWizardDrafts(SHOP).map(d => d.experiment_id);
    expect(kept).toContain('exp_3');
    expect(kept).not.toContain('exp_1');
  });

  it('reports failure when even a single draft will not fit', () => {
    failSetItem(() => {
      const err = new Error('QuotaExceededError');
      err.name = 'QuotaExceededError';
      throw err;
    });

    expect(() => writeClassicWizardDraft(SHOP, { experiment_id: 'exp_1' })).toThrow(
      /QuotaExceededError/
    );
  });

  it('forgets one draft and leaves the others', () => {
    saveInOrder(['exp_1', 'exp_2']);

    clearClassicWizardDraft(SHOP, 'exp_1');

    expect(readClassicWizardDraft(SHOP, 'exp_1')).toBeNull();
    expect(readClassicWizardDraft(SHOP, 'exp_2')).not.toBeNull();
  });

  it('forgets every draft when no id is given', () => {
    saveInOrder(['exp_1', 'exp_2']);

    clearClassicWizardDraft(SHOP);

    expect(readClassicWizardDrafts(SHOP)).toEqual([]);
    expect(localStorage.getItem(classicWizardDraftKey(SHOP))).toBeNull();
  });

  it('removes the key once the last draft is cleared', () => {
    writeClassicWizardDraft(SHOP, { experiment_id: 'exp_1' });

    clearClassicWizardDraft(SHOP, 'exp_1');

    expect(localStorage.getItem(classicWizardDraftKey(SHOP))).toBeNull();
  });

  it('survives unparseable or unexpected stored values', () => {
    localStorage.setItem(classicWizardDraftKey(SHOP), 'not json');
    expect(readClassicWizardDrafts(SHOP)).toEqual([]);

    localStorage.setItem(classicWizardDraftKey(SHOP), JSON.stringify([null, 7, { name: 'no id' }]));
    expect(readClassicWizardDrafts(SHOP)).toEqual([]);
    expect(readClassicWizardDraft(SHOP, 'exp_1')).toBeNull();
  });

  it('keeps one shop\u2019s drafts out of another\u2019s', () => {
    writeClassicWizardDraft(SHOP, { experiment_id: 'exp_1', name: 'Shop one' });
    writeClassicWizardDraft('other.myshopify.com', { experiment_id: 'exp_2', name: 'Shop two' });

    expect(readClassicWizardDrafts(SHOP).map(d => d.experiment_id)).toEqual(['exp_1']);
    expect(readClassicWizardDrafts('other.myshopify.com').map(d => d.experiment_id)).toEqual([
      'exp_2',
    ]);
  });
});
