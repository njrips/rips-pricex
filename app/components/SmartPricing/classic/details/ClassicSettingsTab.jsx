import { useState } from 'react';
import { Button } from '@shopify/polaris';
import SettingsInfoLink from '../../../Settings/SettingsInfoLink';
import { IconChevron, IconShield } from '../classicIcons';
import {
  formatAudienceFactValue,
  formatDetailDate,
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

function percentOrDash(value) {
  return value === null || value === undefined || value === '' ? '—' : `${value}%`;
}

function mapSettingsStatusLabel(testStatus) {
  const key = String(testStatus || '')
    .trim()
    .toLowerCase();
  if (key === 'running') return 'Active';
  if (key === 'paused' || key === 'stopped') return key === 'paused' ? 'Paused' : 'Stopped';
  // `queued` is only the stored default for a plan that has not launched.
  if (key === 'draft' || key === 'queued') return 'Draft';
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
  testIds = [],
  lockedNote = '',
}) {
  const [technicalOpen, setTechnicalOpen] = useState(false);

  if (!settings) {
    return (
      <div className={styles.statCard}>
        <h3 className={styles.panelTitle}>Settings</h3>
        <p className={styles.help}>Settings will appear after the test is saved.</p>
      </div>
    );
  }

  const guardrails = ensureRevenueGuardrailRows(
    metrics?.guardrails,
    metrics?.max_revenue_drop_percent
  );
  const sourceFallback =
    audience?.trafficSource && String(audience.trafficSource).toLowerCase() !== 'all'
      ? formatAudienceFactValue([audience.trafficSource], 'All sources')
      : 'All sources';
  const minSample = audience?.minSampleSize || metrics?.minSampleSize || null;
  const referenceTestIds = [
    ...new Set(
      [...(Array.isArray(testIds) ? testIds : []), settings.testId]
        .map(id => String(id || '').trim())
        .filter(Boolean)
    ),
  ];

  const trafficAllocation =
    audience?.trafficAllocation ?? settings.trafficRampPercent ?? null;
  const deviceFallback =
    audience?.device && String(audience.device).toLowerCase() !== 'all'
      ? formatAudienceFactValue([audience.device], 'All devices')
      : 'All devices';
  const secondaryItems = listSecondaryMetricsForDisplay(metrics);

  return (
    <div className={styles.detailStack}>
      {lockedNote ? <p className={styles.help}>{lockedNote}</p> : null}
      <div className={styles.statCard}>
        <h3 className={styles.panelTitle}>Status & traffic</h3>
        <div className={`${styles.detailCardGrid} ${styles.settingsCardGrid}`}>
          <DetailFactCard
            label="Status"
            value={mapSettingsStatusLabel(settings.testStatus)}
            note="Controls whether new visitors can enter this test."
          />
          <DetailFactCard
            label="Traffic allocation"
            value={percentOrDash(trafficAllocation)}
            note="Percentage of eligible visitors who may enter this test."
            action={onAdjustTraffic ? 'Adjust traffic' : null}
            onAction={onAdjustTraffic}
          />
        </div>
      </div>

      {audience ? (
        <div className={styles.statCard}>
          <h3 className={styles.panelTitle}>Audience & targeting</h3>
          <div className={`${styles.detailCardGrid} ${styles.settingsCardGrid}`}>
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
        <h3 className={styles.panelTitle}>Metrics & guardrail</h3>
        <div className={`${styles.detailCardGrid} ${styles.settingsCardGrid}`}>
          <DetailFactCard
            label="Primary success metric"
            value={metrics?.primaryMetricLabel || '—'}
            note="Choose one metric to optimise for this test."
            action={onChangeMetric ? 'Change metric' : null}
            actionLabel="Change primary success metric"
            onAction={onChangeMetric}
          />
          <DetailFactCard
            label="Secondary metrics"
            action={onChangeMetric ? 'Edit metrics' : null}
            actionLabel="Edit secondary metrics"
            onAction={onChangeMetric}
          >
            {secondaryItems.length ? (
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
              <div className={styles.statValue}>None</div>
            )}
          </DetailFactCard>
          <DetailFactCard
            label={
              <>
                Confidence level
                <SettingsInfoLink hash="confidence" label="Confidence level" />
              </>
            }
            value={percentOrDash(metrics?.confidenceLevel)}
            note="Set in App settings → Results settings."
          />
          <DetailFactCard
            label={
              <>
                Minimum visitors per variation
                <SettingsInfoLink hash="min-sample" label="Minimum visitors" />
              </>
            }
            value={minSample ? Number(minSample).toLocaleString() : '—'}
            note="Set in App settings → Results settings."
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
                <span className={styles.guardrailCardHeadEnd}>
                  <span
                    className={`${styles.badge} ${on ? styles.badgeAccent : ''}`.trim()}
                  >
                    {on ? 'On' : 'Off'}
                  </span>
                  {onEditMetrics ? (
                    <Button
                      variant="plain"
                      accessibilityLabel="Edit guardrail"
                      onClick={onEditMetrics}
                    >
                      Edit
                    </Button>
                  ) : null}
                </span>
              </div>
              {on ? (
                <div className={styles.guardrailRule}>
                  <span>
                    Pauses this test if revenue per visitor for any variation drops more than
                  </span>
                  <span className={styles.guardrailRuleValue}>
                    {String(row.threshold || '').replace(/^-/, '') || '—'}
                  </span>
                  <span>
                    vs control, once each variation has{' '}
                    {Number(minSample || MIN_VISITORS_FOR_REVENUE_GUARDRAIL).toLocaleString()}{' '}
                    visitors.
                  </span>
                </div>
              ) : (
                <div className={styles.guardrailRule}>
                  <span>Doesn’t pause this test on a revenue per visitor drop. Pause it yourself if needed.</span>
                </div>
              )}
              {/* row.hint is deliberately not rendered: the badge above and the
                  sentence beside it already say both halves, and the sentence
                  carries the number. */}
            </div>
          );
        })}
      </div>

      {/* Reference material, folded away. Identifiers always exist, so the
          disclosure always has something in it. */}
      <details
        className={`${styles.advanced} ${styles.settingsDisclosure}`}
        open={technicalOpen}
        onToggle={event => setTechnicalOpen(event.currentTarget.open)}
      >
        <summary className={styles.advancedSummary}>
          Reference & identifiers
          <IconChevron size={16} up={technicalOpen} />
        </summary>
        <div className={styles.advancedBody}>
          <div className={styles.settingsDisclosureGroup}>
            <div className={styles.sectionLabel}>Reference</div>
            <div className={styles.settingsRows}>
              <SettingRow
                label={referenceTestIds.length > 1 ? 'Test IDs' : 'Test ID'}
                value={
                  <span className={styles.monoValue}>
                    {referenceTestIds[0] || '—'}
                    {referenceTestIds.length > 1 ? ` +${referenceTestIds.length - 1} more` : ''}
                  </span>
                }
                note={
                  referenceTestIds.length > 1
                    ? 'Each product runs as its own test. Copy test ID in the ⋯ menu copies all of them.'
                    : null
                }
              />
              {settings.createdAt ? (
                <SettingRow
                  label="Created date"
                  value={formatDetailDate(settings.createdAt)}
                />
              ) : null}
              {settings.startedAt ? (
                <SettingRow
                  label="Started date"
                  value={formatDetailDate(settings.startedAt)}
                />
              ) : null}
            </div>
          </div>

          {onViewHistory || onViewTestsList ? (
            <div className={styles.settingsDisclosureGroup}>
              <div className={styles.sectionLabel}>Links</div>
              <div className={styles.settingsLinks}>
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
        </div>
      </details>
    </div>
  );
}
