import { useEffect, useState } from 'react';
import { Button } from '@shopify/polaris';
import {
  getRestorableSmartPricingExperiments,
  restoreSmartPricingExperiment,
} from '../../../services/smartPricingApi';
import { IconChevron } from './classicIcons';
import styles from './SmartPricingClassic.module.css';

function formatDay(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function describeRestorableExperiment(item) {
  const count = Number(item?.product_count) || 0;
  const parts = [`${count} product${count === 1 ? '' : 's'}`];
  const deleted = formatDay(item?.deleted_at);
  if (deleted) parts.push(`deleted ${deleted}`);
  const erased = formatDay(item?.purge_after);
  if (erased) parts.push(`erased for good ${erased}`);
  return parts.join(' · ');
}

/**
 * Deleted experiments that can still be brought back.
 *
 * Delete waits out a grace period before anything is erased, and this is the
 * way back during it. Hidden when there is nothing to restore, and collapsed
 * otherwise: it is a safety net, not part of the everyday list.
 *
 * @param {{ shopDomain: string, refreshKey: number,
 *   onRestored: () => Promise<void> | void,
 *   onMessage: (message: { type?: string, text: string }) => void }} props
 */
export default function ClassicRecentlyDeleted({ shopDomain, refreshKey, onRestored, onMessage }) {
  const [items, setItems] = useState([]);
  const [graceDays, setGraceDays] = useState(7);
  const [open, setOpen] = useState(false);
  const [busyKey, setBusyKey] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!shopDomain) return undefined;
    Promise.resolve()
      .then(() => getRestorableSmartPricingExperiments(shopDomain))
      .then(data => {
        if (cancelled) return;
        setItems(Array.isArray(data?.experiments) ? data.experiments : []);
        if (Number(data?.grace_days) > 0) setGraceDays(Number(data.grace_days));
      })
      .catch(() => {
        // An older server without the route, or offline. The section is a
        // convenience; the list itself must not fail over it.
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [shopDomain, refreshKey]);

  if (!items.length) return null;

  const restore = async item => {
    setBusyKey(item.key);
    try {
      await restoreSmartPricingExperiment(shopDomain, {
        experimentId: item.experiment_id || '',
        testIds: item.test_ids || [],
      });
      setItems(current => current.filter(other => other.key !== item.key));
      onMessage?.({
        type: 'success',
        text: `Restored ${item.title}. It is in the Archived tab.`,
      });
      await onRestored?.();
    } catch (err) {
      onMessage?.({
        type: 'error',
        text:
          String(err?.response?.data?.error || '').trim() ||
          "Couldn't restore this test. Check your connection and try again.",
      });
    } finally {
      setBusyKey('');
    }
  };

  return (
    <section className={styles.recentlyDeleted} aria-label="Recently deleted tests">
      <button
        type="button"
        className={styles.recentlyDeletedToggle}
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <span>
          <span className={styles.productName}>Recently deleted ({items.length})</span>
          <span className={styles.productSub}>
            {' '}
            · Restorable for {graceDays} days after deleting, then erased for good
          </span>
        </span>
        <IconChevron up={open} />
      </button>
      {open
        ? items.map(item => (
            <div key={item.key} className={styles.recentlyDeletedRow}>
              <div>
                <div className={styles.productName}>{item.title}</div>
                <div className={styles.productSub}>{describeRestorableExperiment(item)}</div>
              </div>
              <Button
                onClick={() => restore(item)}
                loading={busyKey === item.key}
                disabled={Boolean(busyKey) && busyKey !== item.key}
              >
                Restore
              </Button>
            </div>
          ))
        : null}
    </section>
  );
}
