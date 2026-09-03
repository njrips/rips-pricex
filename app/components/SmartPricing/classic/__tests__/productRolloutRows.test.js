import { describe, expect, it } from 'vitest';
import {
  buildProductRolloutRows,
  summarizeRolloutRows,
} from '../classicExperimentDetailsHelpers';

function plan(id, title, testId) {
  return {
    id,
    test_id: testId,
    product_id: `gid://shopify/Product/${id}`,
    metadata: { product_title: title },
    title,
  };
}

function payload(decision, extra = {}) {
  return {
    currency: 'USD',
    arms: [],
    significance: {},
    product_decision: decision,
    ...extra,
  };
}

const READY = {
  state: 'ready_challenger',
  sort_rank: 0,
  can_apply: true,
  can_finish: false,
  detail: 'Ready',
  winner: { current_price: 40, price: 46, price_change_percent: 15 },
  progress: { percent: 100 },
};

const CONTROL = {
  state: 'ready_control',
  sort_rank: 1,
  can_apply: false,
  can_finish: true,
  detail: 'Keep price',
  progress: { percent: 100 },
};

const BLOCKED = {
  state: 'blocked',
  sort_rank: 2,
  can_apply: false,
  can_finish: false,
  detail: 'Split mismatch',
  progress: { percent: 100 },
};

function collecting(percent) {
  return {
    state: 'collecting',
    sort_rank: 3,
    can_apply: false,
    can_finish: false,
    detail: 'Collecting',
    progress: { percent },
  };
}

describe('buildProductRolloutRows', () => {
  it('puts what the merchant can act on first and unfinished work last', () => {
    const rows = buildProductRolloutRows({
      plans: [
        plan('p1', 'Slow SKU', 't1'),
        plan('p2', 'Winner SKU', 't2'),
        plan('p3', 'Broken SKU', 't3'),
        plan('p4', 'Control SKU', 't4'),
      ],
      analyticsByTestId: {
        t1: payload(collecting(20)),
        t2: payload(READY),
        t3: payload(BLOCKED),
        t4: payload(CONTROL),
      },
    });
    expect(rows.map(row => row.state)).toEqual([
      'ready_challenger',
      'ready_control',
      'blocked',
      'collecting',
    ]);
  });

  it('orders the ready group by how long each has been waiting', () => {
    const rows = buildProductRolloutRows({
      plans: [plan('p1', 'Newer', 't1'), plan('p2', 'Older', 't2')],
      analyticsByTestId: {
        t1: payload({ ...READY, ready_since: '2026-02-01T00:00:00.000Z' }),
        t2: payload({ ...READY, ready_since: '2026-01-01T00:00:00.000Z' }),
      },
    });
    expect(rows.map(row => row.productTitle)).toEqual(['Older', 'Newer']);
  });

  it('shows the products nearest their floors ahead of ones that just started', () => {
    const rows = buildProductRolloutRows({
      plans: [plan('p1', 'Just started', 't1'), plan('p2', 'Almost there', 't2')],
      analyticsByTestId: { t1: payload(collecting(5)), t2: payload(collecting(88)) },
    });
    expect(rows.map(row => row.productTitle)).toEqual(['Almost there', 'Just started']);
  });

  it('marks a product with no analytics yet as loading rather than collecting', () => {
    const [row] = buildProductRolloutRows({
      plans: [plan('p1', 'Pending', 't1')],
      analyticsByTestId: {},
    });
    expect(row.loading).toBe(true);
    expect(row.decision).toBeNull();
  });

  it('lists a shared test once instead of repeating it per plan', () => {
    const rows = buildProductRolloutRows({
      plans: [plan('p1', 'A', 'shared'), plan('p2', 'B', 'shared')],
      analyticsByTestId: { shared: payload(READY) },
    });
    expect(rows).toHaveLength(1);
  });

  it('skips plans that were never launched', () => {
    const rows = buildProductRolloutRows({
      plans: [plan('p1', 'Draft', null), plan('p2', 'Live', 't2')],
      analyticsByTestId: { t2: payload(READY) },
    });
    expect(rows.map(row => row.testId)).toEqual(['t2']);
  });
});

describe('summarizeRolloutRows', () => {
  it('counts only rows a bulk apply would actually touch', () => {
    const rows = buildProductRolloutRows({
      plans: [
        plan('p1', 'Winner', 't1'),
        plan('p2', 'Control', 't2'),
        plan('p3', 'Broken', 't3'),
        plan('p4', 'Slow', 't4'),
      ],
      analyticsByTestId: {
        t1: payload(READY),
        t2: payload(CONTROL),
        t3: payload(BLOCKED),
        t4: payload(collecting(30)),
      },
    });
    const summary = summarizeRolloutRows(rows);
    expect(summary.total).toBe(4);
    expect(summary.readyCount).toBe(2);
    // A blocked product must never be swept up in "apply all".
    expect(summary.actionableTestIds).toEqual(['t1', 't2']);
    // Only the challenger win writes a catalog price.
    expect(summary.priceWriteCount).toBe(1);
    expect(summary.counts.blocked).toBe(1);
  });
});
