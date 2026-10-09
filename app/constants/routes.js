import { preserveEmbeddedSearch } from '../utils/shopifyEmbeddedSearch';

/**
 * RipsPriceX routes — Classic Smart Pricing only (Shopify Admin main content).
 * Domain argument kept for Classic call-site compatibility; ignored in paths.
 * Embed params on the current URL are copied so the next page stays inside Admin.
 */

const embed = path => preserveEmbeddedSearch(path);

export const ROUTES = {
  HOME: '/app',
  appSmartPricing: (_domain) => embed('/app'),
  appSmartPricingCreate: (_domain) => embed('/app/experiments/new'),
  appSmartPricingWelcome: (_domain) => embed('/app'),
  appSmartPricingPlan: (_domain, planId) =>
    embed(`/app/experiments/${encodeURIComponent(planId)}`),
  appTestDetail: (_domain, testId) => embed(`/app/experiments/${encodeURIComponent(testId)}`),
  appSettings: (_domain) => embed('/app/settings'),
  appSetup: (_domain) => embed('/app/setup'),
  /** @deprecated Prefer appPlan — Billing folded into Settings → Plan */
  appBilling: (_domain) => embed('/app/settings?tab=plan'),
  appPlan: (_domain) => embed('/app/settings?tab=plan'),
  /** Shopify App Pricing welcome URL target (Partner Dashboard) */
  appWelcome: (_domain) => embed('/app/welcome'),
  appHelp: (_domain) => embed('/app/help'),
};

export default ROUTES;
