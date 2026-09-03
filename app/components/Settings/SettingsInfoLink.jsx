import { useState } from 'react';
import { BlockStack, Modal, Text } from '@shopify/polaris';
import { getDocsSection } from '../public/pricify/docsContent';
import { IconInfo } from '../SmartPricing/classic/classicIcons';
import styles from '../SmartPricing/classic/SmartPricingClassic.module.css';
import { openPublicDocsHref, publicDocsHref } from './settingsGuideLinks';

export default function SettingsInfoLink({ hash, label }) {
  const href = publicDocsHref(hash);
  const section = getDocsSection(hash);
  const name = label || section?.title || 'Setting';
  const [guideOpen, setGuideOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={styles.infoIconLink}
        title={`${name} guide`}
        aria-label={`${name} guide`}
        onClick={event => {
          if (typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation();
          } else {
            event.stopPropagation();
          }
          event.preventDefault();
          setGuideOpen(true);
        }}
      >
        <IconInfo size={16} />
      </button>
      {guideOpen ? (
        <Modal
          open
          onClose={() => setGuideOpen(false)}
          title={section?.title || `${name} guide`}
          secondaryActions={[{ content: 'Close', onAction: () => setGuideOpen(false) }]}
        >
          <Modal.Section>
            <BlockStack gap="300">
              {(section?.paragraphs || []).map(paragraph => (
                <Text as="p" key={paragraph} variant="bodyMd">
                  {paragraph}
                </Text>
              ))}
              {section ? null : (
                <Text as="p" variant="bodyMd">
                  Open the full Pricify guide for this setting.
                </Text>
              )}
              <a
                className={styles.guideFullLink}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={event => {
                  if (openPublicDocsHref(href)) {
                    event.preventDefault();
                    setGuideOpen(false);
                  }
                }}
              >
                Open full guide
              </a>
            </BlockStack>
          </Modal.Section>
        </Modal>
      ) : null}
    </>
  );
}
