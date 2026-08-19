import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { Button, Modal } from '@shopify/polaris';
import { ROUTES } from '../../../constants';
import { apiPost } from '../../../services';
import { useSmartPricingLaunch } from '../../../hooks/useSmartPricingLaunch';
import { readInboxPlans, writeInboxPlans } from '../smartPricingConstants';
import { persistInboxPlansNow } from '../smartPricingInboxPersistence';
import { ButtonIconMore } from './classicIcons';
import { enrichInboxPlansForLaunch, rollupExperimentStatus } from './classicExperimentHelpers';
import {
  buildClassicWizardResumePath,
  collectExperimentTestIds,
  getClassicExperimentResumeId,
  resolveClassicExperimentMenuActions,
} from './classicExperimentListActions';
import {
  buildClassicExperimentDeleteConfirmMessage,
  deleteClassicExperimentSynchronized,
} from './classicExperimentDelete';
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

  useLayoutEffect(() => {
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

  const patchExperimentPlans = async patchFn => {
    const current = readInboxPlans(shopDomain) || [];
    const next = current.map(plan => (planIdSet.has(plan.id) ? patchFn(plan) : plan));
    writeInboxPlans(shopDomain, next, { persist: false });
    await persistInboxPlansNow(shopDomain, next).catch(() => null);
    return next;
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
      notify('error', err?.message || `Could not ${action} experiment.`);
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
        throw new Error('Nothing to launch for this experiment.');
      }
      await launchMany(enrichInboxPlansForLaunch(toLaunch));
      await persistInboxPlansNow(shopDomain, readInboxPlans(shopDomain)).catch(() => null);
      notify('success', 'Experiment launched.');
      await refreshList({ preferLocalIds: planIds, quiet: true });
    });

  const handlePause = () =>
    runBusy('pause', async () => {
      const testIds = collectExperimentTestIds(experiment?.plans);
      if (!testIds.length) {
        throw new Error('No linked test to pause.');
      }
      await Promise.all(testIds.map(id => apiPost(`/tests/${encodeURIComponent(id)}/stop`, {})));
      await patchExperimentPlans(plan => ({ ...plan, status: 'paused' }));
      await sleep(450);
      notify('success', 'Experiment paused.');
      await refreshList({ preferLocalIds: planIds, quiet: true });
    });

  const handleResume = () =>
    runBusy('resume', async () => {
      const testIds = collectExperimentTestIds(experiment?.plans);
      if (!testIds.length) {
        throw new Error('No linked test to resume.');
      }
      await Promise.all(
        testIds.map(id =>
          apiPost(`/tests/${encodeURIComponent(id)}/start`, {
            force: true,
            forceReason: 'classic_list_resume',
          })
        )
      );
      await patchExperimentPlans(plan => ({ ...plan, status: 'running' }));
      notify('success', 'Experiment resumed.');
      await refreshList({ preferLocalIds: planIds, quiet: true });
    });

  const handleArchive = () =>
    runBusy('archive', async () => {
      const at = new Date().toISOString();
      await patchExperimentPlans(plan => ({
        ...plan,
        archived: true,
        archived_at: at,
      }));
      notify('success', 'Experiment archived.');
      await refreshList({ preferLocalIds: planIds, quiet: true });
    });

  const handleRestore = () =>
    runBusy('restore', async () => {
      await patchExperimentPlans(plan => ({
        ...plan,
        archived: false,
        archived_at: null,
      }));
      notify('success', 'Experiment restored.');
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
        throw new Error(result.errors[0] || 'Could not delete experiment.');
      }
      if (result.ok) {
        const detail =
          result.deletedTestIds.length > 0
            ? ` Removed ${result.deletedTestIds.length} linked test${
                result.deletedTestIds.length === 1 ? '' : 's'
              }.`
            : '';
        notify('success', `Experiment deleted.${detail}`);
      } else {
        notify(
          'error',
          result.errors[0] ||
            'Experiment was partially deleted. Refresh the list and retry if plans or tests remain.'
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
      case 'continue':
        setOpen(false);
        navigate(buildClassicWizardResumePath(getClassicExperimentResumeId(experiment)));
        break;
      case 'launch':
        handleLaunch();
        break;
      case 'pause':
        handlePause();
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
      onClick={event => event.stopPropagation()}
    >
      <span ref={triggerRef}>
        <Button
          size="slim"
          icon={ButtonIconMore}
          accessibilityLabel={`Actions for ${experiment?.title || 'experiment'}`}
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
        title="Delete experiment"
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
