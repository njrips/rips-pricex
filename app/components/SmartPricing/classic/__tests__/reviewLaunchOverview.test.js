import { describe, expect, it } from 'vitest';
import {
  buildReviewSections,
  formatReviewPricingModeLabel,
  resolveReviewPricingSummaryText,
} from '../reviewLaunchOverview';

const VARIATIONS = [
  { id: 'control', name: 'Control', traffic: 34 },
  { id: 'var_a', name: 'Var A', letter: 'A', traffic: 33 },
  { id: 'var_b', name: 'Var B', letter: 'B', traffic: 33 },
];

describe('resolveReviewPricingSummaryText', () => {
  it('matches overview pricing strings for price tests', () => {
    expect(
      resolveReviewPricingSummaryText({ isOfferTest: false, priceMode: 'ai', variations: [] }),
    ).toBe('AI suggested prices');
    expect(
      resolveReviewPricingSummaryText({ isOfferTest: true, priceMode: 'ai', variations: [] }),
    ).toBe('Offers per variation');
  });
});

describe('formatReviewPricingModeLabel', () => {
  it('matches the Step 5 pricing strings', () => {
    expect(formatReviewPricingModeLabel('ai')).toBe('AI suggested prices');
    expect(formatReviewPricingModeLabel('bulk')).toBe('Bulk adjusted prices');
    expect(formatReviewPricingModeLabel('manual')).toBe('Manual prices');
  });
});

/** { sectionId: { rowLabel: value } } */
function bySection(input) {
  return Object.fromEntries(
    buildReviewSections(input).map(section => [
      section.id,
      Object.fromEntries(section.rows.map(row => [row.label, row.value])),
    ]),
  );
}

describe('buildReviewSections', () => {
  it('breaks the summary into the five Step 5 sections', () => {
    const sections = buildReviewSections({
      name: 'Growth Plan',
      experimentType: 'price_test',
      experimentTypeLabel: 'Price test',
      selectedCount: 7,
      pickMode: 'manual',
      priceMode: 'ai',
      variations: VARIATIONS,
      audience: {
        segment: 'all_visitors',
        trafficAllocation: 100,
        primaryMetric: 'revenue_per_visitor',
        minSampleSize: '5000',
        guardrails: [{ id: 'revenue', threshold: '-10%', on: true }],
        devices: [],
        sources: [],
      },
      significanceEstimate: { confidenceLevel: 90 },
    });

    expect(sections.map(section => section.title)).toEqual([
      'Basics',
      'Products & prices',
      'Variations & traffic',
      'Audience',
      'Metrics & guardrail',
    ]);
    const rows = Object.fromEntries(
      sections.map(section => [
        section.id,
        section.rows.map(row => `${row.label}: ${row.value}`),
      ]),
    );
    expect(rows.basics).toEqual(['Test name: Growth Plan', 'Test type: Price test']);
    expect(rows.products).toEqual([
      'Products: 7 products',
      'Selection: Picked products',
      'Prices: AI suggested prices',
    ]);
    expect(rows.variations).toEqual([
      'Traffic allocation: 100% of eligible visitors',
      'Traffic split: Control 34% · Var A 33% · Var B 33%',
    ]);
    expect(rows.audience).toEqual([
      'Audience segment: All visitors',
      'Device type: All devices',
      'Traffic source: All sources',
      'Countries: All countries',
    ]);
    expect(rows.metrics).toEqual([
      'Primary success metric: Revenue per visitor',
      'Confidence level: 90%',
      'Minimum visitors per variation: 5,000',
      'Revenue guardrail: On · Stop testing a product if revenue per visitor for any variation drops more than 10% below the control, after 5,000 visitors per variation',
    ]);
  });

  it('lists the standard secondary metrics, and nothing launch would drop', () => {
    const { metrics } = bySection({
      name: 'Secondaries',
      variations: VARIATIONS,
      audience: {
        primaryMetric: 'revenue_per_visitor',
        secondaryMetrics: ['conversion_rate', 'revenue_per_visitor', 'bounce_rate', 'aov'],
        minSampleSize: '5000',
      },
    });
    expect(metrics['Secondary metrics']).toBe('Conversion rate, Average order value');
  });

  it('uses All products scope and says Off for a disarmed guardrail', () => {
    const { products, audience, metrics } = bySection({
      name: 'Catalog',
      pickMode: 'all',
      selectedCount: 120,
      priceMode: 'manual',
      variations: [{ id: 'control', traffic: 100 }],
      audience: {
        segment: 'new_visitors',
        guardrails: [{ id: 'revenue', on: false }],
        minSampleSize: '1000',
        primaryMetric: 'conversion_rate',
      },
      significanceEstimate: { confidenceLevel: 95 },
    });

    expect(products).toEqual({
      Products: '120 products',
      Selection: 'All products',
      Prices: 'Manual prices',
    });
    expect(audience['Audience segment']).toBe('New visitors');
    expect(metrics['Primary success metric']).toBe('Conversion rate');
    expect(metrics['Confidence level']).toBe('95%');
    expect(metrics['Revenue guardrail']).toBe('Off');
  });

  it('starts the guardrail at its own floor when the minimum is lower, and at the minimum when higher', () => {
    const low = bySection({
      audience: { minSampleSize: '1000', guardrails: [{ id: 'revenue', on: true, threshold: '-15%' }] },
    });
    expect(low.metrics['Minimum visitors per variation']).toBe('1,000');
    expect(low.metrics['Revenue guardrail']).toMatch(/more than 15% below the control, after 5,000 visitors per variation$/);

    const high = bySection({ audience: { minSampleSize: '8000' } });
    expect(high.metrics['Revenue guardrail']).toMatch(/after 8,000 visitors per variation$/);
  });

  it('uses Var labels and partial audience filters', () => {
    const { variations, audience, metrics } = bySection({
      name: 'UK push',
      variations: [
        { id: 'control', name: 'Control', traffic: 50 },
        { id: 'var_a', name: 'Variation A', letter: 'A', traffic: 50 },
      ],
      audience: {
        segment: 'returning',
        devices: ['Mobile'],
        deviceMode: 'include',
        sources: ['Search', 'Email'],
        sourceMode: 'include',
        includeCountries: ['GB'],
        countryMode: 'include',
        primaryMetric: 'aov',
        minSampleSize: '1000',
      },
    });

    expect(variations['Traffic split']).toBe('Control 50% · Var A 50%');
    expect(audience['Audience segment']).toBe('Returning visitors');
    expect(audience['Device type']).toBe('Mobile only');
    expect(audience['Traffic source']).toBe('Search & Email');
    expect(audience.Countries).toContain('Include:');
    expect(metrics['Primary success metric']).toBe('Average order value');
  });

  it('uses bulk mode and mixed per-arm pricing labels', () => {
    const bulkOnly = bySection({
      name: 'Bulk run',
      priceMode: 'bulk',
      variations: [{ id: 'control', traffic: 50 }, { id: 'var_a', traffic: 50 }],
    });
    expect(bulkOnly.products.Prices).toBe('Bulk adjusted prices');

    const mixed = bySection({
      name: 'Mixed',
      priceMode: 'manual',
      variations: [
        { id: 'control', traffic: 34 },
        { id: 'var_a', letter: 'A', traffic: 33 },
        { id: 'var_b', letter: 'B', traffic: 33 },
      ],
      pricingByArm: {
        var_a: { priceMode: 'ai' },
        var_b: { priceMode: 'bulk' },
      },
    });
    expect(mixed.products.Prices).toBe('Mixed pricing per variation');
  });

  it('describes offer tests without price-mode wording', () => {
    const { basics, products } = bySection({
      name: 'Sale test',
      experimentType: 'offer_test',
      experimentTypeLabel: 'Offer test',
      selectedCount: 3,
      pickMode: 'manual',
      variations: [{ id: 'control', traffic: 100 }],
    });
    expect(basics['Test type']).toBe('Offer test');
    expect(products).toEqual({
      Products: '3 products',
      Selection: 'Picked products',
      Offers: 'Offers per variation',
    });
  });

  it('reads "1 product" for a single-product test and names an untitled test', () => {
    const { basics, products } = bySection({ selectedCount: 1 });
    expect(products.Products).toBe('1 product');
    expect(basics['Test name']).toBe('Untitled test');
  });
});
