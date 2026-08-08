import React from 'react';
import { IconTrophy } from '../classicIcons';
import { formatNumber, formatPct, formatRate } from '../classicExperimentDetailsHelpers';
import styles from '../SmartPricingClassic.module.css';

export default function ClassicOverviewTab({ kpis, conversionRows, analyticsLoading }) {
  return (
    <>
      <div className={styles.statGrid}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Visitors</div>
          <div className={`${styles.statValue} ${styles.statValueLg}`}>
            {analyticsLoading && (kpis.visitors === null || kpis.visitors === undefined)
              ? '…'
              : formatNumber(kpis.visitors)}
          </div>
          <div className={styles.productSub}>
            {kpis.variationCount > 0
              ? `Across ${kpis.variationCount} variation${kpis.variationCount === 1 ? '' : 's'}`
              : 'No variations yet'}
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Lift vs control</div>
          <div
            className={`${styles.statValue} ${styles.statValueLg} ${
              kpis.lift !== null && kpis.lift !== undefined && kpis.lift >= 0 ? styles.liftPos : ''
            }`}
          >
            {analyticsLoading && (kpis.lift === null || kpis.lift === undefined)
              ? '…'
              : formatPct(kpis.lift)}
          </div>
          <div className={styles.productSub}>{kpis.primaryMetricLabel}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Confidence</div>
          <div className={`${styles.statValue} ${styles.statValueLg}`}>
            {analyticsLoading && (kpis.confidence === null || kpis.confidence === undefined)
              ? '…'
              : kpis.confidence !== null && kpis.confidence !== undefined
                ? `${Number(kpis.confidence).toFixed(0)}%`
                : '—'}
          </div>
          <div className={styles.productSub}>
            {kpis.significant ? 'Statistically significant' : 'Collecting data'}
          </div>
        </div>
      </div>

      <div className={styles.overviewSplit}>
        <div className={styles.statCard}>
          <div className={styles.reviewHead}>
            <h3 className={styles.panelTitle}>Conversion by variation</h3>
            <span className={styles.productSub}>{kpis.primaryMetricLabel}</span>
          </div>
          {conversionRows.length ? (
            conversionRows.map(row => (
              <div key={row.id} className={styles.conversionRow}>
                <div className={styles.conversionRowMeta}>
                  <span>
                    <strong>{row.label}</strong>
                    {row.isControl ? <span className={styles.controlBadge}>Control</span> : null}
                    {row.isWinner ? (
                      <span className={styles.winnerBadge}>
                        <IconTrophy size={10} /> Winner
                      </span>
                    ) : null}
                  </span>
                  <strong>{formatRate(row.rate)}</strong>
                </div>
                <div className={styles.barTrack}>
                  <div
                    className={`${styles.barFill} ${row.isWinner ? styles.barFillWinner : ''}`}
                    style={{ width: `${row.barWidth}%` }}
                  />
                </div>
              </div>
            ))
          ) : (
            <p className={styles.help}>Variation analytics appear after launch.</p>
          )}
        </div>

        <div className={styles.statCard}>
          <div className={styles.reviewHead}>
            <h3 className={styles.panelTitle}>Totals</h3>
          </div>
          <div className={styles.selectionBar}>
            <span>Total visitors</span>
            <strong>{formatNumber(kpis.visitors)}</strong>
          </div>
          <div className={styles.selectionBar}>
            <span>Total conversions</span>
            <strong>{formatNumber(kpis.conversions)}</strong>
          </div>
          <div className={styles.selectionBar}>
            <span>Overall rate</span>
            <strong>{formatRate(kpis.overallRate)}</strong>
          </div>
          <div className={styles.selectionBar}>
            <span>Traffic allocation</span>
            <strong>
              {kpis.trafficAllocation !== null && kpis.trafficAllocation !== undefined
                ? `${kpis.trafficAllocation}%`
                : '—'}
            </strong>
          </div>
        </div>
      </div>
    </>
  );
}
