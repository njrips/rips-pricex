import React from 'react';
import { formatActivityMeta } from '../classicExperimentDetailsHelpers';
import styles from '../SmartPricingClassic.module.css';

export default function ClassicActivityTab({ activity }) {
  const items = Array.isArray(activity) ? activity : [];
  if (!items.length) {
    return (
      <div className={styles.statCard}>
        <h3 className={styles.panelTitle}>Activity history</h3>
        <p className={styles.help}>
          Launch, Self-QA, pause, and winner events will show here as the experiment progresses.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.statCard}>
      <h3 className={styles.panelTitle}>Activity history</h3>
      <ol className={styles.activityTimeline}>
        {items.map((item, index) => (
          <li
            key={item.id}
            className={`${styles.activityTimelineItem} ${
              index === items.length - 1 ? styles.activityTimelineItemLast : ''
            }`}
          >
            <span className={styles.activityDot} aria-hidden />
            <div className={styles.activityCard}>
              <strong className={styles.activityTitle}>{item.title}</strong>
              <div className={styles.activityWhen}>{formatActivityMeta(item)}</div>
              {item.detail && item.kind !== 'created' && item.kind !== 'started' ? (
                <p className={styles.help}>{item.detail}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
