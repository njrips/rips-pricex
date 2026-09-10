/**
 * A paused experiment holds nothing, so its products go back on offer in the
 * create wizard. By the time someone presses Resume, some of them may belong
 * to a test that is live, and starting anyway would put two prices on one
 * product.
 */
import { describe, expect, it } from 'vitest';
import {
  describeBlockedProduct,
  planResume,
  resumeConflictBody,
  resumeConflictConfirmLabel,
  resumeConflictTitle,
  resumeOutcomeMessage,
  resumeConflictListMessage,
} from '../resumeConflicts';

const HELD = {
  test_id: 'mine-b',
  title: 'Runner Shoe',
  blocked_by: { test_id: 'other', test_name: 'Summer pricing', status: 'running', live: true },
};

describe('deciding what Resume does', () => {
  it('resumes everything when nothing is held', () => {
    expect(planResume({ clear: ['a', 'b'], blocked: [] }, ['a', 'b'])).toEqual({
      action: 'resume_all',
      start: ['a', 'b'],
      blocked: [],
    });
  });

  it('asks first when some products are held', () => {
    const plan = planResume({ clear: ['a'], blocked: [HELD] }, ['a', 'mine-b']);
    expect(plan.action).toBe('confirm');
    expect(plan.start).toEqual(['a']);
    expect(plan.blocked).toEqual([HELD]);
  });

  it('has nothing to offer when every product is held', () => {
    const plan = planResume({ clear: [], blocked: [HELD] }, ['mine-b']);
    expect(plan.action).toBe('blocked');
    expect(plan.start).toEqual([]);
  });

  it('resumes everything when the preflight itself failed', () => {
    // The start calls make the same check server-side and refuse one product
    // at a time, so a preflight outage costs a rougher message, not a wrong
    // price.
    expect(planResume(null, ['a', 'b'])).toEqual({
      action: 'resume_all',
      start: ['a', 'b'],
      blocked: [],
    });
  });

  it('ignores a blocked entry with no test to skip', () => {
    expect(planResume({ clear: ['a'], blocked: [{ title: 'Ghost' }] }, ['a']).action).toBe(
      'resume_all'
    );
  });

  it('drops blank ids rather than posting them', () => {
    expect(planResume({ clear: ['a', '', null], blocked: [HELD] }, ['a']).start).toEqual(['a']);
  });
});

describe('what the merchant is told afterwards', () => {
  it('says the experiment resumed when all of it did', () => {
    expect(resumeOutcomeMessage({ started: 4, skipped: 0 })).toBe('Experiment resumed.');
  });

  it('names both numbers for a partial resume', () => {
    // "Experiment resumed" would be a half-truth for the products still paused.
    expect(resumeOutcomeMessage({ started: 8, skipped: 2 })).toBe(
      'Resumed 8 products. 2 stayed paused because another test is pricing them.'
    );
  });

  it('reads as one product and one it', () => {
    expect(resumeOutcomeMessage({ started: 1, skipped: 1 })).toBe(
      'Resumed 1 product. 1 stayed paused because another test is pricing it.'
    );
  });

  it('says nothing when nothing started', () => {
    expect(resumeOutcomeMessage({ started: 0, skipped: 3 })).toBe('');
  });
});

describe('the conflict dialog', () => {
  it('offers to resume the rest', () => {
    expect(resumeConflictTitle({ start: ['a'] })).toBe('Some products are in another test');
    expect(resumeConflictConfirmLabel({ start: ['a'] })).toBe('Resume the other 1 product');
    expect(resumeConflictConfirmLabel({ start: ['a', 'b'] })).toBe('Resume the other 2 products');
  });

  it('says so when there is no rest to resume', () => {
    expect(resumeConflictTitle({ start: [] })).toBe('Nothing left to resume');
    expect(resumeConflictBody({ start: [] })).toMatch(/end those tests/i);
  });

  it('explains why the held products stay paused', () => {
    expect(resumeConflictBody({ start: ['a'] })).toMatch(/two prices on one product/i);
  });

  it('names each held product and who has it', () => {
    expect(describeBlockedProduct(HELD)).toBe('Runner Shoe — Summer pricing');
  });

  it('marks a holder that is itself paused', () => {
    expect(
      describeBlockedProduct({
        ...HELD,
        blocked_by: { ...HELD.blocked_by, status: 'paused', live: false },
      })
    ).toBe('Runner Shoe — Summer pricing (paused)');
  });

  it('still reads as a sentence when the server named nothing', () => {
    expect(describeBlockedProduct({})).toBe('This product — another test');
  });
});

/**
 * The experiment list has no dialog to choose in, so it must not resume some
 * products and quietly leave the rest paused without saying which.
 */
describe('resumeConflictListMessage', () => {
  it('names who has the products and points at the page that can choose', () => {
    const message = resumeConflictListMessage({
      action: 'confirm',
      start: ['a'],
      blocked: [{ test_id: 'b', title: 'Runner Shoe', blocked_by: { test_name: 'Summer' } }],
    });
    expect(message).toMatch(/Runner Shoe/);
    expect(message).toMatch(/Summer/);
    expect(message).toMatch(/open the experiment/i);
  });

  it('says so plainly when there is nothing left to resume', () => {
    const message = resumeConflictListMessage({
      action: 'blocked',
      start: [],
      blocked: [{ test_id: 'b', title: 'Runner Shoe', blocked_by: { test_name: 'Summer' } }],
    });
    expect(message).toMatch(/every product/i);
    expect(message).not.toMatch(/open the experiment/i);
  });

  it('counts the rest rather than listing every product', () => {
    const blocked = ['A', 'B', 'C', 'D'].map((title, index) => ({
      test_id: `t${index}`,
      title,
      blocked_by: { test_name: 'Summer' },
    }));
    const message = resumeConflictListMessage({ action: 'confirm', start: ['a'], blocked });
    expect(message).toMatch(/and 2 more/);
  });
});
