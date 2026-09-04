/**
 * Autosave rules for the Classic create wizard.
 *
 * The wizard only restores a saved draft when the URL carries `?resume=`, so a
 * fresh create never inherits an abandoned one. Autosave keeps that rule by
 * writing the id it saved under back into the URL: a refresh reloads the same
 * address and restores, while "Create experiment" still opens clean.
 */

import { CLASSIC_CREATE_STEPS, classicCreateStepId } from './classicCreateSteps';

/** Fields whose presence means the merchant put something into the wizard. */
function hasListValue(value) {
  return Array.isArray(value) && value.length > 0;
}

function hasMapValue(value) {
  return Boolean(value) && typeof value === 'object' && Object.keys(value).length > 0;
}

/**
 * Whether a snapshot holds merchant input rather than just wizard defaults.
 *
 * Opening the create page must not leave a draft behind, so an untouched
 * wizard is not worth a write. Anything the merchant typed or picked is.
 */
export function wizardSnapshotHasMerchantInput(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  if (String(snapshot.name || '').trim()) return true;
  if (String(snapshot.hypothesis || '').trim()) return true;
  if (String(snapshot.collectionId || '').trim()) return true;
  if (hasListValue(snapshot.selectedIds)) return true;
  if (hasListValue(snapshot.plans)) return true;
  if (hasMapValue(snapshot.priceOverrides)) return true;
  if (hasMapValue(snapshot.offerByArm)) return true;
  if (hasMapValue(snapshot.goalByPlan)) return true;
  return false;
}

/** Whether this snapshot should be written to the browser draft. */
export function shouldAutosaveWizardSnapshot(snapshot) {
  if (!String(snapshot?.experiment_id || '').trim()) return false;
  return wizardSnapshotHasMerchantInput(snapshot);
}

/**
 * The query string that makes the current step reloadable, or null when the URL
 * already says it.
 *
 * Returning null matters: handing an unchanged string to the router on every
 * render would navigate in a loop.
 */
export function buildWizardResumeSearch(searchParams, { experimentId, stepIndex } = {}) {
  const resume = String(experimentId || '').trim();
  const stepId = classicCreateStepId(stepIndex);
  if (!resume || !stepId) return null;

  const next = new URLSearchParams(searchParams || '');
  if (next.get('resume') === resume && next.get('step') === stepId) return null;
  next.set('resume', resume);
  next.set('step', stepId);
  return next.toString();
}

/**
 * Saved experiments that exist nowhere but this browser.
 *
 * An experiment with plans already has a row under Drafts, so repeating it
 * would be noise. One abandoned before products were chosen has no row
 * anywhere — without surfacing it here, leaving the wizard loses it for good.
 */
export function selectUnlistedWizardDrafts(drafts, listedExperimentIds) {
  const listed = new Set(
    Array.from(listedExperimentIds || [])
      .map(id => String(id || '').trim())
      .filter(Boolean)
  );
  return (Array.isArray(drafts) ? drafts : []).filter(draft => {
    const id = String(draft?.experiment_id || '').trim();
    if (!id || listed.has(id)) return false;
    return wizardSnapshotHasMerchantInput(draft);
  });
}

/** "Step 2 of 5 · Variations", for telling one saved draft from another. */
export function wizardDraftStepLabel(draft) {
  const index = Number(draft?.step);
  const step = Number.isInteger(index) ? CLASSIC_CREATE_STEPS[index] : null;
  if (!step) return '';
  return `Step ${index + 1} of ${CLASSIC_CREATE_STEPS.length} · ${step.label}`;
}
