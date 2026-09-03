import { Button, TextField } from '@shopify/polaris';
import SettingsInfoLink from '../../Settings/SettingsInfoLink';
import { ButtonIconPlus, IconControlBaseline, IconScales } from './classicIcons';
import styles from './SmartPricingClassic.module.css';
import {
  buildNextVariation,
  normalizeTraffic,
  splitEvenly,
  trafficTotal,
} from './variationsStepHelpers';
import { isOfferExperimentType } from './offerSelection';

export {
  createDefaultVariations,
  nextChallengerLetter,
  normalizeTraffic,
  splitEvenly,
  trafficTotal,
} from './variationsStepHelpers';

export default function VariationsStepPanel({
  variations,
  onChange,
  experimentType = 'price_test',
}) {
  const total = trafficTotal(variations);
  const allPositive = variations.every(row => Number(row?.traffic) > 0);
  const ok = total === 100 && allPositive;
  const isOffer = isOfferExperimentType(experimentType);

  const updateRow = (index, patch) => {
    onChange(variations.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const onTraffic = (index, value) => {
    onChange(normalizeTraffic(variations, index, value));
  };

  const addVariation = () => {
    if (variations.length >= 5) return;
    onChange(splitEvenly([...variations, buildNextVariation(variations)]));
  };

  return (
    <div>
      <div className={styles.trafficBanner}>
        <span className={styles.trafficBannerLeft}>
          <span className={styles.trafficBannerIcon} aria-hidden>
            <IconScales size={16} />
          </span>
          <span className={styles.trafficBannerText}>
            Traffic allocated
            <SettingsInfoLink hash="traffic-split" label="Traffic split" />
          </span>
          <span className={ok ? styles.trafficOk : styles.trafficBad}>{total}%</span>
          <span className={styles.trafficBannerMuted}>/ 100%</span>
        </span>
        <Button onClick={() => onChange(splitEvenly(variations))}>Split evenly</Button>
      </div>
      {!allPositive ? (
        <p className={styles.error} role="alert">
          Every variation needs more than 0% traffic before you continue.
        </p>
      ) : null}
      {isOffer ? (
        <p className={styles.help}>
          Traffic only on this step. Set the percent or amount-off offer for each variation on
          Products.
        </p>
      ) : null}

      {variations.map((row, index) => {
        const isControl = index === 0 || row.id === 'control';
        return (
          <div key={row.id} className={styles.variationBlock}>
            <div className={styles.variationHead}>
              <span
                className={`${styles.variationBadgeLetter} ${
                  isControl ? styles.controlVariationMarker : ''
                }`}
                aria-label={
                  isControl ? 'Control — current catalog baseline' : `Variation ${row.letter}`
                }
                title={isControl ? 'Current catalog baseline' : undefined}
              >
                {isControl ? <IconControlBaseline size={14} /> : row.letter}
              </span>
              <span className={styles.variationTag}>{row.role}</span>
              {index > 1 ? (
                <span className={styles.variationRemove}>
                  <Button
                    variant="plain"
                    tone="critical"
                    onClick={() => onChange(splitEvenly(variations.filter((_, i) => i !== index)))}
                  >
                    Remove
                  </Button>
                </span>
              ) : null}
            </div>
            <TextField
              label="Variation name"
              labelHidden
              value={row.name}
              onChange={value => updateRow(index, { name: value })}
              autoComplete="off"
              placeholder="Variation name"
            />
            <TextField
              label="Variation description"
              labelHidden
              value={row.description}
              onChange={value => updateRow(index, { description: value })}
              autoComplete="off"
              placeholder={
                index === 0
                  ? isOffer
                    ? 'No offer (baseline)'
                    : 'Current price'
                  : "Describe what's different (optional)"
              }
            />
            <div className={styles.sliderRow}>
              <div className={styles.sliderCol}>
                <div className={styles.sliderMeta}>
                  <span className={styles.trafficLabel}>Traffic</span>
                  <span className={styles.pct}>{row.traffic}%</span>
                </div>
                <input
                  className={styles.slider}
                  type="range"
                  min={0}
                  max={100}
                  value={row.traffic}
                  style={{ '--slider-fill': `${row.traffic}%` }}
                  onChange={e => onTraffic(index, e.target.value)}
                  aria-label={`${row.name || row.letter} traffic`}
                />
              </div>
            </div>
          </div>
        );
      })}

      {variations.length < 5 ? (
        <Button icon={ButtonIconPlus} onClick={addVariation}>
          Add variation
        </Button>
      ) : null}
    </div>
  );
}
