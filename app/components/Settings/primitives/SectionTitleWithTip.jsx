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
        <button type="button" className={styles.sectionHeaderTitleTip} aria-label={tip}>
          <Icon source={InfoIcon} />
        </button>
      </Tooltip>
    </div>
  );
}
