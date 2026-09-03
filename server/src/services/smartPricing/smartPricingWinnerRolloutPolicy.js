function resolveReviewedWinnerIndex(test = {}, significance = {}, requestedIndex) {
  if (significance.sampleReady !== true) {
    throw new Error('Winner rollout requires every variation to reach the minimum sample');
  }
  // A mismatched split means visitors did not reach the variations in the
  // proportions the test asked for, so the two arms are not comparable. That is
  // a data fault, and no amount of evidence on top of it makes the winner real.
  const srm = significance.srm || {};
  if (srm.detected === true || srm.mismatch === true) {
    throw new Error(
      'Traffic split does not match this test’s allocation, so the variations cannot be compared. Check tracking or bot filtering before rolling out a winner.'
    );
  }
  if (significance.significant !== true) {
    if (significance.controlWin === true) {
      throw new Error('Control is the current decision; there is no challenger price to roll out');
    }
    throw new Error('Winner rollout requires a reviewed challenger evidence call');
  }
  const variants = Array.isArray(test.variants) ? test.variants : [];
  const winnerId = String(significance.winnerVariantId || '').trim();
  const signaledIndex = variants.findIndex(
    variant =>
      String(variant?.id || '') === winnerId || String(variant?.name || '') === winnerId
  );
  if (signaledIndex <= 0) {
    throw new Error('The reviewed challenger could not be matched to a test variation');
  }
  if (requestedIndex !== undefined && requestedIndex !== signaledIndex) {
    throw new Error('Requested variation does not match the reviewed challenger evidence');
  }
  return signaledIndex;
}

module.exports = {
  resolveReviewedWinnerIndex,
};
