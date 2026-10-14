import { formatMetricMoney, formatNumber, formatRate } from '../classicExperimentDetailsHelpers';
import styles from '../SmartPricingClassic.module.css';

function loadingValue(analyticsLoading, value) {
  return analyticsLoading && (value === null || value === undefined) ? '…' : null;
}

/** Shown only once the sample floors are met; until then there is no reading. */
function formatLift(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const n = Math.round(Number(value) * 10) / 10;
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}

/** Bottom "Test totals" block on the Overview tab (Global naming doc). */
export default function ClassicOverviewTab({
  kpis,
  analyticsLoading,
  currency = 'USD',
}) {
  return (
    <div className={styles.statCard}>
      <div className={styles.reviewHead}>
        <h3 className={styles.panelTitle}>Test totals</h3>
      </div>
      <div className={styles.selectionBar}>
        <span>Total visitors</span>
        <strong>
          {analyticsLoading && (kpis.visitors === null || kpis.visitors === undefined)
            ? '…'
            : formatNumber(kpis.visitors)}
        </strong>
      </div>
      <div className={styles.selectionBar}>
        <span>Total conversions</span>
        <strong>
          {analyticsLoading && (kpis.conversions === null || kpis.conversions === undefined)
            ? '…'
            : formatNumber(kpis.conversions)}
        </strong>
      </div>
      <div className={styles.selectionBar}>
        <span>Overall conversion rate</span>
        <strong>
          {analyticsLoading && (kpis.overallRate === null || kpis.overallRate === undefined)
            ? '…'
            : formatRate(kpis.overallRate)}
        </strong>
      </div>
      <div className={styles.selectionBar}>
        <span>Overall revenue per visitor</span>
        <strong>
          {analyticsLoading &&
          (kpis.overallRevenuePerVisitor === null || kpis.overallRevenuePerVisitor === undefined)
            ? '…'
            : formatMetricMoney(kpis.overallRevenuePerVisitor, currency)}
        </strong>
      </div>
      <div className={styles.selectionBar}>
        <span title="Revenue per visitor uplift vs control.">Lift</span>
        <strong>{loadingValue(analyticsLoading, kpis.lift) ?? formatLift(kpis.lift)}</strong>
      </div>
      <div className={styles.selectionBar}>
        <span title="How sure the maths is that the winner is better than control.">Confidence</span>
        <strong>
          {loadingValue(analyticsLoading, kpis.confidence) ??
            (kpis.confidence === null || kpis.confidence === undefined
              ? '—'
              : `${Math.round(Number(kpis.confidence))}%`)}
        </strong>
      </div>
      <div className={styles.selectionBar}>
        <span>Traffic allocation</span>
        <strong>
          {kpis.trafficAllocation !== null && kpis.trafficAllocation !== undefined
            ? `${kpis.trafficAllocation}%`
            : '—'}
        </strong>
      </div>
      <p className={styles.help} style={{ marginBottom: 0 }}>
        Percentage of eligible visitors entering this test.
      </p>
    </div>
  );
}
