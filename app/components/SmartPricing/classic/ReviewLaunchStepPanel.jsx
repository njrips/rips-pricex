import { useMemo } from 'react';
import { Badge, Banner, Button } from '@shopify/polaris';
import { formatSplitCountryAudienceLabel, resolveCountryLists } from './countrySelection';
import {
  formatOfferRule,
  formatOfferSummary,
  getOfferCheckoutBlockReason,
  isOfferExperimentType,
} from './offerSelection';
import {
  classicSegmentLabel,
  normalizeSecondaryEvents,
  primaryMetricLabel,
  secondaryMetricLabel,
} from '../targeting/smartPricingAudienceHelpers';
import { parseMinSampleSize } from './classicAudienceEdit';
import { formatTrafficPercent } from './variationsStepHelpers';
import {
  formatApproxTestDuration,
  formatVisitorCount,
  PRACTICAL_TEST_MAX_DAYS,
} from './estimateSignificanceDuration';
import { IconControlBaseline } from './classicIcons';
import { priceSurfacesUnmapped } from '../../../utils/checkoutReadinessClient';
import SettingsInfoLink from '../../Settings/SettingsInfoLink';
import TooltipWrapper from '../../shared/TooltipWrapper';
import {
  buildReviewOverviewLines,
  resolveReviewPricingSummaryText,
  REVIEW_OVERVIEW_LABELS,
  REVIEW_OVERVIEW_LINE_ORDER,
} from './reviewLaunchOverview';
import styles from './SmartPricingClassic.module.css';

const TRAFFIC_TOO_LOW_BODY =
  'At your current traffic and number of variations, this test may take a long time to reach your minimum visitors per variation. To get a clearer result, try testing fewer products or fewer variations.';

function formatModeList(mode, values, emptyLabel) {
  const list = (Array.isArray(values) ? values : []).filter(Boolean);
  if (!list.length) return emptyLabel;
  const prefix = mode === 'exclude' ? 'Exclude' : 'Include';
  return `${prefix}: ${list.join(', ')}`;
}


export default function ReviewLaunchStepPanel({
  name,
  hypothesis = '',
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
  significanceEstimate = null,
  checkoutReady = true,
  checkoutLoading = false,
  checkoutReadiness = null,
  onFixSetup,
  onFixPriceSurfaces,
  onRefreshCheckout,
  onEditStep,
  plans = [],
  /**
   * Why Launch is refusing, for the reasons this page does not already cover
   * with a block of its own. A disabled button with no visible explanation is
   * the same dead end as an enabled one that errors on click.
   */
  launchBlockedReason = '',
  /**
   * The shop-level automatic price write. It has no Settings field any more,
   * but shops that turned it on still have it on and the server still honours
   * it, so the Analysis row has to say which way this experiment will end.
   */
  autoApplyWinner = false,
  autoApplyDelayDays = 0,
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

  const revenueGuardrailRow = (audience?.guardrails || []).find(row => row?.id === 'revenue');
  const guardrailSummary =
    revenueGuardrailRow && revenueGuardrailRow.on === false
      ? 'Off'
      : `Pause below ${String(revenueGuardrailRow?.threshold || '-10%').replace(/^-/, '')}`;

  const failedChecks = Array.isArray(checkoutReadiness?.failed_checks)
    ? checkoutReadiness.failed_checks.filter(Boolean)
    : [];
  const priceSurface = checkoutReadiness?.price_surface || null;
  // The wizard shell carries a standing alert from step two when nothing at all
  // is mapped, so this banner covers the narrower case it does not: rows exist
  // but leave a gap. Without the exclusion the review step said the same thing
  // twice, in two different tones.
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

  const pricingSummary = resolveReviewPricingSummaryText({
    isOfferTest,
    priceMode,
    pricingByArm,
    variations,
  });
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
  // Naming doc Step 5: optional traffic warning at top; feasible timeline lives in Results/overview.
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
        bulkPercent,
        bulkDirection,
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
      bulkPercent,
      bulkDirection,
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

      {launchBlockedReason ? (
        <Banner tone="critical" title="Not ready to launch tests yet">
          <p>{launchBlockedReason}</p>
        </Banner>
      ) : null}

      {priceSurfaceNeedsAttention ? (
        <Banner tone="warning" title="Price locations recommended">
          <p>
            {priceSurface.message ||
              'Map shop-wide PDP selectors so bucketed visitors see test prices on the product page.'}
          </p>
          <div className={styles.errorActions}>
            {/* The fallback here was an `external` link to an in-app route,
                which would have opened Settings in a bare tab outside App
                Bridge. It was also unreachable: the wizard is the only caller
                and it always passes the handler. */}
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

      <section className={styles.reviewSection}>
        <div className={styles.reviewHead}>
          <h2>Basics</h2>
          <Button variant="plain" accessibilityLabel="Edit basics" onClick={() => onEditStep(0)}>
            Edit
          </Button>
        </div>
        <div className={styles.reviewRows}>
          <div className={styles.reviewRow}>
            <div className={styles.kvLabel}>Name</div>
            <p className={styles.kvValue}>{name || 'Untitled test'}</p>
          </div>
          <div className={styles.reviewRow}>
            <div className={styles.kvLabel}>Type</div>
            <p className={styles.kvValue}>{experimentTypeLabel}</p>
          </div>
          {/* Launched with the experiment, so leaving it off this page made a
              hypothesis the merchant had written look like it had been lost. */}
          {String(hypothesis || '').trim() ? (
            <div className={styles.reviewRow}>
              <div className={styles.kvLabel}>Hypothesis</div>
              <p className={styles.kvValue}>{hypothesis}</p>
            </div>
          ) : null}
        </div>
      </section>

      <section className={styles.reviewSection}>
        <div className={styles.reviewHead}>
          <h2>{isOfferTest ? 'Products & offers' : 'Products & prices'}</h2>
          <Button
            variant="plain"
            accessibilityLabel={isOfferTest ? 'Edit products and offers' : 'Edit products'}
            onClick={() => onEditStep(2)}
          >
            Edit
          </Button>
        </div>
        <div className={styles.badgeRow}>
          {/* The count leads: with the product list gone it is the fact this
              card exists to report. */}
          <Badge tone="info">{selectedCount || plans.length} products</Badge>
          <Badge>{pickMode === 'all' ? 'All products' : 'Picked products'}</Badge>
          <Badge>
            {isOfferTest
              ? `Offers: ${(variations || [])
                  .filter((arm, i) => i > 0 && arm.id !== 'control')
                  .map(arm => formatOfferRule(offerByArm[arm.id]))
                  .filter(label => label && label !== 'No offer')
                  .join(' · ') || 'Set on Products'}`
              : `Pricing: ${pricingSummary}`}
          </Badge>
        </div>
        {/* This listed up to eight products with a thumbnail, base price and a
            price chip per arm -- a third copy of the pricing table two steps
            back, and the tallest thing on a page whose job is one last glance
            before launching. The count and the pricing mode are what a review
            needs; Edit goes to the table for the rest. */}
        {!plans.length ? (
          <p className={styles.help}>
            {isOfferTest ? 'Offers' : 'Prices'} finalize when you continue from Products.
          </p>
        ) : null}
      </section>

      <section className={styles.reviewSection}>
        <div className={styles.reviewHead}>
          <h2>Variations & traffic</h2>
          <Button
            variant="plain"
            accessibilityLabel="Edit variations"
            onClick={() => onEditStep(1)}
          >
            Edit
          </Button>
        </div>
        {/* How much of the audience enters at all. This sat under Audience,
            whose Edit goes to a step that no longer carries the control -- it
            moved next to the split it feeds. The percentages below divide this
            number, so they only make sense underneath it. */}
        <p className={styles.help} style={{ margin: 0 }}>
          {audience?.trafficAllocation ?? 100}% of eligible visitors enter, split as:
        </p>
        <div className={styles.reviewRows}>
          {variations.map((arm, index) => {
            const isControl = index === 0 || arm.id === 'control';
            return (
              <div key={arm.id} className={styles.reviewRow}>
                <div className={styles.kvLabel}>
                  <span
                    className={`${styles.armLetter} ${
                      isControl ? styles.controlVariationMarker : ''
                    }`}
                    aria-label={
                      isControl
                        ? 'Control — current catalog baseline'
                        : `Variation ${arm.letter}`
                    }
                  >
                    {isControl ? <IconControlBaseline size={10} /> : arm.letter}
                  </span>
                </div>
                <p className={styles.kvValue}>
                  {arm.name || arm.role} · {formatTrafficPercent(arm.traffic)}% traffic
                  {isOfferTest && arm.id !== 'control'
                    ? ` — ${formatOfferSummary(offerByArm[arm.id])}`
                    : ''}
                  {arm.description ? ` — ${arm.description}` : ''}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* One card held eleven label/value rows in a single 96px-label column,
          which ran tall, left most of its width empty and mixed who is being
          tested with what is being measured. Two cards in a two-column grid,
          matching the sections the Audience step now uses, so a merchant
          checking their setup is reading the same shape they filled in. */}
      <section className={styles.reviewSection}>
        <div className={styles.reviewHead}>
          <h2>Audience</h2>
          <Button variant="plain" accessibilityLabel="Edit audience" onClick={() => onEditStep(3)}>
            Edit
          </Button>
        </div>
        <div className={styles.reviewGrid}>
          <div className={styles.reviewGridItem}>
            <div className={styles.kvLabel}>Segment</div>
            <p className={styles.kvValue}>{classicSegmentLabel(audience?.segment)}</p>
          </div>
          <div className={styles.reviewGridItem}>
            <div className={styles.kvLabel}>Devices</div>
            <p className={styles.kvValue}>
              {formatModeList(audience?.deviceMode, audience?.devices, 'All devices')}
            </p>
          </div>
          <div className={styles.reviewGridItem}>
            <div className={styles.kvLabel}>Sources</div>
            <p className={styles.kvValue}>
              {formatModeList(audience?.sourceMode, audience?.sources, 'All sources')}
            </p>
          </div>
          <div className={`${styles.reviewGridItem} ${styles.reviewGridWide}`}>
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
        <p className={styles.help} style={{ marginTop: 8 }}>
          Only visitors who match these filters can enter the test.
        </p>
      </section>

      <section className={styles.reviewSection}>
        <div className={styles.reviewHead}>
          <h2>Metrics & guardrail</h2>
          <Button variant="plain" accessibilityLabel="Edit metrics" onClick={() => onEditStep(3)}>
            Edit
          </Button>
        </div>
        <div className={styles.reviewGrid}>
          <div className={styles.reviewGridItem}>
            <div className={styles.kvLabel}>Primary</div>
            <p className={styles.kvValue}>{primaryMetric}</p>
          </div>
          <div className={styles.reviewGridItem}>
            <div className={styles.kvLabel}>Secondary</div>
            <p className={styles.kvValue}>{secondarySummary}</p>
          </div>
          <div className={styles.reviewGridItem}>
            <div className={styles.kvLabel}>
              Min visitors
              <SettingsInfoLink hash="min-sample" label="Minimum visitors per variation" />
            </div>
            <p className={styles.kvValue}>
              {formatVisitorCount(parseMinSampleSize(audience?.minSampleSize))} visitors
            </p>
          </div>
          {significanceEstimate?.recommendedSampleSize ? (
            <div className={styles.reviewGridItem}>
              <div className={styles.kvLabel}>
                Planning reference
                <SettingsInfoLink hash="min-sample" label="Planning sample" />
              </div>
              <p className={styles.kvValue}>
                {formatVisitorCount(significanceEstimate.recommendedSampleSize)} visitors
                {significanceEstimate.powerRating === 'underpowered'
                  ? ' · below minimum visitors'
                  : ''}
              </p>
            </div>
          ) : null}
          <div className={styles.reviewGridItem}>
            <div className={styles.kvLabel}>
              Revenue guardrail
              <SettingsInfoLink hash="guardrail-metrics" label="Revenue guardrail" />
            </div>
            {/* The guardrail is switchable per experiment, and this row used to
                print a threshold either way -- telling a merchant who turned it
                off that it would pause their test. */}
            <p className={styles.kvValue}>{guardrailSummary}</p>
          </div>
          <div className={styles.reviewGridItem}>
            <div className={styles.kvLabel}>
              Analysis
              <SettingsInfoLink hash="sequential" label="Sequential testing" />
            </div>
            {/* This said "manual winner review" whichever way the shop was
                set. A shop with automatic price writes on would read that
                promise on the last page before launching an experiment that
                will edit its catalog without asking again. */}
            <p className={styles.kvValue}>
              Sequential · {significanceEstimate?.confidenceLevel || 90}% confidence ·{' '}
              {autoApplyWinner
                ? `winners apply automatically${
                    autoApplyDelayDays > 0
                      ? ` after ${autoApplyDelayDays} day${autoApplyDelayDays === 1 ? '' : 's'}`
                      : ''
                  }`
                : 'manual winner review'}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
