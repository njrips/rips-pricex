import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import PageShell from '../../shared/PageShell';
import { ROUTES } from '../../../constants';
import { apiPost } from '../../../services';
import useClassicShopDomain from '../../../hooks/useClassicShopDomain';
import { useClassicExperimentDetails } from '../../../hooks/useClassicExperimentDetails';
import { useSmartPricingWinnerRollout } from '../../../hooks/useSmartPricingWinnerRollout';
import { patchServerInboxPlan } from '../smartPricingInboxPersistence';
import WinnerApplyModal from '../components/WinnerApplyModal';
import {
  IconArrowLeft,
  IconChart,
  IconFlask,
  IconGear,
  IconMore,
  IconOverview,
  IconPause,
  IconPerson,
  IconPulse,
  IconTarget,
  IconTrophy,
} from './classicIcons';
import ClassicOverviewTab from './details/ClassicOverviewTab';
import ClassicPerformanceTab from './details/ClassicPerformanceTab';
import ClassicVariationsTab from './details/ClassicVariationsTab';
import ClassicAudienceTab from './details/ClassicAudienceTab';
import ClassicMetricsTab from './details/ClassicMetricsTab';
import ClassicActivityTab from './details/ClassicActivityTab';
import ClassicSettingsTab from './details/ClassicSettingsTab';
import styles from './SmartPricingClassic.module.css';

const TABS = [
  { id: 'Overview', icon: IconOverview },
  { id: 'Performance', icon: IconChart },
  { id: 'Variations', icon: IconFlask },
  { id: 'Audience', icon: IconPerson },
  { id: 'Metrics', icon: IconTarget },
  { id: 'Activity', icon: IconPulse },
  { id: 'Settings', icon: IconGear },
];

export default function ClassicExperimentOverview() {
  const { planId } = useParams();
  const navigate = useNavigate();
  const shopDomain = useClassicShopDomain();
  const [tab, setTab] = useState('Overview');
  const [busyAction, setBusyAction] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [winnerModalOpen, setWinnerModalOpen] = useState(false);
  const moreRef = useRef(null);

  const details = useClassicExperimentDetails(shopDomain, planId);
  const {
    loading,
    analyticsLoading,
    experiment,
    plan,
    test,
    testId,
    analytics,
    kpis,
    conversionRows,
    variationAverages,
    productPerformanceRows,
    variations,
    audience,
    metrics,
    activity,
    settings,
    message,
    messageType,
    setMessage,
    setMessageType,
    refresh,
    patchPlanLocal,
  } = details;

  const { applying, previewLoadingPlanId, preview, loadPreview, clearPreview, applyWinner } =
    useSmartPricingWinnerRollout(shopDomain);

  useEffect(() => {
    if (!moreOpen) return undefined;
    const onDoc = event => {
      if (moreRef.current && !moreRef.current.contains(event.target)) {
        setMoreOpen(false);
      }
    };
    const onKey = event => {
      if (event.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  const isDraft = experiment?.status === 'draft' || experiment?.status === 'queued';
  const status = resolveStatus(plan, test, experiment);
  const isRunning = status === 'running';
  const isPaused = status === 'paused' || status === 'stopped';
  // Only enable when analytics declared a promoteable winner arm.
  const canRollOut = Boolean(testId && analytics?.winner_arm_id);

  const experimentTitle = experiment?.title || plan?.title || 'Experiment';
  const currency = plan?.currency || analytics?.currency || 'USD';

  const showError = (err, fallback) => {
    setMessageType('error');
    setMessage(err?.message || fallback);
  };

  const showSuccess = text => {
    setMessageType('success');
    setMessage(text);
  };

  const handlePause = async () => {
    if (!testId || busyAction || !plan?.id) return;
    setBusyAction('pause');
    try {
      await apiPost(`/tests/${encodeURIComponent(testId)}/stop`, {});
      patchPlanLocal({ status: 'paused' });
      await patchServerInboxPlan(shopDomain, plan.id, { status: 'paused' }).catch(() => null);
      showSuccess('Experiment paused.');
      // Delay refresh so merchant_stop inbox sync can land as paused, not winner_ready.
      setTimeout(() => refresh(), 400);
    } catch (err) {
      showError(err, 'Could not pause experiment.');
    } finally {
      setBusyAction('');
    }
  };

  const handleResume = async () => {
    if (!testId || busyAction || !plan?.id) return;
    setBusyAction('resume');
    setMoreOpen(false);
    try {
      // Force skips Self-QA / preflight blocks that often fail on password-protected shops.
      await apiPost(`/tests/${encodeURIComponent(testId)}/start`, {
        force: true,
        forceReason: 'classic_resume_after_pause',
      });
      patchPlanLocal({ status: 'running' });
      await patchServerInboxPlan(shopDomain, plan.id, { status: 'running' }).catch(() => null);
      showSuccess('Experiment resumed.');
      refresh();
    } catch (err) {
      showError(err, 'Could not resume experiment.');
    } finally {
      setBusyAction('');
    }
  };

  const handleRollOut = async () => {
    if (!plan?.test_id || busyAction) return;
    setBusyAction('winner');
    try {
      await loadPreview(plan);
      setWinnerModalOpen(true);
    } catch (err) {
      showError(err, 'Could not load winner preview.');
    } finally {
      setBusyAction('');
    }
  };

  const handleConfirmWinner = async () => {
    try {
      await applyWinner(plan, { publishToShopify: true });
      setWinnerModalOpen(false);
      clearPreview();
      showSuccess('Winner rolled out to Shopify.');
      refresh();
    } catch (err) {
      showError(err, 'Could not apply winner.');
    }
  };

  const copyTestId = async () => {
    setMoreOpen(false);
    if (!testId) return;
    try {
      await navigator.clipboard.writeText(String(testId));
      showSuccess('Test ID copied.');
    } catch {
      showError(null, 'Could not copy test ID.');
    }
  };

  if (!loading && !plan) {
    return (
      <PageShell message={message || 'Experiment not found.'} messageType="error">
        <div className={styles.listPage}>
          <button
            type="button"
            className={styles.backLink}
            onClick={() => navigate(ROUTES.appSmartPricing(shopDomain))}
          >
            <IconArrowLeft /> Experiments
          </button>
          <p className={styles.help}>
            That plan is missing from the Smart Pricing inbox. It may have been deleted, or this
            browser is out of sync — try refreshing the experiments list.
          </p>
          <button type="button" className={styles.ghostBtn} onClick={refresh}>
            Retry load
          </button>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell message={message} messageType={messageType} onCloseMessage={() => setMessage('')}>
      <div className={styles.listPage}>
        <button
          type="button"
          className={styles.backLink}
          onClick={() => navigate(ROUTES.appSmartPricing(shopDomain))}
        >
          <IconArrowLeft /> Experiments
        </button>

        <div className={`${styles.listHeader} ${styles.overviewHeader}`}>
          <div className={styles.overviewHeaderCopy}>
            <div className={styles.overviewTitleRow}>
              <h1 className={`${styles.overviewTitle} ripx-classic-sans`}>{experimentTitle}</h1>
              <span className={`${styles.statusPill} ${statusPillClass(status, styles)}`}>
                <span className={styles.statusDot} />
                {statusLabel(status)}
              </span>
            </div>
            <p className={styles.overviewHypothesis}>
              {plan?.hypothesis ||
                plan?.metadata?.hypothesis ||
                experiment?.hypothesis ||
                'Price test experiment overview.'}
            </p>
            <div className={styles.overviewMeta}>
              <span>Owner · {plan?.owner_name || plan?.created_by_name || 'You'}</span>
              <span>Type · Price test</span>
              {plan?.created_at || test?.started_at || test?.created_at ? (
                <span>
                  Started ·{' '}
                  {String(test?.started_at || test?.created_at || plan?.created_at).slice(0, 10)}
                </span>
              ) : null}
            </div>
          </div>
          <div className={styles.overviewActions}>
            {isDraft ? (
              <button
                type="button"
                className={`${styles.primaryBtn} ${styles.overviewActionBtn}`}
                onClick={() =>
                  navigate(
                    `${ROUTES.appSmartPricingCreate(shopDomain)}?resume=${encodeURIComponent(
                      experiment?.id || planId
                    )}`
                  )
                }
              >
                Continue editing
              </button>
            ) : (
              <>
                {isRunning ? (
                  <button
                    type="button"
                    className={`${styles.ghostBtn} ${styles.overviewActionBtn}`}
                    disabled={Boolean(busyAction) || !testId}
                    onClick={handlePause}
                  >
                    <IconPause /> {busyAction === 'pause' ? 'Pausing…' : 'Pause'}
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`${styles.primaryBtn} ${styles.overviewActionBtn}`}
                  disabled={Boolean(busyAction) || !canRollOut}
                  onClick={handleRollOut}
                  title={
                    canRollOut
                      ? 'Apply winning price to Shopify'
                      : 'Available when a winner is statistically ready'
                  }
                >
                  <IconTrophy />{' '}
                  {busyAction === 'winner' || previewLoadingPlanId === plan?.id
                    ? 'Loading…'
                    : 'Roll out winner'}
                </button>
              </>
            )}
            <div className={styles.moreMenuWrap} ref={moreRef}>
              <button
                type="button"
                className={styles.iconGhostBtn}
                aria-label="More actions"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen(open => !open)}
              >
                <IconMore />
              </button>
              {moreOpen ? (
                <div className={styles.moreMenu} role="menu">
                  {isPaused && testId ? (
                    <button type="button" role="menuitem" onClick={handleResume}>
                      {busyAction === 'resume' ? 'Resuming…' : 'Resume experiment'}
                    </button>
                  ) : null}
                  {testId ? (
                    <button type="button" role="menuitem" onClick={copyTestId}>
                      Copy test ID
                    </button>
                  ) : null}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMoreOpen(false);
                      refresh();
                    }}
                  >
                    Refresh data
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div
          className={styles.overviewTabs}
          role="tablist"
          aria-label="Experiment sections"
          onKeyDown={event => {
            const ids = TABS.map(item => item.id);
            const index = ids.indexOf(tab);
            if (event.key === 'ArrowRight') {
              event.preventDefault();
              setTab(ids[(index + 1) % ids.length]);
            } else if (event.key === 'ArrowLeft') {
              event.preventDefault();
              setTab(ids[(index - 1 + ids.length) % ids.length]);
            } else if (event.key === 'Home') {
              event.preventDefault();
              setTab(ids[0]);
            } else if (event.key === 'End') {
              event.preventDefault();
              setTab(ids[ids.length - 1]);
            }
          }}
        >
          {TABS.map(item => {
            const Icon = item.icon;
            const selected = tab === item.id;
            return (
              <button
                key={item.id}
                id={`classic-tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`classic-panel-${item.id}`}
                tabIndex={selected ? 0 : -1}
                className={`${styles.overviewTab} ${selected ? styles.overviewTabActive : ''}`}
                onClick={() => setTab(item.id)}
              >
                <Icon />
                {item.id}
              </button>
            );
          })}
        </div>

        <div
          id={`classic-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`classic-tab-${tab}`}
          className={styles.overviewTabPanel}
        >
          {tab === 'Overview' ? (
            <ClassicOverviewTab
              kpis={kpis}
              conversionRows={conversionRows}
              analyticsLoading={analyticsLoading}
            />
          ) : null}
          {tab === 'Performance' ? (
            <ClassicPerformanceTab
              analytics={analytics}
              analyticsLoading={analyticsLoading}
              currency={currency}
              variationAverages={variationAverages}
              productPerformanceRows={productPerformanceRows}
              variations={variations}
            />
          ) : null}
          {tab === 'Variations' ? (
            <ClassicVariationsTab
              variations={variations}
              currency={currency}
              shopDomain={shopDomain}
              testId={testId}
            />
          ) : null}
          {tab === 'Audience' ? <ClassicAudienceTab audience={audience} /> : null}
          {tab === 'Metrics' ? <ClassicMetricsTab metrics={metrics} /> : null}
          {tab === 'Activity' ? <ClassicActivityTab activity={activity} /> : null}
          {tab === 'Settings' ? <ClassicSettingsTab settings={settings} /> : null}
        </div>
      </div>

      <WinnerApplyModal
        open={winnerModalOpen}
        plan={plan}
        preview={preview?.data || null}
        loadingPreview={previewLoadingPlanId === plan?.id}
        applying={applying}
        onClose={() => {
          setWinnerModalOpen(false);
          clearPreview();
        }}
        onConfirm={handleConfirmWinner}
      />
    </PageShell>
  );
}

function resolveStatus(plan, test, experiment) {
  const planStatus = String(plan?.status || experiment?.status || '')
    .trim()
    .toLowerCase();
  const testStatus = String(test?.status || '')
    .trim()
    .toLowerCase();

  // Prefer inbox merchant pause over raw stopped → winner_ready race.
  if (planStatus === 'paused') return 'paused';
  if (planStatus === 'winner_ready') return 'winner_ready';
  if (planStatus === 'applied' || planStatus === 'completed') return 'applied';
  if (testStatus === 'running' || testStatus === 'active' || planStatus === 'running') {
    return 'running';
  }
  if (testStatus === 'stopped' || testStatus === 'paused') return 'paused';
  if (plan?.test_id && !planStatus && !testStatus) return 'running';
  if (planStatus === 'queued') return 'queued';
  return planStatus || testStatus || 'draft';
}

function statusLabel(status) {
  if (status === 'running') return 'Running';
  if (status === 'paused' || status === 'stopped') return 'Paused';
  if (status === 'winner_ready') return 'Winner ready';
  if (status === 'applied') return 'Applied';
  if (status === 'queued') return 'Queued';
  return 'Draft';
}

function statusPillClass(status, styles) {
  if (status === 'running') return styles.statusRunning;
  if (status === 'paused' || status === 'stopped') return styles.statusPaused;
  if (status === 'winner_ready' || status === 'applied') return styles.statusCompleted;
  return styles.statusDraft;
}
