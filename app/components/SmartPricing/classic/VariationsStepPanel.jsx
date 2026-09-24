import { useState } from 'react';
import { Button, TextField } from '@shopify/polaris';
import LabelWithInfo from '../../Settings/primitives/LabelWithInfo';
import { ButtonIconPlus, IconControlBaseline, IconScales } from './classicIcons';
import styles from './SmartPricingClassic.module.css';
import {
  buildNextVariation,
  getVariationsStepContinueState,
  MIN_ALLOCATION_PERCENT,
  setVariationTraffic,
  sliderFillPercent,
  formatTrafficPercent,
  roundTrafficPercent,
  splitEvenly,
  trafficRemaining,
  trafficSplitIsComplete,
  trafficTotal,
  variationTrafficHeadroom,
} from './variationsStepHelpers';
import { isOfferExperimentType } from './offerSelection';

export {
  createDefaultVariations,
  getVariationsStepContinueState,
  nextChallengerLetter,
  setVariationTraffic,
  splitEvenly,
  trafficRemaining,
  trafficTotal,
} from './variationsStepHelpers';

/** Up to 100 with one decimal (e.g. 33.3). */
function percentDraft(raw) {
  let s = String(raw ?? '').replace(/[^\d.]/g, '');
  const firstDot = s.indexOf('.');
  if (firstDot >= 0) {
    s =
      s.slice(0, firstDot + 1) +
      s
        .slice(firstDot + 1)
        .replace(/\./g, '')
        .slice(0, 1);
  }
  const whole = firstDot >= 0 ? s.slice(0, firstDot) : s;
  if (whole.length > 3) {
    s = firstDot >= 0 ? `${whole.slice(0, 3)}.${s.slice(firstDot + 1)}` : whole.slice(0, 3);
  }
  return s;
}

/**
 * A percent field that can be typed into or stepped, and cannot leave its range.
 *
 * Clamping on every keystroke makes a field unusable: typing "50" into a row
 * capped at 40 gets rewritten to 4 after the first character, and the second
 * keystroke then reads as 45. So typing goes into a draft of raw digits and is
 * only reconciled with the cap when the edit finishes.
 *
 * Stepping is the opposite case. Up/Down, PageUp/PageDown, Home/End and the
 * spinner buttons each produce a finished number, so they apply immediately.
 * Polaris funnels all of them through `onSpinnerChange` when it is given one,
 * having already clamped against `min`/`max`; without that prop they would
 * arrive as `onChange` and sit in the draft until blur, which would leave the
 * slider ignoring the arrow keys.
 */
function PercentField({ label, value, min = 0, max = 100, disabled = false, onCommit }) {
  const [draft, setDraft] = useState(null);

  const clampPercent = next =>
    roundTrafficPercent(Math.max(min, Math.min(max, Number(next) || 0)));

  const commit = () => {
    if (draft === null) return;
    const parsed = draft === '' ? min : Number(draft);
    setDraft(null);
    onCommit(clampPercent(parsed));
  };

  const step = next => {
    setDraft(null);
    onCommit(clampPercent(next));
  };

  return (
    <span
      className={styles.percentField}
      // Nothing here is interactive; the input inside is. The wrapper only
      // watches an event on its way out, so it carries no semantics of its own.
      role="presentation"
      // Polaris owns the input's onKeyDown to drive its own stepping and has no
      // rest-spread, so a handler passed to TextField is silently dropped.
      // Enter has to be caught on the way out instead.
      onKeyDown={event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        commit();
      }}
    >
      <TextField
        label={label}
        labelHidden
        // Renders as a plain text input -- "integer" is not a real input type --
        // so there is no native spinner to double up on Polaris's own, and no
        // wheel-over-a-focused-field silently changing the split.
        type="integer"
        min={min}
        max={max}
        step={1}
        largeStep={10}
        inputMode="numeric"
        autoComplete="off"
        suffix="%"
        align="right"
        disabled={disabled}
        value={draft ?? formatTrafficPercent(value)}
        onChange={next => setDraft(percentDraft(next))}
        onSpinnerChange={step}
        onBlur={commit}
      />
    </span>
  );
}

export default function VariationsStepPanel({
  variations,
  onChange,
  experimentType = 'price_test',
  // Matches the wizard's own default, so the slider cannot read 50% on a step
  // whose state says 100%.
  trafficAllocation = 100,
  onTrafficAllocationChange,
}) {
  const total = trafficTotal(variations);
  const remaining = trafficRemaining(variations);
  const gate = getVariationsStepContinueState({ variations });
  const isOffer = isOfferExperimentType(experimentType);
  const allocation = Math.max(
    MIN_ALLOCATION_PERCENT,
    Math.min(100, Number(trafficAllocation) || MIN_ALLOCATION_PERCENT)
  );

  const setAllocation = next => {
    if (typeof onTrafficAllocationChange !== 'function') return;
    onTrafficAllocationChange(
      Math.max(MIN_ALLOCATION_PERCENT, Math.min(100, Math.round(Number(next) || 0)))
    );
  };

  const updateRow = (index, patch) => {
    onChange(variations.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const onTraffic = (index, value) => {
    onChange(setVariationTraffic(variations, index, value));
  };

  // Appended at 0% rather than re-split: silently taking traffic off arms the
  // merchant has already set is the behaviour this step moved away from.
  const addVariation = () => {
    if (variations.length >= 4) return;
    onChange([...variations, buildNextVariation(variations)]);
  };

  return (
    <div>
      <div className={styles.sectionLabel}>How much traffic enters this test</div>
      <div className={styles.field}>
        <LabelWithInfo
          htmlFor="classic-variations-allocation"
          hash="traffic-split"
          label="Traffic split"
        >
          Traffic allocation
        </LabelWithInfo>
        <div className={styles.allocationRow}>
          <input
            className={styles.slider}
            id="classic-variations-allocation"
            type="range"
            min={MIN_ALLOCATION_PERCENT}
            max={100}
            value={allocation}
            style={{
              '--slider-fill': `${sliderFillPercent(allocation, MIN_ALLOCATION_PERCENT, 100)}%`,
            }}
            onChange={event => setAllocation(event.target.value)}
            aria-label="Traffic allocation"
          />
          <PercentField
            label="Traffic allocation percent"
            value={allocation}
            min={MIN_ALLOCATION_PERCENT}
            onCommit={setAllocation}
          />
        </div>
        <p className={styles.help}>
          What percentage of eligible visitors should enter this test?
        </p>
        <p className={styles.help} style={{ marginTop: 0 }}>
          {formatTrafficPercent(allocation)}% of eligible visitors will enter this test.
        </p>
      </div>

      <div className={styles.sectionLabel}>Split traffic between variations</div>
      {!isOffer ? (
        <p className={styles.help} style={{ marginTop: 0, marginBottom: 12 }}>
          Split test traffic between your current price (control) and up to 4 price variations.
        </p>
      ) : null}

      <div className={styles.trafficBanner}>
        <span className={styles.trafficBannerLeft}>
          <span className={styles.trafficBannerIcon} aria-hidden>
            <IconScales size={16} />
          </span>
          <span className={styles.trafficBannerText}>Traffic split</span>
          <span className={gate.disabled ? styles.trafficBad : styles.trafficOk}>
            {formatTrafficPercent(total)}%
          </span>
          <span className={styles.trafficBannerMuted}>
            {trafficSplitIsComplete(variations)
              ? '/ 100%'
              : `/ 100% · ${formatTrafficPercent(Math.abs(remaining))}% ${remaining > 0 ? 'left' : 'over'}`}
          </span>
        </span>
        <Button onClick={() => onChange(splitEvenly(variations))}>Split evenly</Button>
      </div>

      {gate.disabled ? (
        <p className={styles.error} role="alert">
          {gate.hint}
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
        const rowMax = variationTrafficHeadroom(variations, index);
        const rowName = row.name || row.role || (isControl ? 'Control' : `Variation ${row.letter}`);
        // Headroom is this row's own share plus whatever is unassigned, so zero
        // means the row holds nothing and there is nothing to give it. The
        // control is genuinely unusable then, and saying so is better than
        // leaving one that silently ignores every drag.
        const stuck = rowMax <= 0;
        return (
          <div key={row.id} className={styles.variationBlock}>
            <div className={styles.variationHead}>
              <span
                className={`${styles.variationBadgeLetter} ${
                  isControl ? styles.controlVariationMarker : ''
                }`}
                aria-label={
                  isControl ? 'Control – current price' : `Variation ${row.letter}`
                }
                title={isControl ? 'Keeps your current catalog price.' : undefined}
              >
                {isControl ? <IconControlBaseline size={14} /> : row.letter}
              </span>
              <span className={styles.variationTag}>
                {isControl ? 'Control – current price' : row.role}
              </span>
              {index > 1 ? (
                <span className={styles.variationRemove}>
                  <Button
                    variant="plain"
                    tone="critical"
                    onClick={() => onChange(variations.filter((_, i) => i !== index))}
                  >
                    Remove
                  </Button>
                </span>
              ) : null}
            </div>
            {isControl ? (
              <p className={styles.help} style={{ margin: '0 0 8px' }}>
                Keeps your current catalog price.
              </p>
            ) : (
              <TextField
                label="Variation name"
                labelHidden
                value={row.name}
                onChange={value => updateRow(index, { name: value })}
                autoComplete="off"
                placeholder={`Variation ${row.letter}`}
              />
            )}
            {!isControl ? (
              <TextField
                label="Variation description"
                labelHidden
                value={row.description}
                onChange={value => updateRow(index, { description: value })}
                autoComplete="off"
                placeholder="Describe what's different (optional)"
              />
            ) : null}
            <div className={styles.sliderRow}>
              <div className={styles.sliderCol}>
                <div className={styles.sliderMeta}>
                  <span className={styles.trafficLabel}>Traffic</span>
                  <PercentField
                    label={`${rowName} traffic percent`}
                    value={row.traffic}
                    max={rowMax}
                    disabled={stuck}
                    onCommit={next => onTraffic(index, next)}
                  />
                </div>
                <input
                  className={styles.slider}
                  type="range"
                  min={0}
                  // Every track runs the full 0–100 so that two rows side by
                  // side mean the same thing. Ending the track at the row's
                  // headroom instead made the default row a 0-to-0 slider: a
                  // control that could not be dragged anywhere at all.
                  max={100}
                  value={row.traffic}
                  disabled={stuck}
                  style={{
                    '--slider-fill': `${sliderFillPercent(row.traffic, 0, 100)}%`,
                    // Fades the part of the track the other rows have taken, so
                    // a thumb that stops early has a visible reason. A stuck row
                    // keeps its full rail: fading all of it, on a control that
                    // is already dimmed by :disabled, left nothing on screen but
                    // a bare thumb. The disabled state and the line underneath
                    // carry that meaning better than an erased track.
                    '--slider-cap': stuck ? '100%' : `${rowMax}%`,
                  }}
                  onChange={e => onTraffic(index, e.target.value)}
                  aria-label={`${rowName} traffic`}
                  aria-valuemax={rowMax}
                />
                {stuck ? (
                  <p className={styles.help}>
                    All traffic is assigned. Lower another variation to free some up.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}

      {variations.length < 4 ? (
        <Button icon={ButtonIconPlus} onClick={addVariation}>
          Add variation
        </Button>
      ) : null}

      <p className={styles.help}>
        If you pause a variation, its traffic will be automatically redistributed to the remaining
        variations.
      </p>
    </div>
  );
}
