import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@shopify/polaris';
import { useKeyedState } from '../../../../hooks/useKeyedState';
import useFocusTrap from '../../../../hooks/useFocusTrap';
import AudienceSuccessStepPanel from '../AudienceSuccessStepPanel';
import { estimateSignificanceDuration } from '../estimateSignificanceDuration';
import { shopDesignFromGuardrails } from '../sampleSizePolicy';
import styles from '../SmartPricingClassic.module.css';

export default function ClassicAudienceMetricsEditModal({
  open,
  focus = 'audience',
  initialValue,
  shopDomain = '',
  readOnly = false,
  readOnlyReason = '',
  liveWarning = '',
  saving = false,
  shopDefaultsReady = true,
  shopMaxRevenueDropPercent,
  plans = [],
  variations = [],
  shopGuardrails = {},
  onClose,
  onSave,
}) {
  // Edits are kept per open/close cycle so a parent re-render cannot wipe them.
  const [draft, setDraft] = useKeyedState(open, initialValue);
  const focusTrapRef = useFocusTrap(open);
  const significanceEstimate = useMemo(() => {
    if (!draft) return null;
    const design = shopDesignFromGuardrails(shopGuardrails);
    return estimateSignificanceDuration({
      plans,
      variations,
      trafficAllocation: draft.trafficAllocation,
      minSampleSize: draft.minSampleSize,
      minConversionsPerVariation: design.minConversions,
      mdePercent: design.mdePercent,
      confidenceLevel: design.confidenceLevel,
      power: design.power,
    });
  }, [draft, plans, shopGuardrails, variations]);

  useEffect(() => {
    if (!open || (focus !== 'metrics' && focus !== 'guardrail')) return undefined;
    const timer = window.setTimeout(() => {
      const body = document.querySelector(`.${styles.audienceEditBody}`);
      const target = document.getElementById(
        focus === 'guardrail' ? 'classic-revenue-guardrail' : 'classic-metrics-editor'
      );
      if (!body || !target) return;
      const offset = target.getBoundingClientRect().top - body.getBoundingClientRect().top;
      body.scrollTop += offset - 8;
    }, 80);
    return () => window.clearTimeout(timer);
  }, [open, focus]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = event => {
      if (event.key !== 'Escape' || saving) return;
      if (document.getElementById('classic-goal-picker-title')) return;
      if (document.querySelector('[role="listbox"][aria-label="Countries"]')) return;
      onClose();
    };
    const prevOverflow = document.body.style.overflow;
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose, saving]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={styles.modalBackdrop}
      role="presentation"
      onClick={event => {
        // Close only on the backdrop itself. Letting the dialog swallow the
        // click instead would put a mouse listener on a non-interactive
        // element, which keyboard users can never reach.
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div
        ref={focusTrapRef}
        className={`${styles.modal} ${styles.audienceEditModal}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="classic-audience-edit-title"
      >
        <div className={styles.modalHeader}>
          <div>
            <h2 id="classic-audience-edit-title" className={`${styles.modalTitle} ripx-classic-sans`}>
              {focus === 'guardrail'
                ? 'Edit revenue guardrail'
                : focus === 'metrics'
                  ? 'Edit metrics'
                  : 'Edit audience'}
            </h2>
            {readOnlyReason ? <p className={styles.help}>{readOnlyReason}</p> : null}
            {liveWarning ? <p className={styles.help}>{liveWarning}</p> : null}
          </div>
          <Button disabled={saving} onClick={onClose}>
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
        </div>
        <div className={styles.audienceEditBody}>
          <AudienceSuccessStepPanel
            value={draft}
            onChange={setDraft}
            shopDomain={shopDomain}
            shopMaxRevenueDropPercent={shopMaxRevenueDropPercent}
            significanceEstimate={significanceEstimate}
            disabled={readOnly || saving || !shopDefaultsReady}
          />
        </div>
        {readOnly ? null : (
          <div className={styles.modalFooter}>
            <span />
            <Button
              variant="primary"
              loading={saving}
              disabled={saving || !shopDefaultsReady}
              onClick={() => onSave(draft)}
            >
              {shopDefaultsReady ? 'Save changes' : 'Loading shop defaults…'}
            </Button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
