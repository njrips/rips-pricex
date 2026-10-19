import { describe, expect, it } from 'vitest';
import {
  buildOverviewContextLine,
  buildTrafficSplitSummary,
  formatRunningTestStatusLabel,
  resolveArmPerformanceBadge,
} from '../classicOverviewLayout';

describe('classicOverviewLayout', () => {
  it('builds the overview context line from doc fields', () => {
    expect(
      buildOverviewContextLine({
        isOfferTest: false,
        productCount: 24,
        primaryMetric: 'revenue_per_visitor',
        trafficAllocation: 50,
      })
    ).toBe(
      'Price test · 24 products · Primary metric: Revenue per visitor · Traffic allocation: 50%'
    );
  });

  it('summarizes traffic split across arms', () => {
    expect(
      buildTrafficSplitSummary([
        { id: 'c', isControl: true, label: 'Control', allocation: 34 },
        { id: 'a', label: 'Variation A', allocation: 33 },
        { id: 'b', label: 'Variation B', allocation: 33 },
      ])
    ).toContain('Traffic split:');
    expect(
      buildTrafficSplitSummary([
        { id: 'c', isControl: true, label: 'Control', allocation: 34 },
        { id: 'a', label: 'Variation A', allocation: 33 },
      ])
    ).toMatch(/Control 34%/);
  });

  it('marks leading and underperforming arms', () => {
    const arms = [
      { id: 'c', isControl: true, revenuePerVisitor: 10, conversionRate: 2, visitors: 100, conversions: 2 },
      { id: 'a', revenuePerVisitor: 12, conversionRate: 2.5, visitors: 100, conversions: 3 },
      { id: 'b', revenuePerVisitor: 7, conversionRate: 1, visitors: 100, conversions: 1 },
    ];
    expect(resolveArmPerformanceBadge(arms[1], arms).label).toBe('Leading');
    expect(resolveArmPerformanceBadge(arms[2], arms).label).toBe('Underperforming');
  });

  it('shows Leading only once a variation has visitors and conversions', () => {
    const noOrders = [
      { id: 'c', isControl: true, revenuePerVisitor: 0, visitors: 40, conversions: 0 },
      { id: 'a', revenuePerVisitor: 0, visitors: 38, conversions: 0 },
    ];
    expect(resolveArmPerformanceBadge(noOrders[0], noOrders)).toBeNull();
    const noVisitors = [
      { id: 'c', isControl: true, revenuePerVisitor: 0, visitors: 0, conversions: 0 },
      { id: 'a', revenuePerVisitor: 0, visitors: 0, conversions: 0 },
    ];
    expect(resolveArmPerformanceBadge(noVisitors[0], noVisitors)).toBeNull();
  });

  it('shows no Leading badge on a tie or once a winner is declared', () => {
    const tie = [
      { id: 'c', isControl: true, revenuePerVisitor: 5, visitors: 50, conversions: 2 },
      { id: 'a', revenuePerVisitor: 5, visitors: 50, conversions: 2 },
    ];
    expect(resolveArmPerformanceBadge(tie[0], tie)).toBeNull();
    const declared = [
      { id: 'c', isControl: true, revenuePerVisitor: 4, visitors: 50, conversions: 2 },
      { id: 'a', revenuePerVisitor: 6, visitors: 50, conversions: 3, isWinner: true },
    ];
    expect(resolveArmPerformanceBadge(declared[1], declared)).toBeNull();
  });

  it('never calls an unseen variation underperforming', () => {
    const arms = [
      { id: 'c', isControl: true, revenuePerVisitor: 5, visitors: 50, conversions: 2 },
      { id: 'a', revenuePerVisitor: 0, visitors: 0, conversions: 0 },
    ];
    expect(resolveArmPerformanceBadge(arms[1], arms)).toBeNull();
  });

  it('ranks variations on the test’s own primary metric', () => {
    // Higher revenue per visitor, lower average order value.
    const arms = [
      {
        id: 'c',
        isControl: true,
        visitors: 100,
        conversions: 10,
        revenuePerVisitor: 5,
        avgOrderValue: 50,
        profitPerVisitor: 2,
      },
      {
        id: 'a',
        visitors: 100,
        conversions: 20,
        revenuePerVisitor: 8,
        avgOrderValue: 40,
        profitPerVisitor: 1,
      },
    ];
    expect(resolveArmPerformanceBadge(arms[1], arms).label).toBe('Leading');
    expect(resolveArmPerformanceBadge(arms[0], arms, { primaryMetric: 'aov' }).label).toBe(
      'Leading'
    );
    expect(resolveArmPerformanceBadge(arms[1], arms, { primaryMetric: 'aov' }).label).toBe(
      'Underperforming'
    );
    expect(
      resolveArmPerformanceBadge(arms[0], arms, { primaryMetric: 'profit_per_visitor' }).label
    ).toBe('Leading');
  });

  it('maps running test status labels for the overview strip', () => {
    expect(formatRunningTestStatusLabel({ isRunning: true })).toBe('Active');
    expect(formatRunningTestStatusLabel({ isPaused: true })).toBe('Paused');
    expect(formatRunningTestStatusLabel({ isEnded: true })).toBe('Stopped');
  });
});
