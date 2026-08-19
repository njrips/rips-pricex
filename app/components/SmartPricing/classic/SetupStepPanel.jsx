import React, { useState } from 'react';
import { Button, TextField } from '@shopify/polaris';
import TooltipWrapper from '../../shared/TooltipWrapper';
import { IconCheck, IconChevron } from './classicIcons';
import styles from './SmartPricingClassic.module.css';

export const EXPERIMENT_TYPES = [
  {
    id: 'ab',
    title: 'A/B test',
    description: 'Compare two versions of a single element.',
    enabled: false,
  },
  {
    id: 'mvt',
    title: 'Multivariate',
    description: 'Test multiple element combinations at once.',
    enabled: false,
  },
  {
    id: 'split_url',
    title: 'Split URL',
    description: 'Redirect traffic to different page URLs.',
    enabled: false,
  },
  {
    id: 'feature_flag',
    title: 'Feature flag',
    description: 'Roll out features gradually with targeting.',
    enabled: false,
  },
  {
    id: 'price_test',
    title: 'Price test',
    description: 'Compare different price points for the same product.',
    enabled: true,
  },
  {
    id: 'offer_test',
    title: 'Offer test',
    description: 'Test a percent or amount-off offer on selected products.',
    enabled: true,
  },
];

export default function SetupStepPanel({
  name,
  onNameChange,
  hypothesis,
  onHypothesisChange,
  onGenerateHypothesis,
  hypothesisBusy = false,
  experimentType = 'price_test',
  onExperimentTypeChange,
  minSampleSize,
  onMinSampleSizeChange,
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <div>
      <div className={styles.field}>
        <TextField
          id="classic-exp-name"
          label="Experiment name"
          requiredIndicator
          value={name}
          onChange={onNameChange}
          placeholder={
            experimentType === 'offer_test'
              ? 'e.g. Summer offer — 10% off'
              : 'e.g. Growth plan — $39 price test'
          }
          autoComplete="off"
          autoFocus
        />
      </div>

      <div className={styles.field}>
        <div className={styles.labelRow}>
          <span className={styles.label}>Hypothesis</span>
          {typeof onGenerateHypothesis === 'function' ? (
            <Button
              variant="plain"
              onClick={onGenerateHypothesis}
              disabled={hypothesisBusy}
              loading={hypothesisBusy}
            >
              Generate with AI
            </Button>
          ) : null}
        </div>
        <TextField
          id="classic-hypothesis"
          label=""
          labelHidden
          value={hypothesis}
          onChange={onHypothesisChange}
          placeholder="If we change… then… because…"
          multiline={3}
          autoComplete="off"
          helpText="What do you expect to happen, and why?"
        />
      </div>

      <div className={styles.sectionLabel}>Experiment type</div>
      <div className={styles.typeGrid}>
        {EXPERIMENT_TYPES.map(type => {
          const selected = experimentType === type.id;
          const card = (
            <button
              type="button"
              disabled={!type.enabled}
              className={`${styles.choiceCard} ${selected ? styles.choiceCardSelected : ''} ${
                !type.enabled ? styles.choiceCardDisabled : ''
              }`}
              onClick={() => type.enabled && onExperimentTypeChange(type.id)}
              aria-pressed={selected}
            >
              <div className={styles.choiceTitle}>
                <span className={styles.choiceTitleText}>{type.title}</span>
                {selected ? (
                  <span className={styles.checkInline} aria-hidden>
                    <IconCheck size={16} />
                  </span>
                ) : null}
              </div>
              <p className={styles.choiceDesc}>{type.description}</p>
            </button>
          );
          if (type.enabled) {
            return <React.Fragment key={type.id}>{card}</React.Fragment>;
          }
          return (
            <span key={type.id} className={styles.choiceCardTooltipWrap}>
              <TooltipWrapper content="Coming soon" preferredPosition="above">
                <span className={styles.choiceCardTooltipTarget}>{card}</span>
              </TooltipWrapper>
            </span>
          );
        })}
      </div>

      <details
        className={styles.advanced}
        open={advancedOpen}
        onToggle={e => setAdvancedOpen(e.currentTarget.open)}
      >
        <summary className={styles.advancedSummary}>
          Advanced options
          <IconChevron size={16} up={advancedOpen} />
        </summary>
        <div className={styles.advancedBody}>
          <div className={styles.field} style={{ marginBottom: 0, marginTop: 14 }}>
            <TextField
              id="classic-min-sample"
              label="Minimum sample size per variation"
              type="number"
              min={100}
              value={String(minSampleSize ?? '')}
              onChange={onMinSampleSizeChange}
              autoComplete="off"
              helpText="Used when estimating how long the test needs to run."
            />
          </div>
        </div>
      </details>
    </div>
  );
}
