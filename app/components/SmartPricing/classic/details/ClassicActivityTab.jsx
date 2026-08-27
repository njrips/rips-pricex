import React, { useEffect, useMemo, useState } from 'react';
import {
  ACTIVITY_FILTERS,
  activityFilterCounts,
  activityKindMeta,
  activityKindTone,
  filterActivityItems,
} from '../classicActivity';
import {
  formatActivityMeta,
  formatActivityStamp,
  groupActivityByDay,
} from '../classicExperimentDetailsHelpers';
import styles from '../SmartPricingClassic.module.css';

export default function ClassicActivityTab({ activity }) {
  const [filter, setFilter] = useState('all');
  const items = Array.isArray(activity) ? activity : [];
  const counts = useMemo(() => activityFilterCounts(items), [items]);
  const visible = useMemo(() => filterActivityItems(items, filter), [items, filter]);
  const groups = useMemo(() => groupActivityByDay(visible), [visible]);
  const filters = ACTIVITY_FILTERS.filter(row => row.id === 'all' || counts[row.id] > 0);

  useEffect(() => {
    if (filter !== 'all' && !counts[filter]) setFilter('all');
  }, [filter, counts]);

  if (!items.length) {
    return (
      <div className={styles.statCard}>
        <h3 className={styles.panelTitle}>Activity history</h3>
        <p className={styles.help}>
          Launch, pause, resume, Self-QA, audience changes, guardrail stops, and winner rollout
          will appear here as the experiment progresses.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.statCard}>
      <div className={styles.activityHead}>
        <div>
          <h3 className={styles.panelTitle}>Activity history</h3>
          <p className={styles.help}>
            {counts.all} event{counts.all === 1 ? '' : 's'}
            {counts.qa ? ` · ${counts.qa} Self-QA` : ''}
            {counts.changes ? ` · ${counts.changes} change${counts.changes === 1 ? '' : 's'}` : ''}
          </p>
        </div>
      </div>
      {filters.length > 1 ? (
        <div className={`${styles.pillRow} ${styles.activityFilterRow}`} role="group" aria-label="Activity filters">
          {filters.map(row => {
            const active = filter === row.id;
            const count = counts[row.id] || 0;
            return (
              <button
                key={row.id}
                type="button"
                aria-pressed={active}
                className={`${styles.pill} ${active ? styles.pillActive : ''}`}
                onClick={() => setFilter(row.id)}
              >
                {row.label}
                <span className={styles.activityFilterCount}>{count}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {visible.length ? (
        <div className={styles.activityGroups}>
          {groups.map(group => (
            <section key={group.day}>
              <h4 className={styles.activityDayLabel}>{group.day}</h4>
              <ol className={styles.activityTimeline}>
                {group.items.map((item, index) => {
                  const tone = activityKindTone(item);
                  const kindLabel = activityKindMeta(item.kind).label;
                  return (
                    <li
                      key={`${item.id}-${item.at}`}
                      className={`${styles.activityTimelineItem} ${
                        index === group.items.length - 1 ? styles.activityTimelineItemLast : ''
                      }`}
                    >
                      <span
                        className={`${styles.activityDot} ${styles[`activityDot_${tone}`] || ''}`}
                        aria-hidden
                      />
                      <div className={styles.activityCard}>
                        <div className={styles.activityCardHead}>
                          <strong className={styles.activityTitle}>{item.title}</strong>
                          <span className={styles.activityKindBadge}>{kindLabel}</span>
                        </div>
                        <div className={styles.activityWhen} title={formatActivityStamp(item.at)}>
                          {formatActivityMeta(item)}
                        </div>
                        {item.detail ? <p className={styles.help}>{item.detail}</p> : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      ) : (
        <p className={styles.help}>No events in this filter.</p>
      )}
    </div>
  );
}
