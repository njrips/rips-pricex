import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import ClassicProductDetailPanel from './details/ClassicProductDetailPanel';
import ClassicAudienceMetricsEditModal from './details/ClassicAudienceMetricsEditModal';
import {
  applyAudienceUiToPlans,
  audienceUiFromSummaries,
  canEditClassicAudienceMetrics,
  validateClassicAudienceUi,
} from './classicAudienceEdit';
import { appendActivityToPlans, createActivityEntry } from './classicActivity';
import {
  formatClassicStatusLabel,
  normalizePlanStatus,
  readClassicWizardDraft,
  rollupExperimentStatus,
  writeClassicWizardDraft,
} from './classicExperimentHelpers';
import {
  buildClassicExperimentDeleteConfirmMessage,
  deleteClassicExperimentSynchronized,
} from './classicExperimentDelete';
import { buildClassicWizardResumePath, getClassicExperimentResumeId, isClassicExperimentEnded, resolveClassicDetailsTab } from './classicExperimentListActions';
import { isOfferExperimentType } from './offerSelection';
import {
  applyReadySmartPricingProducts,
  applySmartPricingWinner,
  finishSmartPricingProduct,
} from '../../../services/smartPricingApi';
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
  // The URL is the single source of truth for the active tab, so back/forward
  // and deep links land on the right one without a state copy to resync.
  const tab = resolveClassicDetailsTab(searchParams.get('tab'));
  const selectedProductId = String(searchParams.get('product') || '').trim();
  const [busyAction, setBusyAction] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [winnerModalOpen, setWinnerModalOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editFocus, setEditFocus] = useState('audience');
  const [editSeed, setEditSeed] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [rolloutBusyTestId, setRolloutBusyTestId] = useState('');
  const [rolloutApplyingAll, setRolloutApplyingAll] = useState(false);
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
    rolloutRows,
    variations,
    audience,
    metrics,
    activity,
    settings,
    message,
    messageType,
    setMessage,
    setMessageType,
    experimentPlans,
    experimentTestIds,
    refresh,
    replaceExperimentPlansLocal,
    shopGuardrails,
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
  const isOfferTest = isOfferExperimentType(
    plan?.experiment_type || plan?.metadata?.experiment_type || test?.type
  );
  const leftoverWinnerPlan = (Array.isArray(experimentPlans) ? experimentPlans : []).find(
    row => normalizePlanStatus(row) === 'winner_ready'
  );
  const canRollOut = Boolean(leftoverWinnerPlan?.test_id) && !isOfferTest;

  const experimentTitle = experiment?.title || plan?.title || 'Experiment';
  const currency = plan?.currency || analytics?.currency || 'USD';
  const resumeId = getClassicExperimentResumeId(experiment) || experiment?.id || planId;

  const selectTab = nextTab => {
    const resolved = resolveClassicDetailsTab(nextTab);
    const params = new URLSearchParams(searchParams);
    if (resolved === 'Overview') params.delete('tab');
    else params.set('tab', resolved.toLowerCase());
    // Leaving a product drill-down when switching tabs keeps the URL honest.
    params.delete('product');
    setSearchParams(params, { replace: true });
  };

  const openProduct = useCallback(
    nextPlanId => {
      const id = String(nextPlanId || '').trim();
      if (!id) return;
      const params = new URLSearchParams(searchParams);
      if (!params.get('tab') || params.get('tab') === 'overview') {
        params.set('tab', 'performance');
      }
      params.set('product', id);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const closeProduct = useCallback(() => {
    const params = new URLSearchParams(searchParams);
    params.delete('product');
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  const selectedProductRow = useMemo(() => {
    if (!selectedProductId) return null;
    const fromRollout = (Array.isArray(rolloutRows) ? rolloutRows : []).find(
      row => String(row.planId || '') === selectedProductId
    );
    if (fromRollout) return fromRollout;
    return (
      (Array.isArray(productPerformanceRows) ? productPerformanceRows : []).find(
        row => String(row.planId || row.plan?.id || '') === selectedProductId
      ) || { planId: selectedProductId }
    );
  }, [selectedProductId, rolloutRows, productPerformanceRows]);

  // Arrow keys live on the tabs, not the tablist: with a roving tabindex the
  // container is deliberately not focusable, so a handler there only ever sees
  // events bubbling up from the focused tab anyway. Focus follows the
  // selection, which is what makes the arrow keys usable at all.
  const onTabKeyDown = (event, fromTab) => {
    const ids = TABS.map(item => item.id);
    const index = ids.indexOf(fromTab);
    let nextTab = null;
    if (event.key === 'ArrowRight') nextTab = ids[(index + 1) % ids.length];
    else if (event.key === 'ArrowLeft') nextTab = ids[(index - 1 + ids.length) % ids.length];
    else if (event.key === 'Home') nextTab = ids[0];
    else if (event.key === 'End') nextTab = ids[ids.length - 1];
    if (!nextTab) return;
    event.preventDefault();
    selectTab(nextTab);
    document.getElementById(`classic-tab-${nextTab}`)?.focus();
  };

  const showError = (err, fallback) => {
    setMessageType('error');
    setMessage(err?.message || fallback);
  };

  const showSuccess = text => {
    setMessageType('success');
    setMessage(text);
  };

  const activityActor = plan?.owner_name || plan?.created_by_name || 'You';
  const stampPlans = (plans, entry, patch = {}) =>
    appendActivityToPlans(
      (Array.isArray(plans) ? plans : []).map(row => ({
        ...row,
        ...patch,
        metadata: {
          ...(row.metadata || {}),
          ...(patch.metadata && typeof patch.metadata === 'object' ? patch.metadata : {}),
        },
      })),
      createActivityEntry({ actor: activityActor, ...entry })
    );

  /**
   * Records a rollout on the one plan it touched.
   *
   * The Activity tab reads these logs, so a per-product rollout that skipped
   * them would leave no trace of the most consequential action in the app.
   */
  const stampRolloutOnPlan = async (testId, entry, patch = {}) => {
    const target = (Array.isArray(experimentPlans) ? experimentPlans : []).filter(
      row => String(row?.test_id || '') === String(testId)
    );
    if (!target.length) return;
    await replaceExperimentPlansLocal(stampPlans(target, entry, patch)).catch(() => null);
  };

  /**
   * Rolls out one product without ending its siblings.
   *
   * Every product in an experiment is a separate test, so applying a finished
   * one stops that test alone. `stopIfRunning` lets the server do the stop as
   * part of the apply, which is what keeps the rest of the experiment collecting.
   */
  const handleApplyProduct = async row => {
    if (!row?.testId || rolloutBusyTestId || rolloutApplyingAll) return;
    setRolloutBusyTestId(row.testId);
    try {
      const result = await applySmartPricingWinner(shopDomain, row.testId, {
        publishToShopify: true,
        stopIfRunning: true,
      });
      const updated = result?.publish?.summary?.updated_count ?? 0;
      await stampRolloutOnPlan(
        row.testId,
        {
          kind: 'complete',
          title: 'Winning price applied',
          detail: row.decision?.winner?.label
            ? `${row.decision.winner.label} written to Shopify`
            : 'Winner written to Shopify',
        },
        { status: 'applied', winner_applied_at: new Date().toISOString() }
      );
      showSuccess(
        updated > 0
          ? `${row.productTitle}: winning price written to ${updated} Shopify variant${updated === 1 ? '' : 's'}.`
          : `${row.productTitle}: winner applied. Shopify prices were already in sync.`
      );
      await sleep(450);
      refresh({ quiet: true });
    } catch (err) {
      showError(err, `Could not apply the winner for ${row.productTitle}.`);
    } finally {
      setRolloutBusyTestId('');
    }
  };

  const handleFinishProduct = async row => {
    if (!row?.testId || rolloutBusyTestId || rolloutApplyingAll) return;
    setRolloutBusyTestId(row.testId);
    try {
      const result = await finishSmartPricingProduct(shopDomain, row.testId);
      await stampRolloutOnPlan(
        row.testId,
        {
          kind: 'complete',
          title: result?.control_retained ? 'Finished on control price' : 'Finished on winning offer',
          detail: 'No catalog price was changed',
        },
        { status: 'completed' }
      );
      showSuccess(`${row.productTitle}: test finished. No catalog price was changed.`);
      await sleep(450);
      refresh({ quiet: true });
    } catch (err) {
      showError(err, `Could not finish ${row.productTitle}.`);
    } finally {
      setRolloutBusyTestId('');
    }
  };

  const handleApplyAllReady = async testIds => {
    if (!Array.isArray(testIds) || !testIds.length || rolloutApplyingAll) return;
    setRolloutApplyingAll(true);
    try {
      const result = await applyReadySmartPricingProducts(shopDomain, testIds);
      const applied = (result?.results || []).filter(entry => entry.applied);
      const failures = (result?.results || []).filter(entry => !entry.applied);
      for (const entry of applied) {
        await stampRolloutOnPlan(
          entry.test_id,
          {
            kind: 'complete',
            title:
              entry.action === 'apply_price'
                ? 'Winning price applied'
                : 'Finished without a price change',
            detail: 'Applied with the rest of the ready products',
          },
          entry.action === 'apply_price'
            ? { status: 'applied', winner_applied_at: new Date().toISOString() }
            : { status: 'completed' }
        );
      }
      const deferred = Number(result?.deferred) || 0;
      const more = deferred > 0 ? ` ${deferred} were left for a second batch.` : '';
      if (failures.length) {
        // A partial result is reported as an error rather than a success: the
        // toast is green or red only, and green would hide the failures.
        showError(
          new Error(
            `Applied ${applied.length} of ${testIds.length - deferred} products. ${failures.length} could not be applied: ${failures[0].error}${more}`
          ),
          'Some products could not be applied.'
        );
      } else {
        showSuccess(
          `Applied ${applied.length} product${applied.length === 1 ? '' : 's'}.${more}`
        );
      }
      await sleep(450);
      refresh({ quiet: true });
    } catch (err) {
      showError(err, 'Could not apply the ready products.');
    } finally {
      setRolloutApplyingAll(false);
    }
  };

  const handlePause = async () => {
    if (!linkedTestIds.length || busyAction) return;
    setBusyAction('pause');
    try {
      await Promise.all(
        linkedTestIds.map(id => apiPost(`/tests/${encodeURIComponent(id)}/stop`, {}))
      );
      await replaceExperimentPlansLocal(
        stampPlans(experimentPlans, {
          kind: 'paused',
          title: 'Experiment paused',
          detail: 'Traffic assignment stopped',
        }, { status: 'paused' })
      );
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
      await replaceExperimentPlansLocal(
        stampPlans(experimentPlans, {
          kind: 'resumed',
          title: 'Experiment resumed',
          detail: 'Traffic assignment started again',
        }, { status: 'running' })
      );
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
      const archivedAt = new Date().toISOString();
      await replaceExperimentPlansLocal(
        stampPlans(
          experimentPlans,
          {
            id: 'archived',
            kind: 'archived',
            title: 'Experiment archived',
            detail: 'Hidden from the active experiments list',
            at: archivedAt,
          },
          { archived: true, archived_at: archivedAt }
        )
      );
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
      await replaceExperimentPlansLocal(
        stampPlans(
          experimentPlans,
          {
            kind: 'restored',
            title: 'Experiment restored',
            detail: 'Moved back to the active experiments list',
          },
          { archived: false, archived_at: null }
        )
      );
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
    const target = leftoverWinnerPlan || plan;
    if (!target?.test_id || busyAction) return;
    setBusyAction('winner');
    try {
      await loadPreview(target);
      setWinnerModalOpen(true);
    } catch (err) {
      showError(err, 'Could not load winner preview.');
    } finally {
      setBusyAction('');
    }
  };

  const handleConfirmWinner = async () => {
    const target = leftoverWinnerPlan || plan;
    try {
      await applyWinner(target, { publishToShopify: true });
      const appliedAt = new Date().toISOString();
      await replaceExperimentPlansLocal(
        stampPlans(
          (Array.isArray(experimentPlans) ? experimentPlans : []).map(row =>
            String(row.id) === String(target.id)
              ? { ...row, status: 'applied', winner_applied_at: appliedAt }
              : row
          ),
          {
            id: 'winner_applied',
            kind: 'complete',
            title: isOfferTest ? 'Test completed' : 'Winning price applied',
            detail: isOfferTest
              ? 'Offer test finished — catalog prices were not changed'
              : 'This product’s winning variation was written to Shopify',
            at: appliedAt,
          }
        )
      );
      setWinnerModalOpen(false);
      clearPreview();
      showSuccess('Winner rolled out to Shopify.');
      refresh();
    } catch (err) {
      showError(err, 'Could not apply winner.');
    }
  };

  const closeAudienceMetricsEditor = useCallback(() => {
    setEditOpen(false);
  }, []);

  const openAudienceMetricsEditor = focus => {
    if (!experimentPlans.length) {
      showError(null, 'No plans to update.');
      return;
    }
    setEditFocus(focus === 'metrics' ? 'metrics' : 'audience');
    setEditSeed(audienceUiFromSummaries(audience, metrics, plan?.metadata?.audience_ui));
    setEditOpen(true);
  };

  const handleSaveAudienceMetrics = async audienceState => {
    if (!canEditClassicAudienceMetrics(status) || editSaving) return;
    if (!experimentPlans.length) {
      showError(null, 'No plans to update.');
      return;
    }
    const check = validateClassicAudienceUi(audienceState);
    if (!check.ok) {
      showError(null, check.message);
      return;
    }
    if (shopGuardrails == null) {
      showError(null, 'Still loading shop experiment defaults. Try again in a moment.');
      return;
    }
    setEditSaving(true);
    try {
      const nextPlans = appendActivityToPlans(
        applyAudienceUiToPlans(experimentPlans, audienceState, {
          experimentId: resumeId,
          experimentTitle: experiment?.title || plan?.metadata?.experiment_title || '',
          hypothesis: plan?.hypothesis || plan?.metadata?.hypothesis || '',
          experimentType:
            plan?.experiment_type || plan?.metadata?.experiment_type || experiment?.experimentType,
          shopGuardrails,
        }),
        createActivityEntry({
          kind: 'updated',
          title:
            editFocus === 'guardrail'
              ? 'Revenue guardrail updated'
              : editFocus === 'metrics'
                ? 'Metrics updated'
                : 'Audience updated',
          detail:
            editFocus === 'guardrail'
              ? 'Revenue per visitor pause threshold changed'
              : editFocus === 'metrics'
              ? 'Primary metric, secondary goals, or guardrails changed'
              : 'Targeting, traffic, or sample size changed',
          actor: activityActor,
        })
      );
      await replaceExperimentPlansLocal(nextPlans);
      const draft = readClassicWizardDraft(shopDomain);
      if (draft && String(draft.experiment_id || '') === String(resumeId || '')) {
        writeClassicWizardDraft(shopDomain, { ...draft, audience: audienceState });
      }
      setEditOpen(false);
      showSuccess(
        isRunning
          ? 'Audience and metrics saved on the plan. Live assignment stays as launched until you pause and relaunch.'
          : 'Audience and metrics updated.'
      );
    } catch (err) {
      showError(err, 'Could not save audience and metrics.');
    } finally {
      setEditSaving(false);
    }
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
                {isOfferTest || isArchived || !canRollOut ? null : (
                  <Button
                    variant="primary"
                    icon={ButtonIconTrophy}
                    disabled={Boolean(busyAction)}
                    onClick={handleRollOut}
                    loading={
                      busyAction === 'winner' ||
                      previewLoadingPlanId === (leftoverWinnerPlan?.id || plan?.id)
                    }
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

        <div className={styles.overviewTabs} role="tablist" aria-label="Experiment sections">
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
                onKeyDown={event => onTabKeyDown(event, item.id)}
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
            selectedProductId ? (
              <ClassicProductDetailPanel
                shopDomain={shopDomain}
                planId={selectedProductId}
                row={selectedProductRow}
                sharedTest={Boolean(selectedProductRow?.sharedTest)}
                currency={currency}
                onClose={closeProduct}
                onChanged={refresh}
              />
            ) : (
              <ClassicPerformanceTab
                analytics={analytics}
                analyticsLoading={analyticsLoading}
                currency={currency}
                variationAverages={variationAverages}
                productPerformanceRows={productPerformanceRows}
                rolloutRows={rolloutRows}
                variations={variations}
                isOfferTest={isOfferTest}
                onApplyProduct={handleApplyProduct}
                onFinishProduct={handleFinishProduct}
                onApplyAllReady={handleApplyAllReady}
                onOpenProduct={openProduct}
                rolloutBusyTestId={rolloutBusyTestId}
                rolloutApplyingAll={rolloutApplyingAll}
              />
            )
          ) : null}
          {tab === 'Variations' ? (
            selectedProductId ? (
              <ClassicProductDetailPanel
                shopDomain={shopDomain}
                planId={selectedProductId}
                row={selectedProductRow}
                sharedTest={Boolean(selectedProductRow?.sharedTest)}
                currency={currency}
                onClose={closeProduct}
                onChanged={refresh}
              />
            ) : (
              <ClassicVariationsTab
                variations={variations}
                currency={currency}
                shopDomain={shopDomain}
                testId={testId}
                isOfferTest={isOfferTest}
                inboxPlans={experimentPlans}
                onOpenProduct={openProduct}
              />
            )
          ) : null}
          {tab === 'Audience' ? (
            <ClassicAudienceTab
              audience={audience}
              onEdit={() => openAudienceMetricsEditor('audience')}
            />
          ) : null}
          {tab === 'Metrics' ? (
            <ClassicMetricsTab
              metrics={metrics}
              onEdit={() => openAudienceMetricsEditor('metrics')}
            />
          ) : null}
          {tab === 'Activity' ? <ClassicActivityTab activity={activity} /> : null}
          {tab === 'Settings' ? (
            <ClassicSettingsTab
              settings={settings}
              audience={audience}
              metrics={metrics}
              onEdit={() => openAudienceMetricsEditor('audience')}
              onEditMetrics={() => openAudienceMetricsEditor('guardrail')}
            />
          ) : null}
        </div>
      </div>

      <ClassicAudienceMetricsEditModal
        open={editOpen}
        focus={editFocus}
        initialValue={editSeed}
        shopDomain={shopDomain}
        plans={experimentPlans}
        variations={variations}
        shopGuardrails={shopGuardrails || {}}
        shopMaxRevenueDropPercent={shopGuardrails?.max_revenue_drop_percent}
        readOnly={!canEditClassicAudienceMetrics(status)}
        readOnlyReason={
          canEditClassicAudienceMetrics(status)
            ? ''
            : 'Audience and metrics are locked after this experiment ends. Start a new experiment to test different targeting or a different goal.'
        }
        liveWarning={
          (isRunning || isPaused) && linkedTestIds.length
            ? 'This updates the saved plan. The live test keeps launch targeting until you relaunch.'
            : ''
        }
        saving={editSaving}
        shopDefaultsReady={shopGuardrails != null}
        onClose={closeAudienceMetricsEditor}
        onSave={handleSaveAudienceMetrics}
      />

      <WinnerApplyModal
        open={winnerModalOpen}
        plan={leftoverWinnerPlan || plan}
        preview={preview?.data || null}
        loadingPreview={
          previewLoadingPlanId === (leftoverWinnerPlan?.id || plan?.id)
        }
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
  const experimentPlans = Array.isArray(experiment?.plans) ? experiment.plans : [];
  if (experimentPlans.length > 1) {
    return rollupExperimentStatus(experimentPlans);
  }
  const planStatus = String(plan?.status || experiment?.status || '')
    .trim()
    .toLowerCase();
  const testStatus = String(test?.status || '')
    .trim()
    .toLowerCase();

  // Prefer inbox merchant pause over raw stopped → winner_ready race.
  if (planStatus === 'paused') return 'paused';
  if (planStatus === 'winner_ready') return 'winner_ready';
  if (planStatus === 'applied') return 'applied';
  if (planStatus === 'completed') return 'completed';
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
  if (status === 'applied') return formatClassicStatusLabel(status, experimentType);
  if (status === 'completed') return formatClassicStatusLabel(status, experimentType);
  if (status === 'queued') return 'Queued';
  return 'Draft';
}

function statusBadgeTone(status) {
  if (status === 'running') return 'info';
  if (status === 'paused' || status === 'stopped') return 'warning';
  if (status === 'winner_ready' || status === 'applied' || status === 'completed') return 'success';
  return undefined;
}
