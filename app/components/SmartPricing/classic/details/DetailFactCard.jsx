import { Button } from '@shopify/polaris';
import styles from '../SmartPricingClassic.module.css';

/**
 * One fact about how an experiment is configured: what it is, what it is set
 * to, and the way to change it.
 *
 * Shared by the Audience, Metrics, and Settings tabs, which each kept their own
 * copy of this markup and had started to drift apart.
 */
export default function DetailFactCard({
  label,
  value,
  note = null,
  action = null,
  actionLabel = null,
  onAction = null,
  children = null,
}) {
  return (
    <div className={`${styles.statCard} ${styles.detailFactCard}`}>
      <div className={styles.detailFactHead}>
        <div className={styles.statLabel}>{label}</div>
        {action && onAction ? (
          <Button variant="plain" accessibilityLabel={actionLabel || action} onClick={onAction}>
            {action}
          </Button>
        ) : null}
      </div>
      <div>
        {children || <div className={styles.statValue}>{value}</div>}
        {note ? <p className={`${styles.help} ${styles.detailFactNote}`}>{note}</p> : null}
      </div>
    </div>
  );
}
