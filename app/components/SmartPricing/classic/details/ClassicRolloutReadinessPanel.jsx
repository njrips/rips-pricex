import { useMemo, useState } from 'react';
import { Badge, Banner, Button, Modal } from '@shopify/polaris';
import { formatCurrency } from '../../smartPricingConstants';
import {
  formatNumber,
  formatRate,
  summarizeRolloutRows,
} from '../classicExperimentDetailsHelpers';
import { IconTrophy } from '../classicIcons';
import styles from '../SmartPricingClassic.module.css';

const STATE_BADGE = {
  ready_challenger: { tone: 'success', label: 'Ready' },
  ready_control: { tone: 'info', label: 'Keep price' },
  blocked: { tone: 'critical', label: 'Needs attention' },
  collecting: { tone: null, label: 'Collecting' },
  applied: { tone: 'success', label: 'Applied' },
};

const LOADING_BADGE = { tone: null, label: 'Loading' };

/**
 * A real, positive amount, or null.
 *
 * `Number(null)` is 0 and passes `Number.isFinite`, so a missing price would
 * render as a confident "$0.00". Offer tests have no catalog price at all, so
 * that is the common case rather than an edge one.
 */
function amount(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function money(value, currency) {
  const n = amount(value);
  if (n === null) return '—';
  return formatCurrency(n, currency);
}

/** For measurements where zero is a real reading rather than a missing one. */
function metricMoney(value, currency) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return formatCurrency(n, currency);
}

function formatWhen(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysSince(iso) {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / 86400000));
}

/** The price move, or the offer that won when there is no catalog price. */
function PriceMove({ decision, currency }) {
  const winner = decision?.winner;
  if (!winner) return <span className={styles.help}>—</span>;
  if (decision.state === 'ready_control') {
    const held = amount(winner.current_price);
    return <span>{held === null ? 'Current price held' : `${money(held, currency)} held`}</span>;
  }
  if (amount(winner.price) === null) {
    return <span>{winner.label || '—'}</span>;
  }
  const change = Number(winner.price_change_percent);
  return (
    <span>
      {money(winner.current_price, currency)} → <strong>{money(winner.price, currency)}</strong>
      {Number.isFinite(change) ? (
        <span className={styles.productSub}> ({change > 0 ? '+' : ''}{change}%)</span>
      ) : null}
    </span>
  );
}

function ProgressCell({ decision }) {
  const progress = decision?.progress;
  const percent = Number(progress?.percent);
  if (!Number.isFinite(percent)) return <span className={styles.help}>—</span>;
  const limit = progress.limited_by === 'conversions' ? 'orders' : 'visitors';
  const have = progress.limited_by === 'conversions' ? progress.conversions : progress.visitors;
  const need =
    progress.limited_by === 'conversions'
      ? progress.required_conversions
      : progress.required_visitors;
  return (
    <div className={styles.rolloutProgress}>
      <div className={styles.barTrack}>
        <div className={styles.barFill} style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
      <span className={styles.productSub}>
        {need ? `${formatNumber(have)} / ${formatNumber(need)} ${limit}` : `${percent}%`}
      </span>
    </div>
  );
}

function ProductDetailModal({ row, onClose, onApply, onFinish, busy }) {
  if (!row) return null;
  const { decision, arms, significance, currency } = row;
  const validated = decision?.winner?.evidence_validated === true;
  const waitedDays = daysSince(decision?.ready_since);
  const autoAt = formatWhen(decision?.auto?.apply_at);

  return (
    <Modal
      open
      onClose={onClose}
      title={row.title}
      primaryAction={
        decision?.can_apply
          ? { content: 'Apply this price', onAction: () => onApply(row), loading: busy }
          : decision?.can_finish
            ? { content: 'Finish this product', onAction: () => onFinish(row), loading: busy }
            : undefined
      }
      secondaryActions={[{ content: 'Close', onAction: onClose }]}
    >
      <Modal.Section>
        <p className={styles.help}>{decision?.detail}</p>
        {decision?.ready_since ? (
          <p className={styles.help}>
            Ready since {formatWhen(decision.ready_since)}
            {waitedDays !== null ? ` (${waitedDays} day${waitedDays === 1 ? '' : 's'} ago)` : ''}
            {autoAt ? ` · Pricify applies this automatically on ${autoAt}` : ''}
          </p>
        ) : null}
        {decision?.state === 'ready_challenger' && !validated ? (
          <Banner tone="warning">
            This variation is ahead on directional evidence only. The exact boundary has not
            confirmed it, so the call is yours rather than the app&apos;s.
          </Banner>
        ) : null}
      </Modal.Section>
      <Modal.Section>
        <div className={styles.detailTableWrap}>
          <table className={styles.detailTable}>
            <thead>
              <tr>
                <th>Variation</th>
                <th>Price</th>
                <th>Visitors</th>
                <th>Orders</th>
                <th>Conversion</th>
                <th>Revenue / visitor</th>
              </tr>
            </thead>
            <tbody>
              {arms.map(arm => {
                const isWinner =
                  decision?.winner?.arm_id && String(arm.arm_id) === String(decision.winner.arm_id);
                return (
                  <tr key={arm.arm_id}>
                    <td>
                      {arm.label}
                      {String(arm.role || '').toLowerCase() === 'control' ? (
                        <span className={styles.controlBadge}>Control</span>
                      ) : null}
                      {isWinner ? (
                        <span className={styles.winnerBadge}>
                          <IconTrophy size={10} /> Winner
                        </span>
                      ) : null}
                    </td>
                    <td>{money(arm.price, currency)}</td>
                    <td>{formatNumber(arm.visitors)}</td>
                    <td>{formatNumber(arm.conversions)}</td>
                    <td>{formatRate(arm.conversion_rate)}</td>
                    <td>{metricMoney(arm.revenue_per_visitor, currency)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Modal.Section>
      {significance ? (
        <Modal.Section>
          <p className={styles.help}>
            Method: {significance.method || 'n/a'}
            {significance.confidence != null
              ? ` · Confidence ${Number(significance.confidence).toFixed(1)}%`
              : ''}
            {significance.evidenceValidated
              ? ' · Confirmed by the exact boundary'
              : ' · Directional evidence'}
          </p>
        </Modal.Section>
      ) : null}
    </Modal>
  );
}

/**
 * The rollout queue for a multi-product experiment.
 *
 * Each product is its own test and reaches a verdict on its own schedule, so
 * this lists them by what needs the merchant rather than making them end the
 * whole experiment to act on the one product that finished.
 */
export default function ClassicRolloutReadinessPanel({
  rows = [],
  currency = 'USD',
  onApplyProduct,
  onFinishProduct,
  onApplyAllReady,
  onOpenProduct,
  busyTestId = null,
  applyingAll = false,
}) {
  const [openRow, setOpenRow] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const summary = useMemo(() => summarizeRolloutRows(rows), [rows]);

  const openDetails = row => {
    if (onOpenProduct && row?.planId) {
      onOpenProduct(row.planId);
      return;
    }
    setOpenRow(row);
  };

  if (!rows.length) return null;

  const visibleRows = showAll ? rows : rows.slice(0, 10);
  const soonestAuto = rows
    .map(row => row.decision?.auto?.apply_at)
    .filter(Boolean)
    .sort()[0];

  return (
    <div className={`${styles.statCard} ${styles.rolloutPanel}`}>
      <div className={styles.reviewHead}>
        <div>
          <h3 className={styles.panelTitle}>Rollout readiness</h3>
          <span className={styles.productSub}>
            {summary.readyCount > 0
              ? `${summary.readyCount} of ${summary.total} products have reached a decision. The rest keep running.`
              : `None of the ${summary.total} products have reached a decision yet.`}
          </span>
        </div>
        {summary.actionableTestIds.length > 0 ? (
          <Button
            variant="primary"
            loading={applyingAll}
            disabled={Boolean(busyTestId)}
            onClick={() => setConfirmBulk(true)}
          >
            {`Apply all ready (${summary.actionableTestIds.length})`}
          </Button>
        ) : null}
      </div>

      {summary.counts.blocked > 0 ? (
        <Banner tone="critical">
          {summary.counts.blocked} product{summary.counts.blocked === 1 ? '' : 's'} cannot be
          trusted yet because the traffic split does not match the test. Those rows are excluded
          from any bulk action.
        </Banner>
      ) : null}

      {soonestAuto ? (
        <Banner tone="info">
          Automatic price writes are on. The first confirmed winner will be applied on{' '}
          {formatWhen(soonestAuto)} unless you apply or override it before then.
        </Banner>
      ) : null}

      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Product</th>
              <th>Status</th>
              <th>Decision</th>
              <th>Progress</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(row => {
              const badge = row.loading
                ? LOADING_BADGE
                : STATE_BADGE[row.state] || STATE_BADGE.collecting;
              const rowCurrency = row.currency || currency;
              const busy = busyTestId === row.testId;
              const autoAt = row.decision?.auto?.apply_at;
              return (
                <tr key={row.key}>
                  <td>
                    <button
                      type="button"
                      className={styles.rolloutProductLink}
                      onClick={() => openDetails(row)}
                    >
                      {row.productTitle}
                    </button>
                    {row.variantTitle ? (
                      <div className={styles.productSub}>{row.variantTitle}</div>
                    ) : null}
                  </td>
                  <td>
                    <Badge tone={badge.tone || undefined}>{badge.label}</Badge>
                  </td>
                  <td>
                    {row.loading ? (
                      <span className={styles.help}>Fetching results…</span>
                    ) : (
                      <>
                        <PriceMove decision={row.decision} currency={rowCurrency} />
                        <div className={`${styles.productSub} ${styles.rolloutDecisionNote}`}>
                          {row.decision?.detail}
                          {autoAt ? ` Pricify applies this on ${formatWhen(autoAt)}.` : ''}
                        </div>
                      </>
                    )}
                  </td>
                  <td>{row.loading ? null : <ProgressCell decision={row.decision} />}</td>
                  <td>
                    {row.decision?.can_apply ? (
                      <Button
                        size="slim"
                        variant="primary"
                        loading={busy}
                        disabled={applyingAll}
                        onClick={() => onApplyProduct?.(row)}
                      >
                        Apply
                      </Button>
                    ) : row.decision?.can_finish ? (
                      <Button
                        size="slim"
                        loading={busy}
                        disabled={applyingAll}
                        onClick={() => onFinishProduct?.(row)}
                      >
                        Finish
                      </Button>
                    ) : (
                      <Button
                        size="slim"
                        variant="plain"
                        disabled={row.loading}
                        onClick={() => openDetails(row)}
                      >
                        Details
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows.length > 10 ? (
        <Button variant="plain" onClick={() => setShowAll(value => !value)}>
          {showAll ? 'Show fewer' : `Show all ${rows.length} products`}
        </Button>
      ) : null}

      {/* Bulk apply writes live catalog prices, so it asks first and says
          exactly how many of them are price changes. */}
      {confirmBulk ? (
        <Modal
          open
          onClose={() => setConfirmBulk(false)}
          title={`Apply ${summary.actionableTestIds.length} ready products?`}
          primaryAction={{
            content: 'Apply them',
            loading: applyingAll,
            onAction: () => {
              setConfirmBulk(false);
              onApplyAllReady?.(summary.actionableTestIds);
            },
          }}
          secondaryActions={[{ content: 'Cancel', onAction: () => setConfirmBulk(false) }]}
        >
          <Modal.Section>
            <p className={styles.help}>
              {summary.priceWriteCount > 0
                ? `${summary.priceWriteCount} product${summary.priceWriteCount === 1 ? '' : 's'} will have a new price written to your Shopify catalog and stop testing.`
                : 'No catalog prices will change.'}
              {summary.actionableTestIds.length - summary.priceWriteCount > 0
                ? ` ${summary.actionableTestIds.length - summary.priceWriteCount} will finish on the price they already have.`
                : ''}
            </p>
            <p className={styles.help}>
              Products still collecting are left running, and anything flagged for attention is
              skipped. Each product is applied on its own, so a failure on one does not stop the
              others.
            </p>
          </Modal.Section>
        </Modal>
      ) : null}

      <ProductDetailModal
        row={openRow}
        busy={busyTestId === openRow?.testId}
        onClose={() => setOpenRow(null)}
        onApply={row => {
          setOpenRow(null);
          onApplyProduct?.(row);
        }}
        onFinish={row => {
          setOpenRow(null);
          onFinishProduct?.(row);
        }}
      />
    </div>
  );
}
