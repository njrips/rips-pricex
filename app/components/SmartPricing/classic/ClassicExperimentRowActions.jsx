import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '../../../constants';
import { apiPost } from '../../../services';
import { useSmartPricingLaunch } from '../../../hooks/useSmartPricingLaunch';
import { readInboxPlans, writeInboxPlans } from '../smartPricingConstants';
import { patchServerInboxPlan, persistInboxPlansNow } from '../smartPricingInboxPersistence';
import { IconMore } from './classicIcons';
import {
  collectExperimentTestIds,
  getClassicExperimentResumeId,
  resolveClassicExperimentMenuActions,
} from './classicExperimentListActions';
import {
  buildClassicExperimentDeleteConfirmMessage,
  deleteClassicExperimentSynchronized,
} from './classicExperimentDelete';
import styles from './SmartPricingClassic.module.css';

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
  onRefresh,
  onMessage,
}) {
  const navigate = useNavigate();
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [menuBox, setMenuBox] = useState(null);
  const [busy, setBusy] = useState('');
  const { launching, launchMany } = useSmartPricingLaunch(shopDomain);

  const actions = resolveClassicExperimentMenuActions(experiment, { checkoutReady });
  const planIds = new Set((experiment?.plans || []).map(p => p.id).filter(Boolean));

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
    const next = current.map(plan => (planIds.has(plan.id) ? patchFn(plan) : plan));
    writeInboxPlans(shopDomain, next, { persist: false });
    await persistInboxPlansNow(shopDomain, next).catch(() => null);
  };

  const openDetails = () => {
    const plan = experiment?.representative;
    if (!plan?.id) return;
    navigate(ROUTES.appSmartPricingPlan(shopDomain, plan.id));
  };

  const handleLaunch = async () => {
    setBusy('launch');
    try {
      const toLaunch = (experiment?.plans || []).filter(plan => {
        const status = String(plan.status || 'draft')
          .trim()
          .toLowerCase();
        return status === 'draft' || status === 'queued';
      });
      if (!toLaunch.length) {
        notify('error', 'Nothing to launch for this experiment.');
        return;
      }
      await launchMany(toLaunch);
      await persistInboxPlansNow(shopDomain, readInboxPlans(shopDomain)).catch(() => null);
      notify('success', 'Experiment launched.');
      onRefresh?.();
    } catch (err) {
      notify('error', err?.message || 'Could not launch experiment.');
    } finally {
      setBusy('');
      setOpen(false);
    }
  };

  const handlePause = async () => {
    setBusy('pause');
    try {
      const testIds = collectExperimentTestIds(experiment?.plans);
      await Promise.all(testIds.map(id => apiPost(`/tests/${encodeURIComponent(id)}/stop`, {})));
      await patchExperimentPlans(plan => ({ ...plan, status: 'paused' }));
      for (const plan of experiment?.plans || []) {
        if (plan?.id) {
          await patchServerInboxPlan(shopDomain, plan.id, { status: 'paused' }).catch(() => null);
        }
      }
      notify('success', 'Experiment paused.');
      onRefresh?.();
    } catch (err) {
      notify('error', err?.message || 'Could not pause experiment.');
    } finally {
      setBusy('');
      setOpen(false);
    }
  };

  const handleResume = async () => {
    setBusy('resume');
    try {
      const testIds = collectExperimentTestIds(experiment?.plans);
      await Promise.all(
        testIds.map(id =>
          apiPost(`/tests/${encodeURIComponent(id)}/start`, {
            force: true,
            forceReason: 'classic_list_resume',
          })
        )
      );
      await patchExperimentPlans(plan => ({ ...plan, status: 'running' }));
      for (const plan of experiment?.plans || []) {
        if (plan?.id) {
          await patchServerInboxPlan(shopDomain, plan.id, { status: 'running' }).catch(() => null);
        }
      }
      notify('success', 'Experiment resumed.');
      onRefresh?.();
    } catch (err) {
      notify('error', err?.message || 'Could not resume experiment.');
    } finally {
      setBusy('');
      setOpen(false);
    }
  };

  const handleArchive = async () => {
    setBusy('archive');
    try {
      const at = new Date().toISOString();
      await patchExperimentPlans(plan => ({
        ...plan,
        archived: true,
        archived_at: at,
      }));
      notify('success', 'Experiment archived.');
      onRefresh?.();
    } catch (err) {
      notify('error', err?.message || 'Could not archive experiment.');
    } finally {
      setBusy('');
      setOpen(false);
    }
  };

  const handleRestore = async () => {
    setBusy('restore');
    try {
      await patchExperimentPlans(plan => ({
        ...plan,
        archived: false,
        archived_at: null,
      }));
      notify('success', 'Experiment restored.');
      onRefresh?.();
    } catch (err) {
      notify('error', err?.message || 'Could not restore experiment.');
    } finally {
      setBusy('');
      setOpen(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(buildClassicExperimentDeleteConfirmMessage(experiment))) {
      return;
    }
    setBusy('delete');
    try {
      const result = await deleteClassicExperimentSynchronized(shopDomain, experiment, {
        deleteLinkedTests: true,
      });
      if (result.ok) {
        const detail =
          result.deletedTestIds.length > 0
            ? ` Removed ${result.deletedTestIds.length} linked test${
                result.deletedTestIds.length === 1 ? '' : 's'
              }.`
            : '';
        notify('success', `Experiment deleted.${detail}`);
        onRefresh?.();
        return;
      }
      if (result.partial) {
        notify(
          'error',
          result.errors[0] ||
            'Experiment was partially deleted. Refresh the list and retry if plans or tests remain.'
        );
        onRefresh?.();
        return;
      }
      notify('error', result.errors[0] || 'Could not delete experiment.');
    } catch (err) {
      notify('error', err?.message || 'Could not delete experiment.');
    } finally {
      setBusy('');
      setOpen(false);
    }
  };

  const runAction = actionId => {
    if (busy || launching) return;
    switch (actionId) {
      case 'view':
        setOpen(false);
        openDetails();
        break;
      case 'continue':
        setOpen(false);
        navigate(
          `${ROUTES.appSmartPricingCreate(shopDomain)}?resume=${encodeURIComponent(
            getClassicExperimentResumeId(experiment)
          )}`
        );
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
      case 'open_test': {
        const testId = collectExperimentTestIds(experiment?.plans)[0];
        setOpen(false);
        if (testId) navigate(ROUTES.appTestDetail(shopDomain, testId));
        break;
      }
      case 'archive':
        handleArchive();
        break;
      case 'restore':
        handleRestore();
        break;
      case 'delete':
        handleDelete();
        break;
      default:
        break;
    }
  };

  const isBusy = Boolean(busy || launching);

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
      <button
        ref={triggerRef}
        type="button"
        className={styles.expRowOpen}
        aria-label={`Actions for ${experiment?.title || 'experiment'}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={isBusy}
        onClick={() => setOpen(value => !value)}
      >
        <IconMore size={16} />
      </button>
      {menu}
    </div>
  );
}
