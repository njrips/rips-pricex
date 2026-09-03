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
  saveDraftDisabled = false,
  onGoToStep,
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

      {/* A group rather than a list: completed steps are real buttons, and a
          list may only contain listitems, so the list role forced a
          non-interactive role onto them. Position is carried by
          aria-current="step" on the active item. */}
      <div className={styles.stepper} role="group" aria-label="Experiment setup progress">
        {steps.map((item, index) => {
          const done = index < stepIndex;
          const active = index === stepIndex;
          const connectorComplete = index < stepIndex;
          const canJump =
            done && typeof onGoToStep === 'function' && !continueBusy;
          const itemClass = `${styles.stepItem} ${active ? styles.stepItemActive : ''} ${
            done ? styles.stepItemDone : ''
          } ${canJump ? styles.stepItemClickable : ''}`;
          const itemBody = (
            <>
              <span className={styles.stepDot} aria-hidden>
                {done ? <IconCheck size={14} /> : index + 1}
              </span>
              <span className={styles.stepText}>
                <span className={styles.stepLabel}>{item.label}</span>
                <span className={styles.stepSub}>{item.subtitle}</span>
              </span>
            </>
          );
          return (
            <React.Fragment key={item.id}>
              {canJump ? (
                <button
                  type="button"
                  className={itemClass}
                  onClick={() => onGoToStep(index)}
                  aria-label={`Go to ${item.label}`}
                >
                  {itemBody}
                </button>
              ) : (
                <div className={itemClass} aria-current={active ? 'step' : undefined}>
                  {itemBody}
                </div>
              )}
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
              disabled={saveDraftBusy || saveDraftDisabled || continueBusy}
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
