import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  getGoalMetricDefinitions,
  saveGoalMetricDefinition,
} from '../../../services/goalMetricsApi';
import { ROUTES } from '../../../constants/routes';
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
import { IconPlus, IconSearch } from './classicIcons';
import styles from './SmartPricingClassic.module.css';

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
  const [definitions, setDefinitions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [draft, setDraft] = useState(createEmptyCustomGoalDraft);
  const [createError, setCreateError] = useState('');
  const [createSaving, setCreateSaving] = useState(false);

  const selected = useMemo(() => normalizeCustomGoals(selectedGoals), [selectedGoals]);
  const selectedKeys = useMemo(() => new Set(selected.map(g => g.event_name)), [selected]);

  const catalogRows = useMemo(() => filterPickerCatalogDefinitions(definitions), [definitions]);

  const refreshCatalog = async () => {
    const domain = String(shopDomain || '').trim();
    if (!domain) {
      setDefinitions([]);
      setLoading(false);
      setLoadError('Shop domain is required to load Goals.');
      return;
    }
    setLoading(true);
    setLoadError('');
    try {
      const rows = await getGoalMetricDefinitions(domain);
      setDefinitions(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setLoadError(err?.response?.data?.error || err?.message || 'Could not load Goals.');
      setDefinitions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on open
  }, [shopDomain]);

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
          : 'RipX watches the storefront and fires this event automatically.';

  const goalsPageHref = shopDomain ? ROUTES.appGoalsMetrics(shopDomain) : null;

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={`${styles.modalBackdrop} ${styles.goalPickerBackdrop}`}
      role="presentation"
      onClick={onClose}
    >
      <div
        className={`${styles.modal} ${styles.goalPickerModal}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="classic-goal-picker-title"
        onClick={e => e.stopPropagation()}
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
          <button type="button" className={styles.iconClose} onClick={onClose} aria-label="Close">
            ×
          </button>
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
                  <IconSearch size={14} />
                  <input
                    className={`${styles.input} ${styles.modalSearchInput}`}
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search goals…"
                    aria-label="Search goals"
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

              {loadError ? <p className={styles.customGoalError}>{loadError}</p> : null}

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
                          <button
                            type="button"
                            className={styles.ghostBtn}
                            onClick={() => handleRemove(goal.event_name)}
                          >
                            Remove
                          </button>
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
                          No matching goals. Create one here, or manage the full library on Goals
                          &amp; Metrics.
                        </p>
                        <div className={styles.goalPickerEmptyActions}>
                          <button
                            type="button"
                            className={styles.ghostBtn}
                            onClick={() => setTab('create')}
                          >
                            <IconPlus size={14} />
                            Create new
                          </button>
                          {goalsPageHref ? (
                            <a
                              className={styles.editLink}
                              href={goalsPageHref}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open Goals &amp; Metrics
                            </a>
                          ) : null}
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
                          <button
                            type="button"
                            className={styles.ghostBtn}
                            onClick={() => handleAdd(row)}
                          >
                            Add
                          </button>
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
                Define how RipX should fire this event on the storefront. It is saved to your Goals
                library for reuse.
              </p>

              <div className={styles.customGoalGrid}>
                <label className={styles.customGoalField}>
                  <span>Display name</span>
                  <input
                    className={styles.input}
                    value={draft.name}
                    onChange={e => {
                      const name = e.target.value;
                      patchDraft({
                        name,
                        event_name: draft.event_name || slugEventKey(name),
                      });
                    }}
                    placeholder="e.g. Add to cart"
                  />
                </label>
                <label className={styles.customGoalField}>
                  <span>Event key</span>
                  <input
                    className={styles.input}
                    value={draft.event_name}
                    onChange={e => patchDraft({ event_name: slugEventKey(e.target.value) })}
                    placeholder="add_to_cart"
                  />
                </label>
                <label className={styles.customGoalField}>
                  <span>How it fires</span>
                  <select
                    className={styles.select}
                    value={draft.trigger_type}
                    onChange={e => patchDraft({ trigger_type: e.target.value })}
                  >
                    {CUSTOM_GOAL_TRIGGER_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.customGoalField}>
                  <span>Aggregation</span>
                  <select
                    className={styles.select}
                    value={draft.aggregation}
                    onChange={e =>
                      patchDraft({
                        aggregation: e.target.value,
                        trigger_config: {
                          ...draft.trigger_config,
                          parameter_name:
                            e.target.value === 'count'
                              ? ''
                              : draft.trigger_config?.parameter_name || 'amount',
                        },
                      })
                    }
                  >
                    <option value="count">Count unique users</option>
                    <option value="sum">Sum event value</option>
                  </select>
                </label>
                <label className={styles.customGoalField}>
                  <span>Direction</span>
                  <select
                    className={styles.select}
                    value={draft.direction}
                    onChange={e => patchDraft({ direction: e.target.value })}
                  >
                    <option value="increase">Higher is better</option>
                    <option value="decrease">Lower is better</option>
                  </select>
                </label>
                {draft.aggregation === 'sum' ? (
                  <label className={styles.customGoalField}>
                    <span>Value parameter</span>
                    <input
                      className={styles.input}
                      value={draft.trigger_config?.parameter_name || ''}
                      onChange={e => patchTriggerConfig({ parameter_name: e.target.value })}
                      placeholder="amount"
                    />
                  </label>
                ) : null}
              </div>

              {draft.trigger_type === 'url_match' ? (
                <label className={styles.customGoalField}>
                  <span>URL pattern</span>
                  <input
                    className={styles.input}
                    value={draft.trigger_config?.url_pattern || ''}
                    onChange={e => patchTriggerConfig({ url_pattern: e.target.value })}
                    placeholder="/cart or /collections/*"
                  />
                </label>
              ) : null}

              {triggerNeedsSelector ? (
                <label className={styles.customGoalField}>
                  <span>
                    {draft.trigger_type === 'element_visibility'
                      ? 'Element selector'
                      : draft.trigger_type === 'css_click'
                        ? 'Click selector'
                        : 'Form selector'}
                  </span>
                  <input
                    className={styles.input}
                    value={draft.trigger_config?.selector || ''}
                    onChange={e => patchTriggerConfig({ selector: e.target.value })}
                    placeholder={
                      draft.trigger_type === 'form_submit'
                        ? 'form.newsletter'
                        : draft.trigger_type === 'element_visibility'
                          ? '.hero-banner'
                          : '.add-to-cart-button'
                    }
                  />
                </label>
              ) : null}

              {draft.trigger_type === 'element_visibility' ? (
                <label className={styles.customGoalField}>
                  <span>Visibility threshold (%)</span>
                  <input
                    className={styles.input}
                    type="number"
                    min={1}
                    max={100}
                    value={draft.trigger_config?.visibility_threshold ?? 50}
                    onChange={e =>
                      patchTriggerConfig({ visibility_threshold: Number(e.target.value) || 50 })
                    }
                  />
                </label>
              ) : null}

              {draft.trigger_type === 'custom_javascript' ? (
                <label className={styles.customGoalField}>
                  <span>JavaScript rule</span>
                  <textarea
                    className={styles.textarea}
                    rows={4}
                    value={draft.trigger_config?.custom_javascript || ''}
                    onChange={e => patchTriggerConfig({ custom_javascript: e.target.value })}
                    placeholder="return document.querySelector('.promo-banner') !== null;"
                  />
                </label>
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
              {createError ? <p className={styles.customGoalError}>{createError}</p> : null}

              <div className={styles.customGoalActions}>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={handleCreateOrAddExisting}
                  disabled={createSaving || draftAlreadySelected}
                >
                  {createSaving ? 'Saving…' : draftCatalogMatch ? 'Add existing' : 'Create & add'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className={styles.modalFooter}>
          <span className={styles.help} style={{ margin: 0 }}>
            {selected.length} custom goal{selected.length === 1 ? '' : 's'} selected
            {goalsPageHref ? (
              <>
                {' · '}
                <a
                  className={styles.editLink}
                  href={goalsPageHref}
                  target="_blank"
                  rel="noreferrer"
                >
                  Manage Goals library
                </a>
              </>
            ) : null}
          </span>
          <button type="button" className={styles.primaryBtn} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
