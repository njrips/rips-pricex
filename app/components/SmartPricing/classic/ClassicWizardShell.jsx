import React from 'react';
import { Button } from '@shopify/polaris';
import { CLASSIC_CREATE_STEPS, getClassicCreateSteps } from './classicCreateSteps';
import {
  ButtonIconArrowLeft,
  ButtonIconArrowRight,
  ButtonIconRocket,
  IconCheck,
} from './classicIcons';
import styles from './SmartPricingClassic.module.css';

export default function ClassicWizardShell({
  stepIndex = 0,
  experimentType = 'price_test',
  title,
  subtitle,
  onBackToList,
  onBack,
  onContinue,
  continueLabel = 'Continue',
  continueDisabled = false,
  continueDisabledReason = '',
  backLabel = 'Back',
  showCancel = false,
  onCancel,
  onSaveDraft,
  saveDraftLabel = 'Save draft',
  saveDraftBusy = false,
  children,
  continueBusy = false,
}) {
  const steps = getClassicCreateSteps(experimentType);
  const step = steps[stepIndex] || steps[0] || CLASSIC_CREATE_STEPS[0];
  const heading = title || step.title;
  const sub = subtitle || step.description;
  const isLaunch = String(continueLabel || '')
    .toLowerCase()
    .includes('launch');
  const lastIndex = steps.length - 1;

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <div className={styles.pageBack}>
          <Button variant="plain" icon={ButtonIconArrowLeft} textAlign="start" onClick={onBackToList}>
            Back to experiments
          </Button>
        </div>
        <span className={styles.stepOf}>
          Step {stepIndex + 1} of {steps.length}
        </span>
      </div>

      <div className={styles.stepper} role="list" aria-label="Experiment setup progress">
        {steps.map((item, index) => {
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
          <div className={styles.pageBack}>
            <Button
              variant="plain"
              textAlign="start"
              icon={ButtonIconArrowLeft}
              onClick={onCancel || onBackToList}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <div className={styles.pageBack}>
            <Button
              variant="plain"
              textAlign="start"
              icon={ButtonIconArrowLeft}
              onClick={onBack}
              disabled={stepIndex === 0}
            >
              {backLabel}
            </Button>
          </div>
        )}
        <div className={styles.footerActions}>
          {typeof onSaveDraft === 'function' ? (
            <Button
              variant="tertiary"
              onClick={onSaveDraft}
              disabled={saveDraftBusy || continueBusy}
              loading={saveDraftBusy}
            >
              {saveDraftLabel}
            </Button>
          ) : null}
          <span className={isLaunch ? undefined : styles.iconTrailingBtn}>
            <Button
              variant="primary"
              icon={isLaunch ? ButtonIconRocket : ButtonIconArrowRight}
              onClick={onContinue}
              disabled={continueDisabled || continueBusy}
              loading={continueBusy}
              accessibilityLabel={
                continueDisabled && continueDisabledReason
                  ? `${continueLabel}. ${continueDisabledReason}`
                  : undefined
              }
            >
              {continueLabel}
            </Button>
          </span>
        </div>
      </div>
    </div>
  );
}
