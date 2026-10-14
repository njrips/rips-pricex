import { Banner } from '@shopify/polaris';
import { formatOfferRule, isOfferExperimentType } from './offerSelection';
import { formatTrafficPercent } from './variationsStepHelpers';
import styles from './SmartPricingClassic.module.css';

function formatMoney(value, currency) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function productTitle(plan) {
  return (
    String(plan?.metadata?.product_title || plan?.product_title || '').trim() ||
    String(plan?.title || '').split(' · ').pop() ||
    'Product'
  );
}

/**
 * Variations and prices of a live test, shown but not editable. Shoppers are
 * already assigned to these arms, so changing them would mix two experiments
 * into one result.
 */
export default function LiveEditLockedStep({
  kind = 'variations',
  variations = [],
  plans = [],
  experimentType = 'price_test',
}) {
  const isOffer = isOfferExperimentType(experimentType);
  const what = kind === 'products' ? (isOffer ? 'Products and offers' : 'Products and prices') : 'Variations and traffic split';

  return (
    <div className={styles.reviewStack}>
      <Banner tone="info" title={`${what} are locked`}>
        <p>
          This test is live, so shoppers are already assigned to these {kind === 'products' ? 'prices' : 'variations'}.
          Changing them would mix two tests into one result. To try something different,
          stop this test and start a new one.
        </p>
      </Banner>
      {kind === 'products' ? (
        <div className={styles.reviewOverview} role="group" aria-label={what}>
          {plans.map(plan => {
            const arms = Array.isArray(plan?.price_arms) ? plan.price_arms : [];
            return (
              <section key={plan.id} className={styles.reviewSection}>
                <h3 className={styles.reviewSectionTitle}>{productTitle(plan)}</h3>
                <dl className={styles.reviewSectionRows}>
                  {arms.map((arm, index) => (
                    <div key={arm.id || index} className={styles.reviewSectionRow}>
                      <dt>{arm.label || (index === 0 ? 'Control' : `Variation ${index}`)}</dt>
                      <dd>
                        {isOffer
                          ? index === 0
                            ? 'No offer'
                            : formatOfferRule(arm.offer, plan.currency)
                          : formatMoney(arm.price, plan.currency)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
          })}
        </div>
      ) : (
        <div className={styles.reviewOverview} role="group" aria-label={what}>
          <section className={styles.reviewSection}>
            <h3 className={styles.reviewSectionTitle}>Variations</h3>
            <dl className={styles.reviewSectionRows}>
              {variations.map((variation, index) => (
                <div key={variation.id || index} className={styles.reviewSectionRow}>
                  <dt>{variation.name || (index === 0 ? 'Control' : `Variation ${index}`)}</dt>
                  <dd>{formatTrafficPercent(variation.traffic)}%</dd>
                </div>
              ))}
            </dl>
          </section>
          <p className={styles.help}>Traffic allocation can still be changed on Audience &amp; goals.</p>
        </div>
      )}
    </div>
  );
}
