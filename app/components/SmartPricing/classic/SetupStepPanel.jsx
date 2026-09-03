import { useState } from 'react';
import { Button, TextField } from '@shopify/polaris';
import SettingsInfoLink from '../../Settings/SettingsInfoLink';
import { IconCheck, IconChevron } from './classicIcons';
import { formatVisitorCount } from './estimateSignificanceDuration';
import styles from './SmartPricingClassic.module.css';

export const EXPERIMENT_TYPES = [
  {
    id: 'price_test',
    title: 'Price test',
    description: 'Compare different price points for the same product.',
  },
  {
    id: 'offer_test',
    title: 'Offer test',
    description: 'Test a percent or amount-off offer on selected products.',
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
  significanceEstimate = null,
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
          return (
            <button
              key={type.id}
              type="button"
              className={`${styles.choiceCard} ${selected ? styles.choiceCardSelected : ''}`}
              onClick={() => onExperimentTypeChange(type.id)}
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
            <div className={styles.labelRow}>
              <span className={styles.label}>Minimum sample size per variation</span>
              <SettingsInfoLink hash="min-sample" label="Minimum sample" />
            </div>
            <TextField
              id="classic-min-sample"
              label="Minimum sample size per variation"
              labelHidden
              type="number"
              min={1}
              value={String(minSampleSize ?? '')}
              onChange={onMinSampleSizeChange}
              autoComplete="off"
            />
            {significanceEstimate?.recommendedSampleSize &&
            String(minSampleSize) !== String(significanceEstimate.recommendedSampleSize) ? (
              <div className={styles.labelRow}>
                <Button
                  variant="plain"
                  onClick={() =>
                    onMinSampleSizeChange(String(significanceEstimate.recommendedSampleSize))
                  }
                >
                  Use planning sample ({formatVisitorCount(significanceEstimate.recommendedSampleSize)})
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </details>
    </div>
  );
}
