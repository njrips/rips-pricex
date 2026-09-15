/** Annual list prices are ~20% lower than pay-monthly (matches landing save badge). */
export const LANDING_BILLING = {
  annual: 'annual',
  monthly: 'monthly',
};

export function quoteTierPrice(tier, billing = LANDING_BILLING.annual) {
  if (billing === LANDING_BILLING.monthly) {
    return { price: tier.monthlyPrice, period: tier.monthlyPeriod };
  }
  return { price: tier.annualPrice, period: tier.annualPeriod };
}
