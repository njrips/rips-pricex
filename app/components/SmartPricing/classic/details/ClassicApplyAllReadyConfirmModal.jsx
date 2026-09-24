import { useMemo } from 'react';
import { Banner, Modal } from '@shopify/polaris';
import { listActionableRolloutProducts } from '../classicExperimentDetailsHelpers';
import styles from '../SmartPricingClassic.module.css';

/**
 * Confirms bulk apply on Overview and rollout panel — writes catalog prices and
 * stops per-product tests, so merchants see counts before confirming.
 */
export default function ClassicApplyAllReadyConfirmModal({
  open = false,
  summary = null,
  rolloutRows = [],
  applyingAll = false,
  onClose,
  onConfirm,
}) {
  const actionableCount = summary?.actionableTestIds?.length || 0;
  const readyProducts = useMemo(
    () => listActionableRolloutProducts(rolloutRows, summary),
    [rolloutRows, summary]
  );

  if (!open || !actionableCount) return null;

  const priceWriteCount = Number(summary.priceWriteCount) || 0;
  const finishOnlyCount = actionableCount - priceWriteCount;
  const directionalCount = Number(summary.directionalPriceWriteCount) || 0;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Apply ${actionableCount} ready product${actionableCount === 1 ? '' : 's'}?`}
      primaryAction={{
        content: 'Apply them',
        loading: applyingAll,
        onAction: () => {
          onClose?.();
          onConfirm?.(summary.actionableTestIds);
        },
      }}
      secondaryActions={[{ content: 'Cancel', onAction: onClose }]}
    >
      <Modal.Section>
        {readyProducts.length ? (
          <ul className={styles.bulkApplyProductList} aria-label="Ready products">
            {readyProducts.map(item => (
              <li key={String(item.testId)} className={styles.bulkApplyProductRow}>
                {item.imageUrl ? (
                  <img className={styles.tableThumb} src={item.imageUrl} alt="" />
                ) : (
                  <span className={styles.tableThumb} aria-hidden />
                )}
                <span className={styles.bulkApplyProductName} title={item.label}>
                  {item.label}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <p className={styles.help}>
          {priceWriteCount > 0
            ? `${priceWriteCount} product${priceWriteCount === 1 ? '' : 's'} will have a new price written to your Shopify catalog and stop testing.`
            : 'No catalog prices will change.'}
          {finishOnlyCount > 0
            ? ` ${finishOnlyCount} will finish on the price they already have.`
            : ''}
        </p>
        <p className={styles.help}>
          Products still collecting are left running, and anything flagged for attention is skipped.
          Each product is applied on its own, so a failure on one does not stop the others.
        </p>
        {directionalCount > 0 ? (
          <Banner tone="warning">
            {directionalCount === 1
              ? 'One of these prices is ahead on directional evidence only.'
              : `${directionalCount} of these prices are ahead on directional evidence only.`}{' '}
            Their confidence is calculated from an estimate that can read higher than the result
            deserves, which is why Priceify will not apply them on its own. Open a product to see
            which.
          </Banner>
        ) : null}
      </Modal.Section>
    </Modal>
  );
}
