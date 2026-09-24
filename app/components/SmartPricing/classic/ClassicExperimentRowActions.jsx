import { useCallback, useEffect, useRef, useState } from 'react';
import useIsomorphicLayoutEffect from '../../../hooks/useIsomorphicLayoutEffect';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { Button, Modal } from '@shopify/polaris';
import { ROUTES } from '../../../constants';
import { apiPost } from '../../../services';
import { getSmartPricingGuardrails } from '../../../services/smartPricingApi';
import { useSmartPricingLaunch } from '../../../hooks/useSmartPricingLaunch';
import { readInboxPlans, writeInboxPlans } from '../smartPricingConstants';
import { persistInboxPlansNow } from '../smartPricingInboxPersistence';
import { ButtonIconMore } from './classicIcons';
import { enrichInboxPlansForLaunch, rollupExperimentStatus } from './classicExperimentHelpers';
import { appendActivityToPlans, createActivityEntry } from './classicActivity';
import { planResume, resumeConflictListMessage } from './resumeConflicts';
import {
  buildClassicWizardResumePath,
  CLASSIC_STOPPED_PLAN_STATUS,
  classicBatchOutcomeMessage,
  collectExperimentTestIds,
  isSettledClassicPlan,
  splitSettledByIds,
  getClassicExperimentResumeId,
  resolveClassicExperimentMenuActions,
} from './classicExperimentListActions';
import {
  buildClassicExperimentDeleteConfirmMessage,
  deleteClassicExperimentSynchronized,
} from './classicExperimentDelete';
import { classicCreateStepId } from './classicCreateSteps';
import { duplicateClassicExperimentAsDraft } from './classicExperimentDuplicate';
import styles from './SmartPricingClassic.module.css';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function measureActionMenuBox(triggerEl) {
  if (!triggerEl || typeof window === 'undefined') return null;
  const rect = triggerEl.getBoundingClientRect();
  const margin = 6;
  const viewportPad = 12;
  const menuWidth = 200;
  const left = Math.max(
    viewportPad,
    Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - viewportPad)
  );
  const topBelow = rect.bottom + margin;
  const availableBelow = window.innerHeight - topBelow - viewportPad;
  const availableAbove = rect.top - viewportPad - margin;
  const preferBelow = availableBelow >= 120 || availableBelow >= availableAbove;

  if (preferBelow) {
    return {
      top: topBelow,
      left,
      width: menuWidth,
      maxHeight: Math.max(120, availableBelow),
      placement: 'below',
    };
  }

  return {
    bottom: window.innerHeight - rect.top + margin,
    left,
    width: menuWidth,
    maxHeight: Math.max(120, availableAbove),
    placement: 'above',
  };
}

export default function ClassicExperimentRowActions({
  experiment,
  shopDomain,
  checkoutReady = false,
  listBusy = false,
  onBusy,
  onRefresh,
  onMessage,
  onActionDone,
}) {
  const navigate = useNavigate();
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [menuBox, setMenuBox] = useState(null);
  const [busy, setBusy] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { launching, launchMany } = useSmartPricingLaunch(shopDomain);

  const actions = resolveClassicExperimentMenuActions(experiment, { checkoutReady });
  const planIds = (experiment?.plans || []).map(p => p.id).filter(Boolean);
  const planIdSet = new Set(planIds);

  const updateMenuBox = useCallback(() => {
    if (!open || !triggerRef.current) {
      setMenuBox(null);
      return;
    }
    setMenuBox(measureActionMenuBox(triggerRef.current));
  }, [open]);

  useIsomorphicLayoutEffect(() => {
    updateMenuBox();
  }, [open, updateMenuBox, actions.length]);

  useEffect(() => {
    if (!open) return undefined;
    const onScrollOrResize = () => updateMenuBox();
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open, updateMenuBox]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = event => {
      const target = event.target;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const onKey = event => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const notify = (type, text) => {
    onMessage?.({ type, text });
  };

  /**
   * @param {(plan: object) => object} patchFn
   * @param {object} [options]
   * @param {boolean} [options.skipSettled] leave products whose winning price
   *   is already published untouched, so the action cannot erase the record
   *   that it was.
   * @param {string[]} [options.onlyTestIds] restrict the patch to the products
   *   whose request actually succeeded.
   */
  const patchExperimentPlans = async (patchFn, { skipSettled = false, onlyTestIds } = {}) => {
    const current = readInboxPlans(shopDomain) || [];
    const next = current.map(plan => {
      if (!planIdSet.has(plan.id)) return plan;
      if (skipSettled && isSettledClassicPlan(plan)) return plan;
      if (onlyTestIds) {
        const planTestId = String(plan?.test_id || plan?.metadata?.test_id || '').trim();
        if (!onlyTestIds.includes(planTestId)) return plan;
      }
      return patchFn(plan);
    });
    writeInboxPlans(shopDomain, next, { persist: false });
    await persistInboxPlansNow(shopDomain, next).catch(() => null);
    return next;
  };

  /**
   * Send one request per product and report which products accepted it.
   *
   * `allSettled`, not `all`: one refusal used to reject the whole batch, so
   * the merchant got a failure message over a row where some products had
   * genuinely stopped and nothing said which.
   */
  const postToEachTest = async (testIds, action) => {
    const results = await Promise.allSettled(
      testIds.map(id => apiPost(`/tests/${encodeURIComponent(id)}/${action}`, {}))
    );
    return splitSettledByIds(testIds, results);
  };

  const refreshList = async (hydrateOptions = {}) => {
    if (typeof onRefresh === 'function') {
      await onRefresh(hydrateOptions);
    }
  };

  const runBusy = async (action, fn) => {
    if (busy || launching || listBusy) return;
    setBusy(action);
    onBusy?.(action);
    setOpen(false);
    try {
      await fn();
      onActionDone?.(action, experiment);
    } catch (err) {
      notify('error', err?.message || `Could not ${action} test.`);
      onBusy?.('');
    } finally {
      setBusy('');
    }
  };

  const openDetails = () => {
    const plan = experiment?.representative;
    if (!plan?.id) return;
    navigate(ROUTES.appSmartPricingPlan(shopDomain, plan.id));
  };

  const handleLaunch = () =>
    runBusy('launch', async () => {
      const toLaunch = (experiment?.plans || []).filter(plan => {
        const status = String(plan.status || 'draft')
          .trim()
          .toLowerCase();
        return status === 'draft' || status === 'queued';
      });
      if (!toLaunch.length) {
        throw new Error('Nothing to launch for this test.');
      }
      const guardrailsPayload = await getSmartPricingGuardrails(shopDomain).catch(() => ({}));
      await launchMany(enrichInboxPlansForLaunch(toLaunch, guardrailsPayload));
      await persistInboxPlansNow(shopDomain, readInboxPlans(shopDomain)).catch(() => null);
      const detailPlanId = toLaunch.find(plan => plan?.id)?.id || experiment?.representative?.id;
      if (detailPlanId) {
        navigate(ROUTES.appSmartPricingPlan(shopDomain, detailPlanId));
        return;
      }
      notify('success', 'Test launched.');
      await refreshList({ preferLocalIds: planIds, quiet: true });
    });

  const handlePause = () =>
    runBusy('pause', async () => {
      // A product whose winner is already applied is not part of what Pause
      // acts on: its price is published and its traffic is no longer split.
      const testIds = collectExperimentTestIds(experiment?.plans, { skipSettled: true });
      if (!testIds.length) {
        throw new Error('No linked test to pause.');
      }
      const { succeeded, failed } = await postToEachTest(testIds, 'pause');
      if (!succeeded.length) {
        throw failed[0]?.reason || new Error('Could not pause test.');
      }
      const pauseEntry = createActivityEntry({
        kind: 'paused',
        title: 'Test paused',
        detail: 'Traffic assignment stopped.',
        actor: experiment?.representative?.owner_name || experiment?.representative?.created_by_name || 'You',
      });
      await patchExperimentPlans(
        plan => appendActivityToPlans([{ ...plan, status: 'paused' }], pauseEntry)[0],
        { skipSettled: true, onlyTestIds: succeeded }
      );
      await sleep(450);
      notify(
        failed.length ? 'warning' : 'success',
        classicBatchOutcomeMessage({
          verb: 'paused',
          done: succeeded.length,
          failed: failed.length,
        })
      );
      await refreshList({ preferLocalIds: planIds, quiet: true });
    });

  /**
   * End the experiment for good.
   *
   * A different call from Pause, because the two mean different things to the
   * server as well as the list. Pause keeps the product reserved so the
   * experiment can have it back; this gives it up, marks the plan finished,
   * and moves the experiment to Completed with Archive and Delete instead of
   * Resume.
   */
  const handleStop = () =>
    runBusy('stop', async () => {
      const testIds = collectExperimentTestIds(experiment?.plans, { skipSettled: true });
      if (!testIds.length) {
        throw new Error('No linked test to stop.');
      }
      const { succeeded, failed } = await postToEachTest(testIds, 'stop');
      if (!succeeded.length) {
        throw failed[0]?.reason || new Error('Could not stop test.');
      }
      const stopEntry = createActivityEntry({
        kind: 'stopped',
        title: 'Stopped test',
        detail: 'Traffic assignment stopped.',
        actor:
          experiment?.representative?.owner_name ||
          experiment?.representative?.created_by_name ||
          'You',
      });
      await patchExperimentPlans(
        plan =>
          appendActivityToPlans([{ ...plan, status: CLASSIC_STOPPED_PLAN_STATUS }], stopEntry)[0],
        { skipSettled: true, onlyTestIds: succeeded }
      );
      await sleep(450);
      notify(
        failed.length ? 'warning' : 'success',
        classicBatchOutcomeMessage({
          verb: 'stopped',
          done: succeeded.length,
          failed: failed.length,
        })
      );
      await refreshList({ preferLocalIds: planIds, quiet: true });
    });

  const handleResume = () =>
    runBusy('resume', async () => {
      // A product whose winner is applied must not be restarted: the merchant
      // committed to that price and it is live in the catalog, so re-splitting
      // its traffic would undo the decision. The per-product resume refuses
      // this outright; neither preflight catches it, because such a test is
      // its own holder and so reads as free.
      const testIds = collectExperimentTestIds(experiment?.plans, { skipSettled: true });
      if (!testIds.length) {
        throw new Error('No linked test to resume.');
      }
      // While this experiment sat paused its products were free, and the
      // create wizard would have offered them, so some may now belong to a
      // live test. Resuming part of an experiment is the merchant's call to
      // make, and this row has nowhere to ask -- so send them to the page that
      // does rather than starting some products and quietly skipping others.
      const preflight = await apiPost('/smart-pricing/tests/resume-preflight', {
        test_ids: testIds,
      })
        .then(res => res?.data || res || {})
        .catch(() => null);
      const resumePlan = planResume(preflight, testIds);
      if (resumePlan.action !== 'resume_all') {
        throw new Error(resumeConflictListMessage(resumePlan));
      }
      await Promise.all(
        testIds.map(id =>
          apiPost(`/tests/${encodeURIComponent(id)}/start`, {
            force: true,
            forceReason: 'classic_list_resume',
          })
        )
      );
      const resumeEntry = createActivityEntry({
        kind: 'resumed',
        title: 'Test resumed',
        detail: 'Traffic assignment resumed.',
        actor: experiment?.representative?.owner_name || experiment?.representative?.created_by_name || 'You',
      });
      await patchExperimentPlans(
        plan => appendActivityToPlans([{ ...plan, status: 'running' }], resumeEntry)[0],
        { skipSettled: true }
      );
      notify('success', 'Test resumed.');
      await refreshList({ preferLocalIds: planIds, quiet: true });
    });

  const handleArchive = () =>
    runBusy('archive', async () => {
      const at = new Date().toISOString();
      const archiveEntry = createActivityEntry({
        id: 'archived',
        kind: 'archived',
        title: 'Test archived',
        detail: 'Hidden from the active tests list',
        at,
        actor: experiment?.representative?.owner_name || experiment?.representative?.created_by_name || 'You',
      });
      await patchExperimentPlans(plan =>
        appendActivityToPlans([{ ...plan, archived: true, archived_at: at }], archiveEntry)[0]
      );
      notify('success', 'Test archived.');
      await refreshList({ preferLocalIds: planIds, quiet: true });
    });

  const handleRestore = () =>
    runBusy('restore', async () => {
      const restoreEntry = createActivityEntry({
        kind: 'restored',
        title: 'Test restored',
        detail: 'Moved back to the active tests list',
        actor: experiment?.representative?.owner_name || experiment?.representative?.created_by_name || 'You',
      });
      await patchExperimentPlans(plan =>
        appendActivityToPlans([{ ...plan, archived: false, archived_at: null }], restoreEntry)[0]
      );
      notify('success', 'Test restored.');
      await refreshList({ preferLocalIds: planIds, quiet: true });
    });

  const handleDelete = () =>
    runBusy('delete', async () => {
      const testIds = collectExperimentTestIds(experiment?.plans);
      const running = rollupExperimentStatus(experiment?.plans) === 'running';
      if (running && testIds.length) {
        await Promise.all(
          testIds.map(id => apiPost(`/tests/${encodeURIComponent(id)}/stop`, {}).catch(() => null))
        );
      }
      const result = await deleteClassicExperimentSynchronized(shopDomain, experiment, {
        deleteLinkedTests: true,
      });
      if (!result.ok && !result.partial) {
        throw new Error(result.errors[0] || 'Could not delete test.');
      }
      if (result.ok) {
        const detail =
          result.deletedTestIds.length > 0
            ? ` Removed ${result.deletedTestIds.length} linked test${
                result.deletedTestIds.length === 1 ? '' : 's'
              }.`
            : '';
        notify('success', `Test deleted.${detail}`);
      } else {
        notify(
          'error',
          result.errors[0] ||
            'Test was partially deleted. Refresh the list and retry if plans or tests remain.'
        );
      }
      await refreshList({ omitIds: planIds, quiet: true });
    });

  const runAction = actionId => {
    if (busy || launching || listBusy) return;
    switch (actionId) {
      case 'view':
        setOpen(false);
        openDetails();
        break;
      case 'edit':
        setOpen(false);
        // The step matters for an unfinished draft: the wizard opens at step 1
        // without it, so continuing a draft left on Audience walked the
        // merchant back through everything they had already answered. Clicking
        // the row title has always passed it.
        navigate(
          buildClassicWizardResumePath(
            getClassicExperimentResumeId(experiment),
            classicCreateStepId(experiment?.wizardDraft?.step) || undefined
          )
        );
        break;
      case 'duplicate':
        setOpen(false);
        runBusy('duplicate', async () => {
          const result = await duplicateClassicExperimentAsDraft(shopDomain, experiment);
          if (!result.ok) {
            notify('error', result.message);
            return;
          }
          notify('success', 'Draft duplicated.');
          await refreshList({ quiet: true });
          navigate(buildClassicWizardResumePath(result.experimentId));
        });
        break;
      case 'launch':
        handleLaunch();
        break;
      case 'pause':
        handlePause();
        break;
      case 'stop':
        handleStop();
        break;
      case 'resume':
        handleResume();
        break;
      case 'archive':
        handleArchive();
        break;
      case 'restore':
        handleRestore();
        break;
      case 'delete':
        setOpen(false);
        setDeleteOpen(true);
        break;
      default:
        break;
    }
  };

  const isBusy = Boolean(busy || launching || listBusy);

  const menuStyle =
    menuBox && typeof document !== 'undefined'
      ? {
          left: menuBox.left,
          width: menuBox.width,
          maxHeight: menuBox.maxHeight,
          overflowY: 'auto',
          ...(menuBox.placement === 'above' ? { bottom: menuBox.bottom } : { top: menuBox.top }),
        }
      : null;

  const menu =
    open && menuStyle && typeof document !== 'undefined'
      ? createPortal(
          <div ref={menuRef} className={styles.moreMenuPortal} style={menuStyle} role="menu">
            {actions.map(action => (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                className={action.destructive ? styles.menuItemDanger : undefined}
                disabled={isBusy}
                onClick={() => runAction(action.id)}
              >
                {busy === action.id || (action.id === 'launch' && launching)
                  ? `${action.label}…`
                  : action.label}
              </button>
            ))}
          </div>,
          document.body
        )
      : null;

  return (
    <div
      className={`${styles.moreMenuWrap} ${styles.expRowActions}`}
      // Layout wrapper with no semantics of its own: the click handler only
      // keeps the menu from also triggering the row's navigation, and the real
      // control inside is a Button that keyboard users reach directly.
      role="presentation"
      onClick={event => event.stopPropagation()}
    >
      <span ref={triggerRef}>
        <Button
          size="slim"
          icon={ButtonIconMore}
          accessibilityLabel={`Actions for ${experiment?.title || 'test'}`}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={isBusy}
          onClick={() => setOpen(value => !value)}
        />
      </span>
      {menu}
      <Modal
        open={deleteOpen}
        onClose={() => {
          if (!isBusy) setDeleteOpen(false);
        }}
        title="Delete test"
        primaryAction={{
          content: 'Delete',
          destructive: true,
          disabled: isBusy,
          onAction: () => {
            setDeleteOpen(false);
            handleDelete();
          },
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            disabled: isBusy,
            onAction: () => setDeleteOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <p>{buildClassicExperimentDeleteConfirmMessage(experiment)}</p>
        </Modal.Section>
      </Modal>
    </div>
  );
}
