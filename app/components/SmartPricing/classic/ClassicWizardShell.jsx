import React from 'react';
import { CLASSIC_CREATE_STEPS as CREATE_STEPS } from './classicCreateSteps';
import { IconArrowLeft, IconArrowRight, IconCheck, IconRocket } from './classicIcons';
import styles from './SmartPricingClassic.module.css';

export default function ClassicWizardShell({
  stepIndex = 0,
  title,
  subtitle,
  onBackToList,
  onBack,
  onContinue,
  continueLabel = 'Continue',
  continueDisabled = false,
  backLabel = 'Back',
  showCancel = false,
  onCancel,
  onSaveDraft,
  saveDraftLabel = 'Save draft',
  saveDraftBusy = false,
  children,
  continueBusy = false,
}) {
  const step = CREATE_STEPS[stepIndex] || CREATE_STEPS[0];
  const heading = title || step.title;
  const sub = subtitle || step.description;
  const isLaunch = String(continueLabel || '')
    .toLowerCase()
    .includes('launch');
  const lastIndex = CREATE_STEPS.length - 1;

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <button type="button" className={styles.backLink} onClick={onBackToList}>
          <IconArrowLeft /> Back to experiments
        </button>
        <span className={styles.stepOf}>
          Step {stepIndex + 1} of {CREATE_STEPS.length}
        </span>
      </div>

      <div className={styles.stepper} role="list" aria-label="Experiment setup progress">
        {CREATE_STEPS.map((item, index) => {
          const done = index < stepIndex;
          const active = index === stepIndex;
          const connectorComplete = index < stepIndex;
          return (
            <React.Fragment key={item.id}>
              <div
                role="listitem"
                className={`${styles.stepItem} ${active ? styles.stepItemActive : ''} ${
                  done ? styles.stepItemDone : ''
                }`}
              >
                <span className={styles.stepDot} aria-hidden>
                  {done ? <IconCheck size={14} /> : index + 1}
                </span>
                <span className={styles.stepText}>
                  <span className={styles.stepLabel}>{item.label}</span>
                  <span className={styles.stepSub}>{item.subtitle}</span>
                </span>
              </div>
              {index < lastIndex ? (
                <div
                  className={`${styles.stepConnector} ${
                    connectorComplete ? styles.stepConnectorDone : ''
                  }`}
                  aria-hidden
                />
              ) : null}
            </React.Fragment>
          );
        })}
      </div>

      <div className={styles.card}>
        <h1 className={`${styles.title} ripx-classic-sans`}>{heading}</h1>
        <p className={styles.subtitle}>{sub}</p>
        {children}
      </div>

      <div className={styles.footer}>
        {showCancel ? (
          <button type="button" className={styles.footerLink} onClick={onCancel || onBackToList}>
            <IconArrowLeft /> Cancel
          </button>
        ) : (
          <button
            type="button"
            className={styles.footerLink}
            onClick={onBack}
            disabled={stepIndex === 0}
          >
            <IconArrowLeft /> {backLabel}
          </button>
        )}
        <div className={styles.footerActions}>
          {typeof onSaveDraft === 'function' ? (
            <button
              type="button"
              className={styles.saveDraftLink}
              onClick={onSaveDraft}
              disabled={saveDraftBusy || continueBusy}
            >
              {saveDraftBusy ? 'Saving…' : saveDraftLabel}
            </button>
          ) : null}
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={onContinue}
            disabled={continueDisabled || continueBusy}
          >
            {continueBusy ? (
              'Working…'
            ) : isLaunch ? (
              <>
                <IconRocket /> {continueLabel}
              </>
            ) : (
              <>
                {continueLabel} <IconArrowRight />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
