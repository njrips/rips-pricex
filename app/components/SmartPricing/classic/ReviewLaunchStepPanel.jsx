import React from 'react';
import { Badge, Banner, Button } from '@shopify/polaris';
import { formatSplitCountryAudienceLabel, resolveCountryLists } from './countrySelection';
import {
  formatOfferRule,
  formatOfferSummary,
  getOfferCheckoutBlockReason,
  isOfferExperimentType,
} from './offerSelection';
import {
  normalizeSecondaryEvents,
  primaryMetricLabel,
  secondaryMetricLabel,
} from '../targeting/smartPricingAudienceHelpers';
import styles from './SmartPricingClassic.module.css';

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `$${n.toFixed(n % 1 === 0 ? 0 : 2)}`;
}

function armDelta(controlPrice, price) {
  const base = Number(controlPrice);
  const next = Number(price);
  if (!Number.isFinite(base) || base === 0 || !Number.isFinite(next)) return null;
  return ((next - base) / base) * 100;
}

function formatPriceModeLabel(mode, { bulkPercent = '10', bulkDirection = 'increase' } = {}) {
  if (mode === 'bulk') {
    return `Bulk ${bulkDirection === 'decrease' ? '−' : '+'}${bulkPercent}%`;
  }
  if (mode === 'ai') return 'AI suggested';
  return 'Manual';
}

function formatModeList(mode, values, emptyLabel) {
  const list = (Array.isArray(values) ? values : []).filter(Boolean);
  if (!list.length) return emptyLabel;
  const prefix = mode === 'exclude' ? 'Exclude' : 'Include';
  return `${prefix}: ${list.join(', ')}`;
}

function segmentLabel(segment) {
  if (segment === 'new_visitors') return 'New visitors';
  if (segment === 'returning') return 'Returning visitors';
  if (segment === 'all_visitors') return 'All visitors';
  return segment || '—';
}

export default function ReviewLaunchStepPanel({
  name,
  hypothesis: _hypothesis,
  experimentType = 'price_test',
  experimentTypeLabel = 'Price test',
  variations = [],
  selectedCount = 0,
  pickMode = 'manual',
  priceMode = 'manual',
  bulkPercent = '10',
  bulkDirection = 'increase',
  pricingByArm = null,
  offerByArm = {},
  audience,
  estimatedDays = null,
  estimatedTimeDetail = '',
  checkoutReady = true,
  checkoutLoading = false,
  checkoutReadiness = null,
  shopDomain = '',
  onFixSetup,
  onFixPriceSurfaces,
  onRefreshCheckout,
  onEditStep,
  plans = [],
}) {
  const primaryMetric = primaryMetricLabel(audience?.primaryMetric, {
    primaryCustomGoal: audience?.primaryCustomGoal,
  });
  const secondaryEvents = normalizeSecondaryEvents(audience?.secondaryMetrics);
  const customGoals = Array.isArray(audience?.customGoals) ? audience.customGoals : [];
  const secondarySummary =
    [
      ...secondaryEvents.map(secondaryMetricLabel),
      ...customGoals.map(goal => {
        const label = goal?.label || secondaryMetricLabel(goal?.event_name);
        const trigger = goal?.trigger_type ? String(goal.trigger_type).replace(/_/g, ' ') : '';
        return trigger ? `${label} (${trigger})` : label;
      }),
    ]
      .filter(Boolean)
      .join(', ') || 'None';

  const failedChecks = Array.isArray(checkoutReadiness?.failed_checks)
    ? checkoutReadiness.failed_checks.filter(Boolean)
    : [];
  const priceSurface = checkoutReadiness?.price_surface || null;
  const priceSurfaceNeedsAttention =
    !isOfferExperimentType(experimentType) && priceSurface && priceSurface.ready === false;
  const isOfferTest = isOfferExperimentType(experimentType);
  const offerDiscountMissing =
    isOfferTest &&
    checkoutReady &&
    checkoutReadiness?.live_api_checked === true &&
    checkoutReadiness?.automatic_discount_available !== true;

  const pricingLabel = (() => {
    if (pricingByArm && typeof pricingByArm === 'object') {
      const testArms = (variations || []).filter(
        (arm, i) => i > 0 && arm?.id && arm.id !== 'control'
      );
      const modes = testArms.map(arm => {
        const cfg = pricingByArm[arm.id] || {};
        return formatPriceModeLabel(cfg.priceMode || priceMode, {
          bulkPercent: cfg.bulkPercent ?? bulkPercent,
          bulkDirection: cfg.bulkDirection || bulkDirection,
        });
      });
      const unique = [...new Set(modes.filter(Boolean))];
      if (unique.length === 1) return unique[0];
      if (unique.length > 1) return 'Mixed per variation';
    }
    return formatPriceModeLabel(priceMode, { bulkPercent, bulkDirection });
  })();

  return (
    <div className={styles.reviewStack}>
      <Banner
        tone={estimatedDays && Number(estimatedDays) >= 42 ? 'warning' : 'info'}
        title={
          estimatedDays
            ? `Estimated time to significance: ~${estimatedDays} days`
            : 'Estimated time to significance'
        }
      >
        <p>
          {estimatedTimeDetail ||
            `Based on ${audience?.trafficAllocation ?? 50}% traffic, minimum sample size, variation count, and selected product traffic.`}
        </p>
      </Banner>

      {checkoutLoading ? (
        <Banner tone="info" title="Checking checkout readiness…">
          <p>
            {isOfferTest
              ? 'Confirming the checkout discount function before launch.'
              : 'Confirming cart transform and pricing infra before launch.'}
          </p>
        </Banner>
      ) : !checkoutReady ? (
        <div className={styles.error} role="alert">
          <div>
            <strong>
              {isOfferTest
                ? 'Checkout is not ready for offer tests.'
                : 'Checkout is not ready for price tests.'}
            </strong>{' '}
            {isOfferTest
              ? getOfferCheckoutBlockReason(checkoutReadiness)
              : checkoutReadiness?.message || 'Fix setup before launching.'}
          </div>
          {!isOfferTest && failedChecks.length > 0 ? (
            <ul className={styles.errorList}>
              {failedChecks.slice(0, 4).map(check => (
                <li key={check}>{check}</li>
              ))}
            </ul>
          ) : null}
          <div className={styles.errorActions}>
            {typeof onFixSetup === 'function' ? (
              <Button variant="plain" onClick={onFixSetup}>
                Open Setup checklist
              </Button>
            ) : null}
            {typeof onRefreshCheckout === 'function' ? (
              <Button variant="plain" onClick={onRefreshCheckout}>
                Re-check
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {offerDiscountMissing ? (
        <Banner tone="info" title="Automatic discount will attach on launch">
          <p>
            The function is deployed. Launch will create the automatic discount that applies the
            offer at checkout. If that fails, re-approve write_discounts and use Ensure on Setup.
          </p>
          <div className={styles.errorActions}>
            {typeof onFixSetup === 'function' ? (
              <Button variant="plain" onClick={onFixSetup}>
                Open Setup
              </Button>
            ) : null}
          </div>
        </Banner>
      ) : null}

      {priceSurfaceNeedsAttention ? (
        <Banner tone="warning" title="Theme price selectors recommended">
          <p>
            {priceSurface.message ||
              'Map shop-wide PDP selectors so bucketed visitors see test prices on the product page.'}
          </p>
          <div className={styles.errorActions}>
            {typeof onFixPriceSurfaces === 'function' ? (
              <Button variant="plain" onClick={onFixPriceSurfaces}>
                Open Settings → Price surfaces
              </Button>
            ) : shopDomain ? (
              <Button
                variant="plain"
                url="/app/settings?tab=price-surfaces&automap=1"
                external
              >
                Open Settings → Price surfaces
              </Button>
            ) : null}
            {typeof onRefreshCheckout === 'function' ? (
              <Button variant="plain" onClick={onRefreshCheckout}>
                Re-check
              </Button>
            ) : null}
          </div>
        </Banner>
      ) : null}

      <section className={styles.reviewSection}>
        <div className={styles.reviewHead}>
          <h3>Basics</h3>
          <Button variant="plain" onClick={() => onEditStep(0)}>
            Edit
          </Button>
        </div>
        <div className={styles.reviewRows}>
          <div className={styles.reviewRow}>
            <div className={styles.kvLabel}>Name</div>
            <p className={styles.kvValue}>{name || 'Untitled experiment'}</p>
          </div>
          <div className={styles.reviewRow}>
            <div className={styles.kvLabel}>Type</div>
            <p className={styles.kvValue}>{experimentTypeLabel}</p>
          </div>
        </div>
      </section>

      <section className={styles.reviewSection}>
        <div className={styles.reviewHead}>
          <h3>Products</h3>
          <Button variant="plain" onClick={() => onEditStep(2)}>
            Edit
          </Button>
        </div>
        <div className={styles.badgeRow}>
          <Badge>Selection: {pickMode === 'all' ? 'All products' : 'Pick manually'}</Badge>
          <Badge>
            {isOfferTest
              ? `Offers: ${(variations || [])
                  .filter((arm, i) => i > 0 && arm.id !== 'control')
                  .map(arm => formatOfferRule(offerByArm[arm.id]))
                  .filter(label => label && label !== 'No offer')
                  .join(' · ') || 'Set on Products'}`
              : `Pricing: ${pricingLabel}`}
          </Badge>
          <Badge tone="info">{selectedCount || plans.length} products</Badge>
        </div>
        {isOfferTest ? (
          <p className={styles.help}>
            Assigned shoppers see the catalog price struck through, the offer price, and the
            message under that cutout. If a variation has no message, they still see the offer
            amount there. Checkout applies the discount.
          </p>
        ) : null}
        {plans.length ? (
          <div className={styles.reviewProductList}>
            {plans.slice(0, 8).map(plan => {
              const arms = plan.price_arms || [];
              const controlPrice =
                arms.find(arm => arm.role === 'control')?.price ?? arms[0]?.price;
              const variantCount =
                Number(plan.variant_count) ||
                (Array.isArray(plan.variants) ? plan.variants.length : 0) ||
                arms.length ||
                1;
              return (
                <div key={plan.id || plan.variant_id} className={styles.reviewProductRow}>
                  {plan.image_url ? (
                    <img className={styles.reviewThumb} src={plan.image_url} alt="" />
                  ) : (
                    <div className={styles.reviewThumb} aria-hidden />
                  )}
                  <div className={styles.reviewProductMeta}>
                    <div className={styles.productName}>{plan.title || plan.product_title}</div>
                    <div className={styles.productSub}>
                      {plan.product_type || 'Catalog'} · base {formatMoney(controlPrice)} ·{' '}
                      {variantCount} variant{variantCount === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div className={styles.reviewArmChips}>
                    {arms.slice(0, 3).map((arm, idx) => {
                      const isControl = arm.role === 'control' || idx === 0;
                      const delta = isControl ? null : armDelta(controlPrice, arm.price);
                      const letter =
                        arm.letter || variations[idx]?.letter || String.fromCharCode(65 + idx);
                      return (
                        <span
                          key={arm.id || idx}
                          className={`${styles.armChip} ${!isControl ? styles.armChipAlt : ''}`}
                        >
                          <span className={styles.armLetter}>{letter}</span>
                          {isOfferTest
                            ? isControl
                              ? 'No offer'
                              : formatOfferRule(arm.offer || offerByArm[arm.id])
                            : formatMoney(arm.price)}
                          {!isOfferTest && delta !== null ? (
                            <span className={delta >= 0 ? styles.deltaPos : styles.deltaNeg}>
                              {delta >= 0 ? '+' : ''}
                              {Math.round(delta)}%
                            </span>
                          ) : null}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className={styles.help}>
            Products and {isOfferTest ? 'offers' : 'prices'} will finalize when you continue from
            Products.
          </p>
        )}
      </section>

      <section className={styles.reviewSection}>
        <div className={styles.reviewHead}>
          <h3>Variations</h3>
          <Button variant="plain" onClick={() => onEditStep(1)}>
            Edit
          </Button>
        </div>
        <div className={styles.reviewRows}>
          {variations.map(arm => (
            <div key={arm.id} className={styles.reviewRow}>
              <div className={styles.kvLabel}>{arm.letter}</div>
              <p className={styles.kvValue}>
                {arm.name || arm.role} · {arm.traffic}% traffic
                {isOfferTest && arm.id !== 'control'
                  ? ` — ${formatOfferSummary(offerByArm[arm.id])}`
                  : ''}
                {arm.description ? ` — ${arm.description}` : ''}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.reviewSection}>
        <div className={styles.reviewHead}>
          <h3>Audience & metrics</h3>
          <Button variant="plain" onClick={() => onEditStep(3)}>
            Edit
          </Button>
        </div>
        <div className={styles.reviewRows}>
          <div className={styles.reviewRow}>
            <div className={styles.kvLabel}>Audience</div>
            <p className={styles.kvValue}>{segmentLabel(audience?.segment)}</p>
          </div>
          <div className={styles.reviewRow}>
            <div className={styles.kvLabel}>Traffic</div>
            <p className={styles.kvValue}>{audience?.trafficAllocation ?? 50}%</p>
          </div>
          <div className={styles.reviewRow}>
            <div className={styles.kvLabel}>Primary</div>
            <p className={styles.kvValue}>{primaryMetric}</p>
          </div>
          <div className={styles.reviewRow}>
            <div className={styles.kvLabel}>Secondary</div>
            <p className={styles.kvValue}>{secondarySummary}</p>
          </div>
          <div className={styles.reviewRow}>
            <div className={styles.kvLabel}>Guardrails</div>
            <p className={styles.kvValue}>
              {(audience?.guardrails || [])
                .filter(g => g.on || g.id === 'revenue')
                .map(g => `${g.label} (${g.threshold})`)
                .join(', ') || 'None'}
            </p>
          </div>
          <div className={styles.reviewRow}>
            <div className={styles.kvLabel}>Devices</div>
            <p className={styles.kvValue}>
              {formatModeList(audience?.deviceMode, audience?.devices, 'All devices')}
            </p>
          </div>
          <div className={styles.reviewRow}>
            <div className={styles.kvLabel}>Sources</div>
            <p className={styles.kvValue}>
              {formatModeList(audience?.sourceMode, audience?.sources, 'All sources')}
            </p>
          </div>
          <div className={styles.reviewRow}>
            <div className={styles.kvLabel}>Countries</div>
            <p className={styles.kvValue}>
              {(() => {
                const lists = resolveCountryLists(audience);
                return formatSplitCountryAudienceLabel(
                  lists.includeCountries,
                  lists.excludeCountries
                );
              })()}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
