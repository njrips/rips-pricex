import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const MERCHANT_UI_FILES = [
  'ClassicExperimentOverview.jsx',
  'ClassicCreateWizard.jsx',
  'ClassicExperimentsList.jsx',
  'ClassicWizardShell.jsx',
  'ClassicAdminShell.jsx',
  'classicCreateSteps.js',
  'classicWizardAutosave.js',
  'classicExperimentDuplicate.js',
  'ClassicExperimentRowActions.jsx',
  'ReviewLaunchStepPanel.jsx',
  'reviewLaunchOverview.js',
  'VariationsStepPanel.jsx',
  'AudienceSuccessStepPanel.jsx',
  'ProductsPricingStepPanel.jsx',
  '../targeting/smartPricingAudienceHelpers.js',
  'helpFaq.js',
  'resumeConflicts.js',
  'classicExperimentDelete.js',
  'details/ClassicActivityTab.jsx',
  'details/ClassicProductDetailPanel.jsx',
  '../components/WinnerApplyModal.jsx',
  '../../../hooks/useClassicExperimentDetails.js',
  'details/ClassicPerformanceTab.jsx',
  'details/ClassicVariationsTab.jsx',
  'details/ClassicSettingsTab.jsx',
  '../../TestWizard/PriceSurfaceMappingsPanel.jsx',
  '../../../routes/app.setup.tsx',
  '../../../routes/app.welcome.tsx',
  '../../../routes/app._index.tsx',
  '../../../routes/app.settings.tsx',
  '../../../hooks/useCartTransformStatus.js',
  '../../../hooks/useCheckoutDiscountStatus.js',
  '../../Settings/sections/SettingsPlanPanel.jsx',
  '../../Settings/sections/StoreSettingsPriceSurfacesSection.jsx',
  '../../../../server/src/utils/checkoutReadinessHints.js',
  '../../../utils/checkoutReadinessClient.js',
  '../../public/priceify/docsContent.js',
].map(relative => join(root, relative));

/** Merchant UI should say "test", not "experiment"; "Price locations", not "Price surfaces". */
const FORBIDDEN = [
  /\bBack to experiments\b/,
  /\bDelete experiment\b/i,
  /\bExperiment name is required\b/,
  /\bexperiments page\b/i,
  /\bLoading shop experiment defaults\b/,
  /\bSettings → Price surfaces\b/,
  /\blabel="Price surfaces"/,
  /\bOpen Price surfaces\b/,
  /\bExperiments<\/button>/,
  /\b>Experiments</,
  /\bExperiment paused\b/,
  /\bExperiment archived\b/,
  /\bCreated experiment\b/,
  /\bLaunched experiment\b/,
  /\benter the experiment\b/i,
  /\bOne experiment covers\b/,
  /\bSet it per experiment\b/,
  /\bfirst experiment\b/i,
  /\bprice surfaces\b/i,
  /\bMin sample\b/,
  /\blabel="Minimum sample"/,
  /\bunder min sample\b/i,
  /\b1\. Theme app embed\b/,
  /\b2\. Checkout functions\b/,
  /\b3\. Theme price selectors\b/,
  /\bAuto-map price locations\b/,
  /\bCart transform \(price tests\)/,
  /\bRe-check checkout functions\b/,
  /\bContinue setup\b/,
  /\bAlternative install\b/,
  /\bOpen Setup checklist\b/,
  /\bfinish Setup checklist\b/i,
  /\bconfirm Setup\b/i,
  /\btheme embed\b/i,
  /\bSmart Pricing\b/,
  /\bTheme price mapping\b/i,
  /\bclick Ensure\b/i,
  /\bDeploy ripspricex-/i,
];

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('merchant naming (Priceify global principles)', () => {
  for (const file of MERCHANT_UI_FILES) {
    it(`avoids legacy experiment/surface labels in ${file.split('/').slice(-2).join('/')}`, () => {
      const source = stripComments(readFileSync(file, 'utf8'));
      for (const pattern of FORBIDDEN) {
        expect(source, pattern.toString()).not.toMatch(pattern);
      }
    });
  }
});
