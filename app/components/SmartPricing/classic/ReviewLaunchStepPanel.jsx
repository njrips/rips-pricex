import React from 'react';
import { formatCountryCodesSummary } from '../../../utils/iso3166CountryDisplay';
import {
  normalizeSecondaryEvents,
  primaryMetricLabel,
  secondaryMetricLabel,
} from '../targeting/smartPricingAudienceHelpers';
import { IconSparkles } from './classicIcons';
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
  experimentTypeLabel = 'Price test',
  variations = [],
  selectedCount = 0,
  pickMode = 'manual',
  priceMode = 'manual',
  bulkPercent = '10',
  bulkDirection = 'increase',
  pricingByArm = null,
  audience,
  estimatedDays = 7,
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
  const priceSurfaceNeedsAttention = priceSurface && priceSurface.ready === false;

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
      <div className={styles.callout}>
        <span className={styles.calloutIcon} aria-hidden>
          <IconSparkles size={16} />
        </span>
        <span className={styles.calloutBody}>
          <span className={styles.calloutStrong}>
            Estimated time to significance: ~{estimatedDays} days
          </span>
          <span className={styles.calloutMeta}>
            Based on {audience?.trafficAllocation ?? 50}% traffic and typical visitor volume.
          </span>
        </span>
      </div>

      {checkoutLoading ? (
        <div className={styles.callout} role="status">
          <span className={styles.calloutBody}>
            <span className={styles.calloutStrong}>Checking checkout readiness…</span>
            <span className={styles.calloutMeta}>
              Confirming cart transform and pricing infra before launch.
            </span>
          </span>
        </div>
      ) : !checkoutReady ? (
        <div className={styles.error} role="alert">
          <div>
            <strong>Checkout is not ready for price tests.</strong>{' '}
            {checkoutReadiness?.message || 'Fix setup before launching.'}
          </div>
          {failedChecks.length > 0 ? (
            <ul className={styles.errorList}>
              {failedChecks.slice(0, 4).map(check => (
                <li key={check}>{check}</li>
              ))}
            </ul>
          ) : null}
          <div className={styles.errorActions}>
            {typeof onFixSetup === 'function' ? (
              <button type="button" className={styles.editLink} onClick={onFixSetup}>
                Open Setup checklist
              </button>
            ) : null}
            {typeof onRefreshCheckout === 'function' ? (
              <button type="button" className={styles.editLink} onClick={onRefreshCheckout}>
                Re-check
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {priceSurfaceNeedsAttention ? (
        <div className={styles.callout} role="status">
          <span className={styles.calloutBody}>
            <span className={styles.calloutStrong}>Theme price selectors recommended</span>
            <span className={styles.calloutMeta}>
              {priceSurface.message ||
                'Map shop-wide PDP selectors so bucketed visitors see test prices on the product page.'}
            </span>
          </span>
          <div className={styles.errorActions}>
            {typeof onFixPriceSurfaces === 'function' ? (
              <button type="button" className={styles.editLink} onClick={onFixPriceSurfaces}>
                Open Settings → Price surfaces
              </button>
            ) : shopDomain ? (
              <a
                className={styles.editLink}
                href={`/app/settings?tab=price-surfaces&automap=1`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Settings → Price surfaces
              </a>
            ) : null}
            {typeof onRefreshCheckout === 'function' ? (
              <button type="button" className={styles.editLink} onClick={onRefreshCheckout}>
                Re-check
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <section className={styles.reviewSection}>
        <div className={styles.reviewHead}>
          <h3>Basics</h3>
          <button type="button" className={styles.editLink} onClick={() => onEditStep(0)}>
            Edit
          </button>
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
          <button type="button" className={styles.editLink} onClick={() => onEditStep(2)}>
            Edit
          </button>
        </div>
        <div className={styles.badgeRow}>
          <span className={styles.badge}>
            Selection: <strong>{pickMode === 'all' ? 'All products' : 'Pick manually'}</strong>
          </span>
          <span className={styles.badge}>
            Pricing: <strong>{pricingLabel}</strong>
          </span>
          <span className={`${styles.badge} ${styles.badgeAccent}`}>
            {selectedCount || plans.length} products
          </span>
        </div>
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
                          {formatMoney(arm.price)}
                          {delta !== null ? (
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
            Products and prices will finalize when you continue from Products.
          </p>
        )}
      </section>

      <section className={styles.reviewSection}>
        <div className={styles.reviewHead}>
          <h3>Variations</h3>
          <button type="button" className={styles.editLink} onClick={() => onEditStep(1)}>
            Edit
          </button>
        </div>
        <div className={styles.reviewRows}>
          {variations.map(arm => (
            <div key={arm.id} className={styles.reviewRow}>
              <div className={styles.kvLabel}>{arm.letter}</div>
              <p className={styles.kvValue}>
                {arm.name || arm.role} · {arm.traffic}% traffic
                {arm.description ? ` — ${arm.description}` : ''}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.reviewSection}>
        <div className={styles.reviewHead}>
          <h3>Audience & metrics</h3>
          <button type="button" className={styles.editLink} onClick={() => onEditStep(3)}>
            Edit
          </button>
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
                .filter(g => g.on)
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
                const summary = formatCountryCodesSummary(audience?.countries || []);
                if (!summary) return 'Worldwide';
                const mode = audience?.countryMode === 'exclude' ? 'Exclude' : 'Include';
                return `${mode}: ${summary}`;
              })()}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
