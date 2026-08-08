import React from 'react';
import styles from '../SmartPricingClassic.module.css';

function formatWhen(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

export default function ClassicActivityTab({ activity }) {
  if (!activity?.length) {
    return (
      <div className={styles.statCard}>
        <h3 className={styles.panelTitle}>Activity</h3>
        <p className={styles.help}>
          Launch, Self-QA, pause, and winner events will show here as the experiment progresses.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.statCard}>
      <h3 className={styles.panelTitle}>Activity</h3>
      <ul className={styles.activityList}>
        {activity.map(item => (
          <li key={item.id} className={styles.activityItem}>
            <div className={styles.activityWhen}>{formatWhen(item.at)}</div>
            <div className={styles.activityBody}>
              <strong>{item.title}</strong>
              {item.detail ? <p className={styles.help}>{item.detail}</p> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
