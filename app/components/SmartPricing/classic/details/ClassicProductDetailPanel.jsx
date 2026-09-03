import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Banner, Button, Modal, TextField } from '@shopify/polaris';
import { formatCurrency } from '../../smartPricingConstants';
import { formatNumber, formatRate } from '../classicExperimentDetailsHelpers';
import {
  applySmartPricingWinner,
  finishSmartPricingProduct,
  getSmartPricingProductReport,
  resumeSmartPricingProduct,
  revertSmartPricingProductPrice,
  rerunSmartPricingProduct,
  stopSmartPricingProduct,
} from '../../../../services/smartPricingApi';
import {
  PRODUCT_EVENT_LABELS,
  resolveProductActionAvailability,
} from '../productActionAvailability';
import { useKeyedState } from '../../../../hooks/useKeyedState';
import styles from '../SmartPricingClassic.module.css';

const STATE_BADGE = {
  ready_challenger: { tone: 'success', label: 'Ready' },
  ready_control: { tone: 'info', label: 'Keep price' },
  blocked: { tone: 'critical', label: 'Needs attention' },
  collecting: { tone: null, label: 'Collecting' },
  applied: { tone: 'success', label: 'Applied' },
};

function money(value, currency) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return formatCurrency(n, currency);
}

function formatWhen(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Dedicated per-product view: metrics, lineage, events, and lifecycle actions.
 */
export default function ClassicProductDetailPanel({
  shopDomain,
  planId,
  row = null,
  sharedTest = false,
  currency = 'USD',
  onClose,
  onChanged,
}) {
  const [report, setReport] = useKeyedState(planId, null);
  const [loading, setLoading] = useKeyedState(`${planId}:loading`, true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [rerunOpen, setRerunOpen] = useState(false);
  const [rerunNote, setRerunNote] = useState('');
  const [useAi, setUseAi] = useState(true);
  const [driftConfirm, setDriftConfirm] = useState(null);

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
        if (!cancelled) setReport(data);
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Could not load product report');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shopDomain, planId, reloadToken, setLoading, setReport]);

  const plan = report?.plan || row?.plan || null;
  const decision = report?.product_decision || row?.decision || null;
  const testId = String(plan?.test_id || row?.testId || '').trim();
  const badge = STATE_BADGE[decision?.state] || { tone: null, label: plan?.status || '—' };
  const hasFollowUp = (report?.lineage || []).some(
    round =>
      round.parent_plan_id === plan?.id &&
      (round.status === 'queued' || round.status === 'draft' || round.status === 'running')
  );
  const baseline = report?.applied_baseline || plan?.applied_baseline || null;
  const hasBaseline = Boolean(baseline?.variants?.length);
  const alreadyReverted = Boolean(baseline?.reverted_at);

  const actions = useMemo(
    () =>
      resolveProductActionAvailability({
        planStatus: plan?.status,
        testStatus: report?.analytics?.test_status || row?.testStatus,
        decision,
        sharedTest: sharedTest || row?.sharedTest === true,
        hasAppliedBaseline: hasBaseline,
        hasFollowUpQueued: hasFollowUp,
        alreadyReverted,
      }),
    [plan, report, row, decision, sharedTest, hasBaseline, hasFollowUp, alreadyReverted]
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

  const arms = Array.isArray(report?.analytics?.arms)
    ? report.analytics.arms
    : Array.isArray(row?.arms)
      ? row.arms
      : [];

  return (
    <div className={styles.statCard} data-testid="classic-product-detail">
      <div className={styles.reviewHead}>
        <div>
          <h3 className={styles.panelTitle}>
            {plan?.title || row?.productTitle || row?.title || 'Product'}
          </h3>
          <div className={styles.productSub}>
            {plan?.variant_title || row?.variantTitle || ''}
            {plan?.variant_id ? ` · ${plan.variant_id}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Badge tone={badge.tone}>{badge.label}</Badge>
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>

      {actions.sharedBlock ? (
        <Banner tone="warning" title="Shared test">
          <p>{actions.sharedBlock}</p>
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

      {loading && !report ? (
        <p className={styles.help}>Loading product report…</p>
      ) : (
        <>
          <div className={styles.selectionBar}>
            <span>Current / catalog</span>
            <strong>{money(plan?.current_price, currency)}</strong>
          </div>
          {decision?.detail ? <p className={styles.help}>{decision.detail}</p> : null}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
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
            {actions.canRerun ? (
              <Button disabled={Boolean(busy)} onClick={() => setRerunOpen(true)}>
                Re-run at a new price
              </Button>
            ) : null}
          </div>

          {arms.length ? (
            <div className={styles.statCard} style={{ marginTop: 12 }}>
              <h4 className={styles.panelTitle}>Arm performance</h4>
              <div className={styles.tableScroll}>
                <table className={styles.dataTable}>
                  <thead>
                    <tr>
                      <th>Arm</th>
                      <th>Price</th>
                      <th>Visitors</th>
                      <th>Conv.</th>
                      <th>PPV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {arms.map(arm => (
                      <tr key={arm.arm_id || arm.variant_id || arm.label}>
                        <td>
                          {arm.label || arm.arm_id || '—'}
                          {arm.role === 'control' ? ' (control)' : ''}
                        </td>
                        <td>{money(arm.price, currency)}</td>
                        <td>{formatNumber(arm.visitors)}</td>
                        <td>{formatRate(arm.conversion_rate)}</td>
                        <td>{money(arm.revenue_per_visitor, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className={styles.statCard} style={{ marginTop: 12 }}>
            <h4 className={styles.panelTitle}>Learning rounds</h4>
            {(report?.lineage || []).length === 0 ? (
              <p className={styles.help}>No lineage yet.</p>
            ) : (
              <ol className={styles.activityList || undefined} style={{ paddingLeft: 18 }}>
                {(report?.lineage || []).map(round => (
                  <li key={round.plan_id} style={{ marginBottom: 8 }}>
                    <strong>Round {round.learning_round}</strong> · {round.status || '—'}
                    {round.plan_id === plan?.id ? ' (current)' : ''}
                    <div className={styles.productSub}>
                      {round.title || round.plan_id}
                      {round.rerun_reason ? ` · ${round.rerun_reason}` : ''}
                      {round.auto_queued ? ' · auto-queued' : ''}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className={styles.statCard} style={{ marginTop: 12 }}>
            <h4 className={styles.panelTitle}>History</h4>
            {(report?.events || []).length === 0 ? (
              <p className={styles.help}>No recorded events yet.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {(report?.events || []).map(event => (
                  <li
                    key={event.id}
                    style={{
                      padding: '8px 0',
                      borderBottom: '1px solid var(--p-color-border-secondary, #e1e3e5)',
                    }}
                  >
                    <div className={styles.productName}>
                      {PRODUCT_EVENT_LABELS[event.event_type] || event.event_type}
                    </div>
                    <div className={styles.productSub}>
                      {formatWhen(event.created_at)} · {event.actor}
                      {event.payload?.updated_count != null
                        ? ` · ${event.payload.updated_count} prices`
                        : ''}
                      {event.payload?.follow_up_plan_id
                        ? ` · ${event.payload.follow_up_plan_id}`
                        : ''}
                    </div>
                  </li>
                ))}
              </ul>
            )}
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
            Creates a queued follow-up plan for this product. Review the new arms, then launch
            when ready. Sibling products in the experiment are not affected.
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
            Catalog prices no longer match what Pricify applied. Forcing revert will overwrite
            the current Shopify price with the pre-apply baseline.
          </p>
          {(driftConfirm?.drifted || []).slice(0, 5).map(row => (
            <div key={row.variant_id} className={styles.productSub}>
              {row.variant_id}: now {money(row.current_price, currency)} (applied{' '}
              {money(row.expected_applied_price, currency)}) → restore{' '}
              {money(row.previous_price, currency)}
            </div>
          ))}
        </Modal.Section>
      </Modal>
    </div>
  );
}
