import { Badge, Button } from '@shopify/polaris';
import SettingsInfoLink from '../../../Settings/SettingsInfoLink';
import { IconShield } from '../classicIcons';
import { formatSplitCountryAudienceLabel, resolveCountryLists } from '../countrySelection';
import { formatAudienceFactValue } from '../classicExperimentDetailsHelpers';
import { ensureRevenueGuardrailRows } from '../revenueGuardrail';
import styles from '../SmartPricingClassic.module.css';

function OnOff({ on }) {
  return on ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>;
}

export default function ClassicSettingsTab({
  settings,
  audience = null,
  metrics = null,
  onEdit = null,
  onEditMetrics = null,
}) {
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
  const sourceFallback =
    audience?.trafficSource && String(audience.trafficSource).toLowerCase() !== 'all'
      ? formatAudienceFactValue([audience.trafficSource], 'All sources')
      : 'All sources';

  return (
    <div className={styles.detailStack}>
      <div className={styles.statCard}>
        <h3 className={styles.panelTitle}>Launch preferences</h3>
        <div className={styles.selectionBar}>
          <span>Status</span>
          <strong>{settings.testStatus || '—'}</strong>
        </div>
        <div className={styles.selectionBar}>
          <span>Traffic ramp</span>
          <strong>
            {settings.trafficRampPercent !== null && settings.trafficRampPercent !== undefined
              ? `${settings.trafficRampPercent}%`
              : '—'}
          </strong>
        </div>
        <div className={styles.selectionBar}>
          <span>Canary days</span>
          <strong>
            {settings.canaryDays !== null && settings.canaryDays !== undefined
              ? settings.canaryDays
              : '—'}
          </strong>
        </div>
        <div className={styles.selectionBar}>
          <span>Auto-stop</span>
          <strong>{settings.autoStopEnabled ? 'On · per product' : 'Off'}</strong>
        </div>
        {settings.autoStopEnabled ? (
          <p className={styles.help} style={{ marginTop: 0 }}>
            {settings.experimentType === 'offer_test' || settings.experimentType === 'offer'
              ? 'Each product ends on its own sequential call. Catalog prices are not changed.'
              : 'Each product is decided on its own. A winning variation writes that Shopify price; a control win leaves the catalog unchanged. Other products keep running.'}
          </p>
        ) : null}
        <div className={styles.selectionBar}>
          <span>
            {settings.priceApplicationMethod === 'checkout_discount_function'
              ? 'Offer application'
              : 'Price application'}
          </span>
          <strong>
            {settings.priceApplicationMethod === 'checkout_discount_function'
              ? 'Checkout discount function'
              : settings.priceApplicationMethod || '—'}
          </strong>
        </div>
        <div className={styles.selectionBar}>
          <span>Scenario preset</span>
          <strong>{settings.scenarioPreset || '—'}</strong>
        </div>
      </div>

      {audience ? (
        <div className={styles.statCard}>
          <div className={styles.detailFactHead}>
            <h3 className={styles.panelTitle}>Traffic sources & exclusions</h3>
            {onEdit ? (
              <Button variant="plain" accessibilityLabel="Edit audience targeting" onClick={onEdit}>
                Edit
              </Button>
            ) : null}
          </div>
          <div className={styles.selectionBar}>
            <span>Sources ({audience.sourceMode || 'include'})</span>
            <strong>{formatAudienceFactValue(audience.sources, sourceFallback)}</strong>
          </div>
          <div className={styles.selectionBar}>
            <span>Countries</span>
            <strong>
              {(() => {
                const lists = resolveCountryLists(audience);
                return formatSplitCountryAudienceLabel(
                  lists.includeCountries,
                  lists.excludeCountries
                );
              })()}
            </strong>
          </div>
          <div className={styles.selectionBar}>
            <span>Exclude bots</span>
            <OnOff on={Boolean(audience.excludeBots)} />
          </div>
          <div className={styles.selectionBar}>
            <span>Exclude internal IPs</span>
            <OnOff on={Boolean(audience.excludeInternalIps)} />
          </div>
          <div className={styles.selectionBar}>
            <span>Inherit shop defaults</span>
            <strong>{audience.inheritDefaults ? 'Yes' : 'No'}</strong>
          </div>
          {audience.minSampleSize || metrics?.minSampleSize ? (
            <div className={styles.selectionBar}>
              <span>
                Minimum sample per variation
                <SettingsInfoLink hash="min-sample" label="Minimum sample" />
              </span>
              <strong>{audience.minSampleSize || metrics.minSampleSize}</strong>
            </div>
          ) : null}
          {metrics?.recommendedSampleSize ? (
            <div className={styles.selectionBar}>
              <span>
                Planning reference per variation
                <SettingsInfoLink hash="min-sample" label="Planning sample" />
              </span>
              <strong>{metrics.recommendedSampleSize}</strong>
            </div>
          ) : null}
          {metrics?.durationFeasibility || metrics?.practicalDurationRange ? (
            <div className={styles.selectionBar}>
              <span>
                Collection plan
                <SettingsInfoLink hash="min-sample" label="Collection planning window" />
              </span>
              <strong>
                {metrics.durationFeasibility === 'not_feasible'
                  ? 'Needs more traffic for a practical 2–8 week test'
                  : metrics.practicalDurationRange
                    ? `Estimated ${metrics.practicalDurationRange}`
                    : 'Needs qualified traffic data'}
              </strong>
            </div>
          ) : null}
          {metrics?.durationFeasibility === 'not_feasible' &&
          Number(metrics.requiredDailyVisitorsForPracticalWindow) > 0 ? (
            <div className={styles.selectionBar}>
              <span>Eligible visitors needed</span>
              <strong>
                About{' '}
                {Number(metrics.requiredDailyVisitorsForPracticalWindow).toLocaleString()}/day
              </strong>
            </div>
          ) : null}
          {metrics?.trafficEvidence ? (
            <div className={styles.selectionBar}>
              <span>Traffic evidence</span>
              <strong>
                {metrics.trafficEvidence === 'estimated'
                  ? 'Estimated · verify with storefront history'
                  : metrics.trafficEvidence === 'modeled'
                    ? 'Modeled from order history'
                    : 'Measured storefront traffic'}
              </strong>
            </div>
          ) : null}
          <div className={styles.selectionBar}>
            <span>
              Analysis
              <SettingsInfoLink hash="sequential" label="Sequential testing" />
            </span>
            <strong>
              {metrics?.analysisMethod === 'frequentist'
                ? 'Fixed-horizon'
                : 'Sequential directional evidence · manual winner review'}
              {metrics?.mdePercent ? ` · ${metrics.mdePercent}% relative lift reference` : ''}
              {metrics?.confidenceLevel ? ` · ${metrics.confidenceLevel}% confidence` : ''}
            </strong>
          </div>
        </div>
      ) : null}

      {guardrails.length ? (
        <div className={styles.statCard}>
          <div className={styles.reviewHead}>
            <div className={styles.panelHeadingGroup}>
              <h3 className={styles.panelTitle}>Revenue guardrail</h3>
              <SettingsInfoLink hash="guardrail-metrics" label="Revenue guardrail" />
            </div>
            {onEditMetrics ? (
              <Button
                variant="plain"
                accessibilityLabel="Edit revenue guardrail"
                onClick={onEditMetrics}
              >
                Edit
              </Button>
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
              {row.hint ? <p className={styles.guardrailHint}>{row.hint}</p> : null}
            </div>
          ))}
        </div>
      ) : null}

      {metrics?.cogs ? (
        <div className={styles.statCard}>
          <h3 className={styles.panelTitle}>COGS</h3>
          <div className={styles.selectionBar}>
            <span>Enabled</span>
            <strong>{metrics.cogs.enabled === false ? 'Off' : 'On'}</strong>
          </div>
          <div className={styles.selectionBar}>
            <span>Type</span>
            <strong>{metrics.cogs.type || '—'}</strong>
          </div>
          <div className={styles.selectionBar}>
            <span>Value</span>
            <strong>
              {metrics.cogs.value !== null && metrics.cogs.value !== undefined
                ? metrics.cogs.type === 'percentage'
                  ? `${metrics.cogs.value}%`
                  : metrics.cogs.value
                : '—'}
            </strong>
          </div>
        </div>
      ) : null}

      {Array.isArray(settings.guardrailNotes) && settings.guardrailNotes.length ? (
        <div className={styles.statCard}>
          <h3 className={styles.panelTitle}>Shop guardrails</h3>
          {settings.guardrailNotes.map(note => (
            <div key={note} className={styles.selectionBar}>
              <span>{note}</span>
              <strong>Active</strong>
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.statCard}>
        <h3 className={styles.panelTitle}>Identifiers</h3>
        <div className={styles.selectionBar}>
          <span>Plan ID</span>
          <strong className={styles.monoValue}>{settings.planId || '—'}</strong>
        </div>
        <div className={styles.selectionBar}>
          <span>Test ID</span>
          <strong className={styles.monoValue}>{settings.testId || '—'}</strong>
        </div>
        <p className={styles.help}>
          Shop-wide Smart Pricing defaults live under Smart Pricing → Settings in the list view.
        </p>
      </div>
    </div>
  );
}
