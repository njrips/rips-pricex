import { useState } from 'react';
import { BlockStack, Modal, Text } from '@shopify/polaris';
import { getDocsSection } from '../public/priceify/docsContent';
import SettingsGuideBody from './SettingsGuideBody';
import TooltipWrapper from '../shared/TooltipWrapper';
import { IconInfo } from '../SmartPricing/classic/classicIcons';
import styles from '../SmartPricing/classic/SmartPricingClassic.module.css';
import { openPublicDocsHref, publicDocsHref } from './settingsGuideLinks';

/**
 * The info icon beside a setting, answering at two depths.
 *
 * Hovering shows the guide's own one-paragraph summary, which is what settings
 * pages used to print underneath every field. Clicking still opens the full
 * guide. The summary is not duplicated here: it comes from the same docs
 * section the modal renders, so the short and long answers cannot drift.
 */
export default function SettingsInfoLink({ hash, label }) {
  const href = publicDocsHref(hash);
  const section = getDocsSection(hash);
  const name = label || section?.title || 'Setting';
  const [guideOpen, setGuideOpen] = useState(false);

  return (
    <>
      <span className={styles.infoIconWrap}>
        <TooltipWrapper content={section?.summary || section?.title || null}>
          <button
            type="button"
            className={styles.infoIconLink}
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
        </TooltipWrapper>
      </span>
      {guideOpen ? (
        <Modal
          open
          onClose={() => setGuideOpen(false)}
          title={section?.title || `${name} guide`}
          secondaryActions={[{ content: 'Close', onAction: () => setGuideOpen(false) }]}
        >
          <Modal.Section>
            <BlockStack gap="300">
              {section ? <SettingsGuideBody section={section} /> : null}
              {section ? null : (
                <Text as="p" variant="bodyMd">
                  Open the full Priceify guide for this setting.
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
