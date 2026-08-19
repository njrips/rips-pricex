import React, { useEffect, useMemo, useState } from 'react';
import { Banner, Button, Select, TextField } from '@shopify/polaris';
import { formatCurrency } from '../../smartPricingConstants';
import { formatOfferRule } from '../offerSelection';
import {
  VARIATION_PRODUCTS_PAGE_SIZE,
  VARIATION_PRODUCTS_PAGE_SIZES,
  filterSortProductPerformance,
  formatNumber,
  formatRate,
  paginateVariationProducts,
} from '../classicExperimentDetailsHelpers';
import { IconTrophy } from '../classicIcons';
import styles from '../SmartPricingClassic.module.css';

function formatPpv(value, currency) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return formatCurrency(n, currency);
}

function AverageMetricChart({
  title,
  subtitle,
  rows,
  valueKey,
  barWidthKey,
  formatValue,
  leadingLabel = 'Winner',
}) {
  return (
    <div className={styles.statCard}>
      <div className={styles.reviewHead}>
        <h3 className={styles.panelTitle}>{title}</h3>
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
  variations = [],
  isOfferTest = false,
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

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('title');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(VARIATION_PRODUCTS_PAGE_SIZE);

  useEffect(() => {
    setQuery('');
    setSort('title');
    setPage(1);
    setPageSize(VARIATION_PRODUCTS_PAGE_SIZE);
  }, [productPerformanceRows.length, analytics?.test_id, analytics?.test_count]);

  const filteredProducts = useMemo(
    () =>
      filterSortProductPerformance(productPerformanceRows, {
        query,
        sort,
      }),
    [productPerformanceRows, query, sort]
  );

  const pageData = useMemo(
    () => paginateVariationProducts(filteredProducts, page, pageSize),
    [filteredProducts, page, pageSize]
  );

  useEffect(() => {
    if (page !== pageData.page) setPage(pageData.page);
  }, [page, pageData.page]);

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

  return (
    <div className={styles.detailStack}>
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

      <div className={styles.overviewSplit}>
        <AverageMetricChart
          title="Avg profit / visitor"
          subtitle={resolvedCurrency}
          rows={averages}
          valueKey="avg_profit_per_visitor"
          barWidthKey="ppvBarWidth"
          formatValue={value => formatPpv(value, resolvedCurrency)}
          leadingLabel={isOfferTest ? 'Leading' : 'Winner'}
        />
        <div className={styles.statCard}>
          <div className={styles.reviewHead}>
            <h3 className={styles.panelTitle}>Totals</h3>
          </div>
          <div className={styles.selectionBar}>
            <span>Products</span>
            <strong>{formatNumber(productCount)}</strong>
          </div>
          <div className={styles.selectionBar}>
            <span>Visitors</span>
            <strong>{formatNumber(analytics?.summary?.visitors)}</strong>
          </div>
          <div className={styles.selectionBar}>
            <span>Conversions</span>
            <strong>{formatNumber(analytics?.summary?.conversions)}</strong>
          </div>
          <div className={styles.selectionBar}>
            <span>Live weighted PPV</span>
            <strong>{formatPpv(analytics?.summary?.live_weighted_ppv, resolvedCurrency)}</strong>
          </div>
          <div className={styles.selectionBar}>
            <span>Projected best PPV</span>
            <strong>{formatPpv(analytics?.summary?.projected_best_ppv, resolvedCurrency)}</strong>
          </div>
        </div>
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
                  <th>PPV</th>
                  <th>Projected</th>
                  <th>vs proj</th>
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
                      <td>{formatPpv(arm.profit_per_visitor, resolvedCurrency)}</td>
                      <td>{formatPpv(arm.projected_ppv, resolvedCurrency)}</td>
                      <td>
                        {arm.ppv_vs_projection_delta === null ||
                        arm.ppv_vs_projection_delta === undefined
                          ? '—'
                          : `${arm.ppv_vs_projection_delta >= 0 ? '+' : ''}${formatPpv(
                              arm.ppv_vs_projection_delta,
                              resolvedCurrency
                            )}`}
                      </td>
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
                { label: 'PPV (high → low)', value: 'ppv_desc' },
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
                  <td colSpan={armColumns.length + 1}>
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
                        <div className={styles.productName}>{row.productTitle || row.title}</div>
                        <div className={styles.productSub}>
                          {row.variantTitle ? `${row.variantTitle} · ` : ''}
                          {row.handle ? `/${row.handle}` : row.productId || '—'}
                          {row.sharedTest ? ' · shared test' : ''}
                        </div>
                      </div>
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
                            {formatPpv(
                              metrics?.profit_per_visitor,
                              row.currency || resolvedCurrency
                            )}{' '}
                            PPV
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
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className={styles.productSub}>
                Page {pageData.page} / {pageData.totalPages}
              </span>
              <Button
                disabled={pageData.page >= pageData.totalPages}
                onClick={() => setPage(p => Math.min(pageData.totalPages, p + 1))}
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
