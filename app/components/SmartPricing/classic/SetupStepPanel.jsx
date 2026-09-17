import { TextField } from '@shopify/polaris';
import { IconCheck } from './classicIcons';
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
    description: 'Show a sale price with the original price crossed out.',
  },
];

export default function SetupStepPanel({
  name,
  onNameChange,
  hypothesis,
  onHypothesisChange,
  experimentType = 'price_test',
  onExperimentTypeChange,
}) {
  return (
    <div>
      <div className={styles.field}>
        <TextField
          id="classic-exp-name"
          label="Test name"
          requiredIndicator
          value={name}
          onChange={onNameChange}
          placeholder={
            experimentType === 'offer_test'
              ? 'e.g. Summer offer — 10% off'
              : 'e.g. Growth plan – £39 price test'
          }
          autoComplete="off"
        />
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Optional: hypothesis</span>
        <TextField
          id="classic-hypothesis"
          label=""
          labelHidden
          value={hypothesis}
          onChange={onHypothesisChange}
          placeholder="If we change… then… because…"
          multiline={3}
          autoComplete="off"
          helpText="Optional, for your notes only."
        />
      </div>

      <div className={styles.sectionLabel}>Test type</div>
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
    </div>
  );
}
