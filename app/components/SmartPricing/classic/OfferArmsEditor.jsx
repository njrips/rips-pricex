import React from 'react';
import { Select, TextField } from '@shopify/polaris';
import {
  EMPTY_OFFER_CONFIG,
  formatOfferRule,
  isActionableOfferConfig,
  normalizeOfferConfig,
} from './offerSelection';
import styles from './SmartPricingClassic.module.css';

const TYPE_OPTIONS = [
  { label: 'Percentage off', value: 'percent' },
  { label: 'Fixed amount off', value: 'fixed' },
];

function currencyPrefix(currency = 'USD') {
  try {
    const part = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
    })
      .formatToParts(0)
      .find(item => item.type === 'currency');
    return part?.value || '$';
  } catch {
    return '$';
  }
}

export default function OfferArmsEditor({
  variations = [],
  offerByArm = {},
  onChange,
  currency = 'USD',
}) {
  const patchArm = (armId, patch) => {
    const prev = normalizeOfferConfig(offerByArm[armId] || EMPTY_OFFER_CONFIG);
    onChange?.({
      ...offerByArm,
      [armId]: { ...prev, ...patch },
    });
  };

  return (
    <div className={styles.offerArmsStack}>
      <div className={styles.sectionLabel}>Offers for each variation</div>
      <p className={styles.help}>
        Control stays at the catalog price with no discount. Each test variation applies one offer
        to every selected product. The message always appears under the product price for that
        variation. If you leave it empty, shoppers still see the offer amount under the price.
      </p>
      {(variations || []).map((arm, index) => {
        const isControl = index === 0 || arm.id === 'control';
        const cfg = normalizeOfferConfig(offerByArm[arm.id] || EMPTY_OFFER_CONFIG);
        const ready = !isControl && isActionableOfferConfig(cfg);
        return (
          <div key={arm.id} className={styles.offerArmCard}>
            <div className={styles.offerArmHead}>
              <span className={styles.segmentLetter}>{arm.letter || String.fromCharCode(65 + index)}</span>
              <strong>{arm.name || (isControl ? 'Control' : `Variation ${index}`)}</strong>
              <span className={styles.offerArmMeta}>
                {isControl
                  ? 'No offer (baseline)'
                  : ready
                    ? formatOfferRule(cfg, currency)
                    : 'Needs an offer'}
              </span>
            </div>
            {isControl ? (
              <p className={styles.help}>Keep control clean so you can measure the offer against catalog price.</p>
            ) : (
              <div className={styles.offerArmFields}>
                <Select
                  label="Offer type"
                  options={TYPE_OPTIONS}
                  value={cfg.discount_type}
                  onChange={value => patchArm(arm.id, { discount_type: value })}
                />
                <TextField
                  label="Value"
                  type="number"
                  min={cfg.discount_type === 'percent' ? 0.01 : 0.01}
                  max={cfg.discount_type === 'percent' ? 100 : undefined}
                  step={cfg.discount_type === 'percent' ? '1' : '0.01'}
                  value={String(cfg.discount_value ?? '')}
                  onChange={value => patchArm(arm.id, { discount_value: value })}
                  autoComplete="off"
                  prefix={cfg.discount_type === 'fixed' ? currencyPrefix(currency) : undefined}
                  suffix={cfg.discount_type === 'percent' ? '%' : undefined}
                  helpText={
                    cfg.discount_type === 'percent'
                      ? 'Percent off the selected products (1–100).'
                      : 'Amount off each selected product, in store currency.'
                  }
                />
                <TextField
                  label="Message (optional)"
                  value={cfg.offer_message}
                  onChange={value => patchArm(arm.id, { offer_message: value })}
                  autoComplete="off"
                  maxLength={120}
                  showCharacterCount
                  placeholder="e.g. Limited-time 10% off"
                  helpText="Shown under the product price (and on cart) when this variation is assigned. Leave empty to show the offer amount only."
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
