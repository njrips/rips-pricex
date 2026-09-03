const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  APPLY_READY_BATCH_CAP,
  APPLY_READY_TIME_BUDGET_MS,
  planApplyBatch,
  batchBudgetExhausted,
} = require('../applyReadyBatchPolicy');

describe('planApplyBatch', () => {
  it('drops blanks and duplicates so a product is not applied twice', () => {
    const { requested, testIds } = planApplyBatch(['a', ' a ', '', null, 'b', 'b']);
    assert.deepEqual(requested, ['a', 'b']);
    assert.deepEqual(testIds, ['a', 'b']);
  });

  it('keeps the overflow visible instead of discarding it', () => {
    const ids = Array.from({ length: APPLY_READY_BATCH_CAP + 7 }, (_, i) => `t-${i}`);
    const { requested, testIds } = planApplyBatch(ids);
    assert.equal(requested.length, APPLY_READY_BATCH_CAP + 7);
    assert.equal(testIds.length, APPLY_READY_BATCH_CAP);
    // The caller reports requested minus answered as deferred, so the ids that
    // did not fit have to remain countable.
    assert.equal(requested.length - testIds.length, 7);
  });

  it('treats a missing or malformed body as nothing to do', () => {
    assert.deepEqual(planApplyBatch(undefined).requested, []);
    assert.deepEqual(planApplyBatch('t-1').requested, []);
    assert.deepEqual(planApplyBatch([{}, 0, false]).requested, []);
  });
});

describe('batchBudgetExhausted', () => {
  it('always lets the first product run, however long it takes', () => {
    // A batch that returns having applied nothing leaves the merchant clicking
    // with no progress.
    assert.equal(batchBudgetExhausted(0, APPLY_READY_TIME_BUDGET_MS * 10), false);
  });

  it('stops once the budget is spent', () => {
    assert.equal(batchBudgetExhausted(1, APPLY_READY_TIME_BUDGET_MS - 1), false);
    assert.equal(batchBudgetExhausted(1, APPLY_READY_TIME_BUDGET_MS), true);
    assert.equal(batchBudgetExhausted(9, APPLY_READY_TIME_BUDGET_MS + 5000), true);
  });

  it('bounds a wide catalogue by time rather than by product count', () => {
    // Three products whose variants take 6s each: a count-based cap of 50 would
    // have kept going, which is what could outlast the request.
    let elapsed = 0;
    let processed = 0;
    const ids = Array.from({ length: 50 }, (_, i) => `t-${i}`);
    for (const _id of ids) {
      if (batchBudgetExhausted(processed, elapsed)) break;
      processed += 1;
      elapsed += 6000;
    }
    assert.equal(processed, 3);
    assert.equal(ids.length - processed, 47);
  });
});
