import { Button } from '@shopify/polaris';
import {
  buildOverviewContextLine,
  formatRunningTestStatusLabel,
} from '../classicOverviewLayout';
import styles from '../SmartPricingClassic.module.css';

export default function ClassicOverviewContextStrip({
  isOfferTest = false,
  productCount = 0,
  primaryMetric = 'revenue_per_visitor',
  trafficAllocation = null,
  isRunning = false,
  isPaused = false,
  isEnded = false,
  isDraft = false,
  statusBusy = false,
  onPause = null,
  onResume = null,
}) {
  const contextLine = buildOverviewContextLine({
    isOfferTest,
    productCount,
    primaryMetric,
    trafficAllocation,
  });
  const statusLabel = formatRunningTestStatusLabel({ isRunning, isPaused, isEnded, isDraft });
  const canToggle = isRunning || isPaused;

  return (
    <div className={`${styles.statCard} ${styles.overviewContextStrip}`}>
      <div className={styles.reviewHead}>
        <p className={styles.help} style={{ margin: 0 }}>
          {contextLine}
        </p>
        <div className={styles.overviewContextStatus}>
          <span className={styles.statLabel}>Status</span>
          <span className={styles.settingsRowValue}>{statusLabel}</span>
          {canToggle && isRunning && onPause ? (
            <Button size="slim" disabled={statusBusy} loading={statusBusy} onClick={onPause}>
              Pause
            </Button>
          ) : null}
          {canToggle && isPaused && onResume ? (
            <Button size="slim" disabled={statusBusy} loading={statusBusy} onClick={onResume}>
              Resume
            </Button>
          ) : null}
        </div>
      </div>
      <p className={styles.help} style={{ marginBottom: 0 }}>
        Controls whether new visitors can enter this test.
      </p>
    </div>
  );
}
