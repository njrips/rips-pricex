import React from 'react';
import styles from '../SmartPricingClassic.module.css';

export default function ClassicMetricsTab({ metrics }) {
  if (!metrics) {
    return (
      <div className={styles.statCard}>
        <h3 className={styles.panelTitle}>Metrics</h3>
        <p className={styles.help}>No success metrics configured yet.</p>
      </div>
    );
  }

  const secondary =
    Array.isArray(metrics.secondary) && metrics.secondary.length
      ? metrics.secondary
      : (metrics.secondaryEvents || []).map(eventName => ({
          event_name: eventName,
          label: eventName,
        }));

  return (
    <div className={styles.detailStack}>
      <div className={styles.statCard}>
        <h3 className={styles.panelTitle}>Primary metric</h3>
        <div className={styles.selectionBar}>
          <span>Goal</span>
          <strong>{metrics.primaryMetricLabel}</strong>
        </div>
        {metrics.rationale ? <p className={styles.help}>{metrics.rationale}</p> : null}
      </div>

      <div className={styles.statCard}>
        <h3 className={styles.panelTitle}>Secondary goals</h3>
        {secondary.length ? (
          secondary.map((item, index) => (
            <div key={item.catalog_id || item.event_name || index} className={styles.selectionBar}>
              <span>{item.label || item.event_name || `Goal ${index + 1}`}</span>
              <strong>
                {[item.aggregation, item.direction].filter(Boolean).join(' · ') ||
                  item.event_name ||
                  '—'}
              </strong>
            </div>
          ))
        ) : (
          <p className={styles.help}>No secondary goals attached.</p>
        )}
      </div>

      {metrics.cogs ? (
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
    </div>
  );
}
