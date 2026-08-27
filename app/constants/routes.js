/**
 * RipsPriceX routes — Classic Smart Pricing only (Shopify Admin main content).
 * Domain argument kept for Classic call-site compatibility; ignored in paths.
 */
export const ROUTES = {
  HOME: '/app',
  appSmartPricing: (_domain) => '/app',
  appSmartPricingCreate: (_domain) => '/app/experiments/new',
  appSmartPricingWelcome: (_domain) => '/app',
  appSmartPricingPlan: (_domain, planId) =>
    `/app/experiments/${encodeURIComponent(planId)}`,
  appGoalsMetrics: (_domain) => '/app/settings',
  appTestDetail: (_domain, testId) => `/app/experiments/${encodeURIComponent(testId)}`,
  appSettings: (_domain) => '/app/settings',
  appSetup: (_domain) => '/app/setup',
  /** @deprecated Prefer appPlan — Billing folded into Settings → Plan */
  appBilling: (_domain) => '/app/settings?tab=plan',
  appPlan: (_domain) => '/app/settings?tab=plan',
  /** Shopify App Pricing welcome URL target (Partner Dashboard) */
  appWelcome: (_domain) => '/app/welcome',
  appHelp: (_domain) => '/app/help',
};

export default ROUTES;
