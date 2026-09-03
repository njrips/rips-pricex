import { useId } from 'react';
import { Form, useActionData, useNavigation } from 'react-router';
import { useKeyedState } from '../../hooks/useKeyedState';
import { IconArrowRight } from '../SmartPricing/classic/classicIcons';
import {
  coerceShopifyShopInput,
  describeShopOpenError,
  isShopifyStoreDomain,
  shopOpenPreview,
  toShopifyShopHandleField,
} from '../../utils/shopifyAdmin';
import styles from '../public/publicStyles';

export default function PublicShopOpenForm({
  action = '/',
  initialError = '',
  title = 'Open in Shopify Admin',
}) {
  const fieldId = useId();
  const actionData = useActionData();
  const navigation = useNavigation();
  const submitting = navigation.state === 'submitting';
  // The field shows what the server echoed back until the visitor types over
  // it. Keying the typed value to the echo means a new echo wins automatically,
  // while an action that returns no shop leaves what they were typing alone.
  const echoedShop = toShopifyShopHandleField(actionData?.shop || '');
  const [typedShop, setTypedShop] = useKeyedState(echoedShop, null);
  const shop = typedShop === null ? echoedShop : typedShop;

  // Keyed on the result itself, so resubmitting and getting the same message
  // shows it again instead of staying dismissed.
  const [error, setError] = useKeyedState(
    actionData,
    () => actionData?.errors?.shop || initialError || ''
  );

  const preview = shopOpenPreview(shop);
  const helpId = `${fieldId}-help`;
  const errorId = `${fieldId}-error`;

  const onShopChange = (event) => {
    const next = event.currentTarget.value;
    const coerced = coerceShopifyShopInput(next);
    if (
      isShopifyStoreDomain(coerced) &&
      (next.includes('/') || /admin\.shopify\.com/i.test(next) || /\.myshopify\.com/i.test(next))
    ) {
      setTypedShop(toShopifyShopHandleField(coerced));
    } else {
      setTypedShop(next.replace(/^\s+/, ''));
    }
    if (error) setError('');
  };

  const onSubmit = (event) => {
    const form = event.currentTarget;
    const field = form.elements.namedItem('shop');
    if (!(field instanceof HTMLInputElement)) return;
    const normalized = coerceShopifyShopInput(field.value);
    if (!isShopifyStoreDomain(normalized)) {
      event.preventDefault();
      setError(describeShopOpenError(field.value));
      return;
    }
    field.value = normalized;
    setTypedShop(toShopifyShopHandleField(normalized));
    setError('');
  };

  return (
    <div className={styles.panel}>
      <p className={styles.panelTitle}>{title}</p>
      <Form className={styles.form} method="post" action={action} onSubmit={onSubmit}>
        <label className={styles.label} htmlFor={fieldId}>
          Shop handle
        </label>
        <div className={styles.row}>
          <div
            className={`${styles.inputWrap} ${error ? styles.inputWrapInvalid : ''}`}
          >
            <input
              id={fieldId}
              className={styles.input}
              type="text"
              name="shop"
              value={shop}
              autoComplete="organization"
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              inputMode="text"
              placeholder="your-store"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : helpId}
              onChange={onShopChange}
            />
            <span className={styles.suffix} aria-hidden>
              .myshopify.com
            </span>
          </div>
          <button className={styles.primaryBtn} type="submit" disabled={submitting}>
            {submitting ? 'Opening…' : 'Open in Admin'}
            {submitting ? null : <IconArrowRight />}
          </button>
        </div>
        {error ? (
          <p id={errorId} className={styles.error} role="alert">
            {error}
          </p>
        ) : preview ? (
          <p id={helpId} className={styles.preview}>
            Opens <strong>{preview}</strong> in Shopify Admin.
          </p>
        ) : (
          <p id={helpId} className={styles.help}>
            Shopify install links already include your shop and skip this step. A
            handle or an Admin URL like <strong>admin.shopify.com/store/your-store</strong>{' '}
            is enough.
          </p>
        )}
      </Form>
    </div>
  );
}
