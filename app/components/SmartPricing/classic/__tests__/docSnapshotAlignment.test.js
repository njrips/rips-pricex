/**
 * Spot-checks that merchant copy still matches docs/research/PRICEIFY_GLOBAL_NAMING_SNAPSHOT.txt.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const snapshotPath = join(repoRoot, 'docs/research/PRICEIFY_GLOBAL_NAMING_SNAPSHOT.txt');
const classicRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function readClassic(relative) {
  return readFileSync(join(classicRoot, relative), 'utf8');
}

function readApp(relative) {
  return readFileSync(join(repoRoot, 'app', relative), 'utf8');
}

/** Phrases that must appear in code if they appear in the snapshot spec. */
const SNAPSHOT_PHRASES = [
  'Finish setup to start your first test.',
  'Run price and offer tests to grow revenue per visitor.',
  'Launch price tests in minutes.',
  'Log of guardrail events and test changes.',
  'Test paused',
  'Stopped test',
  'Launched test',
  'Created test',
  'Test resumed',
  'Winner applied to catalog',
  'Excluded by guardrail',
  'Apply ready products',
  'See how each product is performing and apply winners to your catalog.',
  'Test totals',
  'Status & traffic',
  'Audience & targeting',
  'Metrics & guardrail',
  'This is a safety net',
  'Guardrail excluded product',
  'pause variations but not edit test settings',
  'Apply winner',
  'History tab',
  'Plan & usage',
  'Results settings',
  'Price locations',
  'Minimum visitors per variation',
  'Save results settings',
  'Tell Priceify where prices appear on your theme',
  'Only visitors who match these filters can enter the test.',
  'Control – current price',
  'Traffic & variations',
  'Review & launch',
  'Launch test',
  'Traffic split:',
  'Winners applied in bulk',
  'Traffic allocation changed',
  'Guardrail turned on',
  'Guardrail turned off',
  'Waiting for minimum visitors per variation',
  'Percentage of eligible visitors who may enter this test.',
  'View test in Tests list',
  'Not ready to launch tests yet',
  'Ready to apply winners',
  'The product page price is mapped, which is all a price test needs',
  'Dynamic cart prices (for price tests)',
  'Checkout discounts (for offer tests)',
  'Edit price locations',
  'Open theme settings',
];

describe('doc snapshot alignment', () => {
  it('keeps the research snapshot file in the repo', () => {
    const snapshot = readFileSync(snapshotPath, 'utf8');
    expect(snapshot).toContain('Global naming principles');
    expect(snapshot).toMatch(/Overview[\s\S]*History[\s\S]*Settings/);
  });

  it('implements critical snapshot phrases in merchant UI', () => {
    const corpus = [
      readClassic('ClassicExperimentsList.jsx'),
      readClassic('classicExperimentListActions.js'),
      readClassic('classicCreateSteps.js'),
      readClassic('ClassicExperimentOverview.jsx'),
      readClassic('ClassicCreateWizard.jsx'),
      readClassic('VariationsStepPanel.jsx'),
      readClassic('ReviewLaunchStepPanel.jsx'),
      readClassic('reviewLaunchOverview.js'),
      readClassic('details/ClassicActivityTab.jsx'),
      readClassic('details/ClassicPerformanceTab.jsx'),
      readClassic('details/ClassicRolloutReadinessPanel.jsx'),
      readClassic('details/ClassicSettingsTab.jsx'),
      readClassic('details/ClassicOverviewTab.jsx'),
      readClassic('details/ClassicVariationsTab.jsx'),
      readClassic('classicActivity.js'),
      readClassic('classicOverviewLayout.js'),
      readClassic('classicExperimentDetailsHelpers.js'),
      readClassic('AudienceSuccessStepPanel.jsx'),
      readClassic('classicAudienceEdit.js'),
      readClassic('helpFaq.js'),
      readClassic('productActionAvailability.js'),
      readApp('routes/app.setup.tsx'),
      readApp('routes/app._index.tsx'),
      readApp('routes/app.settings.tsx'),
      readApp('routes/app.tsx'),
      readApp('components/Settings/sections/SettingsStatSettingsPanel.jsx'),
      readApp('components/Settings/sections/SettingsPlanPanel.jsx'),
      readApp('components/public/priceify/docsContent.js'),
      readApp('utils/checkoutReadinessClient.js'),
      readFileSync(
        join(repoRoot, 'server/src/services/smartPricing/smartPricingCheckoutReadinessService.js'),
        'utf8',
      ),
    ].join('\n');

    for (const phrase of SNAPSHOT_PHRASES) {
      expect(corpus, `missing snapshot phrase: ${phrase}`).toContain(phrase);
    }
  });
});
