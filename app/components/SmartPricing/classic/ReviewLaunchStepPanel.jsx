import { useMemo } from 'react';
import { Banner, Button } from '@shopify/polaris';
import { getOfferCheckoutBlockReason, isOfferExperimentType } from './offerSelection';
import { formatApproxTestDuration, PRACTICAL_TEST_MAX_DAYS } from './estimateSignificanceDuration';
import { priceSurfacesUnmapped } from '../../../utils/checkoutReadinessClient';
import TooltipWrapper from '../../shared/TooltipWrapper';
import {
  buildReviewOverviewLines,
  REVIEW_OVERVIEW_LABELS,
  REVIEW_OVERVIEW_LINE_ORDER,
} from './reviewLaunchOverview';
import styles from './SmartPricingClassic.module.css';

const TRAFFIC_TOO_LOW_BODY =
  'At your current traffic and number of variations, this test may take a long time to reach your minimum visitors per variation. To get a clearer result, try testing fewer products or fewer variations.';

/**
 * The last page before launch: the five-line summary and nothing else to read.
 *
 * Per-section cards used to repeat every step underneath the summary, each
 * with its own Edit link. The stepper and "Back to edit" already go back to any
 * step, and anything still stopping the launch is named beside the button.
 */
export default function ReviewLaunchStepPanel({
  name,
  experimentType = 'price_test',
  experimentTypeLabel = 'Price test',
  variations = [],
  selectedCount = 0,
  pickMode = 'manual',
  priceMode = 'manual',
  pricingByArm = null,
  audience,
  estimatedDays = null,
  estimatedTimeDetail = '',
  significanceEstimate = null,
  checkoutReady = true,
  checkoutLoading = false,
  checkoutReadiness = null,
  onFixSetup,
  onFixPriceSurfaces,
  onRefreshCheckout,
  plans = [],
}) {
  const failedChecks = Array.isArray(checkoutReadiness?.failed_checks)
    ? checkoutReadiness.failed_checks.filter(Boolean)
    : [];
  const priceSurface = checkoutReadiness?.price_surface || null;
  // The wizard shell carries a standing alert from step two when nothing at all
  // is mapped, so this banner covers the narrower case it does not: rows exist
  // but leave a gap.
  const priceSurfaceNeedsAttention =
    !isOfferExperimentType(experimentType) &&
    priceSurface &&
    priceSurface.ready === false &&
    !priceSurfacesUnmapped(checkoutReadiness);
  const isOfferTest = isOfferExperimentType(experimentType);
  const offerDiscountMissing =
    isOfferTest &&
    checkoutReady &&
    checkoutReadiness?.live_api_checked === true &&
    checkoutReadiness?.automatic_discount_available !== true;

  const durationNotFeasible =
    significanceEstimate?.durationFeasibility === 'not_feasible' ||
    Number(estimatedDays) > PRACTICAL_TEST_MAX_DAYS;
  // What the merchant has to act on stays in the banner; how it was worked out
  // goes behind a hint. Older callers only pass the whole paragraph, so fall
  // back to that rather than showing nothing.
  const durationSummary = significanceEstimate?.summary || estimatedTimeDetail;
  const durationMethod = significanceEstimate?.summary ? significanceEstimate.method || '' : '';
  const durationRange = significanceEstimate?.practicalDurationRange || '';
  const durationTitle = durationNotFeasible
    ? 'Traffic may be too low for a reliable result'
    : durationRange
      ? `Estimated collection window: ${durationRange}`
      : estimatedDays && estimatedDays <= PRACTICAL_TEST_MAX_DAYS
        ? `Estimated collection window: ${formatApproxTestDuration(estimatedDays)}`
        : estimatedDays
          ? 'Traffic may be too low for a reliable result'
          : 'Timeline needs measured product traffic';
  const showDurationBanner =
    durationNotFeasible ||
    !estimatedDays ||
    Boolean(String(estimatedTimeDetail || '').trim() && !significanceEstimate?.summary);

  const overviewLines = useMemo(
    () =>
      buildReviewOverviewLines({
        name,
        experimentType,
        experimentTypeLabel,
        selectedCount,
        plans,
        pickMode,
        priceMode,
        pricingByArm,
        variations,
        audience,
        significanceEstimate,
      }),
    [
      name,
      experimentType,
      experimentTypeLabel,
      selectedCount,
      plans,
      pickMode,
      priceMode,
      pricingByArm,
      variations,
      audience,
      significanceEstimate,
    ],
  );

  return (
    <div className={styles.reviewStack}>
      {checkoutLoading ? (
        <Banner tone="info" title="Checking checkout readiness…">
          <p>
            {isOfferTest
              ? 'Confirming checkout discounts before launch.'
              : 'Confirming checkout pricing functions before launch.'}
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
              : checkoutReadiness?.message || 'Complete Store setup before launching.'}
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
                Open Store setup
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

      {priceSurfaceNeedsAttention ? (
        <Banner tone="warning" title="Price locations recommended">
          <p>
            {priceSurface.message ||
              'Map shop-wide PDP selectors so bucketed visitors see test prices on the product page.'}
          </p>
          <div className={styles.errorActions}>
            {typeof onFixPriceSurfaces === 'function' ? (
              <Button variant="plain" onClick={onFixPriceSurfaces}>
                Open Settings → Price locations
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

      {showDurationBanner ? (
        <Banner
          tone={durationNotFeasible || !estimatedDays ? 'warning' : 'info'}
          title={durationTitle}
        >
          <p>
            {durationNotFeasible
              ? TRAFFIC_TOO_LOW_BODY
              : durationSummary ||
                estimatedTimeDetail ||
                `From ${audience?.trafficAllocation ?? 100}% test traffic and the products you selected.`}
          </p>
          {durationMethod ? (
            <p className={styles.help}>
              <TooltipWrapper content={durationMethod}>
                <button type="button" className={styles.helpHint} aria-label={durationMethod}>
                  How this is worked out
                </button>
              </TooltipWrapper>
            </p>
          ) : null}
        </Banner>
      ) : null}

      {offerDiscountMissing ? (
        <Banner tone="info" title="Automatic discount will attach on launch">
          <p>
            The function is deployed. If the discount fails to create, re-approve write_discounts
            from Store setup.
          </p>
          <div className={styles.errorActions}>
            {typeof onFixSetup === 'function' ? (
              <Button variant="plain" onClick={onFixSetup}>
                Open Store setup
              </Button>
            ) : null}
          </div>
        </Banner>
      ) : null}

      <section className={styles.reviewOverview} aria-label="Test summary">
        <ul className={styles.reviewOverviewList}>
          {REVIEW_OVERVIEW_LINE_ORDER.map(key => (
            <li key={key}>
              <span className={styles.reviewOverviewLabel}>{REVIEW_OVERVIEW_LABELS[key]}:</span>{' '}
              {overviewLines[key]}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
