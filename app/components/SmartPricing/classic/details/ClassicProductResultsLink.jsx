import { Button } from '@shopify/polaris';
import TooltipWrapper from '../../../shared/TooltipWrapper';
import styles from '../SmartPricingClassic.module.css';

export const PRODUCT_RESULTS_HINT = 'Open this product’s full results in this test';

export function productResultsLabel(title) {
  const name = String(title || '').trim();
  return name ? `View results for ${name}` : 'View product results';
}

/**
 * A product's name in a results table. It opens that product's breakdown, so
 * it has to look like it does: a plain-text button gave no sign it was a link.
 */
export function ProductResultsTitle({ title, onOpen, className = '' }) {
  if (!onOpen) {
    return <div className={`${styles.productName} ${className}`.trim()}>{title}</div>;
  }
  return (
    <button
      type="button"
      className={`${styles.productResultsTitle} ${className}`.trim()}
      onClick={onOpen}
      title={PRODUCT_RESULTS_HINT}
    >
      {title}
    </button>
  );
}

/** The explicit way in, for merchants who would not think to click a name. */
export function ViewProductResultsButton({ title, onOpen, disabled = false }) {
  if (!onOpen) return null;
  return (
    <TooltipWrapper content={PRODUCT_RESULTS_HINT} preferredPosition="above" hoverDelay={200}>
      <Button
        size="slim"
        onClick={onOpen}
        disabled={disabled}
        accessibilityLabel={productResultsLabel(title)}
      >
        View
      </Button>
    </TooltipWrapper>
  );
}
