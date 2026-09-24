import { useState } from 'react';
import { Button } from '@shopify/polaris';
import SettingsInfoLink from '../../../Settings/SettingsInfoLink';
import { IconChevron, IconShield } from '../classicIcons';
import {
  formatAudienceFactValue,
  listSecondaryMetricsForDisplay,
  secondaryMetricDisplayLabel,
} from '../classicExperimentDetailsHelpers';
import { formatSplitCountryAudienceLabel, resolveCountryLists } from '../countrySelection';
import { formatRunningTestStatusLabel } from '../classicOverviewLayout';
import {
  ensureRevenueGuardrailRows,
  MIN_VISITORS_FOR_REVENUE_GUARDRAIL,
} from '../revenueGuardrail';
import DetailFactCard from './DetailFactCard';
import styles from '../SmartPricingClassic.module.css';

/**
 * A label and what it is set to, side by side.
 *
 * The value sits in a column next to its label rather than against the far edge
 * of the card, so a stack of these reads as one list instead of two.
 */
function SettingRow({
  label,
  value,
  note = null,
  infoHash = null,
  infoLabel = null,
  multilineValue = false,
}) {
  return (
    <div
      className={`${styles.settingsRow} ${multilineValue ? styles.settingsRowMultiline : ''}`.trim()}
    >
      <span className={styles.settingsRowLabel}>
        {label}
        {infoHash ? <SettingsInfoLink hash={infoHash} label={infoLabel || label} /> : null}
      </span>
      <span className={styles.settingsRowValue}>{value}</span>
      {note ? <p className={`${styles.help} ${styles.settingsRowNote}`}>{note}</p> : null}
    </div>
  );
}

function titleCase(value) {
  const text = String(value || '').trim();
  if (!text) return '—';
  return text.replace(/[_-]+/g, ' ').replace(/^\w/, character => character.toUpperCase());
}

function percentOrDash(value) {
  return value === null || value === undefined || value === '' ? '—' : `${value}%`;
}

/** Whether a section has anything worth a heading. */
function hasAny(...values) {
  return values.some(value => value !== null && value !== undefined && value !== '');
}

function mapSettingsStatusLabel(testStatus) {
  const key = String(testStatus || '')
    .trim()
    .toLowerCase();
  if (key === 'running') return 'Active';
  if (key === 'paused' || key === 'stopped') return key === 'paused' ? 'Paused' : 'Stopped';
  if (key === 'draft' || key === 'queued') return titleCase(key);
  return formatRunningTestStatusLabel({
    isRunning: key === 'running',
    isPaused: key === 'paused',
    isEnded: ['completed', 'applied', 'winner_ready', 'archived', 'finished'].includes(key),
    isDraft: key === 'draft',
  });
}

export default function ClassicSettingsTab({
  settings,
  audience = null,
  metrics = null,
  onEditMetrics = null,
  onEditAudience = null,
  onChangeMetric = null,
  onAdjustTraffic = null,
  onViewHistory = null,
  onViewTestsList = null,
}) {
  const [technicalOpen, setTechnicalOpen] = useState(false);

  if (!settings) {
    return (
      <div className={styles.statCard}>
        <h3 className={styles.panelTitle}>Settings</h3>
        <p className={styles.help}>Launch settings will appear after the plan is saved.</p>
      </div>
    );
  }

  const guardrails = ensureRevenueGuardrailRows(
    metrics?.guardrails,
    metrics?.max_revenue_drop_percent
  );
  const isOffer = settings.experimentType === 'offer_test' || settings.experimentType === 'offer';
  const sourceFallback =
    audience?.trafficSource && String(audience.trafficSource).toLowerCase() !== 'all'
      ? formatAudienceFactValue([audience.trafficSource], 'All sources')
      : 'All sources';
  const minSample = audience?.minSampleSize || metrics?.minSampleSize || null;
  const cogs = metrics?.cogs || null;
  const shopNotes = Array.isArray(settings.guardrailNotes) ? settings.guardrailNotes : [];

  const collectionPlan =
    metrics?.durationFeasibility === 'not_feasible'
      ? 'Needs more traffic for a practical 2–8 week test'
      : metrics?.practicalDurationRange
        ? `Estimated ${metrics.practicalDurationRange}`
        : hasAny(metrics?.durationFeasibility)
          ? 'Needs qualified traffic data'
          : null;
  const visitorsNeeded =
    metrics?.durationFeasibility === 'not_feasible' &&
    Number(metrics.requiredDailyVisitorsForPracticalWindow) > 0
      ? `About ${Number(metrics.requiredDailyVisitorsForPracticalWindow).toLocaleString()}/day`
      : null;
  const trafficEvidence = metrics?.trafficEvidence
    ? metrics.trafficEvidence === 'estimated'
      ? 'Estimated · verify with storefront history'
      : metrics.trafficEvidence === 'modeled'
        ? 'Modeled from order history'
        : 'Measured storefront traffic'
    : null;

  const hasTrafficPlan = hasAny(
    metrics?.recommendedSampleSize,
    collectionPlan,
    visitorsNeeded,
    trafficEvidence
  );
  const hasLaunchExtras = hasAny(settings.scenarioPreset, settings.canaryDays);

  const trafficAllocation =
    audience?.trafficAllocation ?? settings.trafficRampPercent ?? null;
  const deviceFallback =
    audience?.device && String(audience.device).toLowerCase() !== 'all'
      ? formatAudienceFactValue([audience.device], 'All devices')
      : 'All devices';
  const secondaryItems = listSecondaryMetricsForDisplay(metrics);

  return (
    <div className={styles.detailStack}>
      <div className={styles.statCard}>
        <h3 className={styles.panelTitle}>Status & traffic</h3>
        <div className={styles.settingsRows}>
          <SettingRow
            label="Status"
            value={mapSettingsStatusLabel(settings.testStatus)}
            note="Controls whether new visitors can enter this test."
          />
          <SettingRow
            label="Traffic allocation"
            value={percentOrDash(trafficAllocation)}
            note="Percentage of eligible visitors who may enter this test."
          />
        </div>
        {onAdjustTraffic ? (
          <Button variant="plain" onClick={onAdjustTraffic}>
            Adjust traffic
          </Button>
        ) : null}
      </div>

      {audience ? (
        <div className={styles.statCard}>
          <h3 className={styles.panelTitle}>Audience & targeting</h3>
          <div className={styles.detailCardGrid}>
            <DetailFactCard
              label="Segment"
              value={audience.segmentLabel || 'All visitors'}
              action={onEditAudience ? 'Edit targeting' : null}
              onAction={onEditAudience}
            />
            <DetailFactCard
              label="Devices"
              value={formatAudienceFactValue(audience.devices, deviceFallback)}
              action={onEditAudience ? 'Edit' : null}
              actionLabel="Edit devices"
              onAction={onEditAudience}
            />
            <DetailFactCard
              label="Traffic sources"
              value={formatAudienceFactValue(audience.sources, sourceFallback)}
              action={onEditAudience ? 'Edit' : null}
              actionLabel="Edit traffic sources"
              onAction={onEditAudience}
            />
            <DetailFactCard
              label="Countries"
              value={(() => {
                const lists = resolveCountryLists(audience);
                return formatSplitCountryAudienceLabel(
                  lists.includeCountries,
                  lists.excludeCountries
                );
              })()}
              action={onEditAudience ? 'Edit' : null}
              actionLabel="Edit countries"
              onAction={onEditAudience}
            />
          </div>
          <p className={`${styles.help} ${styles.settingsFootnote}`}>
            Only visitors who match these filters can enter the test.
          </p>
        </div>
      ) : null}

      <div className={styles.statCard}>
        <div className={styles.reviewHead}>
          <h3 className={styles.panelTitle}>Metrics & guardrail</h3>
          {onChangeMetric ? (
            <div className={styles.variationPreviewRow}>
              <Button variant="plain" onClick={onChangeMetric}>
                Change metric
              </Button>
            </div>
          ) : null}
        </div>
        <div className={styles.settingsRows}>
          <SettingRow
            label="Primary success metric"
            value={metrics?.primaryMetricLabel || '—'}
            note="Choose one metric to optimise for this test."
          />
          <SettingRow
            label="Secondary metrics (optional)"
            multilineValue={secondaryItems.length > 0}
            value={
              secondaryItems.length ? (
                <div className={styles.detailChipRow}>
                  {secondaryItems.map((item, index) => (
                    <span
                      key={item.catalog_id || item.event_name || index}
                      className={styles.detailChip}
                    >
                      {secondaryMetricDisplayLabel(item, index)}
                    </span>
                  ))}
                </div>
              ) : (
                'None'
              )
            }
          />
          <SettingRow
            label="Confidence level"
            value={percentOrDash(metrics?.confidenceLevel)}
            note="Set in App settings → Results settings."
            infoHash="confidence"
            infoLabel="Confidence level"
          />
          <SettingRow
            label="Minimum visitors per variation"
            value={minSample ? Number(minSample).toLocaleString() : '—'}
            note="Set in App settings → Results settings."
            infoHash="min-sample"
            infoLabel="Minimum visitors"
          />
        </div>

        {guardrails.map(row => {
          // The guardrail is switchable per experiment now, so this readback
          // reports what the experiment actually chose. It used to print
          // "Always on" and the pause rule unconditionally, which would state
          // the opposite of the truth for an experiment that turned it off.
          const on = row.on !== false;
          return (
            <div className={styles.guardrailCard} key={row.id || row.label}>
              <div className={styles.guardrailCardHead}>
                <span className={styles.guardrailCardTitle}>
                  <IconShield size={14} />
                  {row.label || row.id}
                </span>
                <span
                  className={`${styles.badge} ${on ? styles.badgeAccent : ''}`.trim()}
                >
                  {on ? 'On' : 'Off'}
                </span>
              </div>
              {on ? (
                <div className={styles.guardrailRule}>
                  <span>
                    Pauses the test if revenue per visitor for any variation drops more than
                  </span>
                  <span className={styles.guardrailRuleValue}>
                    {String(row.threshold || '').replace(/^-/, '') || '—'}
                  </span>
                  <span>
                    versus control, after each variation has about{' '}
                    {MIN_VISITORS_FOR_REVENUE_GUARDRAIL} visitors.
                  </span>
                </div>
              ) : (
                <div className={styles.guardrailRule}>
                  <span>Not pausing on revenue drop. Stop this test yourself if needed.</span>
                </div>
              )}
              {/* row.hint is deliberately not rendered: the badge above and the
                  sentence beside it already say both halves, and the sentence
                  carries the number. */}
            </div>
          );
        })}
        {onEditMetrics ? (
          <Button variant="plain" accessibilityLabel="Edit guardrail" onClick={onEditMetrics}>
            Edit guardrail
          </Button>
        ) : null}
      </div>

      {/* Reference material, folded away. Identifiers always exist, so the
          disclosure always has something in it. */}
      <details
        className={`${styles.advanced} ${styles.settingsDisclosure}`}
        open={technicalOpen}
        onToggle={event => setTechnicalOpen(event.currentTarget.open)}
      >
        <summary className={styles.advancedSummary}>
          Reference and identifiers
          <IconChevron size={16} up={technicalOpen} />
        </summary>
        <div className={styles.advancedBody}>
          <div className={styles.settingsDisclosureGroup}>
            <div className={styles.sectionLabel}>Launch behaviour</div>
            <div className={styles.settingsRows}>
              <SettingRow
                label="Auto-stop"
                value={settings.autoStopEnabled ? 'On' : 'Off'}
              />
              <SettingRow
                label={isOffer ? 'Offer application' : 'Price application'}
                value={
                  settings.priceApplicationMethod === 'checkout_discount_function'
                    ? 'Checkout discount'
                    : titleCase(settings.priceApplicationMethod)
                }
              />
              <SettingRow
                label="Analysis method"
                value={
                  metrics?.analysisMethod === 'frequentist'
                    ? 'Fixed-horizon'
                    : 'Sequential, with your review'
                }
              />
            </div>
          </div>
          {hasTrafficPlan ? (
            <div className={styles.settingsDisclosureGroup}>
              <div className={styles.sectionLabel}>Traffic plan</div>
              <div className={styles.settingsRows}>
                {metrics?.recommendedSampleSize ? (
                  <SettingRow
                    label="Planning reference"
                    value={Number(metrics.recommendedSampleSize).toLocaleString()}
                    infoHash="min-sample"
                    infoLabel="Planning sample"
                  />
                ) : null}
                {collectionPlan ? (
                  <SettingRow
                    label="Collection plan"
                    value={collectionPlan}
                    infoHash="min-sample"
                    infoLabel="Collection planning window"
                  />
                ) : null}
                {visitorsNeeded ? (
                  <SettingRow label="Eligible visitors needed" value={visitorsNeeded} />
                ) : null}
                {trafficEvidence ? (
                  <SettingRow label="Traffic evidence" value={trafficEvidence} />
                ) : null}
              </div>
            </div>
          ) : null}

          {cogs ? (
            <div className={styles.settingsDisclosureGroup}>
              <div className={styles.sectionLabel}>Cost of goods</div>
              <div className={styles.settingsRows}>
                <SettingRow
                  label="Margin estimates"
                  value={cogs.enabled === false ? 'Off' : 'On'}
                  // Cost of goods sets the margin floor a test price may not
                  // cross. It does not affect the reported result, which is
                  // revenue per visitor.
                  note={
                    cogs.enabled === false
                      ? 'Margin floors are not applied to this test’s prices.'
                      : cogs.value === null || cogs.value === undefined
                        ? 'Costs read from Shopify where available. Used for margin floors, not for results.'
                        : `Using ${
                            cogs.type === 'percentage' ? `${cogs.value}% of price` : cogs.value
                          } where Shopify has no cost. Used for margin floors, not for results.`
                  }
                />
              </div>
            </div>
          ) : null}

          {shopNotes.length ? (
            <div className={styles.settingsDisclosureGroup}>
              <div className={styles.sectionLabel}>Shop defaults at launch</div>
              <p className={styles.help}>
                Fixed limits this test was built against. They are not adjustable per
                test.
              </p>
              <div className={styles.detailChipRow}>
                {shopNotes.map(note => (
                  <span key={note} className={styles.detailChip}>
                    {note}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {hasLaunchExtras ? (
            <div className={styles.settingsDisclosureGroup}>
              <div className={styles.sectionLabel}>Launch preferences</div>
              <div className={styles.settingsRows}>
                {settings.scenarioPreset ? (
                  <SettingRow label="Scenario preset" value={titleCase(settings.scenarioPreset)} />
                ) : null}
                {hasAny(settings.canaryDays) ? (
                  <SettingRow label="Canary days" value={settings.canaryDays} />
                ) : null}
              </div>
            </div>
          ) : null}

          {onViewHistory || onViewTestsList ? (
            <div className={styles.settingsDisclosureGroup}>
              <div className={styles.sectionLabel}>Links</div>
              <div className={`${styles.settingsRows} ${styles.variationPreviewRow}`}>
                {onViewHistory ? (
                  <Button variant="plain" onClick={onViewHistory}>
                    View test history
                  </Button>
                ) : null}
                {onViewTestsList ? (
                  <Button variant="plain" onClick={onViewTestsList}>
                    View test in Tests list
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className={styles.settingsDisclosureGroup}>
            <div className={styles.sectionLabel}>Identifiers</div>
            <p className={styles.help}>Quote these when contacting support.</p>
            <div className={styles.settingsRows}>
              <SettingRow
                label="Plan ID"
                value={<span className={styles.monoValue}>{settings.planId || '—'}</span>}
              />
              <SettingRow
                label="Test ID"
                value={<span className={styles.monoValue}>{settings.testId || '—'}</span>}
              />
              {settings.createdAt ? (
                <SettingRow
                  label="Created date"
                  value={String(settings.createdAt).slice(0, 10)}
                />
              ) : null}
              {settings.startedAt ? (
                <SettingRow
                  label="Started date"
                  value={String(settings.startedAt).slice(0, 10)}
                />
              ) : null}
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}
