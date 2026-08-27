import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@shopify/polaris';
import AudienceSuccessStepPanel from '../AudienceSuccessStepPanel';
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
  onClose,
  onSave,
}) {
  const [draft, setDraft] = useState(initialValue);

  useEffect(() => {
    if (open) setDraft(initialValue);
    // Snapshot only when the editor opens so parent re-renders do not wipe edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || focus !== 'metrics') return undefined;
    const timer = window.setTimeout(() => {
      const body = document.querySelector(`.${styles.audienceEditBody}`);
      const target = document.getElementById('classic-metrics-editor');
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
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        className={`${styles.modal} ${styles.audienceEditModal}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="classic-audience-edit-title"
        onClick={event => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <div>
            <h2 id="classic-audience-edit-title" className={`${styles.modalTitle} ripx-classic-sans`}>
              {focus === 'metrics' ? 'Edit metrics' : 'Edit audience'}
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
            disabled={readOnly || saving}
          />
        </div>
        {readOnly ? null : (
          <div className={styles.modalFooter}>
            <span />
            <Button variant="primary" loading={saving} disabled={saving} onClick={() => onSave(draft)}>
              Save changes
            </Button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
