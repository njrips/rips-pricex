import { useState } from 'react';
import { Button, Modal } from '@shopify/polaris';
import { buildClassicWizardResumePath } from './classicExperimentListActions';
import { classicCreateStepId } from './classicCreateSteps';
import { wizardDraftStepLabel } from './classicWizardAutosave';
import { IconInfo } from './classicIcons';
import styles from './SmartPricingClassic.module.css';

/** "3 minutes ago" down to the day, then a plain date. */
function formatSavedAt(savedAt) {
  const at = Date.parse(savedAt || '');
  if (!Number.isFinite(at)) return '';
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(at).toLocaleDateString();
}

function draftMeta(draft) {
  return [wizardDraftStepLabel(draft), formatSavedAt(draft.saved_at)].filter(Boolean).join(' · ');
}

/**
 * Experiments started in this browser that never reached the Drafts list.
 *
 * Autosave keeps them, but nothing else in the app knows they exist, so this
 * is the only route back to one after the merchant leaves the wizard.
 */
export default function ClassicUnfinishedDrafts({ drafts, onResume, onDiscard }) {
  const [pendingDiscard, setPendingDiscard] = useState(null);

  if (!drafts?.length) return null;

  return (
    <div className={styles.callout}>
      <span className={styles.calloutIcon} aria-hidden>
        <IconInfo />
      </span>
      <div className={styles.calloutBody}>
        <span className={styles.calloutStrong}>
          {drafts.length === 1
            ? 'You have an unfinished experiment'
            : `You have ${drafts.length} unfinished experiments`}
        </span>
        <span className={styles.calloutMeta}>
          Saved in this browser only. Choose products and save to have it listed under Drafts.
        </span>
        {drafts.map(draft => {
          const meta = draftMeta(draft);
          return (
            <div key={draft.experiment_id} className={styles.calloutRow}>
              <span className={styles.calloutRowText}>
                <span className={styles.calloutStrong}>{draft.name || 'Untitled experiment'}</span>
                {meta ? <span className={styles.calloutMeta}>{meta}</span> : null}
              </span>
              <span className={styles.calloutRowActions}>
                <Button
                  variant="plain"
                  onClick={() =>
                    onResume(
                      buildClassicWizardResumePath(
                        draft.experiment_id,
                        classicCreateStepId(draft.step) || undefined
                      )
                    )
                  }
                >
                  Continue
                </Button>
                <Button
                  variant="plain"
                  tone="critical"
                  onClick={() => setPendingDiscard(draft)}
                >
                  Discard
                </Button>
              </span>
            </div>
          );
        })}
      </div>
      <Modal
        open={Boolean(pendingDiscard)}
        onClose={() => setPendingDiscard(null)}
        title="Discard this unfinished experiment?"
        primaryAction={{
          content: 'Discard',
          destructive: true,
          onAction: () => {
            onDiscard(pendingDiscard);
            setPendingDiscard(null);
          },
        }}
        secondaryActions={[{ content: 'Keep it', onAction: () => setPendingDiscard(null) }]}
      >
        <Modal.Section>
          <p>
            {pendingDiscard?.name || 'This experiment'} was saved in this browser only, so
            discarding it cannot be undone.
          </p>
        </Modal.Section>
      </Modal>
    </div>
  );
}
