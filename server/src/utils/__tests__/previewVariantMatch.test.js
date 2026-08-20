const {
  findVariantForPreviewQuery,
  previewLabelEquals,
  stripPricePrefix,
} = require('../previewVariantMatch');

describe('previewVariantMatch', () => {
  const variants = [
    { id: 'ctrl-uuid', name: 'Control', config: { byProduct: {} } },
    { id: 'var-a-uuid', name: 'Variation A', config: { byProduct: { p1: { byVariant: {} } } } },
    {
      id: 'var-b-uuid',
      name: '$79.00 Variation B',
      config: { byProduct: { p1: { byVariant: {} } } },
    },
  ];

  test('stripPricePrefix removes Smart Pricing money prefix', () => {
    expect(stripPricePrefix('$884.94 Variation A')).toBe('Variation A');
    expect(stripPricePrefix('USD 12.50 Warm')).toBe('Warm');
    expect(stripPricePrefix('Control')).toBe('Control');
    expect(stripPricePrefix('10% off Variation A')).toBe('Variation A');
    expect(stripPricePrefix('$5.00 off Variation A')).toBe('Variation A');
  });

  test('previewLabelEquals matches priced ↔ short arm labels', () => {
    expect(previewLabelEquals('$884.94 Variation A', 'Variation A')).toBe(true);
    expect(previewLabelEquals('Variation A', '$884.94 Variation A')).toBe(true);
    expect(previewLabelEquals('Variation A', 'Variation B')).toBe(false);
  });

  test('findVariantForPreviewQuery prefers variant_id over conflicting variant_name', () => {
    const hit = findVariantForPreviewQuery(variants, {
      variant_id: 'var-b-uuid',
      variant_name: 'Control',
    });
    expect(hit?.id).toBe('var-b-uuid');
  });

  test('findVariantForPreviewQuery matches Classic priced name to short stored name', () => {
    const hit = findVariantForPreviewQuery(variants, {
      variant_name: '$59.00 Variation A',
    });
    expect(hit?.id).toBe('var-a-uuid');
    expect(hit?.name).toBe('Variation A');
  });

  test('findVariantForPreviewQuery matches short name to priced stored name', () => {
    const hit = findVariantForPreviewQuery(variants, {
      variant_name: 'Variation B',
    });
    expect(hit?.id).toBe('var-b-uuid');
  });

  test('does not fall back to Control when name is unmatched', () => {
    const hit = findVariantForPreviewQuery(variants, {
      variant_name: 'Variation Z',
    });
    expect(hit).toBeUndefined();
  });
});
