import React from 'react';
import { Banner, BlockStack, Modal, Text } from '@shopify/polaris';

export default function WinnerApplyModal({
  open,
  plan,
  preview,
  loadingPreview = false,
  applying = false,
  onClose,
  onConfirm,
}) {
  const publish = preview?.publish || preview?.data?.publish || null;
  const summary = publish?.summary || {};
  const wouldUpdate = Number(summary.would_update_count ?? summary.updated_count) || 0;
  const skipped = Number(summary.skipped_count) || 0;
  const scannedVariants = Number(summary.variants_scanned) || 0;
  const scannedProducts = Number(summary.products_scanned) || 0;
  const winnerName =
    preview?.winner_variant_name ||
    preview?.data?.winner_variant_name ||
    publish?.winner_variant_name ||
    'Selected winner';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={plan ? `Apply winner — ${plan.title}` : 'Apply winner'}
      primaryAction={{
        content: 'Apply winner to Shopify',
        onAction: onConfirm,
        loading: applying,
        disabled: loadingPreview || !preview,
      }}
      secondaryActions={[{ content: 'Cancel', onAction: onClose }]}
    >
      <Modal.Section>
        <BlockStack gap="300">
          <Text as="p" tone="subdued">
            Personalizes traffic to the winning price and updates Shopify variant prices where
            needed.
          </Text>

          {loadingPreview && (
            <Text as="p" tone="subdued">
              Loading winner preview…
            </Text>
          )}

          {!loadingPreview && preview && (
            <>
              <Banner tone="info">
                <p>
                  Winner variant: <strong>{winnerName}</strong>
                </p>
              </Banner>

              {scannedProducts > 0 && (
                <Text as="p" tone="subdued">
                  Scanned {scannedProducts} product{scannedProducts === 1 ? '' : 's'} ·{' '}
                  {scannedVariants} variant{scannedVariants === 1 ? '' : 's'}
                </Text>
              )}

              <Text as="p">
                {wouldUpdate > 0
                  ? `${wouldUpdate} Shopify variant price${wouldUpdate === 1 ? '' : 's'} will be updated.`
                  : 'Shopify prices appear already in sync with the winner.'}
                {skipped > 0 ? ` ${skipped} variant${skipped === 1 ? '' : 's'} skipped.` : ''}
              </Text>
            </>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
