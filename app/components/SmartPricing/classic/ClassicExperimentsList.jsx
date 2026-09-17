import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Badge, Button, Spinner, TextField } from '@shopify/polaris';
import PageShell from '../../shared/PageShell';
import { ROUTES } from '../../../constants';
import useClassicShopDomain from '../../../hooks/useClassicShopDomain';
import { useKeyedState } from '../../../hooks/useKeyedState';
import { readInboxPlans, setInboxPersistHandler, writeInboxPlans } from '../smartPricingConstants';
import { filterPlansByQuery } from '../smartPricingUiHelpers';
import { hydrateInboxFromServer, schedulePersistInboxPlans } from '../smartPricingInboxPersistence';
import {
  formatClassicStatusLabel,
  getPlanExperimentId,
  getPlanProductTitle,
  groupPlansIntoExperiments,
  sortExperimentRowsByRecency,
  wizardDraftAsExperimentRow,
} from './classicExperimentHelpers';
import { selectUnlistedWizardDrafts, wizardDraftStepLabel } from './classicWizardAutosave';
import { loadWizardDrafts } from './classicWizardDraftSync';
import { formatOfferRule, isOfferExperimentType } from './offerSelection';
import ClassicExperimentRowActions from './ClassicExperimentRowActions';
import {
  buildClassicWizardResumePath,
  filterClassicExperimentsByTab,
  listTabAfterClassicAction,
} from './classicExperimentListActions';
import {
  enrichExperimentsWithListAnalytics,
  fetchListAnalyticsForEditGating,
} from './classicExperimentListAnalytics';
import { classicCreateStepId } from './classicCreateSteps';
import { useSmartPricingCheckoutReadiness } from '../../../hooks/useSmartPricingCheckoutReadiness';
import {
  ButtonIconPlus,
  IconChevron,
  IconBolt,
  IconControlBaseline,
  IconPerson,
  IconTrendUp,
} from './classicIcons';
import TooltipWrapper from '../../shared/TooltipWrapper';
import styles from './SmartPricingClassic.module.css';

const STAT_TOOLTIPS = {
  running: 'Number of tests currently running.',
  visitors: 'Visitors who have entered any Priceify test this month.',
  winning:
    'Tests that have reached your minimum visitors and have a clear winner.',
};

const TABLE_HEADER_TOOLTIPS = {
  visitors: 'Visitors who entered this test.',
  lift: 'Revenue per visitor uplift vs control.',
  confidence: 'How sure the maths is that the winner is better than control.',
};

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'running', label: 'Running' },
  { id: 'draft', label: 'Draft' },
  { id: 'paused', label: 'Paused' },
  { id: 'finished', label: 'Finished' },
];

function statusVisual(experiment) {
  const status = experiment.status;
  if (status === 'archived' || experiment.archived) {
    return { tone: undefined, text: 'Finished' };
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

function emptyFilterCopy(filter, { reachedDraftServer = true } = {}) {
  // Drafts are the one tab whose contents can be somewhere this page failed to
  // reach. On a device with no local copy -- the second device, which is the
  // whole point of saving them server-side -- a network blip would otherwise
  // render as a confident "you have none" over work that is simply not loaded.
  if (filter === 'draft' && !reachedDraftServer) {
    return "Couldn't reach the server. Showing drafts saved in this browser.";
  }
  if (filter === 'running') return 'No running tests.';
  if (filter === 'draft') return 'No draft tests.';
  if (filter === 'paused') return 'No paused tests.';
  if (filter === 'finished') return 'No finished tests.';
  return 'No tests yet.';
}

async function loadExperimentPlans(shopDomain, hydrateOptions) {
  const local = readInboxPlans(shopDomain) || [];
  try {
    const hydrated = await hydrateInboxFromServer(shopDomain, local, hydrateOptions).catch(
      () => null
    );
    if (hydrated?.plans) {
      writeInboxPlans(shopDomain, hydrated.plans, { persist: false });
      return { plans: hydrated.plans, message: '' };
    }
    return { plans: local, message: '' };
  } catch (err) {
    return {
      plans: readInboxPlans(shopDomain) || [],
      message: err.message || 'Could not load tests.',
    };
  }
}

/**
 * Plans and unfinished drafts, read together.
 *
 * The two have to be taken in the same pass: a draft is only shown when the
 * inbox has no plans under its experiment id, so reading them at different
 * moments can show an experiment twice, once as a draft and once as itself.
 */
async function loadExperimentsAndDrafts(shopDomain, hydrateOptions) {
  const [plansResult, draftsResult] = await Promise.all([
    loadExperimentPlans(shopDomain, hydrateOptions),
    loadWizardDrafts(shopDomain),
  ]);
  return {
    ...plansResult,
    drafts: draftsResult.drafts,
    reachedDraftServer: draftsResult.reachedServer,
  };
}

function formatMetricLabel(metric) {
  const raw = String(metric || '').trim();
  // An unspecified goal launches on revenue per visitor, so that is what a
  // blank metric has to say here.
  if (!raw) return 'Revenue per visitor';
  // Sentence case rather than a lookup of the metrics we happen to know: an
  // unfinished draft carries whatever key the wizard stored, and the ones not
  // on that list used to print lowercase, reading as a raw database value in a
  // column where every other row is prose.
  const words = raw.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
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
  const [localDrafts, setLocalDrafts] = useState([]);
  const [reachedDraftServer, setReachedDraftServer] = useState(true);
  const [search, setSearch] = useState('');
  // Starts busy for each shop; the first load below never has to flip it on.
  const [loading, setLoading] = useKeyedState(shopDomain, true);
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

  const loadRequestRef = useRef(0);

  const applyLoad = useCallback(
    result => {
      setPlans(result.plans);
      setLocalDrafts(result.drafts || []);
      setReachedDraftServer(result.reachedDraftServer !== false);
      if (result.message) setMessage(result.message);
      setLoading(false);
      setGridBusy('');
    },
    [setLoading]
  );

  // Refreshes triggered by row actions show the spinner again unless the caller
  // asked for a quiet background hydrate.
  const reload = useCallback(
    async (hydrateOptions = {}) => {
      const quiet = Boolean(
        hydrateOptions.quiet || hydrateOptions.preferLocalIds || hydrateOptions.omitIds
      );
      if (!quiet) setLoading(true);
      const requestId = loadRequestRef.current + 1;
      loadRequestRef.current = requestId;
      const result = await loadExperimentsAndDrafts(shopDomain, hydrateOptions);
      // Drop a hydrate that lost the race to a newer load or a shop switch,
      // otherwise the list can show a different shop's experiments.
      if (requestId !== loadRequestRef.current) return;
      applyLoad(result);
    },
    [shopDomain, applyLoad, setLoading]
  );

  useEffect(() => {
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    loadExperimentsAndDrafts(shopDomain, {}).then(result => {
      if (requestId === loadRequestRef.current) applyLoad(result);
    });
  }, [shopDomain, applyLoad]);

  const inboxExperimentRows = useMemo(() => {
    const fromPlans = groupPlansIntoExperiments(plans);
    const draftRows = selectUnlistedWizardDrafts(localDrafts, plans.map(getPlanExperimentId))
      .map(wizardDraftAsExperimentRow)
      .filter(Boolean);
    return sortExperimentRowsByRecency([...draftRows, ...fromPlans]);
  }, [plans, localDrafts]);

  const experiments = useMemo(() => {
    const queried = filterPlansByQuery(plans, search);
    const fromPlans = groupPlansIntoExperiments(queried);
    const needle = search.trim().toLowerCase();
    const draftRows = selectUnlistedWizardDrafts(localDrafts, plans.map(getPlanExperimentId))
      .map(wizardDraftAsExperimentRow)
      .filter(Boolean)
      .filter(row => !needle || row.title.toLowerCase().includes(needle));
    return filterClassicExperimentsByTab(
      sortExperimentRowsByRecency([...draftRows, ...fromPlans]),
      filter
    );
  }, [plans, localDrafts, filter, search]);

  const [listAnalyticsByTestId, setListAnalyticsByTestId] = useState({});

  useEffect(() => {
    let cancelled = false;
    if (!shopDomain) return undefined;
    fetchListAnalyticsForEditGating(shopDomain, inboxExperimentRows).then(map => {
      if (!cancelled) setListAnalyticsByTestId(map && typeof map === 'object' ? map : {});
    });
    return () => {
      cancelled = true;
    };
  }, [shopDomain, inboxExperimentRows]);

  const experimentsWithAnalytics = useMemo(
    () => enrichExperimentsWithListAnalytics(experiments, listAnalyticsByTestId),
    [experiments, listAnalyticsByTestId]
  );

  const stats = useMemo(() => {
    const allExperiments = groupPlansIntoExperiments(plans.filter(p => !p.archived));
    const running = allExperiments.filter(e => e.status === 'running').length;
    const winning = allExperiments.filter(
      e => e.status === 'winner_ready' || e.status === 'applied' || e.status === 'completed'
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
    // An unfinished draft has no detail page to open -- there is no plan behind
    // it yet -- so its title reopens the wizard where it was left. Clicking it
    // used to do nothing at all.
    if (experiment.wizardDraft) {
      navigate(
        buildClassicWizardResumePath(
          experiment.id,
          classicCreateStepId(experiment.wizardDraft.step) || undefined
        )
      );
      return;
    }
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
    await reload(hydrateOptions || {});
  };

  const handleRowActionDone = (action, experiment) => {
    const nextTab = listTabAfterClassicAction(action, experiment, filter);
    if (nextTab && nextTab !== filter) {
      setFilterAndUrl(nextTab);
    }
  };

  const gridBusyLabel =
    gridBusy === 'pause'
      ? 'Pausing test…'
      : gridBusy === 'resume'
        ? 'Resuming test…'
        : gridBusy === 'delete'
          ? 'Deleting test…'
          : gridBusy === 'launch'
            ? 'Launching test…'
            : gridBusy === 'archive'
              ? 'Archiving test…'
              : gridBusy === 'restore'
                ? 'Restoring test…'
                : gridBusy === 'duplicate'
                  ? 'Duplicating test…'
                  : gridBusy
                    ? 'Updating tests…'
                    : 'Loading tests…';

  return (
    <PageShell message={message} messageType={messageType} onCloseMessage={() => setMessage('')}>
      <div className={styles.listPage}>
        <div className={styles.listHeader}>
          <p className={styles.eyebrow}>Workspace</p>
          <div className={styles.listHeaderMain}>
            <div>
              <h1 className={`${styles.listTitle} ripx-classic-sans`}>Tests</h1>
              <p className={styles.subtitle} style={{ marginBottom: 0 }}>
                Run price and offer tests to grow revenue per visitor.
              </p>
              <p className={styles.help} style={{ marginTop: 6, marginBottom: 0 }}>
                Launch price tests in minutes. See which prices grow revenue per visitor.
              </p>
            </div>
            <div className={styles.listHeaderActions}>
              <Button
                variant="primary"
                icon={ButtonIconPlus}
                disabled={loading || Boolean(gridBusy)}
                onClick={() => navigate(ROUTES.appSmartPricingCreate(shopDomain))}
              >
                New test
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
              <TooltipWrapper content={STAT_TOOLTIPS.running}>
                <div className={styles.statLabel}>Running tests</div>
              </TooltipWrapper>
            </div>
            <div className={styles.statValue}>{stats.running}</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statCardTop}>
              <div className={styles.statIcon} aria-hidden>
                <IconPerson />
              </div>
              <TooltipWrapper content={STAT_TOOLTIPS.visitors}>
                <div className={styles.statLabel}>Visitors this month</div>
              </TooltipWrapper>
            </div>
            <div className={styles.statValue}>{stats.visitors.toLocaleString()}</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statCardTop}>
              <div className={styles.statIcon} aria-hidden>
                <IconTrendUp />
              </div>
              <TooltipWrapper content={STAT_TOOLTIPS.winning}>
                <div className={styles.statLabel}>Winning tests</div>
              </TooltipWrapper>
            </div>
            <div className={styles.statValue}>{stats.winning}</div>
          </div>
        </div>

        {/* Unfinished drafts used to sit in a banner here, above the tabs,
            because they had no inbox plans to be grouped into a row. They are
            rows now, so "my drafts" is one place instead of two -- and the
            Drafts tab no longer says a merchant has none while a banner right
            above it lists three. */}

        <div className={styles.filterRow}>
          <div className={styles.filterGroup}>
            <span className={styles.filterLabel} id="tests-status-filter-label">
              Status
            </span>
            <div
              className={styles.filterPillTrack}
              role="tablist"
              aria-labelledby="tests-status-filter-label"
            >
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
          </div>
          <div className={styles.listSearch}>
            <TextField
              label="Search tests"
              labelHidden
              value={search}
              onChange={setSearch}
              autoComplete="off"
              placeholder="Search tests"
            />
          </div>
        </div>

        <div className={styles.expTableWrap} aria-busy={loading || Boolean(gridBusy)}>
          {loading || gridBusy ? (
            <div className={styles.expTableBusy} role="status" aria-live="polite">
              <Spinner size="small" />
              <span>{gridBusy ? gridBusyLabel : 'Loading tests…'}</span>
            </div>
          ) : null}
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Test</th>
                <th>Status</th>
                <th>Primary metric</th>
                <th>
                  <TooltipWrapper content={TABLE_HEADER_TOOLTIPS.visitors}>
                    <span>Visitors</span>
                  </TooltipWrapper>
                </th>
                <th>
                  <TooltipWrapper content={TABLE_HEADER_TOOLTIPS.lift}>
                    <span>Lift</span>
                  </TooltipWrapper>
                </th>
                <th>
                  <TooltipWrapper content={TABLE_HEADER_TOOLTIPS.confidence}>
                    <span>Confidence</span>
                  </TooltipWrapper>
                </th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loading && experimentsWithAnalytics.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className={styles.listEmptyState}>
                      <p className={styles.subtitle}>
                        {emptyFilterCopy(filter, { reachedDraftServer })}
                      </p>
                      {filter === 'all' || filter === 'draft' ? (
                        <Button
                          variant="primary"
                          icon={ButtonIconPlus}
                          onClick={() => navigate(ROUTES.appSmartPricingCreate(shopDomain))}
                        >
                          New test
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ) : null}
              {!loading &&
                experimentsWithAnalytics.map(experiment => {
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
                            {/* Keyed off the plans the row can actually show,
                                not its product count. An unfinished draft
                                counts the variants picked in the wizard but has
                                no plans built yet, so counting those offered a
                                chevron that expanded to nothing. */}
                            {experiment.plans.length > 1 ? (
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
                                {experiment.title || 'Untitled test'}
                              </button>
                              <div className={styles.productSub}>
                                {experiment.typeLabel || 'Price test'} ·{' '}
                                {/* For an unfinished draft, how far it got is
                                    the useful thing to say and the owner is
                                    always the merchant reading it. This is what
                                    the drafts banner used to carry. */}
                                {experiment.wizardDraft
                                  ? wizardDraftStepLabel(experiment.wizardDraft) ||
                                    'Not started'
                                  : experiment.owner}
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
                                      {arms.slice(0, 3).map((arm, idx) => {
                                        const isControl = idx === 0 || arm.role === 'control';
                                        const letter = String.fromCharCode(64 + Math.max(1, idx));
                                        return (
                                          <span
                                            key={arm.id || idx}
                                            className={`${styles.armChip} ${
                                              !isControl ? styles.armChipAlt : ''
                                            }`}
                                          >
                                            <span
                                              className={`${styles.armLetter} ${
                                                isControl ? styles.controlVariationMarker : ''
                                              }`}
                                              aria-label={
                                                isControl
                                                  ? 'Control — current catalog baseline'
                                                  : `Variation ${letter}`
                                              }
                                            >
                                              {isControl ? (
                                                <IconControlBaseline size={10} />
                                              ) : (
                                                letter
                                              )}
                                            </span>
                                            {isOffer
                                              ? isControl
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
                                        );
                                      })}
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
