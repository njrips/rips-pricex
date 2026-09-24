import {
  listSecondaryMetricsForDisplay,
  secondaryMetricDisplayLabel,
} from '../classicExperimentDetailsHelpers';
import DetailFactCard from './DetailFactCard';
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

  const secondary = listSecondaryMetricsForDisplay(metrics);

  return (
    <div className={styles.detailStack}>
      <DetailFactCard
        label="Primary metric"
        value={metrics.primaryMetricLabel}
        action={onEdit ? 'Change metric' : null}
        actionLabel="Change primary metric"
        onAction={onEdit}
      />

      <DetailFactCard
        label="Secondary metrics"
        action={onEdit ? 'Edit metrics' : null}
        actionLabel="Edit secondary metrics"
        onAction={onEdit}
      >
        {secondary.length ? (
          <div className={styles.detailChipRow}>
            {secondary.map((item, index) => (
              <span
                key={item.catalog_id || item.event_name || index}
                className={styles.detailChip}
              >
                {secondaryMetricDisplayLabel(item, index)}
              </span>
            ))}
          </div>
        ) : (
          <p className={styles.help}>No secondary goals attached.</p>
        )}
      </DetailFactCard>
    </div>
  );
}
