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
          <span className={styles.statLabel} id="overview-status-label">
            Status
          </span>
          {canToggle ? (
            <div
              className={`${styles.segment} ${styles.overviewStatusToggle}`}
              role="group"
              aria-labelledby="overview-status-label"
            >
              {[
                { id: 'active', label: 'Active', on: isRunning, onClick: onResume },
                { id: 'paused', label: 'Paused', on: isPaused, onClick: onPause },
              ].map(option => (
                <button
                  key={option.id}
                  type="button"
                  className={`${styles.segmentBtn} ${option.on ? styles.segmentBtnActive : ''}`.trim()}
                  aria-pressed={option.on}
                  disabled={statusBusy || option.on || typeof option.onClick !== 'function'}
                  onClick={() => option.onClick?.()}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : (
            <span className={styles.settingsRowValue}>{statusLabel}</span>
          )}
        </div>
      </div>
      <p className={styles.help} style={{ marginBottom: 0 }}>
        Controls whether new visitors can enter this test.
      </p>
    </div>
  );
}
