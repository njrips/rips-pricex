import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Badge, Button, Spinner, TextField } from '@shopify/polaris';
import PageShell from '../../shared/PageShell';
import { ROUTES } from '../../../constants';
import useClassicShopDomain from '../../../hooks/useClassicShopDomain';
import { readInboxPlans, setInboxPersistHandler, writeInboxPlans } from '../smartPricingConstants';
import { filterPlansByQuery } from '../smartPricingUiHelpers';
import { hydrateInboxFromServer, schedulePersistInboxPlans } from '../smartPricingInboxPersistence';
import {
  formatClassicStatusLabel,
  getPlanProductTitle,
  groupPlansIntoExperiments,
} from './classicExperimentHelpers';
import { formatOfferRule, isOfferExperimentType } from './offerSelection';
import ClassicExperimentRowActions from './ClassicExperimentRowActions';
import { filterClassicExperimentsByTab, listTabAfterClassicAction } from './classicExperimentListActions';
import { useSmartPricingCheckoutReadiness } from '../../../hooks/useSmartPricingCheckoutReadiness';
import {
  ButtonIconPlus,
  IconChevron,
  IconBolt,
  IconPerson,
  IconTrendUp,
} from './classicIcons';
import styles from './SmartPricingClassic.module.css';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'running', label: 'Running' },
  { id: 'draft', label: 'Drafts' },
  { id: 'paused', label: 'Paused' },
  { id: 'completed', label: 'Completed' },
  { id: 'archived', label: 'Archived' },
];

function statusVisual(experiment) {
  const status = experiment.status;
  if (status === 'archived' || experiment.archived) {
    return { tone: undefined, text: 'Archived' };
  }
  if (status === 'winner_ready' || status === 'applied' || status === 'completed') {
    return {
      tone: 'success',
      text: formatClassicStatusLabel(status, experiment.experimentType),
    };
  }
  if (status === 'running') {
    return { tone: 'info', text: 'Running' };
  }
  if (status === 'paused') {
    return { tone: 'warning', text: 'Paused' };
  }
  return { tone: undefined, text: 'Draft' };
}

function emptyFilterCopy(filter) {
  if (filter === 'running') return 'No running experiments.';
  if (filter === 'draft') return 'No draft experiments.';
  if (filter === 'paused') return 'No paused experiments.';
  if (filter === 'completed') return 'No completed experiments.';
  if (filter === 'archived') return 'No archived experiments.';
  return 'No experiments yet.';
}

function formatMetricLabel(metric) {
  const raw = String(metric || '').trim();
  if (!raw) return 'Profit per visitor';
  if (raw === 'paid_conversion_rate') return 'Paid conversion rate';
  if (raw === 'profit_per_visitor') return 'Profit per visitor';
  return raw.replace(/_/g, ' ');
}

export default function ClassicExperimentsList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const shopDomain = useClassicShopDomain();

  const initialFilter = searchParams.get('tab') || 'all';
  const [filter, setFilter] = useState(
    FILTERS.some(f => f.id === initialFilter) ? initialFilter : 'all'
  );
  const [plans, setPlans] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [gridBusy, setGridBusy] = useState('');
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('error');
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const {
    checkoutReady,
    offerCheckoutReady,
  } = useSmartPricingCheckoutReadiness(shopDomain);

  useEffect(() => {
    setInboxPersistHandler((d, nextPlans) => {
      schedulePersistInboxPlans(d, nextPlans);
    });
    return () => setInboxPersistHandler(null);
  }, []);

  const load = useCallback(async (hydrateOptions = {}) => {
    const quiet = Boolean(
      hydrateOptions.quiet || hydrateOptions.preferLocalIds || hydrateOptions.omitIds
    );
    if (!quiet) setLoading(true);
    try {
      const local = readInboxPlans(shopDomain) || [];
      const hydrated = await hydrateInboxFromServer(shopDomain, local, hydrateOptions).catch(
        () => null
      );
      const next = Array.isArray(hydrated?.plans) ? hydrated.plans : local;
      setPlans(next);
      if (hydrated?.plans) {
        writeInboxPlans(shopDomain, hydrated.plans, { persist: false });
      }
    } catch (err) {
      setMessage(err.message || 'Could not load experiments.');
      setPlans(readInboxPlans(shopDomain) || []);
    } finally {
      setLoading(false);
      setGridBusy('');
    }
  }, [shopDomain]);

  useEffect(() => {
    load();
  }, [load]);

  const experiments = useMemo(() => {
    const queried = filterPlansByQuery(plans, search);
    return filterClassicExperimentsByTab(groupPlansIntoExperiments(queried), filter);
  }, [plans, filter, search]);

  const stats = useMemo(() => {
    const allExperiments = groupPlansIntoExperiments(plans.filter(p => !p.archived));
    const running = allExperiments.filter(e => e.status === 'running').length;
    const winning = allExperiments.filter(
      e => e.status === 'winner_ready' || e.status === 'completed'
    ).length;
    const visitors = allExperiments.reduce((sum, e) => sum + (Number(e.visitors) || 0), 0);
    return { running, visitors, winning };
  }, [plans]);

  const setFilterAndUrl = id => {
    setFilter(id);
    const next = new URLSearchParams(searchParams);
    if (id === 'all') next.delete('tab');
    else next.set('tab', id);
    setSearchParams(next, { replace: true });
  };

  const toggleExpand = (experimentId, event) => {
    event?.stopPropagation?.();
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(experimentId)) next.delete(experimentId);
      else next.add(experimentId);
      return next;
    });
  };

  const openExperiment = experiment => {
    const plan = experiment.representative;
    if (!plan?.id) return;
    // Always open experiment details. Drafts can resume from Overview → Continue editing.
    navigate(ROUTES.appSmartPricingPlan(shopDomain, plan.id));
  };

  const handleListMessage = ({ type = 'error', text = '' }) => {
    setMessageType(type === 'success' ? 'success' : 'error');
    setMessage(text);
  };

  const handleRowBusy = action => {
    setGridBusy(action || '');
  };

  const handleRowRefresh = async hydrateOptions => {
    await load(hydrateOptions || {});
  };

  const handleRowActionDone = (action, experiment) => {
    const nextTab = listTabAfterClassicAction(action, experiment, filter);
    if (nextTab && nextTab !== filter) {
      setFilterAndUrl(nextTab);
    }
  };

  const gridBusyLabel =
    gridBusy === 'pause'
      ? 'Pausing experiment…'
      : gridBusy === 'resume'
        ? 'Resuming experiment…'
        : gridBusy === 'delete'
          ? 'Deleting experiment…'
          : gridBusy === 'launch'
            ? 'Launching experiment…'
            : gridBusy === 'archive'
              ? 'Archiving experiment…'
              : gridBusy === 'restore'
                ? 'Restoring experiment…'
                : gridBusy
                  ? 'Updating experiments…'
                  : 'Loading experiments…';

  return (
    <PageShell message={message} messageType={messageType} onCloseMessage={() => setMessage('')}>
      <div className={styles.listPage}>
        <div className={styles.listHeader}>
          <p className={styles.eyebrow}>Workspace</p>
          <div className={styles.listHeaderMain}>
            <div>
              <h1 className={`${styles.listTitle} ripx-classic-sans`}>Experiments</h1>
              <p className={styles.subtitle} style={{ marginBottom: 0 }}>
                Ship better product decisions. Launch a test in under two minutes.
              </p>
            </div>
            <div className={styles.listHeaderActions}>
              <Button
                variant="primary"
                icon={ButtonIconPlus}
                disabled={loading || Boolean(gridBusy)}
                onClick={() => navigate(ROUTES.appSmartPricingCreate(shopDomain))}
              >
                New experiment
              </Button>
            </div>
          </div>
        </div>

        <div className={styles.statGrid}>
          <div className={styles.statCard}>
            <div className={styles.statCardTop}>
              <div className={`${styles.statIcon} ${styles.statIconAccent}`} aria-hidden>
                <IconBolt />
              </div>
              <div className={styles.statLabel}>Running now</div>
            </div>
            <div className={styles.statValue}>{stats.running}</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statCardTop}>
              <div className={styles.statIcon} aria-hidden>
                <IconPerson />
              </div>
              <div className={styles.statLabel}>Visitors this month</div>
            </div>
            <div className={styles.statValue}>{stats.visitors.toLocaleString()}</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statCardTop}>
              <div className={styles.statIcon} aria-hidden>
                <IconTrendUp />
              </div>
              <div className={styles.statLabel}>Winning experiments</div>
            </div>
            <div className={styles.statValue}>{stats.winning}</div>
          </div>
        </div>

        <div className={styles.filterRow}>
          <div className={styles.filterPillTrack} role="tablist" aria-label="Filter experiments">
            {FILTERS.map(item => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={filter === item.id}
                className={`${styles.filterPill} ${
                  filter === item.id ? styles.filterPillActive : ''
                }`}
                onClick={() => setFilterAndUrl(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className={styles.listSearch}>
            <TextField
              label="Search experiments"
              labelHidden
              value={search}
              onChange={setSearch}
              autoComplete="off"
              placeholder="Search experiments"
            />
          </div>
        </div>

        <div className={styles.expTableWrap} aria-busy={loading || Boolean(gridBusy)}>
          {loading || gridBusy ? (
            <div className={styles.expTableBusy} role="status" aria-live="polite">
              <Spinner size="small" />
              <span>{gridBusy ? gridBusyLabel : 'Loading experiments…'}</span>
            </div>
          ) : null}
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Experiment</th>
                <th>Status</th>
                <th>Primary metric</th>
                <th>Visitors</th>
                <th>Lift</th>
                <th>Confidence</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loading && experiments.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className={styles.listEmptyState}>
                      <p className={styles.subtitle}>{emptyFilterCopy(filter)}</p>
                      {filter === 'all' || filter === 'draft' ? (
                        <Button
                          variant="primary"
                          icon={ButtonIconPlus}
                          onClick={() => navigate(ROUTES.appSmartPricingCreate(shopDomain))}
                        >
                          New experiment
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ) : null}
              {!loading &&
                experiments.map(experiment => {
                  const status = statusVisual(experiment);
                  const expanded = expandedIds.has(experiment.id);
                  const lift = experiment.lift;
                  const confidence = experiment.confidence;
                  const visitors = experiment.visitors;
                  return (
                    <React.Fragment key={experiment.id}>
                      <tr className={styles.expRow}>
                        <td>
                          <div className={styles.expTitleRow}>
                            {experiment.productCount > 1 ? (
                              <button
                                type="button"
                                className={styles.expExpandBtn}
                                aria-expanded={expanded}
                                aria-label={expanded ? 'Hide products' : 'Show products'}
                                onClick={e => toggleExpand(experiment.id, e)}
                              >
                                <IconChevron up={expanded} />
                              </button>
                            ) : (
                              <span className={styles.expExpandSpacer} />
                            )}
                            <div>
                              <button
                                type="button"
                                className={styles.rowLink}
                                onClick={() => openExperiment(experiment)}
                              >
                                {experiment.title || 'Untitled experiment'}
                              </button>
                              <div className={styles.productSub}>
                                {experiment.typeLabel || 'PRICE'} · {experiment.owner}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <Badge tone={status.tone}>{status.text}</Badge>
                        </td>
                        <td>{formatMetricLabel(experiment.primaryMetric)}</td>
                        <td>
                          {visitors !== null &&
                          visitors !== undefined &&
                          Number.isFinite(Number(visitors)) &&
                          Number(visitors) > 0
                            ? Number(visitors).toLocaleString()
                            : '—'}
                        </td>
                        <td>
                          {lift !== null && lift !== undefined && Number.isFinite(Number(lift)) ? (
                            <span className={Number(lift) >= 0 ? styles.liftPos : undefined}>
                              {Number(lift) >= 0 ? '+' : ''}
                              {Number(lift).toFixed(1)}%
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          {confidence !== null &&
                          confidence !== undefined &&
                          Number.isFinite(Number(confidence))
                            ? `${Number(confidence).toFixed(0)}%`
                            : '—'}
                        </td>
                        <td>
                          <ClassicExperimentRowActions
                            experiment={experiment}
                            shopDomain={shopDomain}
                            checkoutReady={
                              isOfferExperimentType(experiment.experimentType)
                                ? offerCheckoutReady
                                : checkoutReady
                            }
                            listBusy={Boolean(gridBusy) || loading}
                            onBusy={handleRowBusy}
                            onRefresh={handleRowRefresh}
                            onActionDone={handleRowActionDone}
                            onMessage={handleListMessage}
                          />
                        </td>
                      </tr>
                      {expanded
                        ? experiment.plans.map(plan => {
                            const arms = Array.isArray(plan.price_arms) ? plan.price_arms : [];
                            const isOffer = isOfferExperimentType(experiment.experimentType);
                            const control = arms[0]?.price;
                            const variantCount =
                              Number(plan.variant_count) ||
                              (Array.isArray(plan.variants) ? plan.variants.length : 0) ||
                              arms.length ||
                              0;
                            return (
                              <tr
                                key={`${experiment.id}-${plan.id}`}
                                className={styles.expChildRow}
                              >
                                <td colSpan={7}>
                                  <div className={styles.expChildInner}>
                                    {plan.image_url ? (
                                      <img
                                        className={styles.thumb}
                                        src={plan.image_url}
                                        alt=""
                                        style={{ width: 36, height: 36 }}
                                      />
                                    ) : (
                                      <div
                                        className={styles.thumb}
                                        style={{ width: 36, height: 36 }}
                                      />
                                    )}
                                    <div className={styles.expChildMeta}>
                                      <div className={styles.productName}>
                                        {getPlanProductTitle(plan)}
                                      </div>
                                      <div className={styles.productSub}>
                                        {plan.product_type || 'Catalog'}
                                        {control !== null &&
                                        control !== undefined &&
                                        Number.isFinite(Number(control))
                                          ? ` · base $${Number(control).toFixed(2)}`
                                          : ''}
                                        {variantCount
                                          ? ` · ${variantCount} variant${
                                              variantCount === 1 ? '' : 's'
                                            }`
                                          : ''}
                                      </div>
                                    </div>
                                    <div className={styles.expChildArms}>
                                      {arms.slice(0, 3).map((arm, idx) => (
                                        <span
                                          key={arm.id || idx}
                                          className={`${styles.armChip} ${
                                            idx > 0 ? styles.armChipAlt : ''
                                          }`}
                                        >
                                          <span className={styles.armLetter}>
                                            {String.fromCharCode(65 + idx)}
                                          </span>
                                          {isOffer
                                            ? idx === 0 || arm.role === 'control'
                                              ? 'No offer'
                                              : formatOfferRule(arm.offer)
                                            : arm.price !== null &&
                                                arm.price !== undefined &&
                                                Number.isFinite(Number(arm.price))
                                              ? `$${Number(arm.price).toFixed(
                                                  Number(arm.price) % 1 === 0 ? 0 : 2
                                                )}`
                                              : '—'}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        : null}
                    </React.Fragment>
                  );
                })}
            </tbody>
          </table>
        </div>

        <div className={styles.listFooterLinks}>
          <Button variant="plain" onClick={() => navigate(ROUTES.appSettings(shopDomain))}>
            Settings
          </Button>
          <Button variant="plain" onClick={() => navigate(ROUTES.appSetup(shopDomain))}>
            Setup
          </Button>
        </div>
      </div>
    </PageShell>
  );
}
