import React, { useState } from 'react';
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
import { getCountryFieldHelp } from './countrySelection';
import ClassicGoalPickerModal from './ClassicGoalPickerModal';
import { IconCheck, IconChevron, IconShield, IconWand } from './classicIcons';
import { createRevenueGuardrailRow, ensureRevenueGuardrailRows } from './revenueGuardrail';
import styles from './SmartPricingClassic.module.css';

const DEFAULT_GUARDRAILS = [
  createRevenueGuardrailRow(),
  {
    id: 'page_load',
    label: 'Page load time',
    hint: 'Speed of the page load',
    rule: 'Must not increase',
    threshold: '+5%',
    on: true,
  },
  {
    id: 'js_error',
    label: 'JS error rate',
    hint: 'Client-side errors per session',
    rule: 'Must not increase',
    threshold: '+10%',
    on: true,
  },
  {
    id: 'bounce',
    label: 'Bounce rate',
    hint: 'Single-page sessions',
    rule: 'Must not increase',
    threshold: '+3%',
    on: false,
  },
  {
    id: 'refund',
    label: 'Refund rate',
    hint: 'Refunds within 30 days',
    rule: 'Must not increase',
    threshold: '+2%',
    on: true,
  },
  {
    id: 'support',
    label: 'Support tickets',
    hint: 'New tickets per 1k sessions',
    rule: 'Must not increase',
    threshold: '+15%',
    on: false,
  },
  {
    id: 'retention',
    label: '7-day retention',
    hint: 'Returning users at day 7',
    rule: 'Must not drop',
    threshold: '-3%',
    on: false,
  },
];

export function createDefaultAudienceState() {
  return {
    segment: 'all_visitors',
    trafficAllocation: 50,
    primaryMetric: 'revenue_per_visitor',
    primaryCustomGoal: null,
    secondaryMetrics: [],
    customGoals: [],
    guardrails: ensureRevenueGuardrailRows(DEFAULT_GUARDRAILS),
    minSampleSize: '5000',
    ...normalizeClassicAudienceTargeting({}),
  };
}

function toggleInList(list, value) {
  return list.includes(value) ? list.filter(v => v !== value) : [...list, value];
}

function IncludeExcludeToggle({ value, onChange, ariaLabel }) {
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
        onClick={() => onChange('include')}
      >
        Include
      </button>
      <button
        type="button"
        className={`${styles.segmentBtn} ${mode === 'exclude' ? styles.segmentBtnActive : ''}`}
        aria-pressed={mode === 'exclude'}
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
  const guardrails = ensureRevenueGuardrailRows(state.guardrails || DEFAULT_GUARDRAILS);
  const { devices, sources, countries, countryMode } = normalizeClassicAudienceTargeting(state);
  const trafficAllocation = Number(state.trafficAllocation) || 50;
  const primaryMetric = primaryCustomGoal?.event_name
    ? String(primaryCustomGoal.event_name).trim().toLowerCase()
    : normalizePrimaryMetric(state.primaryMetric, 'revenue_per_visitor');
  const primaryMetricKey = primaryMetric;

  const patch = partial => onChange({ ...state, ...partial });

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
          <div className={styles.labelRow}>
            <div className={styles.aiSuggestTitle}>
              <IconWand size={16} />
              AI audience targeting
            </div>
            <Button variant="plain" onClick={onSuggestAi} disabled={suggestBusy} loading={suggestBusy}>
              Suggest with AI
            </Button>
          </div>
          <p className={styles.aiSuggestBody}>
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
          onChange={value => patch({ segment: value })}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Traffic allocation</label>
        <input
          className={styles.slider}
          type="range"
          min={5}
          max={100}
          value={trafficAllocation}
          style={{ '--slider-fill': `${trafficAllocation}%` }}
          onChange={e => patch({ trafficAllocation: Number(e.target.value) })}
          aria-label="Traffic allocation"
        />
        <p className={styles.help}>
          {trafficAllocation}% of matching visitors will enter the experiment.
        </p>
      </div>

      <div className={styles.field}>
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
                onClick={() => selectPrimaryMetric(metric.value)}
              />
            );
          })}
          {primaryCustomGoal ? (
            <SelectablePill
              key={primaryCustomGoal.event_name}
              label={primaryCustomGoal.label}
              active
              onClick={() =>
                patch({ primaryCustomGoal: null, primaryMetric: 'revenue_per_visitor' })
              }
              title={`${customGoalTriggerSummary(primaryCustomGoal)} · click to clear custom primary`}
            />
          ) : null}
          <button
            type="button"
            className={`${styles.pill} ${styles.customGoalPill}`}
            onClick={() => {
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
            const disabled = metric.value === primaryMetricKey;
            return (
              <SelectablePill
                key={`secondary-${metric.value}`}
                label={metric.label}
                active={active}
                disabled={disabled}
                onClick={() => toggleSecondary(metric.value)}
              />
            );
          })}
          {customGoals.map(goal => (
            <SelectablePill
              key={goal.event_name}
              label={goal.label}
              active
              onClick={() => removeCustomGoal(goal.event_name)}
              title={`${customGoalTriggerSummary(goal)} · click to remove`}
            />
          ))}
          <button
            type="button"
            className={`${styles.pill} ${styles.customGoalPill}`}
            onClick={() => {
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

      {goalPickerOpen ? (
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

      <div className={styles.sectionLabel}>Guardrail metrics</div>
      <table className={styles.guardTable}>
        <thead>
          <tr>
            <th>
              <span className={styles.guardMetricHead}>
                <IconShield size={14} />
                Metric
              </span>
            </th>
            <th>Rule</th>
            <th>Threshold</th>
            <th>On</th>
          </tr>
        </thead>
        <tbody>
          {guardrails.map((row, index) => (
            <tr key={row.id}>
              <td>
                <strong>{row.label}</strong>
                <div className={styles.productSub}>{row.hint}</div>
              </td>
              <td>{row.rule}</td>
              <td className={styles.guardThresholdCell}>
                <input
                  className={`${styles.thresholdInput} ${row.on ? '' : styles.thresholdInputDim}`}
                  value={row.threshold}
                  onChange={e => {
                    const next = guardrails.map((g, i) =>
                      i === index ? { ...g, threshold: e.target.value } : g
                    );
                    patch({ guardrails: next });
                  }}
                />
              </td>
              <td className={styles.guardOnCell}>
                <button
                  type="button"
                  className={`${styles.toggle} ${row.on ? styles.toggleOn : ''}`}
                  aria-pressed={row.on}
                  disabled={row.locked || row.id === 'revenue'}
                  onClick={() => {
                    if (row.locked || row.id === 'revenue') return;
                    const next = guardrails.map((g, i) => (i === index ? { ...g, on: !g.on } : g));
                    patch({ guardrails: next });
                  }}
                >
                  <span className={styles.toggleKnob} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.help}>
        Revenue per visitor is always on and pauses the test if any variation drops past the
        limit versus control. Other rows alert when those metrics are available.
      </p>

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
            <TextField
              id="classic-aud-min-sample"
              label="Minimum sample size per variation"
              value={String(state.minSampleSize ?? '5000')}
              onChange={value => patch({ minSampleSize: value })}
              autoComplete="off"
              helpText="We'll wait for at least this many visitors per variation before calling results."
            />
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
                onChange={next => patch({ countryMode: next })}
                ariaLabel="Country include or exclude"
              />
            </div>
            <ClassicCountryMultiSelect
              value={countries}
              mode={countryMode}
              onChange={next => patch({ countries: next })}
            />
            <p className={styles.help}>{getCountryFieldHelp(countries, countryMode)}</p>
          </div>
        </div>
      </details>
    </div>
  );
}
