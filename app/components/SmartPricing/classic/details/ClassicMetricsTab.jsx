import { Button } from '@shopify/polaris';
import { formatPrimaryMetricLabel } from '../classicExperimentDetailsHelpers';
import styles from '../SmartPricingClassic.module.css';

export default function ClassicMetricsTab({ metrics, onEdit }) {
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
          label: formatPrimaryMetricLabel(eventName),
        }));

  return (
    <div className={styles.detailStack}>
      <div className={`${styles.statCard} ${styles.detailFactCard}`}>
        <div className={styles.detailFactHead}>
          <div className={styles.statLabel}>Primary metric</div>
          {onEdit ? (
            <Button variant="plain" accessibilityLabel="Change primary metric" onClick={onEdit}>
              Change metric
            </Button>
          ) : null}
        </div>
        <div className={styles.statValue}>{metrics.primaryMetricLabel}</div>
      </div>

      <div className={`${styles.statCard} ${styles.detailFactCard}`}>
        <div className={styles.detailFactHead}>
          <div className={styles.statLabel}>Secondary metrics</div>
          {onEdit ? (
            <Button variant="plain" accessibilityLabel="Edit secondary metrics" onClick={onEdit}>
              Edit metrics
            </Button>
          ) : null}
        </div>
        {secondary.length ? (
          <div className={styles.detailChipRow}>
            {secondary.map((item, index) => (
              <span
                key={item.catalog_id || item.event_name || index}
                className={styles.detailChip}
              >
                {item.label || formatPrimaryMetricLabel(item.event_name) || `Goal ${index + 1}`}
              </span>
            ))}
          </div>
        ) : (
          <p className={styles.help}>No secondary goals attached.</p>
        )}
      </div>
    </div>
  );
}
