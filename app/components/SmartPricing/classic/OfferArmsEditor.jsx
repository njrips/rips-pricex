import { Select, TextField } from '@shopify/polaris';
import LabelWithInfo from '../../Settings/primitives/LabelWithInfo';
import {
  capOfferMessageLength,
  EMPTY_OFFER_CONFIG,
  formatOfferRule,
  isActionableOfferConfig,
  normalizeOfferConfig,
  trimOfferMessageForSave,
} from './offerSelection';
import TooltipWrapper from '../../shared/TooltipWrapper';
import { IconControlBaseline, IconInfo } from './classicIcons';
import styles from './SmartPricingClassic.module.css';

const OFFER_MESSAGE_TOOLTIP =
  'Shown under the sale cutout (and on cart) when this variation is assigned. Spaces and punctuation are kept while you type; leading and trailing spaces are removed when you leave the field. Leave empty to show the offer amount only.';

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
  const patchArm = (armId, patch, { finalizeMessage = false } = {}) => {
    const prev = offerByArm[armId] || EMPTY_OFFER_CONFIG;
    let offerMessage = prev.offer_message ?? '';
    if (Object.prototype.hasOwnProperty.call(patch, 'offer_message')) {
      offerMessage = finalizeMessage
        ? trimOfferMessageForSave(patch.offer_message)
        : capOfferMessageLength(patch.offer_message);
    }
    const merged = { ...prev, ...patch, offer_message: offerMessage };
    const next = { ...normalizeOfferConfig(merged), offer_message: offerMessage };
    onChange?.({
      ...offerByArm,
      [armId]: next,
    });
  };

  return (
    <div className={styles.offerArmsStack}>
      <LabelWithInfo hash="offers" label="Offers for each variation">
        Offers for each variation
      </LabelWithInfo>
      {(variations || []).map((arm, index) => {
        const isControl = index === 0 || arm.id === 'control';
        const stored = offerByArm[arm.id] || EMPTY_OFFER_CONFIG;
        const cfg = normalizeOfferConfig(stored);
        const messageDraft = capOfferMessageLength(stored.offer_message ?? '');
        const ready = !isControl && isActionableOfferConfig(cfg);
        return (
          <div key={arm.id} className={styles.offerArmCard}>
            <div className={styles.offerArmHead}>
              <span
                className={`${styles.segmentLetter} ${
                  isControl ? styles.controlVariationMarker : ''
                }`}
                aria-label={isControl ? 'Control — current catalog baseline' : `Variation ${arm.letter}`}
              >
                {isControl ? (
                  <IconControlBaseline size={12} />
                ) : (
                  arm.letter || String.fromCharCode(64 + index)
                )}
              </span>
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
                <div>
                  <div className={styles.titleWithInfo}>
                    <label className={styles.label} htmlFor={`offer-message-${arm.id}`}>
                      Message (optional)
                    </label>
                    <TooltipWrapper
                      content={OFFER_MESSAGE_TOOLTIP}
                      accessibilityLabel="Offer message details"
                    >
                      <button
                        type="button"
                        className={styles.infoIconLink}
                        aria-label="Offer message details"
                      >
                        <IconInfo size={14} />
                      </button>
                    </TooltipWrapper>
                  </div>
                  <TextField
                    id={`offer-message-${arm.id}`}
                    label="Message (optional)"
                    labelHidden
                    value={messageDraft}
                    onChange={value => patchArm(arm.id, { offer_message: value })}
                    onBlur={() =>
                      patchArm(arm.id, { offer_message: messageDraft }, { finalizeMessage: true })
                    }
                    autoComplete="off"
                    maxLength={120}
                    showCharacterCount
                    placeholder="e.g. Limited-time 10% off"
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
