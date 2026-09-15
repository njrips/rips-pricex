/**
 * Keeps a saved wizard draft small enough to store.
 *
 * A draft carries one plan object per selected product, and a plan is mostly
 * preview material the server built to fill the Products step: three rounds of
 * learning path, the variant-count options the merchant did not pick, the
 * projections behind each arm. At roughly 5.7 KB a product that is about half
 * a megabyte by ninety products, which is where the server's per-draft ceiling
 * refused the save and every Continue turned red.
 *
 * None of what is dropped here is read again after a draft is restored. The
 * merchant's own choices -- which products, which variations, which prices,
 * which audience -- live at the top of the snapshot, not inside the plans, and
 * the plans themselves are rebuilt from the preview call each time the
 * Products step is passed.
 */

/**
 * Plan fields the server builds for the Products step and nobody reads back.
 *
 * Checked against every read of a plan object in the client and against what
 * the launch and preview endpoints take from a plan they are sent. Two are
 * worth naming because they look load-bearing and are not:
 *
 * `arm_projections` is copied onto the launched test when present and skipped
 * when absent, so losing it costs a piece of reporting metadata rather than
 * the test itself.
 *
 * `guardrail_checks` is deliberately NOT here. It is the only one of these the
 * review step's preflight still reads, and an absent list counts as a pass --
 * so dropping it would quietly retire the margin and checkout blockers for
 * exactly the large experiments that most need them.
 */
export const DROPPED_DRAFT_PLAN_FIELDS = Object.freeze([
  'learning_path',
  'variant_count_options',
  'recommended_variant_count',
  'variant_count_rationale',
  'arm_projections',
  'ai_summary',
  'schema_version',
  'plan_version',
  'shop_domain',
  'traffic_split_strategy',
]);

/** Bytes this snapshot would take on the wire, which is what the cap counts. */
export function wizardSnapshotBytes(snapshot) {
  try {
    return new TextEncoder().encode(JSON.stringify(snapshot ?? null)).length;
  } catch {
    return 0;
  }
}

function compactPlan(plan) {
  if (!plan || typeof plan !== 'object') return plan;
  const next = { ...plan };
  DROPPED_DRAFT_PLAN_FIELDS.forEach(field => {
    delete next[field];
  });
  // The whole audience state, copied into every plan. It is already stored
  // once at the top of the snapshot, and `stampClassicExperimentMetadata`
  // writes it back over each plan from that single copy before launch, so the
  // per-plan copies are only ever read after being rewritten.
  if (next.metadata && typeof next.metadata === 'object' && 'audience_ui' in next.metadata) {
    next.metadata = { ...next.metadata };
    delete next.metadata.audience_ui;
  }
  return next;
}

/**
 * The same draft, without the parts that are rebuilt rather than remembered.
 *
 * Restoring a compacted draft gives the merchant back everything they can see
 * or change, so this is applied to the browser copy too -- storage there is
 * finite as well, and five drafts of a large experiment is the case that fills
 * it.
 */
export function compactWizardSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  if (!Array.isArray(snapshot.plans)) return snapshot;
  return { ...snapshot, plans: snapshot.plans.map(compactPlan) };
}

/**
 * What actually gets written to either copy of a draft.
 *
 * Compacts first, then drops `plans_omitted` once a pricing table is back.
 * That flag only describes a server-side partial save; leaving it on after the
 * merchant rebuilt plans would reopen the draft a step short on the next resume.
 */
export function prepareWizardSnapshotForSave(snapshot) {
  const compact = compactWizardSnapshot(snapshot);
  if (!compact || typeof compact !== 'object') return compact;
  if (!Array.isArray(compact.plans) || !compact.plans.length) return compact;
  const { plans_omitted: _plansOmitted, ...rest } = compact;
  return rest;
}

/**
 * The draft with its pricing table left behind.
 *
 * The last resort for an experiment too big to store even compacted, and a far
 * better one than refusing the save outright: what survives is everything the
 * merchant typed, so the draft still opens on another device with the right
 * products, variations, prices and audience. Only the table the Products step
 * builds from them is missing, and passing through that step builds it again.
 *
 * `plans_omitted` says so, so a restore can tell this apart from a draft saved
 * before the merchant had reached the Products step.
 */
export function omitPlansFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  const { plans, ...rest } = snapshot;
  if (!Array.isArray(plans) || !plans.length) return snapshot;
  return { ...rest, plans: [], plans_omitted: true };
}
