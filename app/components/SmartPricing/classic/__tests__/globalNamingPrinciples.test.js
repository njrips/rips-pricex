/**
 * Spot-checks merchant copy against Priceify Global naming principles (PDF).
 * Complements merchantNaming.test.js (forbidden legacy strings).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CLASSIC_CREATE_STEPS,
  getClassicCreateSteps,
  stepLabelLines,
} from '../classicCreateSteps';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(relative) {
  return readFileSync(join(root, relative), 'utf8');
}

describe('global naming principles (PDF spot checks)', () => {
  it('uses the five wizard step labels from the spec', () => {
    expect(stepLabelLines('Products & prices')).toEqual(['Products &', 'prices']);
    expect(CLASSIC_CREATE_STEPS.map(step => step.label)).toEqual([
      'Basics',
      'Traffic',
      'Products & prices',
      'Audience & goals',
      'Review & launch',
    ]);
  });

  it('names the tests dashboard and primary CTA per the spec', () => {
    const list = read('ClassicExperimentsList.jsx');
    expect(list).toMatch(/Run price and offer tests to grow revenue per visitor/);
    expect(list).toMatch(/Launch price tests in minutes/);
    expect(list).toMatch(/Running tests/);
    expect(list).toMatch(/Winning tests/);
    expect(list).toMatch(/>\s*New test\s*</);
    expect(list).toMatch(/label: 'Draft'/);
    expect(list).toMatch(/label: 'Finished'/);
    expect(list).toContain('Status');
  });

  it('offers PDF row actions for draft tests', () => {
    const actions = read('classicExperimentListActions.js');
    expect(actions).toContain("label: 'Edit test'");
    expect(actions).toContain("label: 'Duplicate'");
    expect(actions).toContain("label: 'View results'");
  });

  it('uses Store setup on welcome and plan surfaces', () => {
    const welcome = read('../../../routes/app.welcome.tsx');
    const plan = read('../../../components/Settings/sections/SettingsPlanPanel.jsx');
    expect(welcome).toMatch(/Store setup/);
    expect(welcome).not.toMatch(/theme embed/i);
    expect(plan).toMatch(/Open setup checklist/);
  });

  it('aligns store setup card titles with the spec', () => {
    const setup = read('../../../routes/app.setup.tsx');
    expect(setup).toContain('1. Theme connection');
    expect(setup).toContain('2. Checkout pricing functions');
    expect(setup).toContain('3. Price locations on your site');
    expect(setup).toContain('Auto-detect prices');
    expect(setup).toContain('Edit price locations');
    expect(setup).toContain(
      'Complete the steps below to connect Priceify to your theme and checkout.',
    );
    const priceSurfaces = read('../../TestWizard/PriceSurfaceMappingsPanel.jsx');
    expect(priceSurfaces).toContain('Auto-detect prices');
    expect(priceSurfaces).not.toMatch(/Scan storefront|Storefront price scan/);
  });

  it('aligns public setup vocabulary with Store setup cards', () => {
    const landing = read('../../public/priceify/landingContent.js');
    const docs = read('../../public/priceify/docsContent.js');
    expect(landing).toMatch(/Theme connection on Store setup/);
    expect(docs).toMatch(/Checkout pricing functions on Store setup/);
    expect(docs).not.toMatch(/theme app embed/i);
  });

  it('uses Priceify as the product name in merchant copy', () => {
    const welcome = read('../../../routes/app.welcome.tsx');
    const help = read('helpFaq.js');
    expect(welcome).toMatch(/Priceify plan/);
    expect(help).toMatch(/Priceify plan/);
    expect(welcome).not.toMatch(/Smart Pricing plan/);
  });

  it('names the Price locations settings tab consistently', () => {
    const settings = read('../../../routes/app.settings.tsx');
    expect(settings).toMatch(/label: 'Price locations'/);
    expect(settings).toMatch(/title: 'Theme price selectors'/);
  });

  it('aligns create wizard step titles and review copy with the spec', () => {
    expect(
      CLASSIC_CREATE_STEPS.filter(step => step.id !== 'review').every(
        step => step.description === '',
      ),
    ).toBe(true);
    expect(CLASSIC_CREATE_STEPS.map(step => step.title)).toEqual([
      'Set up your test',
      'Traffic & variations',
      'Choose products & set test prices',
      'Audience & goals',
      'Review & launch',
    ]);
    const setup = read('SetupStepPanel.jsx');
    const variations = read('VariationsStepPanel.jsx');
    const wizard = read('ClassicCreateWizard.jsx');
    expect(setup).toContain('Compare different price points for the same product.');
    const audienceHelpers = read('../targeting/smartPricingAudienceHelpers.js');
    expect(audienceHelpers).toContain("label: 'Average order value'");
    expect(variations).toContain('How much traffic enters this test');
    expect(variations).toContain('What percentage of eligible visitors should enter this test?');
    expect(variations).not.toMatch(/price change to every selected product/i);
    const trafficStep = CLASSIC_CREATE_STEPS.find(step => step.id === 'variations');
    expect(trafficStep?.description).toBe('');
    expect(getClassicCreateSteps('offer_test').find(step => step.id === 'variations')?.description).toBe(
      '',
    );
    const productsStep = CLASSIC_CREATE_STEPS.find(step => step.id === 'products');
    expect(productsStep?.description).toBe('');
    expect(getClassicCreateSteps('offer_test').find(step => step.id === 'products')?.description).toBe(
      '',
    );
    const productsPanel = read('ProductsPricingStepPanel.jsx');
    expect(productsPanel).toContain('tableColumnHeaderMain');
    expect(productsPanel).not.toMatch(/>\s*Change \(optional\)\s*</);
    expect(productsPanel).toContain('Base price');
    expect(variations).toContain('If you pause a variation');
    expect(variations).toContain("Describe what's different (optional)");
    expect(wizard).toContain("backLabel={step === 4 ? 'Back to edit' : 'Back'}");
    expect(wizard).toContain("'Launch test'");
    const audience = read('AudienceSuccessStepPanel.jsx');
    expect(audience).toContain('MIN_VISITORS_FOR_REVENUE_GUARDRAIL');
    expect(audience).not.toMatch(/minimum visitors per variation is reached/i);
    expect(audience).toMatch(/This is a safety net/i);
    expect(audience).toMatch(/does not declare a winner/i);
    expect(CLASSIC_CREATE_STEPS.find(step => step.id === 'audience')?.description).toBe('');
    expect(CLASSIC_CREATE_STEPS.find(step => step.id === 'review')?.description).toContain(
      'Check your settings before launching. You can pause or stop a test at any time.',
    );
    expect(CLASSIC_CREATE_STEPS.find(step => step.id === 'review')?.description).toContain(
      'pause variations but not edit test settings',
    );
    const review = read('ReviewLaunchStepPanel.jsx');
    expect(review).toContain('Open Store setup');
    expect(review).toContain('Open Settings → Price locations');
    expect(review).not.toMatch(/Fix setup before launching/i);
    expect(review).toContain('Traffic may be too low for a reliable result');
    expect(review).toContain('Picked products');
    expect(review).toContain("isOfferTest ? 'Products & offers' : 'Products & prices'");
    expect(review).toContain('reviewOverviewLabel');
    const overview = read('reviewLaunchOverview.js');
    expect(overview).toContain('AI suggested prices');
    expect(overview).toContain('REVIEW_OVERVIEW_LINE_ORDER');
    expect(overview).toContain('formatReviewPricingModeLabel');
    expect(overview).toContain('Mixed pricing per variation');
    expect(review).toContain('showDurationBanner');
    expect(productsPanel).toContain('Price band (min–max)');
    expect(productsPanel).toContain('Pick specific products');
    expect(productsPanel).toContain('How would you like to pick products?');
    expect(productsPanel).toContain('For each variation, choose how you');
    const helpFaq = read('helpFaq.js');
    expect(helpFaq).toMatch(/term: 'Revenue guardrail'/);
    expect(helpFaq).toMatch(/term: 'Results settings'/);
    expect(helpFaq).toMatch(/Where is the revenue guardrail\?/);
  });

  it('structures the running-test Overview tab per the spec', () => {
    const overview = read('ClassicExperimentOverview.jsx');
    expect(overview).toMatch(
      /After the minimum visitors per variation is reached, you can pause variations but\s+not edit test settings/,
    );
    expect(overview).toContain('ClassicOverviewContextStrip');
    expect(overview).toContain('overviewMode');
    const totals = read('details/ClassicOverviewTab.jsx');
    expect(totals).toContain('Test totals');
    const layout = read('classicOverviewLayout.js');
    expect(layout).toContain('buildOverviewContextLine');
    const helpers = read('classicExperimentDetailsHelpers.js');
    expect(helpers).toContain('formatProductStatusLabel');
    expect(helpers).toContain('formatProductDecisionOutcome');
    const perf = read('details/ClassicPerformanceTab.jsx');
    expect(perf).toContain('Apply winner');
    expect(perf).toContain('formatApplyAllReadyLabel');
    expect(perf).toContain('Product performance by variation');
    expect(perf).toMatch(/overviewMode \? null : \(\s*<ClassicRolloutReadinessPanel/s);
    const rolloutPanel = read('details/ClassicRolloutReadinessPanel.jsx');
    expect(rolloutPanel).toContain('Ready to apply winners');
    expect(rolloutPanel).not.toMatch(/Rollout readiness/);
    expect(perf).toContain(
      'See how each product is performing and apply winners to your catalog.',
    );
  });

  it('uses the three test detail tabs from the spec', () => {
    const overview = read('ClassicExperimentOverview.jsx');
    const tabs = read('classicExperimentListActions.js');
    expect(tabs).toContain("export const CLASSIC_DETAILS_TABS = ['Overview', 'History', 'Settings']");
    expect(overview).toMatch(/\{ id: 'Overview'/);
    expect(overview).toMatch(/\{ id: 'History'/);
    expect(overview).toMatch(/\{ id: 'Settings'/);
    expect(overview).not.toMatch(/\{ id: 'Performance'/);
    expect(overview).not.toMatch(/\{ id: 'Activity'/);
  });

  it('structures the running-test Settings tab per the spec', () => {
    const settingsTab = read('details/ClassicSettingsTab.jsx');
    expect(settingsTab).toContain('Status & traffic');
    expect(settingsTab).toContain('Audience & targeting');
    expect(settingsTab).toContain('Metrics & guardrail');
    expect(settingsTab).toContain('View test history');
    expect(settingsTab).toContain('View test in Tests list');
    const history = read('details/ClassicActivityTab.jsx');
    expect(history).toContain('Test history');
    expect(history).toContain('Log of guardrail events and test changes.');
    const activity = read('classicActivity.js');
    expect(activity).toContain("label: 'Guardrails'");
    const events = read('productActionAvailability.js');
    expect(events).toContain('Winner applied to catalog');
    expect(events).toContain('Stopped by guardrail');
  });

  it('uses Results settings field labels from the spec', () => {
    const panel = read('../../../components/Settings/sections/SettingsStatSettingsPanel.jsx');
    const settingsPage = read('../../../routes/app.settings.tsx');
    expect(panel).toContain('Minimum visitors per variation');
    expect(settingsPage).toContain('Save results settings');
    expect(settingsPage).toContain('These settings apply to every new test you launch.');
    expect(panel).toContain('When Priceify can call a winner.');
    expect(panel).toMatch(/80% \(faster, less strict\)/);
    expect(panel).toContain('Both apply to every new test you launch.');
    expect(panel.replace(/\s+/g, ' ')).toContain('when a winner can be called');
  });
});
