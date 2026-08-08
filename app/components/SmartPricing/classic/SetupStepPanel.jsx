import React, { useState } from 'react';
import { IconCheck, IconChevron, IconWand } from './classicIcons';
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
    description: 'Test discounts, bundles, or promotional offers.',
    enabled: false,
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
        <label className={styles.label} htmlFor="classic-exp-name">
          Experiment name<span className={styles.required}>*</span>
        </label>
        <input
          id="classic-exp-name"
          className={styles.input}
          value={name}
          onChange={e => onNameChange(e.target.value)}
          placeholder="e.g. Growth plan — $39 price test"
          autoFocus
        />
      </div>

      <div className={styles.field}>
        <div className={styles.labelRow}>
          <label className={styles.label} htmlFor="classic-hypothesis">
            Hypothesis
          </label>
          {typeof onGenerateHypothesis === 'function' ? (
            <button
              type="button"
              className={styles.aiTextBtn}
              onClick={onGenerateHypothesis}
              disabled={hypothesisBusy}
            >
              <IconWand size={14} />
              {hypothesisBusy ? 'Generating…' : 'Generate with AI'}
            </button>
          ) : null}
        </div>
        <textarea
          id="classic-hypothesis"
          className={styles.textarea}
          value={hypothesis}
          onChange={e => onHypothesisChange(e.target.value)}
          placeholder="If we change… then… because…"
        />
        <p className={styles.help}>What do you expect to happen, and why?</p>
      </div>

      <div className={styles.sectionLabel}>Experiment type</div>
      <div className={styles.typeGrid}>
        {EXPERIMENT_TYPES.map(type => {
          const selected = experimentType === type.id;
          return (
            <button
              key={type.id}
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
            <label className={styles.label} htmlFor="classic-min-sample">
              Minimum sample size per variation
            </label>
            <input
              id="classic-min-sample"
              className={styles.input}
              type="number"
              min={100}
              value={minSampleSize}
              onChange={e => onMinSampleSizeChange(e.target.value)}
            />
            <p className={styles.help}>Used when estimating how long the test needs to run.</p>
          </div>
        </div>
      </details>
    </div>
  );
}
