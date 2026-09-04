import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Banner, Button, Select, TextField } from '@shopify/polaris';
import {
  getGoalMetricDefinitions,
  saveGoalMetricDefinition,
} from '../../../services/goalMetricsApi';
import {
  CUSTOM_GOAL_TRIGGER_OPTIONS,
  attachCustomGoal,
  catalogGoalTriggerSummary,
  createEmptyCustomGoalDraft,
  detachCustomGoal,
  filterPickerCatalogDefinitions,
  mapGoalDefinitionToCustomGoal,
  normalizeCustomGoals,
  validateCustomGoalDraft,
} from '../targeting/smartPricingAudienceHelpers';
import { useKeyedState } from '../../../hooks/useKeyedState';
import useFocusTrap from '../../../hooks/useFocusTrap';
import { ButtonIconPlus } from './classicIcons';
import styles from './SmartPricingClassic.module.css';

const NO_SHOP_CATALOG = {
  definitions: [],
  loading: false,
  loadError: 'Shop domain is required to load Goals.',
};

async function loadGoalCatalog(domain) {
  try {
    const rows = await getGoalMetricDefinitions(domain);
    return { definitions: Array.isArray(rows) ? rows : [], loading: false, loadError: '' };
  } catch (err) {
    return {
      definitions: [],
      loading: false,
      loadError: err?.response?.data?.error || err?.message || 'Could not load Goals.',
    };
  }
}

function slugEventKey(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
}

export default function ClassicGoalPickerModal({
  shopDomain = '',
  selectedGoals = [],
  onChange,
  onClose,
  initialTab = 'browse',
  selectionMode = 'multiple',
  title = 'Add goals',
  description = 'Pick from your Goals library or create a new storefront event. Monitoring only — these do not pick the winner.',
  createMetricRole = 'secondary',
}) {
  const [tab, setTab] = useState(initialTab === 'create' ? 'create' : 'browse');
  // This modal is mounted only while it is open, so the trap is always on.
  const focusTrapRef = useFocusTrap(true);
  const initialCatalog = useMemo(
    () =>
      String(shopDomain || '').trim()
        ? { definitions: [], loading: true, loadError: '' }
        : NO_SHOP_CATALOG,
    [shopDomain]
  );
  const [catalog, setCatalog] = useKeyedState(shopDomain, initialCatalog);
  const { definitions, loading, loadError } = catalog;
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [draft, setDraft] = useState(createEmptyCustomGoalDraft);
  const [createError, setCreateError] = useState('');
  const [createSaving, setCreateSaving] = useState(false);

  const selected = useMemo(() => normalizeCustomGoals(selectedGoals), [selectedGoals]);
  const selectedKeys = useMemo(() => new Set(selected.map(g => g.event_name)), [selected]);

  const catalogRows = useMemo(() => filterPickerCatalogDefinitions(definitions), [definitions]);

  const refreshCatalog = useCallback(async () => {
    const domain = String(shopDomain || '').trim();
    if (!domain) {
      setCatalog(NO_SHOP_CATALOG);
      return;
    }
    setCatalog(prev => ({ ...prev, loading: true, loadError: '' }));
    setCatalog(await loadGoalCatalog(domain));
  }, [shopDomain, setCatalog]);

  useEffect(() => {
    const domain = String(shopDomain || '').trim();
    if (!domain) return undefined;
    let cancelled = false;
    loadGoalCatalog(domain).then(next => {
      if (!cancelled) setCatalog(next);
    });
    return () => {
      cancelled = true;
    };
  }, [shopDomain, setCatalog]);

  const availableRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalogRows.filter(row => {
      if (selectedKeys.has(row.event_name)) return false;
      if (sourceFilter === 'builtin' && row.source !== 'catalog_builtin') return false;
      if (sourceFilter === 'custom' && row.source === 'catalog_builtin') return false;
      if (!q) return true;
      const hay = `${row.label} ${row.event_name} ${catalogGoalTriggerSummary(row)}`.toLowerCase();
      return hay.includes(q);
    });
  }, [catalogRows, selectedKeys, search, sourceFilter]);

  const existingByKey = useMemo(() => {
    const map = new Map();
    catalogRows.forEach(row => map.set(row.event_name, row));
    return map;
  }, [catalogRows]);

  const draftEventKey = slugEventKey(draft.event_name || draft.name);
  const draftCatalogMatch = draftEventKey ? existingByKey.get(draftEventKey) : null;
  const draftAlreadySelected = draftEventKey ? selectedKeys.has(draftEventKey) : false;

  const patchDraft = partial => {
    setCreateError('');
    setDraft(prev => ({ ...prev, ...partial }));
  };

  const patchTriggerConfig = partial => {
    setCreateError('');
    setDraft(prev => ({
      ...prev,
      trigger_config: { ...(prev.trigger_config || {}), ...partial },
    }));
  };

  const handleAdd = row => {
    if (!row) return;
    if (selectionMode === 'single') {
      onChange?.(attachCustomGoal([], row));
      onClose?.();
      return;
    }
    onChange?.(attachCustomGoal(selected, row));
  };

  const handleRemove = eventName => {
    onChange?.(detachCustomGoal(selected, eventName));
  };

  const handleCreateOrAddExisting = async () => {
    if (draftAlreadySelected) {
      setCreateError('That event is already selected for this experiment.');
      return;
    }

    if (draftCatalogMatch) {
      handleAdd(draftCatalogMatch);
      setDraft(createEmptyCustomGoalDraft());
      setTab('browse');
      return;
    }

    const checked = validateCustomGoalDraft(draft);
    if (!checked.ok) {
      setCreateError(checked.error);
      return;
    }

    setCreateSaving(true);
    setCreateError('');
    try {
      let nextGoal = { ...checked.definition, catalog_id: null };
      const domain = String(shopDomain || '').trim();
      if (domain) {
        const saved = await saveGoalMetricDefinition(domain, {
          name: checked.definition.label,
          event_name: checked.definition.event_name,
          description: `Smart Pricing custom goal · ${catalogGoalTriggerSummary(checked.definition)}`,
          category: 'custom',
          aggregation: checked.definition.aggregation,
          direction: checked.definition.direction,
          metric_role: createMetricRole === 'primary' ? 'primary' : 'secondary',
          trigger_type: checked.definition.trigger_type,
          trigger_config: checked.definition.trigger_config,
          tags: ['smart-pricing', 'classic-wizard'],
        });
        nextGoal = mapGoalDefinitionToCustomGoal({
          ...saved,
          ...checked.definition,
          id: saved?.id,
          catalog_id: saved?.id,
          builtin: false,
          source: 'custom',
        }) || { ...checked.definition, catalog_id: saved?.id || null };
      }
      onChange?.(
        selectionMode === 'single'
          ? attachCustomGoal([], nextGoal)
          : attachCustomGoal(selected, nextGoal)
      );
      setDraft(createEmptyCustomGoalDraft());
      await refreshCatalog();
      setTab('browse');
      if (selectionMode === 'single') {
        onClose?.();
      }
    } catch (err) {
      setCreateError(
        err?.response?.data?.error || err?.message || 'Could not save this custom goal.'
      );
    } finally {
      setCreateSaving(false);
    }
  };

  const triggerNeedsSelector = [
    'css_click',
    'form_start',
    'form_submit',
    'element_visibility',
  ].includes(draft.trigger_type);
  const triggerHint =
    draft.trigger_type === 'custom_event'
      ? `Track with RipX.trackEvent(testId, '${draftEventKey || 'event_key'}', value)`
      : draft.trigger_type === 'url_match'
        ? 'Fires automatically when the shopper URL matches your pattern.'
        : draft.trigger_type === 'custom_javascript'
          ? 'Return true, a number, or { value } when the event should count.'
          : 'Priceify watches the storefront and fires this event automatically.';

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={`${styles.modalBackdrop} ${styles.goalPickerBackdrop}`}
      role="presentation"
      onClick={e => {
        // Close only on the backdrop itself. Letting the dialog swallow the
        // click instead would put a mouse listener on a non-interactive
        // element, which keyboard users can never reach.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={focusTrapRef}
        className={`${styles.modal} ${styles.goalPickerModal}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="classic-goal-picker-title"
      >
        <div className={styles.modalHeader}>
          <div>
            <h2 id="classic-goal-picker-title" className={styles.modalTitle}>
              {title}
            </h2>
            <p className={styles.help} style={{ margin: '4px 0 0' }}>
              {description}
            </p>
          </div>
          <Button onClick={onClose}>Close</Button>
        </div>

        <div className={styles.goalPickerTabs} role="tablist" aria-label="Goal picker mode">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'browse'}
            className={`${styles.goalPickerTab} ${tab === 'browse' ? styles.goalPickerTabActive : ''}`}
            onClick={() => setTab('browse')}
          >
            Browse
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'create'}
            className={`${styles.goalPickerTab} ${tab === 'create' ? styles.goalPickerTabActive : ''}`}
            onClick={() => setTab('create')}
          >
            Create
          </button>
        </div>

        <div className={`${styles.modalBody} ${styles.goalPickerBody}`}>
          {tab === 'browse' ? (
            <div className={styles.goalPickerBrowse}>
              <div className={styles.goalPickerToolbar}>
                <div className={`${styles.searchWrap} ${styles.modalSearch}`}>
                  <TextField
                    label="Search goals"
                    labelHidden
                    value={search}
                    onChange={setSearch}
                    placeholder="Search goals…"
                    autoComplete="off"
                  />
                </div>
                <div
                  className={`${styles.segment} ${styles.segmentInline} ${styles.goalPickerSourceFilter}`}
                  role="group"
                  aria-label="Goal source"
                >
                  {[
                    { id: 'all', label: 'All' },
                    { id: 'builtin', label: 'Built-in' },
                    { id: 'custom', label: 'Custom' },
                  ].map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`${styles.segmentBtn} ${
                        sourceFilter === opt.id ? styles.segmentBtnActive : ''
                      }`}
                      onClick={() => setSourceFilter(opt.id)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {loadError ? <Banner tone="critical" title={loadError} /> : null}

              <div className={styles.goalPickerPanes}>
                <section className={styles.goalPickerPane} aria-label="Selected goals">
                  <div className={styles.goalPickerPaneHead}>
                    <strong>Selected</strong>
                    <span>{selected.length}</span>
                  </div>
                  <div className={styles.goalPickerList}>
                    {selected.length === 0 ? (
                      <p className={styles.help}>No custom goals selected yet.</p>
                    ) : (
                      selected.map(goal => (
                        <div key={goal.event_name} className={styles.goalPickerRow}>
                          <div className={styles.goalPickerRowMeta}>
                            <strong>{goal.label}</strong>
                            <span>
                              {goal.event_name} · {catalogGoalTriggerSummary(goal)}
                            </span>
                          </div>
                          <Button onClick={() => handleRemove(goal.event_name)}>Remove</Button>
                        </div>
                      ))
                    )}
                  </div>
                </section>

                <section className={styles.goalPickerPane} aria-label="Available goals">
                  <div className={styles.goalPickerPaneHead}>
                    <strong>Available</strong>
                    <span>{loading ? '…' : availableRows.length}</span>
                  </div>
                  <div className={styles.goalPickerList}>
                    {loading ? (
                      <p className={styles.help}>Loading Goals library…</p>
                    ) : availableRows.length === 0 ? (
                      <div className={styles.goalPickerEmpty}>
                        <p className={styles.help}>
                          No matching goals. Create one here — this is where the library is kept.
                        </p>
                        <div className={styles.goalPickerEmptyActions}>
                          <Button icon={ButtonIconPlus} onClick={() => setTab('create')}>
                            Create new
                          </Button>
                        </div>
                      </div>
                    ) : (
                      availableRows.map(row => (
                        <div key={row.event_name} className={styles.goalPickerRow}>
                          <div className={styles.goalPickerRowMeta}>
                            <strong>{row.label}</strong>
                            <span>
                              {row.event_name} · {catalogGoalTriggerSummary(row)}
                              {row.source === 'catalog_builtin' ? ' · Built-in' : ' · Custom'}
                            </span>
                          </div>
                          <Button onClick={() => handleAdd(row)}>Add</Button>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </div>
            </div>
          ) : (
            <div className={styles.goalPickerCreate}>
              <p className={styles.help}>
                Define how Priceify should fire this event on the storefront. It is saved to your Goals
                library for reuse.
              </p>

              <div className={styles.customGoalGrid}>
                <div className={styles.customGoalField}>
                  <TextField
                    label="Display name"
                    value={draft.name}
                    onChange={name =>
                      patchDraft({
                        name,
                        event_name: draft.event_name || slugEventKey(name),
                      })
                    }
                    placeholder="e.g. Add to cart"
                    autoComplete="off"
                  />
                </div>
                <div className={styles.customGoalField}>
                  <TextField
                    label="Event key"
                    value={draft.event_name}
                    onChange={value => patchDraft({ event_name: slugEventKey(value) })}
                    placeholder="add_to_cart"
                    autoComplete="off"
                  />
                </div>
                <div className={styles.customGoalField}>
                  <Select
                    label="How it fires"
                    options={CUSTOM_GOAL_TRIGGER_OPTIONS.map(opt => ({
                      label: opt.label,
                      value: opt.value,
                    }))}
                    value={draft.trigger_type}
                    onChange={value => patchDraft({ trigger_type: value })}
                  />
                </div>
                <div className={styles.customGoalField}>
                  <Select
                    label="Aggregation"
                    options={[
                      { label: 'Count unique users', value: 'count' },
                      { label: 'Sum event value', value: 'sum' },
                    ]}
                    value={draft.aggregation}
                    onChange={value =>
                      patchDraft({
                        aggregation: value,
                        trigger_config: {
                          ...draft.trigger_config,
                          parameter_name:
                            value === 'count'
                              ? ''
                              : draft.trigger_config?.parameter_name || 'amount',
                        },
                      })
                    }
                  />
                </div>
                <div className={styles.customGoalField}>
                  <Select
                    label="Direction"
                    options={[
                      { label: 'Higher is better', value: 'increase' },
                      { label: 'Lower is better', value: 'decrease' },
                    ]}
                    value={draft.direction}
                    onChange={value => patchDraft({ direction: value })}
                  />
                </div>
                {draft.aggregation === 'sum' ? (
                  <div className={styles.customGoalField}>
                    <TextField
                      label="Value parameter"
                      value={draft.trigger_config?.parameter_name || ''}
                      onChange={value => patchTriggerConfig({ parameter_name: value })}
                      placeholder="amount"
                      autoComplete="off"
                    />
                  </div>
                ) : null}
              </div>

              {draft.trigger_type === 'url_match' ? (
                <div className={styles.customGoalField}>
                  <TextField
                    label="URL pattern"
                    value={draft.trigger_config?.url_pattern || ''}
                    onChange={value => patchTriggerConfig({ url_pattern: value })}
                    placeholder="/cart or /collections/*"
                    autoComplete="off"
                  />
                </div>
              ) : null}

              {triggerNeedsSelector ? (
                <div className={styles.customGoalField}>
                  <TextField
                    label={
                      draft.trigger_type === 'element_visibility'
                        ? 'Element selector'
                        : draft.trigger_type === 'css_click'
                          ? 'Click selector'
                          : 'Form selector'
                    }
                    value={draft.trigger_config?.selector || ''}
                    onChange={value => patchTriggerConfig({ selector: value })}
                    placeholder={
                      draft.trigger_type === 'form_submit'
                        ? 'form.newsletter'
                        : draft.trigger_type === 'element_visibility'
                          ? '.hero-banner'
                          : '.add-to-cart-button'
                    }
                    autoComplete="off"
                  />
                </div>
              ) : null}

              {draft.trigger_type === 'element_visibility' ? (
                <div className={styles.customGoalField}>
                  <TextField
                    label="Visibility threshold (%)"
                    type="number"
                    min={1}
                    max={100}
                    value={String(draft.trigger_config?.visibility_threshold ?? 50)}
                    onChange={value =>
                      patchTriggerConfig({ visibility_threshold: Number(value) || 50 })
                    }
                    autoComplete="off"
                  />
                </div>
              ) : null}

              {draft.trigger_type === 'custom_javascript' ? (
                <div className={styles.customGoalField}>
                  <TextField
                    label="JavaScript rule"
                    value={draft.trigger_config?.custom_javascript || ''}
                    onChange={value => patchTriggerConfig({ custom_javascript: value })}
                    placeholder="return document.querySelector('.promo-banner') !== null;"
                    multiline={4}
                    autoComplete="off"
                  />
                </div>
              ) : null}

              <p className={styles.customGoalHint}>
                <code>{triggerHint}</code>
              </p>

              {draftCatalogMatch && !draftAlreadySelected ? (
                <p className={styles.help}>
                  This event key already exists in your Goals library. Add will attach the existing
                  definition without overwriting it.
                </p>
              ) : null}
              {createError ? <Banner tone="critical" title={createError} /> : null}

              <div className={styles.customGoalActions}>
                <Button
                  variant="primary"
                  onClick={handleCreateOrAddExisting}
                  disabled={createSaving || draftAlreadySelected}
                  loading={createSaving}
                >
                  {draftCatalogMatch ? 'Add existing' : 'Create & add'}
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className={styles.modalFooter}>
          <span className={styles.help} style={{ margin: 0 }}>
            {selected.length} custom goal{selected.length === 1 ? '' : 's'} selected
          </span>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
