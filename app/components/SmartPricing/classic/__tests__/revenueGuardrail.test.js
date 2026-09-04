import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  createRevenueGuardrailRow,
  ensureRevenueGuardrailRows,
  formatRevenueDropThreshold,
  MAX_REVENUE_DROP_PERCENT,
  MIN_REVENUE_DROP_PERCENT,
  parseRevenueDropThreshold,
  revenueGuardrailGoalConfig,
} from '../revenueGuardrail.js';

describe('ensureRevenueGuardrailRows', () => {
  it('keeps only the revenue pause row', () => {
    const rows = ensureRevenueGuardrailRows([
      createRevenueGuardrailRow(12),
      { id: 'page_load', label: 'Page load time', on: true },
      { id: 'bounce', label: 'Bounce rate', on: false },
    ]);
    assert.deepEqual(
      rows.map(row => row.id),
      ['revenue']
    );
    assert.equal(rows[0].on, true);
    assert.equal(rows[0].locked, true);
    assert.equal(rows[0].threshold, '-12%');
  });

  it('adds a revenue row when none is stored', () => {
    const rows = ensureRevenueGuardrailRows([]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'revenue');
    assert.equal(rows[0].threshold, '-10%');
  });

  it('seeds a shop max revenue drop when no experiment row exists yet', () => {
    const rows = ensureRevenueGuardrailRows([], 15);
    assert.equal(rows[0].threshold, '-15%');
  });

  it('stamps launch goal.guardrails as a pause config, not UI rows', () => {
    const config = revenueGuardrailGoalConfig([{ id: 'revenue', threshold: '-8%' }], 15);
    assert.deepEqual(config, { auto_stop: true, max_revenue_drop_percent: 8 });
  });

  // The shop value used to cap this, and the tighter of the two won. It is no
  // longer a setting a merchant can see, so capping by it would hold every test
  // to a number they could not find, let alone change.
  it('keeps an experiment threshold looser than the shop default', () => {
    const config = revenueGuardrailGoalConfig([{ id: 'revenue', threshold: '-20%' }], 10);
    assert.deepEqual(config, { auto_stop: true, max_revenue_drop_percent: 20 });
  });

  it('still holds the experiment threshold inside the allowed range', () => {
    assert.deepEqual(revenueGuardrailGoalConfig([{ id: 'revenue', threshold: '-80%' }], 10), {
      auto_stop: true,
      max_revenue_drop_percent: MAX_REVENUE_DROP_PERCENT,
    });
    assert.deepEqual(revenueGuardrailGoalConfig([{ id: 'revenue', threshold: '-1%' }], 10), {
      auto_stop: true,
      max_revenue_drop_percent: MIN_REVENUE_DROP_PERCENT,
    });
  });
});

describe('revenue drop threshold editing', () => {
  // The card writes raw digits while typing and normalises on blur, so a partial
  // entry must survive the keystroke that produced it.
  const typeThen = raw => {
    const digits = String(raw).replace(/[^0-9.]/g, '');
    const typing = ensureRevenueGuardrailRows([{ id: 'revenue', threshold: `-${digits}%` }]);
    const committed = ensureRevenueGuardrailRows([
      {
        id: 'revenue',
        threshold: formatRevenueDropThreshold(parseRevenueDropThreshold(digits)),
      },
    ]);
    return { typing: typing[0].threshold, committed: committed[0].threshold };
  };

  it('keeps an in-progress value and clamps it on blur', () => {
    assert.equal(typeThen('1').typing, '-1%');
    assert.equal(typeThen('1').committed, `-${MIN_REVENUE_DROP_PERCENT}%`);
    assert.equal(typeThen('12').typing, '-12%');
    assert.equal(typeThen('12').committed, '-12%');
  });

  it('clamps above the maximum and falls back on an empty field', () => {
    assert.equal(typeThen('999').committed, `-${MAX_REVENUE_DROP_PERCENT}%`);
    assert.equal(typeThen('').committed, '-10%');
  });

  it('never stores a threshold the launch config would reject', () => {
    for (const raw of ['', '0', '1', '3', '12', '50', '80', 'abc']) {
      const { committed } = typeThen(raw);
      const percent = parseRevenueDropThreshold(committed);
      assert.ok(
        percent >= MIN_REVENUE_DROP_PERCENT && percent <= MAX_REVENUE_DROP_PERCENT,
        `${raw} -> ${committed} (${percent}) out of range`
      );
    }
  });
});
