import { useState } from 'react';
import {
  classicMetricOptionsFor,
  GOAL_METRIC_OPTIONS,
  CLASSIC_DEVICE_OPTIONS,
  CLASSIC_SEGMENT_OPTIONS,
  CLASSIC_SOURCE_OPTIONS,
  customGoalTriggerSummary,
  normalizeClassicAudienceTargeting,
  normalizeCustomGoals,
  normalizePrimaryMetric,
  normalizeSecondaryEvents,
} from '../targeting/smartPricingAudienceHelpers';
import ClassicCountryMultiSelect from './ClassicCountryMultiSelect';
import {
  activeCountryList,
  blockedCountryCodes,
  getCountryFieldHelp,
  resolveCountryLists,
} from './countrySelection';
import ClassicGoalPickerModal from './ClassicGoalPickerModal';
import LabelWithInfo from '../../Settings/primitives/LabelWithInfo';
import { IconCheck, IconShield } from './classicIcons';
import {
  ensureRevenueGuardrailRows,
  formatRevenueDropThreshold,
  MAX_REVENUE_DROP_PERCENT,
  MIN_REVENUE_DROP_PERCENT,
  DEFAULT_MAX_REVENUE_DROP_PERCENT,
  MIN_VISITORS_FOR_REVENUE_GUARDRAIL,
  parseRevenueDropThreshold,
} from './revenueGuardrail';
import { formatPracticalDurationRange } from './estimateSignificanceDuration';
import { MIN_ALLOCATION_PERCENT, sliderFillPercent } from './variationsStepHelpers';
import styles from './SmartPricingClassic.module.css';

export function createDefaultAudienceState() {
  return {
    segment: 'all_visitors',
    // Every matching visitor enters the experiment unless the merchant dials it
    // back. Holding half the traffic out by default doubled how long every test
    // took to reach significance, and bought nothing for it: the visitors kept
    // out are not measured, so they are not a safety margin, just a slower
    // answer. The guardrails are what limit the downside.
    trafficAllocation: 100,
    primaryMetric: 'revenue_per_visitor',
    primaryCustomGoal: null,
    secondaryMetrics: [],
    customGoals: [],
    guardrails: ensureRevenueGuardrailRows([]),
    minSampleSize: '5000',
    ...normalizeClassicAudienceTargeting({}),
  };
}

function toggleInList(list, value) {
  return list.includes(value) ? list.filter(v => v !== value) : [...list, value];
}

function IncludeExcludeToggle({ value, onChange, ariaLabel, disabled = false }) {
  const mode = value === 'exclude' ? 'exclude' : 'include';
  return (
    <div
      className={`${styles.segment} ${styles.segmentInline} ${styles.includeExcludeToggle}`}
      role="group"
      aria-label={ariaLabel}
    >
      <button
        type="button"
        className={`${styles.segmentBtn} ${mode === 'include' ? styles.segmentBtnActive : ''}`}
        aria-pressed={mode === 'include'}
        disabled={disabled}
        onClick={() => onChange('include')}
      >
        Include
      </button>
      <button
        type="button"
        className={`${styles.segmentBtn} ${mode === 'exclude' ? styles.segmentBtnActive : ''}`}
        aria-pressed={mode === 'exclude'}
        disabled={disabled}
        onClick={() => onChange('exclude')}
      >
        Exclude
      </button>
    </div>
  );
}

/**
 * `role` switches the semantics without touching the look. Device type,
 * traffic source and metrics are independent toggles and stay buttons with
 * aria-pressed; audience segment is one-of-three, so it renders as a radio and
 * is announced as a choice within its group rather than three separate
 * switches that happen to be mutually exclusive.
 */
function SelectablePill({
  label,
  active,
  disabled = false,
  onClick,
  className = '',
  role = 'button',
  title,
}) {
  const isRadio = role === 'radio';
  return (
    <button
      type="button"
      className={[styles.pill, active && styles.pillActive, className].filter(Boolean).join(' ')}
      disabled={disabled}
      onClick={onClick}
      title={title}
      {...(isRadio ? { role: 'radio', 'aria-checked': active } : { 'aria-pressed': active })}
    >
      {active ? (
        <span className={`${styles.checkInline} ${styles.checkPlain}`} aria-hidden>
          <IconCheck size={13} />
        </span>
      ) : null}
      {label}
    </button>
  );
}

export default function AudienceSuccessStepPanel({
  value,
  onChange,
  shopDomain = '',
  significanceEstimate = null,
  disabled = false,
  showTrafficAllocation = true,
}) {
  const [goalPickerOpen, setGoalPickerOpen] = useState(false);
  const [goalPickerTarget, setGoalPickerTarget] = useState('secondary');
  const state = value || createDefaultAudienceState();
  const secondaryMetrics = normalizeSecondaryEvents(state.secondaryMetrics || []);
  const customGoals = normalizeCustomGoals(state.customGoals || []);
  const primaryCustomGoal = state.primaryCustomGoal
    ? normalizeCustomGoals([state.primaryCustomGoal])[0] || null
    : null;
  const guardrails = ensureRevenueGuardrailRows(state.guardrails);
  const revenueGuardrail = guardrails[0];
  const guardrailOn = revenueGuardrail.on !== false;
  const setGuardrailOn = on =>
    patch({
      // The threshold is kept while it is off, so switching back on restores
      // the number rather than resetting to the default.
      guardrails: ensureRevenueGuardrailRows([{ ...revenueGuardrail, on: on !== false }]),
    });
  const effectiveRevenueDropMax = MAX_REVENUE_DROP_PERCENT;
  const storedRevenueDrop = parseRevenueDropThreshold(revenueGuardrail?.threshold);
  const [revenueDropDraft, setRevenueDropDraft] = useState(null);
  const displayedRevenueDrop =
    revenueDropDraft ?? String(Math.min(storedRevenueDrop, effectiveRevenueDropMax));
  const commitRevenueDrop = raw => {
    const digits = String(raw ?? '').replace(/\D/g, '');
    const normalized = Math.min(
      effectiveRevenueDropMax,
      parseRevenueDropThreshold(digits)
    );
    setRevenueDropDraft(null);
    const threshold = formatRevenueDropThreshold(normalized);
    patch({ guardrails: ensureRevenueGuardrailRows([{ ...revenueGuardrail, threshold }]) });
  };
  const targeting = normalizeClassicAudienceTargeting(state);
  const { devices, sources, countryMode } = targeting;
  const countryLists = resolveCountryLists({ ...state, ...targeting });
  const countries = activeCountryList(countryLists);
  const otherTabCountries = blockedCountryCodes(countryLists);
  const trafficAllocation = Number(state.trafficAllocation) || 50;
  const activeSegment = CLASSIC_SEGMENT_OPTIONS.some(o => o.value === state.segment)
    ? state.segment
    : 'all_visitors';
  const planningWindow = significanceEstimate?.practicalDurationRange || '';
  const minimumSampleWindow = formatPracticalDurationRange(
    significanceEstimate?.earliestDays,
    significanceEstimate?.trafficEvidence
  );
  const durationNotFeasible = significanceEstimate?.durationFeasibility === 'not_feasible';
  const primaryMetric = primaryCustomGoal?.event_name
    ? String(primaryCustomGoal.event_name).trim().toLowerCase()
    : normalizePrimaryMetric(state.primaryMetric, 'revenue_per_visitor');
  const primaryMetricKey = primaryMetric;
  // Profit per visitor is no longer offered, but an experiment already running
  // on it keeps its pill so editing the audience does not re-goal the test.
  const legacyPrimaryOptions = classicMetricOptionsFor([primaryMetric]).filter(
    opt => !GOAL_METRIC_OPTIONS.some(goal => goal.value === opt.value)
  );
  const primaryMetricOptions = [
    ...GOAL_METRIC_OPTIONS.map(opt =>
      opt.value === 'revenue_per_visitor'
        ? { ...opt, label: 'Revenue per visitor (recommended)' }
        : opt
    ),
    ...legacyPrimaryOptions,
  ];

  const patch = partial => {
    if (disabled) return;
    onChange({ ...state, ...partial });
  };

  const selectPrimaryMetric = value => {
    const next = normalizePrimaryMetric(value, 'revenue_per_visitor');
    patch({
      primaryMetric: next,
      primaryCustomGoal: null,
      secondaryMetrics: secondaryMetrics.filter(v => v !== next),
    });
  };

  const selectPrimaryCustomGoal = goal => {
    const normalized = normalizeCustomGoals([goal])[0];
    if (!normalized?.event_name) return;
    const nextKey = String(normalized.event_name).trim().toLowerCase();
    patch({
      primaryCustomGoal: normalized,
      primaryMetric: nextKey,
      secondaryMetrics: secondaryMetrics.filter(v => v !== nextKey),
      customGoals: customGoals.filter(g => g.event_name !== nextKey),
    });
  };

  const toggleSecondary = value => {
    if (value === primaryMetricKey) return;
    patch({
      secondaryMetrics: secondaryMetrics.includes(value)
        ? secondaryMetrics.filter(v => v !== value)
        : [...secondaryMetrics, value],
    });
  };

  const removeCustomGoal = eventName => {
    patch({
      customGoals: customGoals.filter(goal => goal.event_name !== eventName),
    });
  };

  return (
    <div>
      <div className={styles.stepSection}>
      <div className={styles.stepSectionTitle}>Audience</div>
      <p className={styles.help} style={{ marginTop: 0 }}>
        Only visitors who match these filters can enter the test.
      </p>

      {/* The create wizard asks for this on the Variations step, next to the
          split it feeds, and passes false here. Editing a live experiment still
          reaches it through this panel, which is the only place that offers
          it. */}
      {showTrafficAllocation ? (
      <div className={styles.field}>
        <label className={styles.label} htmlFor="classic-audience-traffic">
          Traffic allocation
        </label>
        <input
          className={styles.slider}
          id="classic-audience-traffic"
          type="range"
          min={MIN_ALLOCATION_PERCENT}
          max={100}
          value={trafficAllocation}
          // The fill is a fraction of the track, not of 100. This track starts
          // at 5, so painting the raw percent put the fill ahead of the thumb
          // by up to a tenth of the width -- a stub of near-black sticking out
          // past the handle at every value below the top.
          style={{
            '--slider-fill': `${sliderFillPercent(trafficAllocation, MIN_ALLOCATION_PERCENT, 100)}%`,
          }}
          onChange={e => patch({ trafficAllocation: Number(e.target.value) })}
          aria-label="Traffic allocation"
          disabled={disabled}
        />
        <p className={styles.help}>
          {trafficAllocation}% of eligible visitors will enter this test.
          {durationNotFeasible
            ? ' Current traffic does not support a practical 2–8 week test; Review shows the traffic needed.'
            : planningWindow
              ? ` Estimated collection window ${planningWindow}.`
              : significanceEstimate && !significanceEstimate.days
                ? ' Timeline needs traffic data for every selected product and a positive allocation for every variation.'
                : ''}
          {significanceEstimate?.earliestDays &&
          significanceEstimate.recommendedSampleSize &&
          significanceEstimate.earliestDays !== significanceEstimate.days &&
          minimumSampleWindow
            ? ` Minimum visitors per variation has an estimated ${minimumSampleWindow} collection window.`
            : ''}
        </p>
      </div>
      ) : null}

      {/* Device, source, segment and countries used to sit behind an "Advanced
          options" disclosure below the metrics, which put the whole definition
          of who is in the test underneath the numbers measuring them --
          and behind a click. They are the audience, so they are the audience
          section. */}
      <div className={styles.modeRow}>
        <div className={styles.audiencePanel}>
          <div className={styles.sectionLabel}>Device type</div>
          <div className={styles.pillRow}>
            {CLASSIC_DEVICE_OPTIONS.map(device => {
              const active = devices.includes(device);
              return (
                <SelectablePill
                  key={device}
                  label={device}
                  active={active}
                  disabled={disabled}
                  onClick={() =>
                    patch({ devices: toggleInList(devices, device), deviceMode: 'include' })
                  }
                />
              );
            })}
          </div>
          <p className={styles.help}>
            Which devices are eligible for the test. Tablet maps to mobile in launch
            targeting.
          </p>
        </div>

        <div className={styles.audiencePanel}>
          <div className={styles.sectionLabel}>Traffic source</div>
          <div className={styles.pillRow}>
            {CLASSIC_SOURCE_OPTIONS.map(source => {
              const active = sources.includes(source);
              return (
                <SelectablePill
                  key={source}
                  label={source}
                  active={active}
                  disabled={disabled}
                  onClick={() =>
                    patch({ sources: toggleInList(sources, source), sourceMode: 'include' })
                  }
                />
              );
            })}
          </div>
          <p className={styles.help}>Only visitors from these sources will enter.</p>
        </div>
      </div>

      {/* A visitor is new or returning or neither, never two at once, so this
          reads as a radio group rather than the independent toggles above it. */}
      <div className={`${styles.audiencePanel} ${styles.field}`}>
        <div className={styles.sectionLabel} id="classic-audience-segment">
          Audience segment
        </div>
        <div
          className={styles.pillRow}
          role="radiogroup"
          aria-labelledby="classic-audience-segment"
        >
          {CLASSIC_SEGMENT_OPTIONS.map(option => (
            <SelectablePill
              key={option.value}
              role="radio"
              label={option.label}
              active={activeSegment === option.value}
              disabled={disabled}
              onClick={() => patch({ segment: option.value })}
            />
          ))}
        </div>
        <p className={styles.help}>
          {CLASSIC_SEGMENT_OPTIONS.find(option => option.value === activeSegment)?.help ||
            'Which visitors count toward the test.'}
        </p>
      </div>

      <div className={`${styles.audiencePanel} ${styles.field}`}>
        <div className={styles.audiencePanelHead}>
          <div className={styles.sectionLabel}>Countries</div>
          <IncludeExcludeToggle
            value={countryMode}
            disabled={disabled}
            onChange={next => {
              const lists = resolveCountryLists({ ...state, ...targeting, countryMode: next });
              patch({
                countryMode: next,
                countries: next === 'exclude' ? lists.excludeCountries : lists.includeCountries,
                includeCountries: lists.includeCountries,
                excludeCountries: lists.excludeCountries,
              });
            }}
            ariaLabel="Country include or exclude"
          />
        </div>
        <ClassicCountryMultiSelect
          key={countryMode}
          value={countries}
          mode={countryMode}
          blockedCodes={otherTabCountries}
          disabled={disabled}
          onChange={next => {
            if (countryMode === 'exclude') {
              patch({
                countryMode: 'exclude',
                excludeCountries: next,
                includeCountries: countryLists.includeCountries,
                countries: next,
              });
              return;
            }
            patch({
              countryMode: 'include',
              includeCountries: next,
              excludeCountries: countryLists.excludeCountries,
              countries: next,
            });
          }}
        />
        <p className={styles.help}>
          {getCountryFieldHelp(countries, countryMode, otherTabCountries)}
        </p>
      </div>
      </div>

      <div className={styles.stepSection}>
      <div className={styles.stepSectionTitle}>Success metrics</div>

      <div className={styles.field} id="classic-metrics-editor">
        <div className={styles.label}>
          Primary success metric<span className={styles.required}>*</span>
        </div>
        <div className={`${styles.pillRow} ${styles.metricPillRow}`}>
          {primaryMetricOptions.map(metric => {
            const active = !primaryCustomGoal && primaryMetric === metric.value;
            return (
              <SelectablePill
                key={`primary-${metric.value}`}
                label={metric.label}
                active={active}
                disabled={disabled}
                onClick={() => selectPrimaryMetric(metric.value)}
              />
            );
          })}
          {primaryCustomGoal ? (
            <SelectablePill
              key={primaryCustomGoal.event_name}
              label={primaryCustomGoal.label}
              active
              disabled={disabled}
              onClick={() =>
                patch({ primaryCustomGoal: null, primaryMetric: 'revenue_per_visitor' })
              }
              title={`${customGoalTriggerSummary(primaryCustomGoal)} · click to clear custom primary`}
            />
          ) : null}
          <button
            type="button"
            className={`${styles.pill} ${styles.customGoalPill}`}
            disabled={disabled}
            onClick={() => {
              if (disabled) return;
              setGoalPickerTarget('primary');
              setGoalPickerOpen(true);
            }}
          >
            + Add goal
          </button>
        </div>
        <p className={styles.help}>
          Choose one metric to optimise for this test. You can also add a custom goal; it cannot
          also be a secondary.
        </p>
      </div>

      <div className={styles.field}>
        <div className={styles.fieldLabelStack}>
          <span className={styles.label}>Secondary metrics</span>
          <span className={styles.fieldLabelHint}>(optional)</span>
        </div>
        <div className={`${styles.pillRow} ${styles.metricPillRow}`}>
          {GOAL_METRIC_OPTIONS.map(metric => {
            const active = secondaryMetrics.includes(metric.value);
            const locked = metric.value === primaryMetricKey;
            return (
              <SelectablePill
                key={`secondary-${metric.value}`}
                label={metric.label}
                active={active}
                disabled={disabled || locked}
                onClick={() => toggleSecondary(metric.value)}
              />
            );
          })}
          {customGoals.map(goal => (
            <SelectablePill
              key={goal.event_name}
              label={goal.label}
              active
              disabled={disabled}
              onClick={() => removeCustomGoal(goal.event_name)}
              title={`${customGoalTriggerSummary(goal)} · click to remove`}
            />
          ))}
          <button
            type="button"
            className={`${styles.pill} ${styles.customGoalPill}`}
            disabled={disabled}
            onClick={() => {
              if (disabled) return;
              setGoalPickerTarget('secondary');
              setGoalPickerOpen(true);
            }}
          >
            + Add goal
          </button>
        </div>
        <p className={styles.help}>
          Optional. Quick picks watch common side effects. Use + Add goal to select from your Goals
          library or create a new storefront trigger.
        </p>
      </div>

      {goalPickerOpen && !disabled ? (
        <ClassicGoalPickerModal
          shopDomain={shopDomain}
          selectedGoals={
            goalPickerTarget === 'primary'
              ? primaryCustomGoal
                ? [primaryCustomGoal]
                : []
              : customGoals
          }
          selectionMode={goalPickerTarget === 'primary' ? 'single' : 'multiple'}
          title={goalPickerTarget === 'primary' ? 'Choose primary goal' : 'Add goals'}
          description={
            goalPickerTarget === 'primary'
              ? 'Pick a custom goal from your Goals library or create a new storefront event to optimize.'
              : 'Pick from your Goals library or create a new storefront event. Monitoring only — these do not pick the winner.'
          }
          createMetricRole={goalPickerTarget === 'primary' ? 'primary' : 'secondary'}
          onChange={next => {
            if (goalPickerTarget === 'primary') {
              const goal = normalizeCustomGoals(next)[0];
              if (goal) selectPrimaryCustomGoal(goal);
              else patch({ primaryCustomGoal: null, primaryMetric: 'revenue_per_visitor' });
              setGoalPickerOpen(false);
              return;
            }
            patch({ customGoals: normalizeCustomGoals(next) });
          }}
          onClose={() => setGoalPickerOpen(false)}
        />
      ) : null}
      </div>

      {/* Last on the step: a safety net for the experiment above it, which only
          makes sense once the audience and the metrics are settled. */}
      <div className={styles.stepSection}>
      <LabelWithInfo
        id="classic-revenue-guardrail"
        titleClassName={styles.stepSectionTitle}
        hash="guardrail-metrics"
        label="Revenue guardrail"
      >
        Revenue guardrail
      </LabelWithInfo>
      <div className={styles.guardrailCard}>
        <div className={styles.guardrailCardHead}>
          <span className={styles.guardrailCardTitle}>
            <IconShield size={14} />
            {revenueGuardrail.label}
          </span>
          {/* This was a static "Always on" badge, which told the merchant the
              answer instead of asking. The switch is real: turning it off
              stores enabled:false on the goal, which is what the evaluator
              reads before it pauses anything. */}
          <button
            type="button"
            role="switch"
            aria-checked={guardrailOn}
            aria-label="Revenue guardrail"
            className={`${styles.guardrailSwitch} ${
              guardrailOn ? styles.guardrailSwitchOn : ''
            }`}
            disabled={disabled}
            onClick={() => setGuardrailOn(!guardrailOn)}
          >
            <span className={styles.guardrailSwitchKnob} aria-hidden />
          </button>
        </div>
        {guardrailOn ? (
          <>
            <div className={styles.guardrailRule}>
              <span>
                Pause this test if revenue per visitor for any variation drops more than
              </span>
              <span className={styles.guardrailInputWrap}>
                <input
                  className={styles.guardrailInput}
                  type="number"
                  min={MIN_REVENUE_DROP_PERCENT}
                  max={effectiveRevenueDropMax}
                  step={1}
                  value={displayedRevenueDrop}
                  disabled={disabled}
                  aria-label="Maximum revenue per visitor drop, percent"
                  aria-describedby="revenue-guardrail-help"
                  onChange={e => setRevenueDropDraft(String(e.target.value).replace(/\D/g, ''))}
                  onBlur={e => commitRevenueDrop(e.target.value)}
                />
                <span className={styles.guardrailInputSuffix} aria-hidden="true">
                  %
                </span>
              </span>
              <span>
                below control, once each variation has about{' '}
                {MIN_VISITORS_FOR_REVENUE_GUARDRAIL} visitors.
              </span>
            </div>
            <p className={styles.guardrailHint} id="revenue-guardrail-help">
              This is a safety net. It does not declare a winner; it only prevents a bad
              variation from running for too long. This test owns the threshold (
              {MIN_REVENUE_DROP_PERCENT}%–{effectiveRevenueDropMax}%; default{' '}
              {DEFAULT_MAX_REVENUE_DROP_PERCENT}%). Max price change and margin floors are checked
              on Products & prices, not while the test runs.
            </p>
          </>
        ) : (
          <p className={styles.guardrailHint}>
            Off. This test will keep running even if a variation earns less per visitor than
            control, until you stop it yourself.
          </p>
        )}
      </div>
      </div>
    </div>
  );
}
