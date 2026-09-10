import { useState } from 'react';
import { BlockStack, Button, Collapsible, InlineStack, Text } from '@shopify/polaris';

/**
 * A guide section rendered for Admin: the answer to "what does this setting do
 * again?", which is usually the summary and the facts strip rather than the
 * full guide. Sections carrying a summary show it with the prose folded away —
 * several run past 3,500 characters, and neither a modal nor a search result is
 * a good place to meet that. Sections without one are short enough to show
 * whole.
 *
 * Shared by the Settings info-icon modal and Help search so a setting reads the
 * same wherever a merchant finds it.
 *
 * @param {{ section: object, idPrefix?: string }} props
 */
export default function SettingsGuideBody({ section, idPrefix = 'settings-guide' }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const paragraphs = section?.paragraphs || [];
  const facts = Array.isArray(section?.facts) ? section.facts : [];
  // Scoped to the section: Help renders several of these on one page, and a
  // repeated aria-controls target would point every button at the first panel.
  const detailId = `${idPrefix}-detail-${section?.id || 'section'}`;

  if (!section?.summary) {
    return (
      <BlockStack gap="300">
        {paragraphs.map(paragraph => (
          <Text as="p" key={paragraph} variant="bodyMd">
            {paragraph}
          </Text>
        ))}
      </BlockStack>
    );
  }

  return (
    <BlockStack gap="300">
      <Text as="p" variant="bodyMd" fontWeight="medium">
        {section.summary}
      </Text>
      {facts.length ? (
        <BlockStack gap="150">
          {facts.map(fact => (
            <InlineStack key={fact.label} gap="200" wrap={false} align="start">
              <Text as="span" variant="bodySm" tone="subdued">
                {fact.label}
              </Text>
              <Text as="span" variant="bodySm">
                {fact.value}
              </Text>
            </InlineStack>
          ))}
        </BlockStack>
      ) : null}
      <div>
        <Button
          variant="plain"
          disclosure={detailOpen ? 'up' : 'down'}
          onClick={() => setDetailOpen(prev => !prev)}
          ariaExpanded={detailOpen}
          ariaControls={detailId}
        >
          {detailOpen ? 'Hide full explanation' : 'Read the full explanation'}
        </Button>
      </div>
      <Collapsible open={detailOpen} id={detailId}>
        <BlockStack gap="300">
          {paragraphs.map(paragraph => (
            <Text as="p" key={paragraph} variant="bodyMd">
              {paragraph}
            </Text>
          ))}
        </BlockStack>
      </Collapsible>
    </BlockStack>
  );
}
