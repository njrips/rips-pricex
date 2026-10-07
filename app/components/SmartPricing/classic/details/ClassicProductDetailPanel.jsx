import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Banner, Button, Modal, TextField } from '@shopify/polaris';
import {
  formatMetricMoney,
  formatNumber,
  formatRate,
} from '../classicExperimentDetailsHelpers';
import {
  applySmartPricingWinner,
  finishSmartPricingProduct,
  getSmartPricingProductDaily,
  getSmartPricingProductReport,
  releaseSmartPricingProduct,
  resumeSmartPricingProduct,
  revertSmartPricingProductPrice,
  rerunSmartPricingProduct,
  stopSmartPricingProduct,
} from '../../../../services/smartPricingApi';
import { resolveProductActionAvailability } from '../productActionAvailability';
import {
  buildProductArmRows,
  buildProductHistory,
  collectProductWarnings,
  describeDecisionProgress,
  formatDaysRunning,
  resolveAdminProductHref,
  resolveNeighbourProducts,
  resolveStorefrontProductHref,
  summarizeProductAnalytics,
  summarizeRounds,
} from './productDetailReport';
import ClassicProductDailyChart from './ClassicProductDailyChart';
import { useKeyedState } from '../../../../hooks/useKeyedState';
import TooltipWrapper from '../../../shared/TooltipWrapper';
import styles from '../SmartPricingClassic.module.css';

const STATE_BADGE = {
  ready_challenger: { tone: 'success', label: 'Ready' },
  ready_control: { tone: 'info', label: 'Keep price' },
  blocked: { tone: 'critical', label: 'Needs attention' },
  collecting: { tone: null, label: 'Collecting' },
  applied: { tone: 'success', label: 'Applied' },
};

const HISTORY_PREVIEW = 8;
const LIVE_REFRESH_MS = 60000;

function formatWhen(iso, { withTime = true } = {}) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  });
}

function formatSignedPercent(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const n = Number(value);
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function Delta({ value }) {
  const text = formatSignedPercent(value);
  if (!text) return <span className={styles.productSub}>—</span>;
  const tone = value > 0 ? styles.deltaPlainPos : value < 0 ? styles.deltaPlainNeg : '';
  return <span className={`${styles.deltaPlain} ${tone}`}>{text}</span>;
}

function StatCard({ label, value, note = null }) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
      {note ? <div className={styles.productSub}>{note}</div> : null}
    </div>
  );
}

/**
 * Dedicated per-product view: results, progress, variations, rounds, history
 * and lifecycle actions for one product in a test.
 */
export default function ClassicProductDetailPanel({
  shopDomain,
  planId,
  row = null,
  sharedTest = false,
  currency = 'USD',
  primaryMetric = 'revenue_per_visitor',
  products = [],
  onOpenProduct = null,
  onClose,
  onChanged,
}) {
  const [report, setReport] = useKeyedState(planId, null);
  const [loading, setLoading] = useKeyedState(`${planId}:loading`, true);
  const [loadedAt, setLoadedAt] = useKeyedState(`${planId}:loadedAt`, null);
  // Previous / Next keeps this panel mounted, so anything about one product
  // starts over when the next one opens.
  const [error, setError] = useKeyedState(planId, '');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useKeyedState(planId, '');
  const [rerunOpen, setRerunOpen] = useKeyedState(planId, false);
  const [rerunNote, setRerunNote] = useKeyedState(planId, '');
  const [useAi, setUseAi] = useState(true);
  const [driftConfirm, setDriftConfirm] = useKeyedState(planId, null);
  const [historyExpanded, setHistoryExpanded] = useKeyedState(planId, false);

  // Bumping this re-runs the fetch below, so the effect stays the only place
  // that loads the report and an action refresh cannot drift from it.
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken(token => token + 1), []);

  useEffect(() => {
    if (!shopDomain || !planId) return undefined;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const data = await getSmartPricingProductReport(shopDomain, planId);
        if (!cancelled) {
          setReport(data);
          setLoadedAt(new Date());
        }
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Could not load product report');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shopDomain, planId, reloadToken, setLoading, setReport, setLoadedAt, setError]);

  // Fetched on its own so a slow day-by-day query never holds up the numbers
  // and actions above it. A failure only hides the chart.
  const [daily, setDaily] = useKeyedState(`${planId}:daily`, null);
  useEffect(() => {
    if (!shopDomain || !planId) return undefined;
    let cancelled = false;
    getSmartPricingProductDaily(shopDomain, planId)
      .then(data => {
        if (!cancelled) setDaily(data);
      })
      .catch(() => {
        if (!cancelled) setDaily(null);
      });
    return () => {
      cancelled = true;
    };
  }, [shopDomain, planId, reloadToken, setDaily]);

  // Orders land from Shopify's webhook within seconds, so a running test's
  // numbers move while the panel is open. Hidden tabs are left alone.
  const isRunning = (report?.plan?.status || row?.plan?.status) === 'running';
  useEffect(() => {
    if (!isRunning || typeof document === 'undefined') return undefined;
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') reload();
    };
    const timer = setInterval(refreshIfVisible, LIVE_REFRESH_MS);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [isRunning, reload]);

  const neighbours = useMemo(() => resolveNeighbourProducts(products, planId), [products, planId]);
  const modalOpen = rerunOpen || Boolean(driftConfirm);

  useEffect(() => {
    const onKeyDown = event => {
      if (modalOpen || event.defaultPrevented) return;
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (!typing && event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [modalOpen, onClose]);

  const plan = report?.plan || row?.plan || null;
  const decision = report?.product_decision || row?.decision || null;
  const analytics = report?.analytics || null;
  const testId = String(plan?.test_id || row?.testId || '').trim();
  const stateBadge = STATE_BADGE[decision?.state] || { tone: null, label: plan?.status || '—' };
  const badgeLabel = decision?.label || stateBadge.label;
  const hasFollowUp = (report?.lineage || []).some(
    round =>
      round.parent_plan_id === plan?.id &&
      (round.status === 'queued' || round.status === 'draft' || round.status === 'running')
  );
  const baseline = report?.applied_baseline || plan?.applied_baseline || null;
  const hasBaseline = Boolean(baseline?.variants?.length);
  const alreadyReverted = Boolean(baseline?.reverted_at);
  const isShared = sharedTest || row?.sharedTest === true;

  const actions = useMemo(
    () =>
      resolveProductActionAvailability({
        planStatus: plan?.status,
        testStatus: analytics?.test_status || row?.testStatus,
        decision,
        sharedTest: isShared,
        hasAppliedBaseline: hasBaseline,
        hasFollowUpQueued: hasFollowUp,
        alreadyReverted,
      }),
    [plan, analytics, row, decision, isShared, hasBaseline, hasFollowUp, alreadyReverted]
  );

  const runAction = async (key, fn) => {
    if (!testId && key !== 'close') {
      setError('This product is not linked to a live test yet.');
      return;
    }
    setBusy(key);
    setMessage('');
    setError('');
    try {
      const result = await fn();
      setMessage(result?.message || 'Done.');
      reload();
      onChanged?.();
    } catch (err) {
      const details = err?.response?.data?.details;
      if (details?.code === 'PRICE_DRIFT' || err?.code === 'PRICE_DRIFT') {
        setDriftConfirm({ drifted: details?.drifted || err.drifted || [] });
      } else {
        setError(err?.message || err?.response?.data?.error || 'Action failed');
      }
    } finally {
      setBusy('');
    }
  };

  const armTable = useMemo(
    () =>
      buildProductArmRows(
        Array.isArray(analytics?.arms) ? analytics.arms : Array.isArray(row?.arms) ? row.arms : [],
        {
          primaryMetric,
          winnerArmId: analytics?.winner_arm_id || decision?.winner?.arm_id || null,
        }
      ),
    [row, primaryMetric, analytics, decision]
  );
  const stats = useMemo(() => summarizeProductAnalytics(analytics), [analytics]);
  const progress = describeDecisionProgress(decision);
  const warnings = collectProductWarnings(analytics);
  const rounds = summarizeRounds(report?.lineage, plan?.id);
  const history = buildProductHistory(report?.events);
  const visibleHistory = historyExpanded ? history : history.slice(0, HISTORY_PREVIEW);

  const title = plan?.title || row?.productTitle || row?.title || 'Product';
  const variantTitle = plan?.variant_title || row?.variantTitle || '';
  const imageUrl = plan?.image_url || row?.imageUrl || null;
  const handle =
    plan?.handle || plan?.product_handle || plan?.metadata?.handle || row?.handle || '';
  const adminHref = resolveAdminProductHref(plan?.product_id || row?.productId);
  const storeHref = resolveStorefrontProductHref(shopDomain, {
    handle,
    variantId: plan?.variant_id || row?.variantId,
  });
  const winner = decision?.winner || null;
  const significance = analytics?.significance || null;
  const autoApplyAt = decision?.auto?.eligible && decision?.auto?.apply_at ? decision.auto.apply_at : null;

  const metricColumnLabel = armTable.metric.label;

  return (
    <div className={styles.detailStack} data-testid="classic-product-detail">
      <div className={styles.productDetailNav}>
        <button type="button" className={styles.backLink} onClick={onClose}>
          ← All products
        </button>
        {onOpenProduct && neighbours.position ? (
          <div className={styles.productDetailPager}>
            <Button
              size="slim"
              disabled={!neighbours.previous}
              accessibilityLabel={
                neighbours.previous ? `Previous product: ${neighbours.previous.title || ''}` : 'Previous product'
              }
              onClick={() => onOpenProduct(neighbours.previous.planId)}
            >
              Previous
            </Button>
            <span>
              {neighbours.position} of {neighbours.total}
            </span>
            <Button
              size="slim"
              disabled={!neighbours.next}
              accessibilityLabel={
                neighbours.next ? `Next product: ${neighbours.next.title || ''}` : 'Next product'
              }
              onClick={() => onOpenProduct(neighbours.next.planId)}
            >
              Next
            </Button>
          </div>
        ) : null}
      </div>

      <div className={styles.statCard}>
        <div className={styles.productDetailHead}>
          {imageUrl ? <img className={styles.thumb} src={imageUrl} alt="" /> : null}
          <div className={styles.productDetailHeadMain}>
            <h3 className={styles.panelTitle}>{title}</h3>
            {variantTitle ? <div className={styles.productSub}>{variantTitle}</div> : null}
            <div className={styles.detailChipRow}>
              <span className={styles.detailChip}>
                Catalog price {formatMetricMoney(plan?.current_price, currency)}
              </span>
              {stats.startedAt ? (
                <span className={styles.detailChip}>
                  Started {formatWhen(stats.startedAt, { withTime: false })}
                </span>
              ) : null}
              {stats.daysRunning !== null ? (
                <span className={styles.detailChip}>
                  {analytics?.stopped_at ? 'Ran' : 'Running'} {formatDaysRunning(stats.daysRunning).toLowerCase()}
                </span>
              ) : null}
              {rounds.length > 1 ? (
                <span className={styles.detailChip}>
                  Round {rounds.find(r => r.isCurrent)?.round ?? rounds.length}
                </span>
              ) : null}
            </div>
          </div>
          <div className={styles.productDetailHeadSide}>
            <Badge tone={stateBadge.tone}>{badgeLabel}</Badge>
            <div className={styles.productDetailLinks}>
              {storeHref ? (
                <Button variant="plain" url={storeHref} target="_blank">
                  View on store
                </Button>
              ) : null}
              {adminHref ? (
                <Button variant="plain" url={adminHref} target="_top">
                  Open in Shopify admin
                </Button>
              ) : null}
              <Button variant="plain" onClick={reload} loading={loading && Boolean(report)}>
                Refresh
              </Button>
            </div>
            {loadedAt ? (
              <div className={styles.productSub}>
                Updated{' '}
                {loadedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
              </div>
            ) : null}
          </div>
        </div>

        <div className={styles.productDetailVerdict}>
          {decision?.detail ? <p className={styles.help}>{decision.detail}</p> : null}
          {winner && winner.label && decision?.state === 'ready_challenger' ? (
            <p className={styles.help}>
              <strong>{winner.label}</strong>
              {winner.price !== null && winner.price !== undefined
                ? ` at ${formatMetricMoney(winner.price, currency)}`
                : ''}
              {Number(winner.price_change_percent)
                ? ` (${formatSignedPercent(winner.price_change_percent)} on price)`
                : ''}
              {formatSignedPercent(winner.lift_percent)
                ? `, ${formatSignedPercent(winner.lift_percent)} lift`
                : ''}
              {Number.isFinite(Number(winner.confidence))
                ? ` at ${Math.round(Number(winner.confidence))}% confidence`
                : ''}
              .
            </p>
          ) : null}
          {autoApplyAt ? (
            <p className={styles.help}>
              Applies automatically on {formatWhen(autoApplyAt)} unless you decide first.
            </p>
          ) : null}
          {progress && decision?.state === 'collecting' ? (
            <div className={styles.rolloutProgress}>
              <div className={styles.productDetailRowTop}>
                <span className={styles.statLabel}>Progress to a decision</span>
                <strong>{progress.percent}%</strong>
              </div>
              <div
                className={styles.barTrack}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress.percent}
                aria-label="Progress to a decision"
              >
                <div className={styles.barFill} style={{ width: `${progress.percent}%` }} />
              </div>
              {progress.text ? <div className={styles.productSub}>{progress.text}</div> : null}
            </div>
          ) : null}

          <div className={styles.productDetailActions}>
            {actions.canApply ? (
              <Button
                variant="primary"
                loading={busy === 'apply'}
                disabled={Boolean(busy)}
                onClick={() =>
                  runAction('apply', () =>
                    applySmartPricingWinner(shopDomain, testId, {
                      publishToShopify: true,
                      stopIfRunning: true,
                    })
                  )
                }
              >
                Apply winning price
              </Button>
            ) : null}
            {actions.canFinish ? (
              <Button
                loading={busy === 'finish'}
                disabled={Boolean(busy)}
                onClick={() =>
                  runAction('finish', () => finishSmartPricingProduct(shopDomain, testId))
                }
              >
                Keep catalog price
              </Button>
            ) : null}
            {actions.canResume ? (
              <Button
                loading={busy === 'resume'}
                disabled={Boolean(busy)}
                onClick={() =>
                  runAction('resume', () => resumeSmartPricingProduct(shopDomain, testId))
                }
              >
                Resume
              </Button>
            ) : null}
            {actions.canRerun ? (
              <Button disabled={Boolean(busy)} onClick={() => setRerunOpen(true)}>
                Re-run at a new price
              </Button>
            ) : null}
            {actions.canRevert ? (
              <Button
                loading={busy === 'revert'}
                disabled={Boolean(busy)}
                onClick={() =>
                  runAction('revert', () =>
                    revertSmartPricingProductPrice(shopDomain, testId, { force: false })
                  )
                }
              >
                Revert to previous price
              </Button>
            ) : null}
            {actions.canRelease ? (
              <TooltipWrapper content="Keeps the applied catalog price, and stops this test serving it, so the product can go into a new test.">
                <Button
                  loading={busy === 'release'}
                  disabled={Boolean(busy)}
                  onClick={() =>
                    runAction('release', () => releaseSmartPricingProduct(shopDomain, testId))
                  }
                >
                  Release product
                </Button>
              </TooltipWrapper>
            ) : null}
            {actions.canStop ? (
              <Button
                tone="critical"
                loading={busy === 'stop'}
                disabled={Boolean(busy)}
                onClick={() =>
                  runAction('stop', () => stopSmartPricingProduct(shopDomain, testId))
                }
              >
                Stop this product
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {actions.sharedBlock ? (
        <Banner tone="warning" title="Shared test">
          <p>{actions.sharedBlock} The numbers below cover every product in it.</p>
        </Banner>
      ) : null}
      {error ? (
        <Banner tone="critical" onDismiss={() => setError('')}>
          <p>{error}</p>
        </Banner>
      ) : null}
      {message ? (
        <Banner tone="success" onDismiss={() => setMessage('')}>
          <p>{message}</p>
        </Banner>
      ) : null}
      {warnings.map(warning => (
        <Banner key={warning.id} tone={warning.tone} title={warning.title}>
          <p>{warning.text}</p>
        </Banner>
      ))}

      {loading && !report ? (
        <p className={styles.help}>Loading product report…</p>
      ) : (
        <>
          <div className={`${styles.statGrid} ${styles.productDetailStats}`}>
            <StatCard label="Visitors" value={formatNumber(stats.visitors)} />
            <StatCard label="Orders" value={formatNumber(stats.orders)} />
            <StatCard label="Conversion rate" value={formatRate(stats.conversionRate)} />
            <StatCard
              label="Revenue per visitor"
              value={formatMetricMoney(stats.revenuePerVisitor, currency)}
            />
            <StatCard label="Revenue" value={formatMetricMoney(stats.revenue, currency)} />
            <StatCard
              label="Average order value"
              value={formatMetricMoney(stats.avgOrderValue, currency)}
            />
          </div>

          {armTable.rows.length ? (
            <div className={styles.statCard}>
              <div className={styles.productDetailRowTop}>
                <h4 className={styles.panelTitle}>Variations</h4>
                {significance && Number.isFinite(Number(significance.confidence)) ? (
                  <span className={styles.productSub}>
                    {significance.significant ? 'Significant' : 'Not significant yet'} ·{' '}
                    {Math.round(Number(significance.confidence))}% confidence
                  </span>
                ) : null}
              </div>
              <div className={styles.detailTableWrap}>
                <table className={`${styles.detailTable} ${styles.productDetailTable}`}>
                  <thead>
                    <tr>
                      <th>Variation</th>
                      <th>Price</th>
                      <th>Traffic</th>
                      <th>Visitors</th>
                      <th>Orders</th>
                      <th>Conv. rate</th>
                      <th>Avg order</th>
                      <th>Revenue / visitor</th>
                      <th>
                        {metricColumnLabel} vs control
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {armTable.rows.map(arm => (
                      <tr key={arm.key}>
                        <td>
                          <strong>{arm.label}</strong>
                          {arm.isControl ? <span className={styles.controlBadge}>Control</span> : null}
                          {arm.isWinner ? <span className={styles.winnerBadge}>Winner</span> : null}
                          {arm.isLeading ? (
                            <span className={styles.controlBadge}>Ahead so far</span>
                          ) : null}
                          {arm.revenueTrap ? (
                            <span className={`${styles.controlBadge} ${styles.trapBadge}`}>
                              Profit down
                            </span>
                          ) : null}
                        </td>
                        <td>
                          {formatMetricMoney(arm.price, currency)}{' '}
                          {arm.priceDeltaPercent !== null ? (
                            <span className={styles.productSub}>
                              {formatSignedPercent(arm.priceDeltaPercent)}
                            </span>
                          ) : null}
                        </td>
                        <td>
                          {arm.trafficShare !== null ? `${Math.round(arm.trafficShare)}%` : '—'}
                          {arm.allocation !== null ? (
                            <span className={styles.productSub}> of {Math.round(arm.allocation)}% planned</span>
                          ) : null}
                        </td>
                        <td>{formatNumber(arm.visitors)}</td>
                        <td>{formatNumber(arm.conversions)}</td>
                        <td>{formatRate(arm.conversionRate)}</td>
                        <td>{formatMetricMoney(arm.avgOrderValue, currency)}</td>
                        <td>
                          <div className={styles.productDetailMetricCell}>
                            <span>{formatMetricMoney(arm.revenuePerVisitor, currency)}</span>
                            {armTable.metric.key === 'revenuePerVisitor' ? (
                              <div className={styles.barTrack} aria-hidden>
                                <div
                                  className={`${styles.barFill} ${arm.isWinner || arm.isLeading ? styles.barFillWinner : ''}`}
                                  style={{ width: `${arm.barPercent}%` }}
                                />
                              </div>
                            ) : null}
                          </div>
                        </td>
                        <td>{arm.isControl ? <span className={styles.productSub}>Baseline</span> : <Delta value={arm.liftPercent} />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={styles.help}>
                {armTable.metric.fallback
                  ? 'This test is judged on a custom goal, so variations are compared here on revenue per visitor. '
                  : ''}
                Traffic is the share of this product&apos;s visitors each variation received.
              </p>
            </div>
          ) : null}

          {daily && armTable.rows.length ? (
            <ClassicProductDailyChart
              daily={daily}
              rows={armTable.rows}
              currency={currency}
              primaryMetric={primaryMetric}
            />
          ) : null}

          <div className={styles.productDetailSplit}>
            <div className={styles.statCard}>
              <h4 className={styles.panelTitle}>Learning rounds</h4>
              {rounds.length === 0 ? (
                <p className={styles.help}>This is the first round for this product.</p>
              ) : (
                <ul className={styles.productDetailList}>
                  {rounds.map(round => (
                    <li key={round.planId || round.round}>
                      <div className={styles.productDetailRowTop}>
                        <strong>
                          Round {round.round}
                          {round.isCurrent ? ' (this one)' : ''}
                        </strong>
                        <span className={styles.productSub}>{round.status}</span>
                      </div>
                      <div className={styles.productSub}>
                        {round.prices.length
                          ? `Tested ${round.prices.map(p => formatMetricMoney(p, currency)).join(', ')}`
                          : 'No prices recorded'}
                        {round.visitors !== null ? ` · ${formatNumber(round.visitors)} visitors` : ''}
                        {round.autoQueued ? ' · queued automatically' : ''}
                      </div>
                      {round.winnerLabel ? (
                        <div className={styles.productSub}>
                          Winner: {round.winnerLabel}
                          {round.winnerPrice !== null ? ` at ${formatMetricMoney(round.winnerPrice, currency)}` : ''}
                          {formatSignedPercent(round.liftPercent) ? ` (${formatSignedPercent(round.liftPercent)})` : ''}
                        </div>
                      ) : null}
                      {round.reason ? <div className={styles.productSub}>Note: {round.reason}</div> : null}
                      {!round.isCurrent && round.planId && onOpenProduct ? (
                        <Button variant="plain" onClick={() => onOpenProduct(round.planId)}>
                          Open round {round.round}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className={styles.statCard}>
              <h4 className={styles.panelTitle}>History</h4>
              {history.length === 0 ? (
                <p className={styles.help}>No recorded events yet.</p>
              ) : (
                <>
                  <ul className={styles.productDetailList}>
                    {visibleHistory.map(event => (
                      <li key={event.id}>
                        <div className={styles.productDetailRowTop}>
                          <span className={styles.productName}>{event.title}</span>
                          <span className={styles.productSub}>{event.actor}</span>
                        </div>
                        {event.detail ? <div className={styles.productSub}>{event.detail}</div> : null}
                        <div className={styles.productSub}>{formatWhen(event.at)}</div>
                      </li>
                    ))}
                  </ul>
                  {history.length > HISTORY_PREVIEW ? (
                    <Button variant="plain" onClick={() => setHistoryExpanded(open => !open)}>
                      {historyExpanded ? 'Show fewer' : `Show all ${history.length} events`}
                    </Button>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </>
      )}

      <Modal
        open={rerunOpen}
        onClose={() => setRerunOpen(false)}
        title="Queue a re-run"
        primaryAction={{
          content: 'Queue re-run',
          loading: busy === 'rerun',
          onAction: () =>
            runAction('rerun', async () => {
              const result = await rerunSmartPricingProduct(shopDomain, testId, {
                useAiSuggestion: useAi,
                note: rerunNote || null,
              });
              setRerunOpen(false);
              return result;
            }),
        }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setRerunOpen(false) }]}
      >
        <Modal.Section>
          <p>
            Creates a queued follow-up round for this product. Review the new prices, then launch
            when ready. Other products in the test are not affected.
          </p>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0' }}>
            <input
              type="checkbox"
              checked={useAi}
              onChange={event => setUseAi(event.target.checked)}
            />
            Suggest prices from this test&apos;s results
          </label>
          <TextField
            label="Note (optional)"
            value={rerunNote}
            onChange={setRerunNote}
            autoComplete="off"
            multiline={2}
          />
        </Modal.Section>
      </Modal>

      <Modal
        open={Boolean(driftConfirm)}
        onClose={() => setDriftConfirm(null)}
        title="Shopify prices changed"
        primaryAction={{
          content: 'Force revert',
          destructive: true,
          loading: busy === 'revert',
          onAction: () =>
            runAction('revert', async () => {
              const result = await revertSmartPricingProductPrice(shopDomain, testId, {
                force: true,
              });
              setDriftConfirm(null);
              return result;
            }),
        }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setDriftConfirm(null) }]}
      >
        <Modal.Section>
          <p>
            Catalog prices no longer match what Priceify applied. Forcing revert will overwrite
            the current Shopify price with the pre-apply baseline.
          </p>
          {(driftConfirm?.drifted || []).slice(0, 5).map(row => (
            <div key={row.variant_id} className={styles.productSub}>
              Variant {String(row.variant_id || '').match(/(\d+)$/)?.[1] || row.variant_id}: now {formatMetricMoney(row.current_price, currency)} (applied{' '}
              {formatMetricMoney(row.expected_applied_price, currency)}) → restore{' '}
              {formatMetricMoney(row.previous_price, currency)}
            </div>
          ))}
        </Modal.Section>
      </Modal>
    </div>
  );
}
