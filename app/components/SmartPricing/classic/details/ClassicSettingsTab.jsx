import { useState } from 'react';
import { Button } from '@shopify/polaris';
import SettingsInfoLink from '../../../Settings/SettingsInfoLink';
import { IconChevron, IconShield } from '../classicIcons';
import { formatAudienceFactValue } from '../classicExperimentDetailsHelpers';
import { ensureRevenueGuardrailRows } from '../revenueGuardrail';
import DetailFactCard from './DetailFactCard';
import styles from '../SmartPricingClassic.module.css';

/**
 * A label and what it is set to, side by side.
 *
 * The value sits in a column next to its label rather than against the far edge
 * of the card, so a stack of these reads as one list instead of two.
 */
function SettingRow({ label, value, note = null, infoHash = null, infoLabel = null }) {
  return (
    <div className={styles.settingsRow}>
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

export default function ClassicSettingsTab({
  settings,
  audience = null,
  metrics = null,
  onEditMetrics = null,
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

  return (
    <div className={styles.detailStack}>
      {/* The four answers a merchant opens this tab for. Everything that is
          reference material rather than a decision moved into the disclosure at
          the bottom, so these are no longer buried among identifiers and shop
          defaults. */}
      <div className={styles.detailCardGrid}>
        <DetailFactCard label="Status" value={titleCase(settings.testStatus)} />
        <DetailFactCard
          label="Auto-stop"
          value={settings.autoStopEnabled ? 'On' : 'Off'}
          note={
            settings.autoStopEnabled
              ? isOffer
                ? 'Each product ends on its own sequential call. Catalog prices are not changed.'
                : 'Each product is decided on its own. A winning variation writes that Shopify price; a control win leaves the catalog unchanged. Other products keep running.'
              : 'Products keep collecting until you end them.'
          }
        />
        <DetailFactCard
          label={isOffer ? 'Offer application' : 'Price application'}
          value={
            settings.priceApplicationMethod === 'checkout_discount_function'
              ? 'Checkout discount'
              : titleCase(settings.priceApplicationMethod)
          }
          note={
            settings.priceApplicationMethod === 'checkout_discount_function'
              ? 'The winning discount is applied at checkout.'
              : 'Test prices are shown on the storefront and charged at checkout.'
          }
        />
        <DetailFactCard
          label="Traffic ramp"
          value={percentOrDash(settings.trafficRampPercent)}
          note="Share of eligible visitors entering the split."
        />
      </div>

      {/* One place for everything that decides the outcome. These were split
          across a "Traffic sources" card and a separate guardrail card, and the
          analysis row crammed method, lift and confidence into one string. */}
      <div className={styles.statCard}>
        <div className={styles.reviewHead}>
          <div className={styles.panelHeadingGroup}>
            <h3 className={styles.panelTitle}>How a winner is decided</h3>
            <SettingsInfoLink hash="sequential" label="Sequential testing" />
          </div>
          {onEditMetrics ? (
            <Button
              variant="plain"
              accessibilityLabel="Edit revenue guardrail"
              onClick={onEditMetrics}
            >
              Edit guardrail
            </Button>
          ) : null}
        </div>
        <div className={styles.settingsRows}>
          <SettingRow
            label="Method"
            value={
              metrics?.analysisMethod === 'frequentist'
                ? 'Fixed-horizon'
                : 'Sequential, with your review'
            }
            note={
              metrics?.analysisMethod === 'frequentist'
                ? null
                : 'Evidence is re-checked as data arrives. No price changes without your approval.'
            }
          />
          <SettingRow
            label="Confidence level"
            value={percentOrDash(metrics?.confidenceLevel)}
            infoHash="confidence"
            infoLabel="Confidence level"
          />
          <SettingRow
            label="Minimum sample per variation"
            value={minSample ? Number(minSample).toLocaleString() : '—'}
            note="Set once for the whole shop, in Stat settings."
            infoHash="min-sample"
            infoLabel="Minimum sample"
          />
          {metrics?.mdePercent ? (
            <SettingRow
              label="Lift reference"
              value={`${metrics.mdePercent}% relative`}
              note="Used to plan how much traffic a test needs, not to call the winner."
            />
          ) : null}
        </div>

        {guardrails.map(row => (
          <div className={styles.guardrailCard} key={row.id || row.label}>
            <div className={styles.guardrailCardHead}>
              <span className={styles.guardrailCardTitle}>
                <IconShield size={14} />
                {row.label || row.id}
              </span>
              <span className={`${styles.badge} ${styles.badgeAccent}`}>Always on</span>
            </div>
            <div className={styles.guardrailRule}>
              <span>Pauses the test if any variation drops more than</span>
              <span className={styles.guardrailRuleValue}>
                {String(row.threshold || '').replace(/^-/, '') || '—'}
              </span>
              <span>versus control.</span>
            </div>
            {/* row.hint is deliberately not rendered. It reads "Always on.
                Auto-pauses if any variation drops past this vs control." — the
                badge above and the sentence beside it already say both halves,
                and the sentence carries the number. */}
          </div>
        ))}
      </div>

      {/* Renamed from "Traffic sources & exclusions", which had grown to hold
          sample sizes and analysis methods too. Countries moved out entirely:
          the Audience tab shows them and is where they are edited. */}
      {audience ? (
        <div className={styles.statCard}>
          <h3 className={styles.panelTitle}>Who is counted</h3>
          <div className={styles.settingsRows}>
            <SettingRow
              label={`Traffic sources (${audience.sourceMode || 'include'})`}
              value={formatAudienceFactValue(audience.sources, sourceFallback)}
            />
            {/* Plain text, not status badges: these sit between "Traffic
                sources" and "Inherit shop defaults", and a green pill among
                them reads as an alert rather than a neutral fact. */}
            <SettingRow label="Exclude bots" value={audience.excludeBots ? 'On' : 'Off'} />
            <SettingRow
              label="Exclude internal IPs"
              value={audience.excludeInternalIps ? 'On' : 'Off'}
            />
            <SettingRow
              label="Inherit shop defaults"
              value={audience.inheritDefaults ? 'Yes' : 'No'}
            />
          </div>
          <p className={`${styles.help} ${styles.settingsFootnote}`}>
            Segment, devices, and countries are on the Audience tab.
          </p>
        </div>
      ) : null}

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
                      ? 'Margin floors are not applied to this experiment’s prices.'
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
                Fixed limits this experiment was built against. They are not adjustable per
                experiment.
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
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}
