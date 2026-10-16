import { describe, expect, it } from 'vitest';
import {
  buildDailyChart,
  defaultDailyMetric,
  buildProductArmRows,
  buildProductHistory,
  collectProductWarnings,
  daysBetween,
  describeDecisionProgress,
  formatDaysRunning,
  productCatalogPrice,
  productHeading,
  productVariantLine,
  resolveAdminProductHref,
  resolveArmMetric,
  resolveNeighbourProducts,
  resolveStorefrontLink,
  resolveStorefrontProductHref,
  summarizeProductAnalytics,
  summarizeRounds,
} from '../productDetailReport';

const arms = [
  { arm_id: 'c', role: 'control', label: 'Control', price: 40, visitors: 100, conversions: 4, conversion_rate: 4, revenue_per_visitor: 1.6, avg_order_value: 40, revenue: 160 },
  { arm_id: 'a', role: 'challenger', label: 'Variation A', price: 44, visitors: 100, conversions: 4, conversion_rate: 4, revenue_per_visitor: 1.76, avg_order_value: 44, revenue: 176 },
  { arm_id: 'b', role: 'challenger', label: 'Variation B', price: 36, visitors: 50, conversions: 1, conversion_rate: 2, revenue_per_visitor: 0.72, avg_order_value: 36, revenue: 36 },
];

describe('buildProductArmRows orders and profit', () => {
  it('counts orders apart from buyers, falling back to buyers on an older server', () => {
    const { rows } = buildProductArmRows([
      { arm_id: 'c', role: 'control', conversions: 4, orders: 5, visitors: 10 },
      { arm_id: 'a', role: 'challenger', conversions: 3, visitors: 10 },
    ]);
    expect(rows.map(r => [r.conversions, r.orders])).toEqual([[4, 5], [3, 3]]);
  });

  it('shows profit only when cost of goods makes it differ from revenue, or it is the goal', () => {
    expect(buildProductArmRows(arms).showProfit).toBe(false);
    const withCogs = arms.map(arm => ({ ...arm, profit_per_visitor: arm.revenue_per_visitor * 0.45 }));
    expect(buildProductArmRows(withCogs).showProfit).toBe(true);
    const same = arms.map(arm => ({ ...arm, profit_per_visitor: arm.revenue_per_visitor }));
    expect(buildProductArmRows(same).showProfit).toBe(false);
    expect(buildProductArmRows(same, { primaryMetric: 'profit_per_visitor' }).showProfit).toBe(true);
  });
});

describe('buildProductArmRows traffic and average order', () => {
  const split = [
    { arm_id: 'c', role: 'control', allocation_percent: 34, visitors: 3034, orders: 66, avg_order_value: 100, product_revenue_per_order: 60 },
    { arm_id: 'a', role: 'challenger', allocation_percent: 33, visitors: 2963, orders: 8, avg_order_value: 110, product_revenue_per_order: 130 },
    { arm_id: 'b', role: 'challenger', allocation_percent: 33, visitors: 3003, orders: 0, avg_order_value: null },
  ];

  it('keeps one decimal of share and flags no one while the split passes its check', () => {
    const { rows } = buildProductArmRows(split);
    expect(rows.map(r => r.trafficShare)).toEqual([33.7, 32.9, 33.4]);
    expect(rows.some(r => r.trafficOffPlan)).toBe(false);
  });

  it('flags only the variations visibly off plan once the sample ratio check fails', () => {
    const skewed = split.map((arm, i) => ({ ...arm, visitors: [4000, 2500, 3300][i] }));
    const { rows } = buildProductArmRows(skewed, { srmDetected: true });
    expect(rows.map(r => r.trafficOffPlan)).toEqual([true, true, false]);
  });

  it('compares average order with control, caps the product share at the order, and notes few orders', () => {
    const { rows } = buildProductArmRows(split);
    expect(rows.map(r => r.avgOrderDeltaPercent)).toEqual([null, 10, null]);
    expect(rows.map(r => r.productPerOrder)).toEqual([60, 110, null]);
    expect(rows.map(r => r.fewOrders)).toEqual([false, true, false]);
  });
});

describe('summarizeProductAnalytics orders', () => {
  it('averages revenue over orders, not buyers', () => {
    const stats = summarizeProductAnalytics({ summary: { visitors: 100, conversions: 4, orders: 5, revenue: 500 } });
    expect(stats.orders).toBe(5);
    expect(stats.avgOrderValue).toBe(100);
  });
});

describe('buildProductArmRows prices for offer tests', () => {
  const offerArms = [
    { arm_id: 'c', role: 'control', label: 'Control', price: null, offer: null },
    { arm_id: 'a', role: 'challenger', label: '15% off Variation A', price: null, offer: { discount_type: 'percent', discount_value: 15 } },
    { arm_id: 'b', role: 'challenger', label: 'Variation B', price: null, offer: { discount_type: 'fixed', discount_value: 5 } },
    { arm_id: 's', role: 'challenger', label: 'Variation C', price: null, offer: { discount_type: 'free_shipping', discount_value: null } },
  ];

  it('prices each arm from the catalog price less its offer', () => {
    const { rows } = buildProductArmRows(offerArms, { catalogPrice: 40 });
    expect(rows.map(r => r.price)).toEqual([40, 34, 35, 40]);
    expect(rows.map(r => r.offerText)).toEqual([null, '15% off', '$5.00 off', 'Free shipping']);
    expect(rows[1].label).toBe('Variation A');
    expect(rows.map(r => r.priceDeltaPercent)).toEqual([null, -15, -12.5, 0]);
    expect(rows.every(r => r.priceFromCatalog)).toBe(true);
  });

  it('takes the offer off the catalog price a wizard-built offer arm stores', () => {
    const { rows } = buildProductArmRows([
      { arm_id: 'c', role: 'control', label: 'Control', price: 49 },
      { arm_id: 'a', role: 'challenger', label: 'Variation A', price: 49, offer: { discount_type: 'percent', discount_value: 10 } },
    ]);
    expect(rows.map(r => r.price)).toEqual([49, 44.1]);
    expect(rows[1].priceDeltaPercent).toBe(-10);
    expect(rows[1].priceFromCatalog).toBe(true);
    expect(rows[0].priceFromCatalog).toBe(false);
  });

  it('leaves prices empty without a catalog price, and never overrides an arm that has one', () => {
    expect(buildProductArmRows(offerArms).rows.map(r => r.price)).toEqual([null, null, null, null]);
    const priced = buildProductArmRows(arms, { catalogPrice: 99 }).rows;
    expect(priced.map(r => r.price)).toEqual([40, 44, 36]);
    expect(priced.some(r => r.priceFromCatalog)).toBe(false);
  });
});

describe('buildProductArmRows', () => {
  it('compares each variation with control on price and on the goal', () => {
    const { rows } = buildProductArmRows(arms, { primaryMetric: 'revenue_per_visitor' });
    const [control, a, b] = rows;

    expect(control.isControl).toBe(true);
    expect(control.liftPercent).toBeNull();
    expect(a.priceDeltaPercent).toBe(10);
    expect(a.liftPercent).toBe(10);
    expect(b.priceDeltaPercent).toBe(-10);
    expect(b.liftPercent).toBe(-55);
    expect(a.trafficShare).toBe(40);
  });

  it('marks an early leader only while no winner has been called', () => {
    expect(buildProductArmRows(arms).rows.find(r => r.isLeading)?.key).toBe('a');

    const decided = buildProductArmRows(arms, { winnerArmId: 'b' });
    expect(decided.rows.some(r => r.isLeading)).toBe(false);
    expect(decided.rows.find(r => r.isWinner)?.key).toBe('b');
  });

  it('does not call a tie a lead', () => {
    const tied = buildProductArmRows(arms, { primaryMetric: 'conversion_rate' });
    expect(tied.rows.some(r => r.isLeading)).toBe(false);
  });

  it('gives an unseen variation no reading rather than a zero', () => {
    const { rows } = buildProductArmRows([arms[0], { ...arms[1], visitors: 0 }]);
    expect(rows[1].metricValue).toBeNull();
    expect(rows[1].liftPercent).toBeNull();
    expect(rows.some(r => r.isLeading)).toBe(false);
  });

  it('judges a custom goal on revenue per visitor and says so', () => {
    expect(resolveArmMetric('vip_checkout')).toMatchObject({ key: 'revenuePerVisitor', fallback: true });
    expect(resolveArmMetric('aov')).toMatchObject({ key: 'avgOrderValue', fallback: false });
    expect(resolveArmMetric('')).toMatchObject({ fallback: false });
  });
});

describe('summarizeProductAnalytics', () => {
  it('derives order value from revenue over orders, and counts days run', () => {
    const stats = summarizeProductAnalytics(
      {
        started_at: '2026-09-20T10:00:00Z',
        stopped_at: null,
        arms,
        summary: { visitors: 250, conversions: 9, overall_conversion_rate: 3.6, live_weighted_rpv: 1.49 },
      },
      { now: new Date('2026-10-05T09:00:00Z') }
    );

    expect(stats.revenue).toBe(372);
    expect(stats.avgOrderValue).toBeCloseTo(41.33, 2);
    expect(stats.daysRunning).toBe(14);
  });

  it('leaves money blank when nothing was measured', () => {
    const stats = summarizeProductAnalytics({ summary: { visitors: 10, conversions: 0 }, arms: [] });
    expect(stats.revenue).toBeNull();
    expect(stats.avgOrderValue).toBeNull();
    expect(stats.daysRunning).toBeNull();
  });
});

describe('days running', () => {
  it('counts whole days and reads a fresh test as under a day', () => {
    expect(daysBetween('2026-10-01T00:00:00Z', new Date('2026-10-01T05:00:00Z'))).toBe(0);
    expect(formatDaysRunning(0)).toBe('Under a day');
    expect(formatDaysRunning(1)).toBe('1 day');
    expect(formatDaysRunning(12)).toBe('12 days');
    expect(daysBetween('not a date')).toBeNull();
  });
});

describe('describeDecisionProgress', () => {
  it('names the floor the product is waiting on', () => {
    expect(
      describeDecisionProgress({
        progress: { percent: 40, limited_by: 'conversions', conversions: 12, required_conversions: 30 },
      })
    ).toEqual({ percent: 40, text: '12 of 30 orders in the smallest variation' });
    expect(
      describeDecisionProgress({
        progress: { percent: 55, limited_by: 'visitors', visitors: 550, required_visitors: 1000 },
      }).text
    ).toBe('550 of 1,000 visitors in the smallest variation');
    expect(describeDecisionProgress({ progress: { percent: null } })).toBeNull();
  });
});

describe('collectProductWarnings', () => {
  it('surfaces a split mismatch, a guardrail stop and a profit trap', () => {
    const ids = collectProductWarnings({
      significance: { srm: { detected: true } },
      revenue_guardrail: { enforced: true },
      arms: [{ label: 'Variation A', revenue_trap_live: true }],
    }).map(w => w.id);
    expect(ids).toEqual(['srm', 'guardrail', 'trap']);
    expect(collectProductWarnings({ arms })).toEqual([]);
  });
});

describe('summarizeRounds', () => {
  it('lists what each round tested and what won', () => {
    const [first, second] = summarizeRounds(
      [
        {
          plan_id: 'p1',
          learning_round: 1,
          status: 'applied',
          analytics: { arms, winner_arm_id: 'a', significance: { lift: 10 }, summary: { visitors: 250 } },
        },
        { plan_id: 'p2', learning_round: 2, status: 'running', auto_queued: true, analytics: null },
      ],
      'p2'
    );

    expect(first).toMatchObject({ status: 'Winner applied', prices: [40, 44, 36], winnerLabel: 'Variation A', winnerPrice: 44, liftPercent: 10, isCurrent: false });
    expect(second).toMatchObject({ status: 'Running', isCurrent: true, autoQueued: true, winnerLabel: null });
  });
});

describe('buildProductHistory', () => {
  it('uses merchant wording for who did what', () => {
    const history = buildProductHistory([
      { id: 1, event_type: 'launched', actor: 'merchant', created_at: '2026-10-01T00:00:00Z', payload: {} },
      { id: 2, event_type: 'guardrail_stopped', actor: 'guardrail', created_at: '2026-10-02T00:00:00Z', payload: {} },
      { id: 3, event_type: 'rerun_queued', actor: 'system', created_at: '2026-10-03T00:00:00Z', payload: { follow_up_plan_id: 'SP-9', learning_round: 2 } },
    ]);
    expect(history.map(h => h.actor)).toEqual(['You', 'Revenue guardrail', 'Priceify']);
    expect(history[2].detail).toBe('Round 2 queued, ready to review and launch.');
    expect(history[2].detail).not.toContain('SP-9');
  });
});

describe('product links', () => {
  it('opens the admin product through App Bridge and the store page with its variant', () => {
    expect(resolveAdminProductHref('gid://shopify/Product/123')).toBe('shopify://admin/products/123');
    expect(resolveAdminProductHref(null)).toBeNull();
    expect(
      resolveStorefrontProductHref('demo.myshopify.com', { handle: 'merino-beanie', variantId: 'gid://shopify/ProductVariant/77' })
    ).toBe('https://demo.myshopify.com/products/merino-beanie?variant=77');
    expect(resolveStorefrontProductHref('demo.myshopify.com', { handle: '' })).toBeNull();
  });

  it('links View on store only to a product Shopify serves on the Online Store', () => {
    const args = { handle: 'old-handle', variantId: 'gid://shopify/ProductVariant/77' };
    // The live handle wins: a renamed product has moved.
    expect(
      resolveStorefrontLink('demo.myshopify.com', {
        ...args,
        storefront: { status: 'published', handle: 'new-handle' },
      })
    ).toEqual({ href: 'https://demo.myshopify.com/products/new-handle?variant=77', reason: '' });
    // Shopify could not be asked: the saved handle, as before.
    expect(
      resolveStorefrontLink('demo.myshopify.com', { ...args, storefront: { status: 'unknown' } }).href
    ).toBe('https://demo.myshopify.com/products/old-handle?variant=77');
    for (const status of ['draft', 'archived', 'unpublished', 'missing']) {
      const link = resolveStorefrontLink('demo.myshopify.com', { ...args, storefront: { status } });
      expect(link.href).toBeNull();
      expect(link.reason).toMatch(/no test visitors/);
    }
    expect(
      resolveStorefrontLink('demo.myshopify.com', { ...args, storefront: { status: 'draft' } }).reason
    ).toMatch(/draft in Shopify.*Set it to Active/);
  });
});

describe('buildDailyChart', () => {
  const daily = {
    days: ['2026-10-01', '2026-10-02', '2026-10-03'],
    series: [
      // Out of table order on purpose: the chart follows the table.
      { variant_id: 'v2', points: [{ visitors: 10, conversions: 1, revenue: 44 }, { visitors: 0, conversions: 0, revenue: 0 }, { visitors: 10, conversions: 0, revenue: 0 }] },
      { variant_id: 'v1', points: [{ visitors: 10, conversions: 1, revenue: 40 }, { visitors: 10, conversions: 1, revenue: 40 }, { visitors: 0, conversions: 0, revenue: 0 }] },
    ].map(s => ({ ...s, points: s.points.map((p, i) => ({ ...p, date: `2026-10-0${i + 1}` })) })),
  };
  const { rows } = buildProductArmRows([
    { arm_id: 'c', variant_id: 'v1', role: 'control', label: 'Control', visitors: 20 },
    { arm_id: 'a', variant_id: 'v2', label: 'Variation A', visitors: 20 },
  ]);

  it('runs a cumulative figure per variation, labelled from the table', () => {
    const chart = buildDailyChart(daily, rows, { metric: 'revenue_per_visitor', cumulative: true });
    expect(chart.lines.map(l => l.label)).toEqual(['Control', 'Variation A']);
    expect(chart.lines[0].points.map(p => p.value)).toEqual([4, 4, 4]);
    expect(chart.lines[1].points.map(p => p.value)).toEqual([4.4, 4.4, 2.2]);
  });

  it('leaves a day with no visitors as a gap rather than a zero rate', () => {
    const chart = buildDailyChart(daily, rows, { metric: 'conversion_rate', cumulative: false });
    expect(chart.lines[1].points[1].value).toBeNull();
    expect(chart.lines[0].points[2].value).toBeNull();
    expect(buildDailyChart(daily, rows, { metric: 'visitors', cumulative: false }).lines[1].points[1].value).toBe(0);
  });

  it('defaults to the goal the chart can draw', () => {
    expect(defaultDailyMetric('conversion_rate')).toBe('conversion_rate');
    expect(defaultDailyMetric('aov')).toBe('revenue_per_visitor');
  });

  it('reports no data for an empty series', () => {
    expect(buildDailyChart({ days: [], series: [] }, rows).hasData).toBe(false);
  });
});

describe('resolveNeighbourProducts', () => {
  const list = [{ planId: 'p1' }, { planId: 'p2' }, { planId: 'p3' }];

  it('finds the products either side', () => {
    expect(resolveNeighbourProducts(list, 'p2')).toMatchObject({ previous: { planId: 'p1' }, next: { planId: 'p3' }, position: 2, total: 3 });
    expect(resolveNeighbourProducts(list, 'p1').previous).toBeNull();
  });

  it('offers no paging for a product outside the list, or a list of one', () => {
    expect(resolveNeighbourProducts(list, 'older-round').position).toBeNull();
    expect(resolveNeighbourProducts([{ planId: 'p1' }], 'p1').position).toBeNull();
  });
});

/**
 * The test's name is the page title right above the product view, so the
 * heading repeating it as "Spring sale · Merino Beanie" only pushed the product
 * name off to the right.
 */
describe('productHeading', () => {
  it('drops the test name a plan title starts with', () => {
    expect(productHeading({ title: 'Spring sale · Merino Beanie' })).toBe('Merino Beanie');
  });

  it('prefers the product title the plan stores', () => {
    expect(
      productHeading({ title: 'Spring sale · Old name', product_title: 'Merino Beanie' })
    ).toBe('Merino Beanie');
  });

  it('leaves the variant to its own line', () => {
    expect(productHeading({ title: 'Spring sale · Merino Beanie — Grey' }, null, 'Grey')).toBe(
      'Merino Beanie'
    );
    expect(productHeading({ title: 'Spring sale · Merino Beanie — Grey' })).toBe(
      'Merino Beanie — Grey'
    );
  });

  it('falls back to the list row while the plan loads', () => {
    expect(productHeading(null, { productTitle: 'Merino Beanie' })).toBe('Merino Beanie');
    expect(productHeading(null, { title: 'Spring sale · Merino Beanie' })).toBe('Merino Beanie');
    expect(productHeading(null, null)).toBe('Product');
  });

  it("drops Shopify's Default Title placeholder, and no other dash", () => {
    expect(
      productHeading({ title: 'Smart Price Test 1 · The Collection Snowboard: Hydrogen - Default Title' })
    ).toBe('The Collection Snowboard: Hydrogen');
    expect(productHeading({ product_title: 'Board — Default Title' })).toBe('Board');
    expect(productHeading({ product_title: 'DZR Minna - 43' })).toBe('DZR Minna - 43');
    expect(productHeading(null, { productTitle: 'Board - Default Title' })).toBe('Board');
  });
});

describe('productVariantLine', () => {
  it('shows a real variant and hides the Default Title placeholder', () => {
    expect(productVariantLine({ variant_title: 'Grey' })).toBe('Grey');
    expect(productVariantLine({ variant_title: 'Default Title' })).toBe('');
    expect(productVariantLine(null, { variantTitle: 'default title' })).toBe('');
    expect(productVariantLine(null, { variantTitle: 'Large' })).toBe('Large');
  });
});

describe('productCatalogPrice', () => {
  it("takes the report's resolved price, then the plan's, and never a zero", () => {
    expect(productCatalogPrice({ catalog_price: 600 }, { current_price: null })).toBe(600);
    expect(productCatalogPrice({}, { current_price: 40 })).toBe(40);
    expect(productCatalogPrice({ catalog_price: null }, { current_price: 0 })).toBeNull();
    expect(productCatalogPrice(null, null)).toBeNull();
  });
});
