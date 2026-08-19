import React from 'react';
import { Badge } from '@shopify/polaris';
import { IconShield } from '../classicIcons';
import { formatCountryAudienceValue } from '../countrySelection';
import { formatAudienceFactValue } from '../classicExperimentDetailsHelpers';
import styles from '../SmartPricingClassic.module.css';

function OnOff({ on }) {
  return on ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>;
}

export default function ClassicSettingsTab({ settings, audience = null, metrics = null }) {
  if (!settings) {
    return (
      <div className={styles.statCard}>
        <h3 className={styles.panelTitle}>Settings</h3>
        <p className={styles.help}>Launch settings will appear after the plan is saved.</p>
      </div>
    );
  }

  const guardrails = Array.isArray(metrics?.guardrails) ? metrics.guardrails : [];
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
          <strong>{settings.autoStopEnabled ? 'On' : 'Off'}</strong>
        </div>
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
          <h3 className={styles.panelTitle}>Traffic sources & exclusions</h3>
          <div className={styles.selectionBar}>
            <span>Sources ({audience.sourceMode || 'include'})</span>
            <strong>{formatAudienceFactValue(audience.sources, sourceFallback)}</strong>
          </div>
          <div className={styles.selectionBar}>
            <span>Countries ({audience.countryMode || 'include'})</span>
            <strong>{formatCountryAudienceValue(audience.countries, audience.countryMode)}</strong>
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
          {audience.minSampleSize ? (
            <div className={styles.selectionBar}>
              <span>Minimum sample per variation</span>
              <strong>{audience.minSampleSize}</strong>
            </div>
          ) : null}
        </div>
      ) : null}

      {guardrails.length ? (
        <div className={styles.statCard}>
          <div className={styles.reviewHead}>
            <h3 className={styles.panelTitle}>Guardrail metrics</h3>
          </div>
          <div className={styles.detailTableWrap}>
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
                {guardrails.map(row => (
                  <tr key={row.id || row.label}>
                    <td>
                      <strong>{row.label || row.id}</strong>
                      {row.hint ? <div className={styles.productSub}>{row.hint}</div> : null}
                    </td>
                    <td>{row.rule || '—'}</td>
                    <td>{row.threshold || '—'}</td>
                    <td>
                      {row.on || row.id === 'revenue' ? (
                        <Badge tone="success">On</Badge>
                      ) : (
                        <Badge>Off</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
