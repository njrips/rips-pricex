import { formatPrimaryMetricLabel } from '../classicExperimentDetailsHelpers';
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

  const secondary =
    Array.isArray(metrics.secondary) && metrics.secondary.length
      ? metrics.secondary
      : (metrics.secondaryEvents || []).map(eventName => ({
          event_name: eventName,
          label: formatPrimaryMetricLabel(eventName),
        }));

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
                {item.label || formatPrimaryMetricLabel(item.event_name) || `Goal ${index + 1}`}
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
