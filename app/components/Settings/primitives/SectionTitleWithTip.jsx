import React from 'react';
import { Icon, Text, Tooltip } from '@shopify/polaris';
import { InfoIcon } from '@shopify/polaris-icons';
import styles from '../Settings.module.css';

export function SectionTitleWithTip({
  title,
  tip,
  asHeading = 'h2',
  titleClassName,
  variant = 'headingMd',
  fontWeight,
}) {
  return (
    <div className={styles.sectionHeaderTitleRow}>
      <Text variant={variant} as={asHeading} className={titleClassName} fontWeight={fontWeight}>
        {title}
      </Text>
      <Tooltip content={tip}>
        <span className={styles.sectionHeaderTitleTip} tabIndex={0} aria-label={tip}>
          <Icon source={InfoIcon} />
        </span>
      </Tooltip>
    </div>
  );
}
