/**
 * Resuming an experiment whose products may have been taken.
 *
 * A paused experiment holds nothing, so its products go back on offer in the
 * create wizard. By the time someone presses Resume, some of them may belong to
 * a test that is live -- and starting anyway would put two prices on one
 * product, each pricing a share of the same shoppers and each counting the same
 * orders as its own.
 *
 * An experiment is one test per product, so the fix needs no surgery on the
 * test: start the products that are free and leave the held ones paused. The
 * merchant can end the other test and resume the rest later.
 */

/**
 * What Resume should do, given what the preflight found.
 *
 * A preflight that failed returns `resume_all`: the per-product start calls
 * make the same check server-side and refuse individually, so a preflight
 * outage costs a rougher message, not a wrong price.
 */
export function planResume(preflight, testIds = []) {
  const all = (Array.isArray(testIds) ? testIds : []).map(id => String(id || '')).filter(Boolean);
  if (!preflight || typeof preflight !== 'object') {
    return { action: 'resume_all', start: all, blocked: [] };
  }
  const blocked = (Array.isArray(preflight.blocked) ? preflight.blocked : []).filter(
    row => row && row.test_id
  );
  if (!blocked.length) {
    return { action: 'resume_all', start: all, blocked: [] };
  }
  const clear = (Array.isArray(preflight.clear) ? preflight.clear : [])
    .map(id => String(id || ''))
    .filter(Boolean);
  return {
    action: clear.length ? 'confirm' : 'blocked',
    start: clear,
    blocked,
  };
}

/**
 * What to tell the merchant afterwards. A partial resume has to name both
 * numbers: "Experiment resumed" would be a half-truth for the products that
 * are still sitting paused.
 */
export function resumeOutcomeMessage({ started = 0, skipped = 0 } = {}) {
  if (started <= 0) return '';
  if (skipped <= 0) return 'Test resumed.';
  const products = `${started} product${started === 1 ? '' : 's'}`;
  const them = skipped === 1 ? 'it' : 'them';
  return `Resumed ${products}. ${skipped} stayed paused because another test is pricing ${them}.`;
}

/** Heading for the conflict dialog: some products left, or none. */
export function resumeConflictTitle({ start = [] } = {}) {
  return start.length ? 'Some products are in another test' : 'Nothing left to resume';
}

export function resumeConflictBody({ start = [] } = {}) {
  return start.length
    ? 'These products started a different test while this test was paused. Resuming them too would put two prices on one product, so they will stay paused:'
    : 'Every product in this test started a different test while it was paused. End those tests to free the products, then resume:';
}

export function resumeConflictConfirmLabel({ start = [] } = {}) {
  return `Resume the other ${start.length} product${start.length === 1 ? '' : 's'}`;
}

/**
 * The same news, for the experiment list, which has no dialog to choose in.
 *
 * Resuming part of an experiment is a real decision, so the list sends the
 * merchant to the page that can present it rather than quietly resuming some
 * products and leaving the rest paused without saying which.
 */
export function resumeConflictListMessage(plan) {
  const blocked = Array.isArray(plan?.blocked) ? plan.blocked : [];
  const names = blocked.slice(0, 2).map(describeBlockedProduct).join('; ');
  const more = blocked.length > 2 ? `, and ${blocked.length - 2} more` : '';
  const detail = names ? ` ${names}${more}.` : '';
  return plan?.action === 'blocked'
    ? `Every product in this test is in another test now.${detail} End those tests to free the products.`
    : `Some products are in another test now.${detail} Open the test to resume the rest.`;
}

/** One line per held product: what it is, and who has it. */
export function describeBlockedProduct(row) {
  const title = String(row?.title || 'This product');
  const holder = String(row?.blocked_by?.test_name || 'another test');
  const paused = row?.blocked_by?.status === 'paused' ? ' (paused)' : '';
  return `${title} — ${holder}${paused}`;
}
