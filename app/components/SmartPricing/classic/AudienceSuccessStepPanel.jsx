import { useState } from 'react';
import { Button, Select, TextField } from '@shopify/polaris';
import {
  ALL_CLASSIC_METRIC_OPTIONS,
  CLASSIC_DEVICE_OPTIONS,
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
import SettingsInfoLink from '../../Settings/SettingsInfoLink';
import { IconCheck, IconChevron, IconShield, IconWand } from './classicIcons';
import {
  clampMaxRevenueDropPercent,
  DEFAULT_MAX_REVENUE_DROP_PERCENT,
  ensureRevenueGuardrailRows,
  formatRevenueDropThreshold,
  MAX_REVENUE_DROP_PERCENT,
  MIN_REVENUE_DROP_PERCENT,
  parseRevenueDropThreshold,
} from './revenueGuardrail';
import {
  formatPracticalDurationRange,
  formatVisitorCount,
} from './estimateSignificanceDuration';
import styles from './SmartPricingClassic.module.css';

export function createDefaultAudienceState() {
  return {
    segment: 'all_visitors',
    trafficAllocation: 50,
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

function SelectablePill({ label, active, disabled = false, onClick, className = '' }) {
  return (
    <button
      type="button"
      className={[styles.pill, active && styles.pillActive, className].filter(Boolean).join(' ')}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
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
  onSuggestAi,
  suggestBusy = false,
  shopDomain = '',
  significanceEstimate = null,
  shopMaxRevenueDropPercent = DEFAULT_MAX_REVENUE_DROP_PERCENT,
  disabled = false,
}) {
  const [advancedOpen, setAdvancedOpen] = useState(true);
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
  const effectiveRevenueDropMax = clampMaxRevenueDropPercent(
    shopMaxRevenueDropPercent,
    MAX_REVENUE_DROP_PERCENT
  );
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
      {typeof onSuggestAi === 'function' ? (
        <div className={styles.aiSuggestBanner}>
          <div className={styles.aiSuggestTitle}>
            <span className={styles.aiSuggestTitleLead}>
              <IconWand size={16} />
              AI audience targeting
            </span>
            <Button
              variant="plain"
              onClick={onSuggestAi}
              disabled={disabled || suggestBusy}
              loading={suggestBusy}
            >
              Suggest with AI
            </Button>
          </div>
          <p className={styles.aiSuggestBody} aria-live="polite">
            {state.aiRationale
              ? state.aiRationale
              : 'Recommend segment, traffic split, success metric, and targeting from your catalog and guardrails.'}
          </p>
        </div>
      ) : null}

      <div className={styles.field}>
        <Select
          id="classic-audience-segment"
          label="Audience segment"
          options={[
            { label: 'All visitors', value: 'all_visitors' },
            { label: 'New visitors', value: 'new_visitors' },
            { label: 'Returning visitors', value: 'returning' },
          ]}
          value={state.segment || 'all_visitors'}
          disabled={disabled}
          onChange={value => patch({ segment: value })}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="classic-audience-traffic">
          Traffic allocation
        </label>
        <input
          className={styles.slider}
          id="classic-audience-traffic"
          type="range"
          min={5}
          max={100}
          value={trafficAllocation}
          style={{ '--slider-fill': `${trafficAllocation}%` }}
          onChange={e => patch({ trafficAllocation: Number(e.target.value) })}
          aria-label="Traffic allocation"
          disabled={disabled}
        />
        <p className={styles.help}>
          {trafficAllocation}% of matching visitors will enter the experiment.
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
            ? ` Your minimum sample has an estimated ${minimumSampleWindow} collection window.`
            : ''}
        </p>
      </div>

      <div className={styles.field} id="classic-metrics-editor">
        <div className={styles.label}>
          Primary success metric<span className={styles.required}>*</span>
        </div>
        <div className={`${styles.pillRow} ${styles.metricPillRow}`}>
          {ALL_CLASSIC_METRIC_OPTIONS.map(metric => {
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
          Choose one metric to optimize, including profit or a custom goal. It cannot also be a
          secondary.
        </p>
      </div>

      <div className={styles.field}>
        <div className={styles.label}>Secondary metrics</div>
        <div className={`${styles.pillRow} ${styles.metricPillRow}`}>
          {ALL_CLASSIC_METRIC_OPTIONS.map(metric => {
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

      <div className={styles.labelRow} id="classic-revenue-guardrail">
        <div className={styles.sectionLabel}>Revenue guardrail</div>
        <SettingsInfoLink hash="guardrail-metrics" label="Revenue guardrail" />
      </div>
      <div className={styles.guardrailCard}>
        <div className={styles.guardrailCardHead}>
          <span className={styles.guardrailCardTitle}>
            <IconShield size={14} />
            {revenueGuardrail.label}
          </span>
          <span className={`${styles.badge} ${styles.badgeAccent}`}>Always on</span>
        </div>
        <div className={styles.guardrailRule}>
          <span>Pause the test if any variation drops more than</span>
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
          <span>versus control.</span>
        </div>
        <p className={styles.guardrailHint} id="revenue-guardrail-help">
          Operational safety pause based on the observed revenue-per-visitor point estimate; it is
          not winner evidence. Allowed range {MIN_REVENUE_DROP_PERCENT}–
          {effectiveRevenueDropMax}% (your shop cap).
        </p>
      </div>

      <details
        className={`${styles.advanced} ${styles.audienceAdvanced}`}
        open={advancedOpen}
        onToggle={e => setAdvancedOpen(e.currentTarget.open)}
      >
        <summary className={styles.advancedSummary}>
          Advanced options
          <IconChevron size={16} up={advancedOpen} />
        </summary>
        <div className={styles.advancedBody}>
          <div className={`${styles.field} ${styles.audienceMinSample}`}>
            <div className={styles.labelRow}>
              <span className={styles.label}>Minimum sample size per variation</span>
              <SettingsInfoLink hash="min-sample" label="Minimum sample" />
            </div>
            <TextField
              id="classic-aud-min-sample"
              label="Minimum sample size per variation"
              labelHidden
              type="number"
              min={1}
              value={String(state.minSampleSize ?? '5000')}
              onChange={value => patch({ minSampleSize: value })}
              autoComplete="off"
              disabled={disabled}
            />
            {significanceEstimate?.recommendedSampleSize &&
            String(state.minSampleSize) !== String(significanceEstimate.recommendedSampleSize) ? (
              <div className={styles.labelRow} style={{ marginTop: 6 }}>
                <Button
                  variant="plain"
                  disabled={disabled}
                  onClick={() =>
                    patch({ minSampleSize: String(significanceEstimate.recommendedSampleSize) })
                  }
                >
                  Use planning sample ({formatVisitorCount(significanceEstimate.recommendedSampleSize)})
                </Button>
              </div>
            ) : null}
          </div>

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
                Which devices are eligible for the experiment. Tablet maps to mobile in launch
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
                    countries:
                      next === 'exclude' ? lists.excludeCountries : lists.includeCountries,
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
      </details>
    </div>
  );
}
