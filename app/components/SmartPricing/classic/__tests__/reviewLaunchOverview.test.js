import { describe, expect, it } from 'vitest';
import {
  buildReviewOverviewLines,
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

describe('buildReviewOverviewLines', () => {
  it('formats the five overview lines from the Step 5 spec', () => {
    const lines = buildReviewOverviewLines({
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

    expect(lines.test).toBe(
      'Growth Plan — Price test · 7 products · Picked products · AI suggested prices',
    );
    expect(lines.traffic).toBe(
      '100% of eligible visitors · Control 34% · Var A 33% · Var B 33%',
    );
    expect(lines.audience).toBe(
      'All visitors · All devices · All sources · All countries',
    );
    expect(lines.results).toBe(
      'Primary: Revenue per visitor · 90% confidence · 5,000 visitors/variation',
    );
    expect(lines.safety).toMatch(/^Guardrail ON · Pause if Rev\/visitor drops >10%/);
  });

  it('uses All products scope and guardrail off copy', () => {
    const lines = buildReviewOverviewLines({
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

    expect(lines.test).toContain('120 products · All products · Manual prices');
    expect(lines.audience).toContain('New visitors');
    expect(lines.results).toContain('Conversion rate');
    expect(lines.safety).toBe('Guardrail OFF');
  });

  it('uses Var labels and partial audience filters in the overview', () => {
    const lines = buildReviewOverviewLines({
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
        guardrails: [{ id: 'revenue', on: true, threshold: '-15%' }],
      },
      significanceEstimate: { confidenceLevel: 90 },
    });

    expect(lines.traffic).toContain('Control 50% · Var A 50%');
    expect(lines.audience).toContain('Returning visitors · Mobile only · Search & Email');
    expect(lines.audience).toContain('Include:');
    expect(lines.results).toContain('Average order value');
  });

  it('uses bulk mode and mixed per-arm pricing labels', () => {
    const bulkOnly = buildReviewOverviewLines({
      name: 'Bulk run',
      priceMode: 'bulk',
      variations: [{ id: 'control', traffic: 50 }, { id: 'var_a', traffic: 50 }],
      audience: { primaryMetric: 'revenue_per_visitor', minSampleSize: '1000' },
    });
    expect(bulkOnly.test).toContain('Bulk adjusted prices');

    const mixed = buildReviewOverviewLines({
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
      audience: { primaryMetric: 'revenue_per_visitor', minSampleSize: '1000' },
    });
    expect(mixed.test).toContain('Mixed pricing per variation');
  });

  it('describes offer tests without price-mode wording', () => {
    const lines = buildReviewOverviewLines({
      name: 'Sale test',
      experimentType: 'offer_test',
      experimentTypeLabel: 'Offer test',
      selectedCount: 3,
      pickMode: 'manual',
      variations: [{ id: 'control', traffic: 100 }],
      audience: { primaryMetric: 'revenue_per_visitor', minSampleSize: '500' },
    });
    expect(lines.test).toBe(
      'Sale test — Offer test · 3 products · Picked products · Offers per variation',
    );
  });
});
