import { useEffect, useId, useState } from 'react';
import { Form, useActionData, useNavigation } from 'react-router';
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
  autoFocus = false,
  initialError = '',
  title = 'Open in Shopify Admin',
}) {
  const fieldId = useId();
  const actionData = useActionData();
  const navigation = useNavigation();
  const submitting = navigation.state === 'submitting';
  const [shop, setShop] = useState(() => toShopifyShopHandleField(actionData?.shop || ''));
  const [error, setError] = useState(actionData?.errors?.shop || initialError || '');

  useEffect(() => {
    if (actionData?.shop) setShop(toShopifyShopHandleField(actionData.shop));
    if (actionData?.errors?.shop) setError(actionData.errors.shop);
  }, [actionData]);

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
      setShop(toShopifyShopHandleField(coerced));
    } else {
      setShop(next.replace(/^\s+/, ''));
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
    setShop(toShopifyShopHandleField(normalized));
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
              autoFocus={autoFocus}
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
