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
  resolveAdminProductHref,
  resolveArmMetric,
  resolveNeighbourProducts,
  resolveStorefrontProductHref,
  summarizeProductAnalytics,
  summarizeRounds,
} from '../productDetailReport';

const arms = [
  { arm_id: 'c', role: 'control', label: 'Control', price: 40, visitors: 100, conversions: 4, conversion_rate: 4, revenue_per_visitor: 1.6, avg_order_value: 40, revenue: 160 },
  { arm_id: 'a', role: 'challenger', label: 'Variation A', price: 44, visitors: 100, conversions: 4, conversion_rate: 4, revenue_per_visitor: 1.76, avg_order_value: 44, revenue: 176 },
  { arm_id: 'b', role: 'challenger', label: 'Variation B', price: 36, visitors: 50, conversions: 1, conversion_rate: 2, revenue_per_visitor: 0.72, avg_order_value: 36, revenue: 36 },
];

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
