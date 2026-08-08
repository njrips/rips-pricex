import React from 'react';
import { IconPlus, IconScales } from './classicIcons';
import styles from './SmartPricingClassic.module.css';
import {
  buildNextVariation,
  createDefaultVariations,
  normalizeTraffic,
  splitEvenly,
  trafficTotal,
} from './variationsStepHelpers';

export {
  createDefaultVariations,
  nextChallengerLetter,
  normalizeTraffic,
  splitEvenly,
  trafficTotal,
} from './variationsStepHelpers';

export default function VariationsStepPanel({ variations, onChange }) {
  const total = trafficTotal(variations);
  const ok = total === 100;

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
          <span className={styles.trafficBannerText}>Traffic allocated</span>
          <span className={ok ? styles.trafficOk : styles.trafficBad}>{total}%</span>
          <span className={styles.trafficBannerMuted}>/ 100%</span>
        </span>
        <button
          type="button"
          className={styles.ghostBtn}
          onClick={() => onChange(splitEvenly(variations))}
        >
          Split evenly
        </button>
      </div>

      {variations.map((row, index) => (
        <div key={row.id} className={styles.variationBlock}>
          <div className={styles.variationHead}>
            <span className={styles.variationBadgeLetter}>{row.letter}</span>
            <span className={styles.variationTag}>{row.role}</span>
            {index > 1 ? (
              <button
                type="button"
                className={`${styles.footerLink} ${styles.variationRemove}`}
                onClick={() => onChange(splitEvenly(variations.filter((_, i) => i !== index)))}
              >
                Remove
              </button>
            ) : null}
          </div>
          <input
            className={`${styles.input} ${styles.variationInput}`}
            value={row.name}
            onChange={e => updateRow(index, { name: e.target.value })}
            placeholder="Variation name"
          />
          <input
            className={`${styles.input} ${styles.variationInput}`}
            value={row.description}
            onChange={e => updateRow(index, { description: e.target.value })}
            placeholder={index === 0 ? 'Current price' : "Describe what's different (optional)"}
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
      ))}

      {variations.length < 5 ? (
        <button type="button" className={styles.addVariation} onClick={addVariation}>
          <IconPlus size={16} /> Add variation
        </button>
      ) : null}
    </div>
  );
}
