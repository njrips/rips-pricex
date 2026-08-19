import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Badge, Button, Modal } from '@shopify/polaris';
import PageShell from '../../shared/PageShell';
import { ROUTES } from '../../../constants';
import { apiPost } from '../../../services';
import useClassicShopDomain from '../../../hooks/useClassicShopDomain';
import { useClassicExperimentDetails } from '../../../hooks/useClassicExperimentDetails';
import { useSmartPricingWinnerRollout } from '../../../hooks/useSmartPricingWinnerRollout';
import WinnerApplyModal from '../components/WinnerApplyModal';
import {
  ButtonIconArrowLeft,
  ButtonIconMore,
  ButtonIconPause,
  ButtonIconPlay,
  ButtonIconTrophy,
  IconChart,
  IconFlask,
  IconGear,
  IconOverview,
  IconPerson,
  IconPulse,
  IconTarget,
} from './classicIcons';
import ClassicOverviewTab from './details/ClassicOverviewTab';
import ClassicPerformanceTab from './details/ClassicPerformanceTab';
import ClassicVariationsTab from './details/ClassicVariationsTab';
import ClassicAudienceTab from './details/ClassicAudienceTab';
import ClassicMetricsTab from './details/ClassicMetricsTab';
import ClassicActivityTab from './details/ClassicActivityTab';
import ClassicSettingsTab from './details/ClassicSettingsTab';
import { formatClassicStatusLabel } from './classicExperimentHelpers';
import {
  buildClassicExperimentDeleteConfirmMessage,
  deleteClassicExperimentSynchronized,
} from './classicExperimentDelete';
import { buildClassicWizardResumePath, getClassicExperimentResumeId, isClassicExperimentEnded, resolveClassicDetailsTab } from './classicExperimentListActions';
import { isOfferExperimentType } from './offerSelection';
import styles from './SmartPricingClassic.module.css';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
  const [searchParams, setSearchParams] = useSearchParams();
  const shopDomain = useClassicShopDomain();
  const [tab, setTab] = useState(() => resolveClassicDetailsTab(searchParams.get('tab')));
  const [busyAction, setBusyAction] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [winnerModalOpen, setWinnerModalOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
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
    experimentTestIds,
    refresh,
    patchExperimentPlansLocal,
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

  const tabParam = searchParams.get('tab');

  useEffect(() => {
    const next = resolveClassicDetailsTab(tabParam);
    setTab(current => (current === next ? current : next));
  }, [tabParam]);

  const status = resolveStatus(plan, test, experiment);
  const isArchived = Boolean(experiment?.archived) || status === 'archived';
  const isDraft = !isArchived && (status === 'draft' || status === 'queued');
  const isRunning = !isArchived && status === 'running';
  const isPaused = !isArchived && (status === 'paused' || status === 'stopped');
  const isEnded = !isArchived && isClassicExperimentEnded(status);
  const linkedTestIds = Array.isArray(experimentTestIds) && experimentTestIds.length
    ? experimentTestIds
    : testId
      ? [testId]
      : [];
  // Only enable when analytics declared a promoteable winner arm.
  const isOfferTest = isOfferExperimentType(
    plan?.experiment_type || plan?.metadata?.experiment_type || test?.type
  );
  const canRollOut = Boolean(testId && analytics?.winner_arm_id) && !isOfferTest;

  const experimentTitle = experiment?.title || plan?.title || 'Experiment';
  const currency = plan?.currency || analytics?.currency || 'USD';
  const resumeId = getClassicExperimentResumeId(experiment) || experiment?.id || planId;

  const selectTab = nextTab => {
    const resolved = resolveClassicDetailsTab(nextTab);
    setTab(resolved);
    const params = new URLSearchParams(searchParams);
    if (resolved === 'Overview') params.delete('tab');
    else params.set('tab', resolved.toLowerCase());
    setSearchParams(params, { replace: true });
  };

  const showError = (err, fallback) => {
    setMessageType('error');
    setMessage(err?.message || fallback);
  };

  const showSuccess = text => {
    setMessageType('success');
    setMessage(text);
  };

  const handlePause = async () => {
    if (!linkedTestIds.length || busyAction) return;
    setBusyAction('pause');
    try {
      await Promise.all(
        linkedTestIds.map(id => apiPost(`/tests/${encodeURIComponent(id)}/stop`, {}))
      );
      await patchExperimentPlansLocal({ status: 'paused' });
      showSuccess('Experiment paused.');
      await sleep(450);
      refresh({
        quiet: true,
        preferLocalIds: (experiment?.plans || []).map(row => row.id).filter(Boolean),
      });
    } catch (err) {
      showError(err, 'Could not pause experiment.');
    } finally {
      setBusyAction('');
    }
  };

  const handleResume = async () => {
    if (!linkedTestIds.length || busyAction) return;
    setBusyAction('resume');
    setMoreOpen(false);
    try {
      await Promise.all(
        linkedTestIds.map(id =>
          apiPost(`/tests/${encodeURIComponent(id)}/start`, {
            force: true,
            forceReason: 'classic_resume_after_pause',
          })
        )
      );
      await patchExperimentPlansLocal({ status: 'running' });
      showSuccess('Experiment resumed.');
      refresh({
        quiet: true,
        preferLocalIds: (experiment?.plans || []).map(row => row.id).filter(Boolean),
      });
    } catch (err) {
      showError(err, 'Could not resume experiment.');
    } finally {
      setBusyAction('');
    }
  };

  const handleArchive = async () => {
    if (busyAction) return;
    setBusyAction('archive');
    setMoreOpen(false);
    try {
      await patchExperimentPlansLocal({
        archived: true,
        archived_at: new Date().toISOString(),
      });
      showSuccess('Experiment archived.');
      navigate(`${ROUTES.appSmartPricing(shopDomain)}?tab=archived`);
    } catch (err) {
      showError(err, 'Could not archive experiment.');
    } finally {
      setBusyAction('');
    }
  };

  const handleRestore = async () => {
    if (busyAction) return;
    setBusyAction('restore');
    setMoreOpen(false);
    try {
      await patchExperimentPlansLocal({ archived: false, archived_at: null });
      showSuccess('Experiment restored.');
      refresh({
        quiet: true,
        preferLocalIds: (experiment?.plans || []).map(row => row.id).filter(Boolean),
      });
    } catch (err) {
      showError(err, 'Could not restore experiment.');
    } finally {
      setBusyAction('');
    }
  };

  const handleDelete = async () => {
    if (busyAction) return;
    setBusyAction('delete');
    setDeleteOpen(false);
    setMoreOpen(false);
    try {
      if (isRunning && linkedTestIds.length) {
        await Promise.all(
          linkedTestIds.map(id =>
            apiPost(`/tests/${encodeURIComponent(id)}/stop`, {}).catch(() => null)
          )
        );
      }
      const result = await deleteClassicExperimentSynchronized(shopDomain, experiment, {
        deleteLinkedTests: true,
      });
      if (!result.ok && !result.partial) {
        throw new Error(result.errors[0] || 'Could not delete experiment.');
      }
      showSuccess(
        result.ok
          ? 'Experiment deleted.'
          : result.errors[0] || 'Experiment was partially deleted.'
      );
      navigate(ROUTES.appSmartPricing(shopDomain));
    } catch (err) {
      showError(err, 'Could not delete experiment.');
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

  const handleEditAudienceOrMetrics = () => {
    if (isDraft && resumeId) {
      navigate(buildClassicWizardResumePath(resumeId, 'audience'));
      return;
    }
    selectTab('Settings');
  };

  const copyTestId = async () => {
    setMoreOpen(false);
    const ids = linkedTestIds.length ? linkedTestIds : testId ? [testId] : [];
    if (!ids.length) return;
    try {
      await navigator.clipboard.writeText(ids.join('\n'));
      showSuccess('Test ID copied.');
    } catch {
      showError(null, 'Could not copy test ID.');
    }
  };

  if (!loading && !plan) {
    return (
      <PageShell message={message || 'Experiment not found.'} messageType="error">
        <div className={styles.listPage}>
          <div className={styles.pageLead}>
            <div className={styles.pageBack}>
              <Button
                variant="plain"
                textAlign="start"
                icon={ButtonIconArrowLeft}
                onClick={() => navigate(ROUTES.appSmartPricing(shopDomain))}
              >
                Experiments
              </Button>
            </div>
            <p className={styles.help}>
              That plan is missing from the Smart Pricing inbox. It may have been deleted, or this
              browser is out of sync — try refreshing the experiments list.
            </p>
            <Button onClick={refresh}>Retry load</Button>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell message={message} messageType={messageType} onCloseMessage={() => setMessage('')}>
      <div className={styles.listPage}>
        <div className={styles.pageLead}>
          <div className={styles.pageBack}>
            <Button
              variant="plain"
              textAlign="start"
              icon={ButtonIconArrowLeft}
              onClick={() => navigate(ROUTES.appSmartPricing(shopDomain))}
            >
              Experiments
            </Button>
          </div>

          <div className={`${styles.listHeader} ${styles.overviewHeader}`}>
            <div className={styles.overviewHeaderCopy}>
              <div className={styles.overviewTitleRow}>
                <h1 className={`${styles.overviewTitle} ripx-classic-sans`}>{experimentTitle}</h1>
                <Badge tone={statusBadgeTone(status)}>
                  {statusLabel(status, isOfferTest ? 'offer_test' : 'price_test')}
                </Badge>
              </div>
              <p className={styles.overviewHypothesis}>
                {plan?.hypothesis ||
                  plan?.metadata?.hypothesis ||
                  experiment?.hypothesis ||
                  (isOfferTest ? 'Offer test experiment overview.' : 'Price test experiment overview.')}
              </p>
              <div className={styles.overviewMeta}>
                <span>Owner · {plan?.owner_name || plan?.created_by_name || 'You'}</span>
                <span>Type · {isOfferTest ? 'Offer test' : 'Price test'}</span>
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
              <Button
                variant="primary"
                onClick={() => navigate(buildClassicWizardResumePath(resumeId))}
              >
                Continue editing
              </Button>
            ) : (
              <>
                {isRunning ? (
                  <Button
                    icon={ButtonIconPause}
                    onClick={handlePause}
                    disabled={Boolean(busyAction) || !linkedTestIds.length}
                    loading={busyAction === 'pause'}
                  >
                    Pause
                  </Button>
                ) : null}
                {isPaused ? (
                  <Button
                    icon={ButtonIconPlay}
                    onClick={handleResume}
                    disabled={Boolean(busyAction) || !linkedTestIds.length}
                    loading={busyAction === 'resume'}
                  >
                    Resume
                  </Button>
                ) : null}
                {isOfferTest || isArchived ? null : (
                  <Button
                    variant="primary"
                    icon={ButtonIconTrophy}
                    disabled={Boolean(busyAction) || !canRollOut}
                    onClick={handleRollOut}
                    loading={busyAction === 'winner' || previewLoadingPlanId === plan?.id}
                  >
                    Roll out winner
                  </Button>
                )}
              </>
            )}
            <div className={styles.moreMenuWrap} ref={moreRef}>
              <Button
                icon={ButtonIconMore}
                accessibilityLabel="More actions"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen(open => !open)}
              />
              {moreOpen ? (
                <div className={styles.moreMenu} role="menu">
                  {linkedTestIds.length ? (
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
                  {isArchived ? (
                    <button type="button" role="menuitem" onClick={handleRestore}>
                      {busyAction === 'restore' ? 'Restoring…' : 'Restore'}
                    </button>
                  ) : isPaused || isEnded ? (
                    <button type="button" role="menuitem" onClick={handleArchive}>
                      {busyAction === 'archive' ? 'Archiving…' : 'Archive'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.menuItemDanger}
                    onClick={() => {
                      setMoreOpen(false);
                      setDeleteOpen(true);
                    }}
                  >
                    Delete
                  </button>
                </div>
              ) : null}
            </div>
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
              selectTab(ids[(index + 1) % ids.length]);
            } else if (event.key === 'ArrowLeft') {
              event.preventDefault();
              selectTab(ids[(index - 1 + ids.length) % ids.length]);
            } else if (event.key === 'Home') {
              event.preventDefault();
              selectTab(ids[0]);
            } else if (event.key === 'End') {
              event.preventDefault();
              selectTab(ids[ids.length - 1]);
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
                onClick={() => selectTab(item.id)}
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
              isOfferTest={isOfferTest}
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
              isOfferTest={isOfferTest}
            />
          ) : null}
          {tab === 'Variations' ? (
            <ClassicVariationsTab
              variations={variations}
              currency={currency}
              shopDomain={shopDomain}
              testId={testId}
              isOfferTest={isOfferTest}
            />
          ) : null}
          {tab === 'Audience' ? (
            <ClassicAudienceTab audience={audience} onEdit={handleEditAudienceOrMetrics} />
          ) : null}
          {tab === 'Metrics' ? (
            <ClassicMetricsTab metrics={metrics} onEdit={handleEditAudienceOrMetrics} />
          ) : null}
          {tab === 'Activity' ? <ClassicActivityTab activity={activity} /> : null}
          {tab === 'Settings' ? (
            <ClassicSettingsTab settings={settings} audience={audience} metrics={metrics} />
          ) : null}
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
      <Modal
        open={deleteOpen}
        onClose={() => {
          if (!busyAction) setDeleteOpen(false);
        }}
        title="Delete experiment"
        primaryAction={{
          content: 'Delete',
          destructive: true,
          disabled: Boolean(busyAction),
          onAction: handleDelete,
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            disabled: Boolean(busyAction),
            onAction: () => setDeleteOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <p>{buildClassicExperimentDeleteConfirmMessage(experiment)}</p>
        </Modal.Section>
      </Modal>
    </PageShell>
  );
}

function resolveStatus(plan, test, experiment) {
  if (experiment?.archived || plan?.archived) return 'archived';
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
  if (planStatus === 'queued') return 'queued';
  return planStatus || testStatus || 'draft';
}

function statusLabel(status, experimentType) {
  if (status === 'archived') return 'Archived';
  if (status === 'running') return 'Running';
  if (status === 'paused' || status === 'stopped') return 'Paused';
  if (status === 'winner_ready') return formatClassicStatusLabel(status, experimentType);
  if (status === 'applied') return 'Applied';
  if (status === 'queued') return 'Queued';
  return 'Draft';
}

function statusBadgeTone(status) {
  if (status === 'running') return 'info';
  if (status === 'paused' || status === 'stopped') return 'warning';
  if (status === 'winner_ready' || status === 'applied' || status === 'completed') return 'success';
  return undefined;
}
