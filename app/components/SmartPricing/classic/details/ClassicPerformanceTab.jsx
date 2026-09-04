import { useMemo } from 'react';
import { Banner, Button, Select, TextField } from '@shopify/polaris';
import { useKeyedState } from '../../../../hooks/useKeyedState';
import { formatCurrency } from '../../smartPricingConstants';
import { formatOfferRule } from '../offerSelection';
import {
  VARIATION_PRODUCTS_PAGE_SIZE,
  VARIATION_PRODUCTS_PAGE_SIZES,
  filterSortProductPerformance,
  formatMetricMoney,
  formatNumber,
  formatRate,
  paginateVariationProducts,
} from '../classicExperimentDetailsHelpers';
import { IconTrophy } from '../classicIcons';
import { TooltipWrapper } from '../../../shared';
import ClassicRolloutReadinessPanel from './ClassicRolloutReadinessPanel';
import styles from '../SmartPricingClassic.module.css';

/**
 * Revenue per visitor is the money metric of record here.
 *
 * Profit per visitor used to sit beside it in every chart, total and column.
 * It looked like a second, independent measurement and it was not: a launch
 * stamps one shop-wide cost-of-goods percentage onto the goal, and live profit
 * is computed as revenue minus that percentage of revenue. Profit per visitor
 * was therefore revenue per visitor times a constant — at the default 55% cost
 * assumption, exactly 45% of it, in every row, with an identical ranking. It
 * added a column and a decision to read, and no information.
 *
 * Real per-variant cost does exist for the price-band and margin guardrails,
 * which read Shopify's unit cost. Live analytics never used it. Until it does,
 * this tab reports what the store actually took.
 */
const MONEY_HELP = {
  rpvByVariation:
    'Revenue per visitor for this variation: sales divided by visitors. Each product counts once, however much traffic it got.',
  rpvAllTraffic:
    'Revenue per visitor across the whole experiment, control and variations together, weighted by visitors. Higher or lower than the per-variation averages because busier products pull it further.',
  armRpv: 'Measured revenue per visitor for this variation, averaged across the products in it.',
};

/** Table heading that explains itself on hover. */
function MetricHeading({ label, help }) {
  return (
    <th>
      <TooltipWrapper content={help}>
        <span>{label}</span>
      </TooltipWrapper>
    </th>
  );
}

/** Totals row: label with an explanation, value on the right. */
function TotalsRow({ label, help, value }) {
  return (
    <div className={styles.selectionBar}>
      {help ? (
        <TooltipWrapper content={help}>
          <span>{label}</span>
        </TooltipWrapper>
      ) : (
        <span>{label}</span>
      )}
      <strong>{value}</strong>
    </div>
  );
}

function AverageMetricChart({
  title,
  subtitle,
  help,
  rows,
  valueKey,
  barWidthKey,
  formatValue,
  leadingLabel = 'Winner',
}) {
  return (
    <div className={styles.statCard}>
      <div className={styles.reviewHead}>
        <h3 className={styles.panelTitle}>
          <TooltipWrapper content={help}>
            <span>{title}</span>
          </TooltipWrapper>
        </h3>
        {subtitle ? <span className={styles.productSub}>{subtitle}</span> : null}
      </div>
      {rows.length ? (
        rows.map(row => (
          <div key={`${title}:${row.id}`} className={styles.conversionRow}>
            <div className={styles.conversionRowMeta}>
              <span>
                <strong>{row.label}</strong>
                {row.isControl ? <span className={styles.controlBadge}>Control</span> : null}
                {row.isWinner ? (
                  <span className={styles.winnerBadge}>
                    <IconTrophy size={10} /> {leadingLabel}
                  </span>
                ) : null}
              </span>
              <strong>{formatValue(row[valueKey])}</strong>
            </div>
            <div className={styles.barTrack}>
              <div
                className={`${styles.barFill} ${row.isWinner ? styles.barFillWinner : ''}`}
                style={{ width: `${row[barWidthKey] || 0}%` }}
              />
            </div>
          </div>
        ))
      ) : (
        <p className={styles.help}>Variation averages appear after launch.</p>
      )}
    </div>
  );
}

export default function ClassicPerformanceTab({
  analytics,
  analyticsLoading,
  currency = 'USD',
  variationAverages = [],
  productPerformanceRows = [],
  rolloutRows = [],
  variations = [],
  isOfferTest = false,
  onApplyProduct,
  onFinishProduct,
  onApplyAllReady,
  onOpenProduct,
  rolloutBusyTestId = null,
  rolloutApplyingAll = false,
}) {
  const arms = Array.isArray(analytics?.arms) ? analytics.arms : [];
  const averages = Array.isArray(variationAverages) ? variationAverages : [];
  const resolvedCurrency = analytics?.currency || currency;
  const armColumns =
    Array.isArray(variations) && variations.length
      ? variations
      : averages.map(row => ({
          id: row.id,
          label: row.label,
          isControl: row.isControl,
        }));

  // A different result set (new analytics, or rows added/removed) starts the
  // product table over rather than leaving a stale search on an empty page.
  const productViewKey = `${productPerformanceRows.length}|${analytics?.test_id ?? ''}|${
    analytics?.test_count ?? ''
  }`;
  const [query, setQuery] = useKeyedState(productViewKey, '');
  const [sort, setSort] = useKeyedState(productViewKey, 'title');
  const [page, setPage] = useKeyedState(productViewKey, 1);
  const [pageSize, setPageSize] = useKeyedState(productViewKey, VARIATION_PRODUCTS_PAGE_SIZE);

  const filteredProducts = useMemo(
    () =>
      filterSortProductPerformance(productPerformanceRows, {
        query,
        sort,
      }),
    [productPerformanceRows, query, sort]
  );

  // Clamped for us, so every reader below goes through pageData.page.
  const pageData = useMemo(
    () => paginateVariationProducts(filteredProducts, page, pageSize),
    [filteredProducts, page, pageSize]
  );

  if (analyticsLoading && !arms.length && !averages.length && !productPerformanceRows.length) {
    return (
      <div className={styles.statCard}>
        <p className={styles.help}>Loading arm performance…</p>
      </div>
    );
  }

  if (!arms.length && !averages.length && !productPerformanceRows.length) {
    return (
      <div className={styles.statCard}>
        <h3 className={styles.panelTitle}>Performance</h3>
        <p className={styles.help}>
          Live arm analytics appear once this experiment is launched and collecting visitors.
        </p>
      </div>
    );
  }

  const productCount = productPerformanceRows.length;
  const uniqueTestIds = new Set(productPerformanceRows.map(row => row.testId).filter(Boolean));
  const testCount = Number(analytics?.test_count) || uniqueTestIds.size || (arms.length ? 1 : 0);
  const sharedNote = productPerformanceRows.some(row => row.sharedTest);

  const revenueRail = analytics?.revenue_guardrail;
  const significance = analytics?.significance;
  const evidenceValidated = significance?.evidenceValidated === true;
  // The split check rides on significance, but older payloads carried it at the
  // top level of analytics, so both shapes are read.
  const srm = significance?.srm || analytics?.srm || null;
  const srmDetected = srm?.detected === true;
  const srmPValue = srm?.pValue ?? null;
  const isConversionFamily = String(significance?.family || '') === 'conversion';
  const awaitingMaturity =
    significance?.outcomesMatured === false &&
    (significance?.significant === true || significance?.controlWin === true);

  return (
    <div className={styles.detailStack}>
      {/* Assignment integrity comes before any reading of the result: if the
          split is wrong, the arms are not comparable and the numbers below
          cannot be acted on. */}
      {srmDetected ? (
        <Banner tone="critical" title="Traffic split does not match this test">
          <p>
            Visitors did not reach the variations in the proportions this test asked for
            {Number.isFinite(Number(srmPValue)) ? ` (p = ${Number(srmPValue)})` : ''}. That usually
            means bot traffic, a tracking problem, or a caching layer serving one variation more
            often. Until it is resolved the variations are not comparable, so winner rollout is
            blocked and no price will be written automatically.
          </p>
        </Banner>
      ) : null}
      {awaitingMaturity ? (
        <Banner tone="info" title="Waiting for orders to settle">
          <p>
            The evidence has reached its threshold, but this test has been collecting for{' '}
            {Math.max(0, Math.floor(Number(significance.collectionDays) || 0))} of{' '}
            {Number(significance.outcomeMaturityDays) || 14} days. A price is not written
            automatically until the test covers two full weekly cycles, so a single strong week
            cannot decide a catalog price. You can still roll out the winner manually.
          </p>
        </Banner>
      ) : null}
      {analytics?.significance?.sampleReady === false &&
      Number(analytics?.significance?.minSampleSize) > 0 ? (
        <Banner tone="info" title="Waiting for minimum sample size">
          <p>
            {analytics.significance.message ||
              `Results are not called until each variation reaches ${analytics.significance.minSampleSize} visitors.`}
          </p>
        </Banner>
      ) : analytics?.significance?.sequential &&
        analytics?.significance?.significant !== true &&
        analytics?.significance?.controlWin !== true &&
        analytics?.significance?.sampleReady !== false ? (
        <Banner tone="info" title="Sequential test still collecting evidence">
          <p>
            {!evidenceValidated
              ? isConversionFamily
                ? 'Conversion results are confirmed against an exact boundary before any price is written automatically. Until that boundary is crossed the reading here is directional, so review it before rolling out a winner.'
                : 'Revenue per visitor is measured with an order-value variance approximation, so this metric always needs manual review before a price is rolled out.'
              : analytics.significance.message ||
                'Always-valid conversion testing decides each product on its own. A winning variation can be written to that product’s Shopify price; a control win leaves that catalog price unchanged.'}
            {Number(analytics.significance.recommendedSampleSize) > 0
              ? ` Fixed-horizon planning reference: ${Number(analytics.significance.recommendedSampleSize).toLocaleString('en-US')} visitors/variation.`
              : ''}
          </p>
        </Banner>
      ) : null}
      {revenueRail?.breached || revenueRail?.enforced ? (
        <Banner tone="warning" title="Paused by revenue guardrail">
          <p>
            Revenue per visitor dropped {revenueRail.observed_drop_percent}% vs control (limit{' '}
            {revenueRail.threshold_percent}%). Traffic assignment stopped.
          </p>
        </Banner>
      ) : revenueRail?.ready && Number.isFinite(Number(revenueRail.observed_drop_percent)) ? (
        <p className={styles.help}>
          Largest revenue drop vs control: {revenueRail.observed_drop_percent}% (limit{' '}
          {revenueRail.threshold_percent}%).
        </p>
      ) : null}
      {/* Products finish at different times, so what to do next comes before the
          experiment-wide averages. */}
      <ClassicRolloutReadinessPanel
        rows={rolloutRows}
        currency={resolvedCurrency}
        onApplyProduct={onApplyProduct}
        onFinishProduct={onFinishProduct}
        onApplyAllReady={onApplyAllReady}
        onOpenProduct={onOpenProduct}
        busyTestId={rolloutBusyTestId}
        applyingAll={rolloutApplyingAll}
      />
      <div className={styles.statCard}>
        <div className={styles.reviewHead}>
          <h3 className={styles.panelTitle}>Average performance by variation</h3>
          <span className={styles.productSub}>
            {productCount > 1
              ? `Across ${productCount} products${testCount > 1 ? ` · ${testCount} tests` : ''}`
              : analytics?.summary?.visitors !== null && analytics?.summary?.visitors !== undefined
                ? `${formatNumber(analytics.summary.visitors)} visitors`
                : null}
          </span>
        </div>
        <p className={styles.help} style={{ marginTop: 0 }}>
          Charts use averages across products that have live data
          {testCount > 1 ? ' (each product test counted once)' : ''}.
        </p>
      </div>

      <div className={styles.overviewSplit}>
        <AverageMetricChart
          title="Avg conversion"
          subtitle="By variation"
          rows={averages}
          valueKey="avg_conversion_rate"
          barWidthKey="conversionBarWidth"
          formatValue={formatRate}
          leadingLabel={isOfferTest ? 'Leading' : 'Winner'}
        />
        <AverageMetricChart
          title="Avg visitors"
          subtitle="By variation"
          rows={averages}
          valueKey="avg_visitors"
          barWidthKey="visitorsBarWidth"
          formatValue={formatNumber}
          leadingLabel={isOfferTest ? 'Leading' : 'Winner'}
        />
      </div>

      <AverageMetricChart
        title="Avg revenue / visitor"
        subtitle={`By variation · ${resolvedCurrency}`}
        help={MONEY_HELP.rpvByVariation}
        rows={averages}
        valueKey="avg_revenue_per_visitor"
        barWidthKey="rpvBarWidth"
        formatValue={value => formatMetricMoney(value, resolvedCurrency)}
        leadingLabel={isOfferTest ? 'Leading' : 'Winner'}
      />

      <div className={styles.statCard}>
        <div className={styles.reviewHead}>
          <h3 className={styles.panelTitle}>Totals</h3>
        </div>
        <TotalsRow label="Products" value={formatNumber(productCount)} />
        <TotalsRow label="Visitors" value={formatNumber(analytics?.summary?.visitors)} />
        <TotalsRow label="Conversions" value={formatNumber(analytics?.summary?.conversions)} />
        <TotalsRow
          label="Revenue per visitor, all traffic"
          help={MONEY_HELP.rpvAllTraffic}
          value={formatMetricMoney(analytics?.summary?.live_weighted_rpv, resolvedCurrency)}
        />
      </div>

      {arms.length ? (
        <div className={styles.statCard}>
          <div className={styles.reviewHead}>
            <h3 className={styles.panelTitle}>Arm rollup</h3>
            <span className={styles.productSub}>
              {analytics?.multi_test ? 'Merged across product tests' : 'Experiment arms'}
            </span>
          </div>
          <div className={styles.detailTableWrap}>
            <table className={styles.detailTable}>
              <thead>
                <tr>
                  <th>Variation</th>
                  <th>{isOfferTest ? 'Offer' : 'Price'}</th>
                  <th>Visitors</th>
                  <th>Conversion</th>
                  <MetricHeading label="Revenue / visitor" help={MONEY_HELP.armRpv} />
                  {/* Forecast and "vs forecast" are gone with the profit
                      columns. Both were profit figures, and the comparison was
                      not sound: the forecast used each product's real margin
                      where Shopify had a unit cost, while the measured side
                      used the flat shop-wide cost assumption. */}
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {arms.map(arm => {
                  const trap = arm.revenue_trap_live || arm.revenue_trap_projected;
                  return (
                    <tr key={arm.arm_id || arm.variant_id || arm.label}>
                      <td>
                        <strong>{arm.label || arm.variant_name || arm.role || '—'}</strong>
                        {arm.role === 'control' ? (
                          <span className={styles.controlBadge}>Control</span>
                        ) : null}
                      </td>
                      <td>
                        {isOfferTest
                          ? arm.role === 'control' || arm.isControl
                            ? 'No offer'
                            : formatOfferRule(
                                (variations || []).find(
                                  row =>
                                    String(row.id) === String(arm.arm_id || arm.id) ||
                                    String(row.label) === String(arm.label)
                                )?.offer,
                                resolvedCurrency
                              )
                          : formatCurrency(arm.price, resolvedCurrency)}
                      </td>
                      <td>{formatNumber(arm.visitors)}</td>
                      <td>{formatRate(arm.conversion_rate)}</td>
                      <td>{formatMetricMoney(arm.revenue_per_visitor, resolvedCurrency)}</td>
                      <td>
                        <span className={trap ? styles.trapBadge : styles.okBadge}>
                          {trap ? 'Revenue trap' : 'OK'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className={`${styles.statCard} ${styles.variationsProductsPanel}`}>
        <div className={styles.variationProductBlockHead}>
          <div>
            <h3 className={styles.panelTitle}>Product performance by variation</h3>
            <p className={styles.help} style={{ margin: 0 }}>
              {filteredProducts.length} product{filteredProducts.length === 1 ? '' : 's'}
              {sharedNote
                ? ' · some SKUs share a test — live metrics are test-level, not SKU-attributed'
                : ''}
            </p>
          </div>
        </div>

        <div className={styles.variationsProductsToolbar}>
          <div className={styles.variationsProductsSearch}>
            <TextField
              label="Search product performance"
              labelHidden
              value={query}
              onChange={value => {
                setQuery(value);
                setPage(1);
              }}
              autoComplete="off"
              placeholder="Search products, variants, or handle"
            />
          </div>
          <div className={styles.tablePageSize}>
            <Select
              label="Sort"
              labelHidden
              value={sort}
              onChange={value => {
                setSort(value);
                setPage(1);
              }}
              options={[
                { label: 'Name A–Z', value: 'title' },
                { label: 'Visitors (high → low)', value: 'visitors_desc' },
                { label: 'Conversion (high → low)', value: 'conversion_desc' },
                { label: 'Revenue per visitor (high → low)', value: 'rpv_desc' },
              ]}
            />
          </div>
          <div className={styles.tablePageSize}>
            <Select
              label="Rows"
              labelHidden
              value={String(pageSize)}
              onChange={value => {
                setPageSize(Number(value) || VARIATION_PRODUCTS_PAGE_SIZE);
                setPage(1);
              }}
              options={VARIATION_PRODUCTS_PAGE_SIZES.map(size => ({
                label: String(size),
                value: String(size),
              }))}
            />
          </div>
        </div>

        <div className={`${styles.tableScroll} ${styles.variationsProductsTableScroll}`}>
          <table className={styles.table} aria-label="Product performance by variation">
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">Decision</th>
                {armColumns.map(arm => (
                  <th key={arm.id} scope="col" className={styles.variationsPriceCol}>
                    {arm.label}
                    {arm.isControl ? ' · Ctrl' : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!pageData.items.length ? (
                <tr>
                  <td colSpan={armColumns.length + 2}>
                    <p className={styles.help}>
                      {query.trim() ? 'No products match that search.' : 'No products to show.'}
                    </p>
                  </td>
                </tr>
              ) : (
                pageData.items.map(row => (
                  <tr key={row.key} className={styles.productPriceRow}>
                    <td>
                      <div className={styles.productMeta}>
                        <button
                          type="button"
                          className={styles.linkButton || undefined}
                          style={{
                            background: 'none',
                            border: 0,
                            padding: 0,
                            color: 'inherit',
                            textAlign: 'left',
                            cursor: onOpenProduct && row.planId ? 'pointer' : 'default',
                            font: 'inherit',
                          }}
                          onClick={() => {
                            if (onOpenProduct && row.planId) onOpenProduct(row.planId);
                          }}
                        >
                          <div className={styles.productName}>{row.productTitle || row.title}</div>
                        </button>
                        <div className={styles.productSub}>
                          {row.variantTitle ? `${row.variantTitle} · ` : ''}
                          {row.handle ? `/${row.handle}` : row.productId || '—'}
                          {row.sharedTest ? ' · shared test' : ''}
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className={styles.productName}>{row.decisionLabel || '—'}</div>
                      {row.sharedTest ? (
                        <div className={styles.productSub}>
                          Shared test — stop/re-run at experiment level
                        </div>
                      ) : null}
                    </td>
                    {armColumns.map(arm => {
                      const metrics = row.metricsByArmId?.[String(arm.id)] || null;
                      return (
                        <td key={`${row.key}:${arm.id}`} className={styles.variationsPriceCol}>
                          <div className={styles.productName}>
                            {formatRate(metrics?.conversion_rate)}
                          </div>
                          <div className={styles.productSub}>
                            {formatNumber(metrics?.visitors)} vis ·{' '}
                            {formatMetricMoney(
                              metrics?.revenue_per_visitor,
                              row.currency || resolvedCurrency
                            )}{' '}
                            rev/visitor
                          </div>
                          <div className={styles.productSub}>
                            {isOfferTest
                              ? arm.isControl || arm.role === 'control'
                                ? 'No offer'
                                : formatOfferRule(arm.offer, row.currency || resolvedCurrency)
                              : metrics?.price !== null && metrics?.price !== undefined
                                ? formatCurrency(metrics.price, row.currency || resolvedCurrency)
                                : '—'}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {(pageData.totalPages > 1 || pageData.total > VARIATION_PRODUCTS_PAGE_SIZE) && (
          <div className={styles.variationsProductsFooter}>
            <span className={styles.productSub}>
              {pageData.total
                ? `Showing ${Math.min(
                    (pageData.page - 1) * pageData.pageSize + 1,
                    pageData.total
                  )}–${Math.min(pageData.page * pageData.pageSize, pageData.total)} of ${
                    pageData.total
                  } products`
                : '0 products'}
            </span>
            <div className={styles.tablePager}>
              <Button
                disabled={pageData.page <= 1}
                onClick={() => setPage(Math.max(1, pageData.page - 1))}
              >
                Previous
              </Button>
              <span className={styles.productSub}>
                Page {pageData.page} / {pageData.totalPages}
              </span>
              <Button
                disabled={pageData.page >= pageData.totalPages}
                onClick={() => setPage(Math.min(pageData.totalPages, pageData.page + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
