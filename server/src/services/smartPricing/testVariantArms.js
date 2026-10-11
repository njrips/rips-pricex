/**
 * Reading a price test's arms back out of its variants.
 *
 * Plain functions with no requires, so the inbox store can use them: the
 * analytics service that also needs them requires the inbox store, and a
 * require in the other direction would be a cycle.
 */

function variantFixedPrice(variant = {}) {
  const cfg = variant.config && typeof variant.config === 'object' ? variant.config : {};
  if (cfg.price !== undefined && cfg.price !== null && String(cfg.price).trim() !== '') {
    return Number(cfg.price);
  }
  const byProduct = cfg.byProduct;
  if (byProduct && typeof byProduct === 'object') {
    for (const productCfg of Object.values(byProduct)) {
      const byVariant =
        productCfg?.byVariant && typeof productCfg.byVariant === 'object'
          ? productCfg.byVariant
          : null;
      if (!byVariant) {
        continue;
      }
      for (const variantCfg of Object.values(byVariant)) {
        if (
          variantCfg?.price !== undefined &&
          variantCfg?.price !== null &&
          String(variantCfg.price).trim() !== ''
        ) {
          return Number(variantCfg.price);
        }
      }
    }
  }
  return null;
}

function synthesizeArmsFromTestVariants(testVariants = []) {
  return (Array.isArray(testVariants) ? testVariants : []).map((variant, index) => {
    const price = variantFixedPrice(variant);
    const name = String(variant?.name || `Variant ${index + 1}`).trim();
    const role =
      index === 0 || /^control\b/i.test(name) || /\bcontrol\b/i.test(name)
        ? 'control'
        : 'challenger';
    return {
      id: variant?.id || `variant_${index}`,
      role,
      label:
        name || (role === 'control' ? 'Control' : `Variation ${String.fromCharCode(65 + index)}`),
      price: Number.isFinite(price) ? price : null,
      allocation_percent: Number(variant?.allocation) || null,
    };
  });
}

const OFFER_DISCOUNT_TYPES = new Set(['percent', 'fixed', 'free_shipping']);

/** The offer a launched variant gives, in the shape plan arms keep it. */
function offerOfTestVariant(variant) {
  const cfg = variant?.config && typeof variant.config === 'object' ? variant.config : {};
  const type = String(cfg.discount_type || '').trim().toLowerCase();
  if (!OFFER_DISCOUNT_TYPES.has(type)) return null;
  const value = Number(cfg.discount_value);
  if (type !== 'free_shipping' && !(Number.isFinite(value) && value > 0)) return null;
  const offer = { discount_type: type, discount_value: type === 'free_shipping' ? null : value };
  const message = String(cfg.offer_message || '').trim();
  if (message) offer.offer_message = message;
  const code = String(cfg.discount_code_name || '').trim();
  if (code) offer.discount_code_name = code;
  return offer;
}

/**
 * Launch names variants after what they give: "$600.00 Control", "15% off
 * Variation A". The plan keeps the price and the offer in their own fields,
 * so the label is the part after, which is what the wizard stored.
 */
function stripLaunchLabelPrefix(label) {
  const text = String(label || '').trim();
  const cleaned = text
    .replace(/^[^\d\s]{0,3}\s?[\d.,]+%?\s+off\s+/i, '')
    .replace(/^free\s+shipping\s+/i, '')
    .replace(/^[^\d\s]?\s?[\d.,]+\s+/, '')
    .trim();
  return cleaned || text;
}

/** Arms for a plan rebuilt from its test. */
function planArmsFromTestVariants(testVariants = []) {
  const variants = Array.isArray(testVariants) ? testVariants : [];
  return synthesizeArmsFromTestVariants(variants).map((arm, index) => {
    const offer = arm.role === 'control' ? null : offerOfTestVariant(variants[index]);
    return {
      ...arm,
      label: stripLaunchLabelPrefix(arm.label),
      ...(offer ? { offer } : {}),
    };
  });
}

/** The price shoppers saw before the test: the control arm's. */
function controlPriceOfArms(arms = []) {
  const control = (Array.isArray(arms) ? arms : []).find(arm => arm?.role === 'control');
  const price = Number(control?.price);
  return Number.isFinite(price) && price > 0 ? price : null;
}

module.exports = {
  variantFixedPrice,
  synthesizeArmsFromTestVariants,
  planArmsFromTestVariants,
  offerOfTestVariant,
  stripLaunchLabelPrefix,
  controlPriceOfArms,
};
