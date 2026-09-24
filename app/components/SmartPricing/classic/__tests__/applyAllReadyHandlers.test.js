import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const classicDir = dirname(fileURLToPath(import.meta.url));

describe('Apply all ready products (Overview bulk apply)', () => {
  it('opens a confirm modal before bulk apply, not a direct handler on the button', () => {
    const source = readFileSync(
      join(classicDir, '../details/ClassicPerformanceTab.jsx'),
      'utf8'
    );
    expect(source).toContain('ClassicApplyAllReadyConfirmModal');
    expect(source).toMatch(/onClick=\{\(\) => setConfirmApplyAllReady\(true\)\}/);
    expect(source).not.toMatch(/onClick=\{onApplyAllReady\}/);
    expect(source).not.toMatch(
      /onClick=\{\(\) => onApplyAllReady\(rolloutSummary\.actionableTestIds\)\}/
    );
  });

  it('shares confirm modal with the rollout readiness panel', () => {
    const perf = readFileSync(join(classicDir, '../details/ClassicPerformanceTab.jsx'), 'utf8');
    const rollout = readFileSync(
      join(classicDir, '../details/ClassicRolloutReadinessPanel.jsx'),
      'utf8'
    );
    expect(perf).toContain('ClassicApplyAllReadyConfirmModal');
    expect(rollout).toContain('ClassicApplyAllReadyConfirmModal');
  });
});
