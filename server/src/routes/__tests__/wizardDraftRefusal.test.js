const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { wizardDraftRefusalBody } = require('../smartPricingRoutes');

/**
 * What the wizard gets back when the store declines to keep a draft.
 *
 * Two audiences in one body: a sentence for the merchant, and a code for the
 * wizard, which answers an oversized draft by sending it again without its
 * pricing table.
 */
describe('a refused wizard draft', () => {
  it('names the reason as a code the wizard can act on', () => {
    // Matching on the sentence instead would mean a copy edit here quietly
    // turned the retry off, and the merchant would be back to a red error on
    // every Continue.
    const body = wizardDraftRefusalBody('draft_too_large');

    assert.equal(body.reason, 'draft_too_large');
    assert.equal(body.success, false);
  });

  it('still says in words what went wrong', () => {
    const body = wizardDraftRefusalBody('draft_too_large');

    assert.deepEqual(body.details, ['Draft is too large to save on the server']);
  });

  it('distinguishes a draft that is too big from one that is malformed', () => {
    // Only the first is worth retrying smaller.
    assert.equal(wizardDraftRefusalBody('experiment_id_required').reason, 'experiment_id_required');
    assert.deepEqual(wizardDraftRefusalBody('experiment_id_required').details, [
      'draft.experiment_id is required',
    ]);
  });

  it('answers a reason it does not recognise without pretending to know it', () => {
    const body = wizardDraftRefusalBody('');

    assert.equal(body.reason, 'unknown');
    assert.deepEqual(body.details, ['Could not save draft']);
  });
});
