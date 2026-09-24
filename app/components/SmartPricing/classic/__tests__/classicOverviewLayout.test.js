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
    ).toMatch(/Control 34\.0%/);
  });

  it('marks leading and underperforming arms', () => {
    const arms = [
      { id: 'c', isControl: true, revenuePerVisitor: 10, conversionRate: 2 },
      { id: 'a', revenuePerVisitor: 12, conversionRate: 2.5 },
      { id: 'b', revenuePerVisitor: 7, conversionRate: 1 },
    ];
    expect(resolveArmPerformanceBadge(arms[1], arms).label).toBe('Leading');
    expect(resolveArmPerformanceBadge(arms[2], arms).label).toBe('Underperforming');
  });

  it('maps running test status labels for the overview strip', () => {
    expect(formatRunningTestStatusLabel({ isRunning: true })).toBe('Active');
    expect(formatRunningTestStatusLabel({ isPaused: true })).toBe('Paused');
    expect(formatRunningTestStatusLabel({ isEnded: true })).toBe('Stopped');
  });
});
