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
  appBilling: (_domain) => '/app/billing',
};

export default ROUTES;
