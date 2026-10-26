import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collapseCountrySelection, resolveCountryLists } from './countrySelection';
import { estimateSignificanceDuration } from './estimateSignificanceDuration';
import { shopDesignFromGuardrails, stampStatisticalFields } from './sampleSizePolicy';
import { useNavigate, useSearchParams } from 'react-router';
import { Banner, Button } from '@shopify/polaris';
import PageShell from '../../shared/PageShell';
import ClassicPageLoader from '../../shared/ClassicPageLoader';
import { ROUTES } from '../../../constants';
import { preserveEmbeddedSearch } from '../../../utils/shopifyEmbeddedSearch';
import { apiGet } from '../../../services';
import useClassicShopDomain from '../../../hooks/useClassicShopDomain';
import { useHydrated } from '../../../hooks/useHydrated';
import { useKeyedState } from '../../../hooks/useKeyedState';
import {
  createSmartPricingBatch,
  getSmartPricingGuardrails,
  getSmartPricingOpportunities,
  getSmartPricingOpportunitiesProgress,
  suggestSmartPricingGoals,
  suggestSmartPricingPrices,
  batchPreviewSmartPricingLaunch,
  getSmartPricingExperimentTests,
  applyPausedSmartPricingSettings,
} from '../../../services/smartPricingApi';
import { appendActivityToPlans, createActivityEntry } from './classicActivity';
import LiveEditLockedStep from './LiveEditLockedStep';
import {
  alreadyLaunchedPlanIds,
  useSmartPricingLaunch,
} from '../../../hooks/useSmartPricingLaunch';
import { useSmartPricingCheckoutReadiness } from '../../../hooks/useSmartPricingCheckoutReadiness';
import { readInboxPlans, writeInboxPlans } from '../smartPricingConstants';
import { persistInboxPlansNow } from '../smartPricingInboxPersistence';
/**
 * Products per experiment (not parallel-test capacity).
 *
 * Nothing downstream requires a cap: the batch endpoint takes any number of
 * variant ids, tests are one JSONB row each, and checkout prices ride on cart
 * line attributes rather than a size-limited metafield. What the number really
 * protects is the storefront: launching an experiment starts one test per
 * product, and every running test is embedded in the script that loads on every
 * page, so the selection size lands on shopper page weight.
 *
 * It was 100 from the first commit with no recorded reason, and at 100 it bit
 * ordinary catalogs -- a 118-product store could not select its own catalog.
 * At 250 a 282-product store could not put its own catalog in one test. Live
 * variants are fetched 50 tests to a request, three requests at a time, so 500
 * is at most ten requests per page view, four rounds at worst.
 */
const CLASSIC_MAX_PRODUCT_SELECTION = 500;
/** Long enough that typing does not write on every keystroke. */
const WIZARD_AUTOSAVE_DELAY_MS = 600;

/**
 * What to tell the merchant when the browser kept the draft but the server
 * did not.
 *
 * A refusal and an unreachable server both leave the work in this browser
 * alone, and they need opposite advice. "Try again" is right for a network
 * blip and wrong for a draft the server has read and declined -- most often
 * for being too large, which retrying will never fix.
 */
function draftServerFailureMessage(saved) {
  if (saved?.refused) {
    const reason = String(saved.reason || '').trim();
    return `${reason || 'The server would not accept this draft'}. It is still saved in this browser, but it will not reach your other devices.`;
  }
  return 'Saved in this browser only — we could not reach the server. Use Save draft to make it available on your other devices.';
}

/** Default AI pricing knobs for new non-control variation arms in the create wizard. */
function seedDefaultPricingByArm(prev, variations) {
  if (!Array.isArray(variations) || !variations.length) return prev;
  let changed = false;
  const next = { ...prev };
  variations.forEach((arm, index) => {
    if (index === 0 || arm.id === 'control') return;
    if (next[arm.id]?.priceMode) return;
    changed = true;
    next[arm.id] = {
      bulkPercent: '10',
      bulkDirection: 'increase',
      aiMinPct: '10',
      aiMaxPct: '20',
      aiUnit: 'percent',
      priceMode: 'ai',
      ...(next[arm.id] || {}),
    };
  });
  return changed ? next : prev;
}

/**
 * What to say about a save the server accepted.
 *
 * Two outcomes are not the plain success they used to be reported as. The
 * server may keep a newer copy of this draft, made on another device, in which
 * case this save did not land at all. And a shop only keeps five unfinished
 * experiments, so starting a sixth throws the oldest away -- silently, until
 * now, which meant coming back to Drafts to find work gone and nothing to
 * explain it.
 */
function draftSavedMessage(saved) {
  if (saved?.superseded) {
    return 'A newer version of this draft was saved on another device, so that one was kept. Reload to pick it up.';
  }
  const evicted = Array.isArray(saved?.evicted) ? saved.evicted : [];
  if (evicted.length) {
    const names = evicted
      .map(row => String(row?.name || '').trim())
      .filter(Boolean)
      .join(', ');
    const what = names || `${evicted.length} older draft${evicted.length === 1 ? '' : 's'}`;
    return `Draft saved. You had the maximum of ${CLASSIC_WIZARD_DRAFT_LIMIT} drafts, so ${what} was discarded to make room.`;
  }
  // Said here and not on every Continue. Nothing the merchant entered is
  // missing, so interrupting each step would be noise; but Save draft is them
  // asking what was kept, and on another device this one opens a step short.
  if (saved?.plansOmitted) {
    return 'Draft saved. Because this test has many products, it reopens on the Products step on other devices. Everything you entered is kept.';
  }
  return 'Draft saved. Keep editing here, or pick it up later from Drafts on the tests page.';
}
import {
  buildClassicGoalPayload,
  buildSecondaryGoalPayload,
  classicAudienceToSegments,
  createEmptyAudienceSegments,
  normalizeAudienceSegments,
  normalizeClassicAudienceTargeting,
  normalizeClassicCreatePrimaryMetric,
  normalizeCustomGoals,
  normalizeSecondaryEvents,
  BUILTIN_SECONDARY_METRICS,
} from '../targeting/smartPricingAudienceHelpers';
import ClassicWizardShell from './ClassicWizardShell';
import { CLASSIC_CREATE_STEPS, classicCreateStepIndex } from './classicCreateSteps';
import { buildClassicExperimentEditPath } from './classicExperimentListActions';
import {
  buildWizardResumeSearch,
  shouldAutosaveWizardSnapshot,
  wizardSnapshotHasMerchantInput,
} from './classicWizardAutosave';
import {
  forgetWizardDraftEverywhere,
  loadServerWizardDraft,
  saveWizardDraftEverywhere,
  wizardDraftSavedAt,
} from './classicWizardDraftSync';
import SetupStepPanel, { EXPERIMENT_TYPES } from './SetupStepPanel';
import VariationsStepPanel, { createDefaultVariations } from './VariationsStepPanel';
import {
  getVariationsStepContinueState,
  normalizeWholeTrafficSplit,
  variationsFromPlanArms,
} from './variationsStepHelpers';
import ProductsPricingStepPanel from './ProductsPricingStepPanel';
import AudienceSuccessStepPanel, { createDefaultAudienceState } from './AudienceSuccessStepPanel';
import { ensureRevenueGuardrailRows, revenueGuardrailGoalConfig } from './revenueGuardrail';
import ReviewLaunchStepPanel from './ReviewLaunchStepPanel';
import {
  CLASSIC_WIZARD_DRAFT_LIMIT,
  getPlanExperimentId,
  readClassicWizardDraft,
  stampClassicExperimentMetadata,
  upsertExperimentPlansInInbox,
  writeClassicWizardDraft,
} from './classicExperimentHelpers';
import {
  DEFAULT_MIN_SAMPLE_SIZE,
  applyAudienceUiToPlans,
  mergeInboxPlansById,
  resolveLiveEditActivityEntries,
  resolveMinSampleSize,
  validateClassicAudienceUi,
} from './classicAudienceEdit';
import {
  formatCatalogLoadError,
  getProductsStepContinueState,
  isAiSuggestedPrice,
  describeAiBandRange,
  composeAiSuggestBanner,
  describeAiSuggestionSource,
  describeGuardrailLimitedSuggestions,
  normalizeAiPriceBand,
  applyPriceSuggestionsToOverrides,
  buildAiBandPriceOverrides,
  buildLocalPriceSuggestionMeta,
  keepArmKeys,
  metaFromPriceSuggestions,
  resolveAiSuggestSpreadArms,
  siblingArmPrices,
  guardrailPriceWindow,
  aiBandOrderError,
  variantIdentity,
  resolveAiSuggestTargetArms,
  resolveBandEdge,
  lookupPriceOverride,
  priceOverrideKey,
  removedArmIds,
  dropArmEntries,
  reconcileSelectedVariantIds,
  resolvePricingRows,
  limitSelectionToProducts,
} from './productsStepReadiness';
import { newCatalogProgressId, startCatalogProgressPoll } from './catalogLoadProgress';
import { buildUnavailableSelectionNotice } from './productsStepCatalogCopy';
import {
  isActionableOfferConfig,
  getOfferCheckoutBlockReason,
  isOfferExperimentType,
  normalizeOfferConfig,
  offerByArmFromPlanArms,
} from './offerSelection';
import { priceSurfacesUnmapped } from '../../../utils/checkoutReadinessClient';
import SettingsInfoLink from '../../Settings/SettingsInfoLink';
import styles from './SmartPricingClassic.module.css';

/**
 * The first step is where the merchant picks the type, so until it is behind
 * them there is no telling whether price selectors matter to this run at all.
 */
const FIRST_STEP_AFTER_TYPE_CHOSEN = 1;

/** Test statuses that mean the experiment is past the wizard. */
const LAUNCHED_TEST_STATUSES = new Set(['running', 'paused', 'scheduled', 'stopped', 'completed']);

/** Plans an Edit test on a live experiment covers: the ones still running or paused. */
const LIVE_EDIT_PLAN_STATUSES = new Set(['running', 'active', 'paused', 'scheduled']);

/** A plan whose test exists and has left draft: its experiment has launched. */
function isLaunchedPlan(plan) {
  const status = String(plan?.status || '').trim().toLowerCase();
  return Boolean(String(plan?.test_id || '').trim()) && status !== 'draft' && status !== 'queued';
}

function createExperimentId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `exp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function segmentsFromClassicAudience(audienceState, baseSegments) {
  return normalizeAudienceSegments(
    classicAudienceToSegments(audienceState || createDefaultAudienceState(), baseSegments)
  );
}

function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

/** Rebuild plan arms Control-first from wizard variations + overrides. */
function rebuildPlanArmsFromVariations(
  plan,
  variations = [],
  priceOverrides = {},
  offerByArm = {},
  priceSuggestionMeta = {}
) {
  const base = Number(plan?.current_price) || 0;
  const variantId = plan?.variant_id;
  return (variations || []).map((variation, index) => {
    const isControl = index === 0 || variation.id === 'control';
    const armId = variation.id || (isControl ? 'control' : `arm_${index + 1}`);
    const raw = lookupPriceOverride(priceOverrides, variantId, armId);
    const hasOverride =
      raw !== undefined &&
      raw !== null &&
      String(raw).trim() !== '' &&
      Number.isFinite(Number(raw));
    const price = isControl ? base : hasOverride ? Number(raw) : base;
    const delta = base > 0 ? ((price - base) / base) * 100 : 0;
    const offer = isControl ? null : normalizeOfferConfig(offerByArm[variation.id]);
    return {
      id: variation.id || (isControl ? 'control' : `arm_${index + 1}`),
      role: isControl ? 'control' : 'challenger',
      label: variation.name || (isControl ? 'Control' : `Variation ${variation.letter || index}`),
      price: roundMoney(price),
      delta_percent: roundMoney(delta),
      traffic_percent: Number(variation.traffic) || 0,
      allocation_percent: Number(variation.traffic) || 0,
      offer: isControl || !isActionableOfferConfig(offer) ? null : offer,
      // Launch holds every other price to max price change; an AI band is used as typed.
      ...(!isControl && hasOverride && isAiSuggestedPrice(priceSuggestionMeta, priceOverrides, variantId, armId)
        ? { price_source: 'ai' }
        : {}),
    };
  });
}

// The two fetchers below return results instead of writing state, so effects can
// start them without setting state synchronously.
async function fetchShopGuardrails(shopDomain) {
  try {
    const data = await getSmartPricingGuardrails(shopDomain);
    const g = data?.guardrails || data || {};
    return { guardrails: g && typeof g === 'object' ? g : {}, ok: true };
  } catch {
    return { guardrails: {}, ok: false };
  }
}

async function fetchCatalog(shopDomain, { onProgress } = {}) {
  const progressId = onProgress ? newCatalogProgressId() : '';
  const stopPolling = onProgress
    ? startCatalogProgressPoll(() => getSmartPricingOpportunitiesProgress(shopDomain, progressId), onProgress)
    : () => {};
  try {
    // Classic wizard product picker needs the full catalog.
    // `ai_pick` only returns recommended rows — empty when AI ranking fails or none are tagged.
    const data = await getSmartPricingOpportunities(shopDomain, {
      filter: 'all',
      // Rebuild the snapshot so prices, stock and new products are current.
      refresh: true,
      // The AI ranking only orders and annotates the top few products, and
      // waiting for it was most of this step's load time.
      aiRanking: 'background',
      progressId,
    });
    const rows = Array.isArray(data?.opportunities) ? data.opportunities : [];
    if (data?.error && !rows.length) {
      throw new Error(String(data.error));
    }
    return {
      rows,
      defaults: data?.default_selected_variant_ids || rows.map(r => r.variant_id).filter(Boolean),
      // Products another price test is holding are not in `rows`. Saying so
      // beats letting a merchant hunt for a product that is simply not
      // offered, which is what the silent version of this filter caused.
      withheld: data?.summary?.withheld_by_other_tests || null,
      // A catalog larger than one snapshot is loaded in part. The picker used
      // to present that part as the whole catalog, so the rest of the shop's
      // products looked like they did not exist.
      catalogTruncated: Boolean(data?.summary?.catalog_truncated),
      catalogLoadedProductCount:
        data?.summary?.store_product_count ?? data?.summary?.catalog_product_count ?? null,
      error: '',
    };
  } catch (err) {
    return {
      rows: [],
      defaults: [],
      withheld: null,
      catalogTruncated: false,
      catalogLoadedProductCount: null,
      error: formatCatalogLoadError(err),
    };
  } finally {
    stopPolling();
  }
}

/**
 * Whether a saved plan belongs to the draft named by `?resume=`. A plan that
 * names no experiment is resumed by its own id, which is all the list has
 * for it.
 */
function planMatchesResumeId(plan, resumeId) {
  const experimentId = getPlanExperimentId(plan);
  if (experimentId) return experimentId === resumeId;
  return String(plan?.id || '') === resumeId;
}

/**
 * @param {{ onTitleChange?: (title: string) => void }} props
 *   `onTitleChange` reports what this draft should be called, so the admin
 *   title bar can stop saying "New experiment" once the draft has a name. The
 *   name lives in this component's state and the title bar is rendered by the
 *   route, so it has to travel upwards; the alternative was moving App Bridge
 *   into the wizard, which every test that renders the wizard bare would then
 *   have to stub.
 */
export default function ClassicCreateWizard({ onTitleChange }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const shopDomain = useClassicShopDomain();
  const resumeId = String(searchParams.get('resume') || '').trim();
  const stepParam = String(searchParams.get('step') || '').trim();
  // Edit test on a running or paused test: the same steps, with what shoppers
  // are already assigned to (variations, products, prices) shown but locked.
  const liveEditRequested = Boolean(resumeId) && searchParams.get('live') === '1';
  const [liveEdit, setLiveEdit] = useState(false);

  // A ?step= deep link decides where the wizard opens. Moving between steps
  // rewrites it (see syncResumeUrl) so a refresh comes back to the same place;
  // because the rewrite always matches the step just set, the re-key below
  // resolves to the value already on screen.
  const urlStep = classicCreateStepIndex(stepParam);
  const [step, setStep] = useKeyedState(stepParam, urlStep ?? 0);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('error');
  const [busy, setBusy] = useState(false);
  /** Full-page loader while Launch test runs, then while routing to test details. */
  const [launchPhase, setLaunchPhase] = useState('');
  const [launchProgress, setLaunchProgress] = useState(null);
  const [savingDraft, setSavingDraft] = useState(false);
  // Stable on SSR + first client paint; a real id appears once the draft has been
  // read after mount, so server and client markup agree.
  const [generatedExperimentId] = useState(createExperimentId);
  const [draftExperimentId, setExperimentId] = useState('');
  const hydrated = useHydrated();
  const [draftHydrated, setDraftHydrated] = useState(false);
  const experimentId = draftExperimentId || (draftHydrated ? generatedExperimentId : '');
  // Tracks whether a saved draft won: shop defaults must not overwrite values the
  // merchant already chose.
  const [appliedSavedDraft, setAppliedSavedDraft] = useState(false);
  // Restored from plans already in the inbox rather than from a draft, so
  // there is no draft for the server to be holding a newer copy of.
  const [resumedFromInbox, setResumedFromInbox] = useState(false);
  // Set while ?resume= names a draft only the server can hold. The wizard
  // stays behind its loader until that copy lands: a blank, editable form in
  // the meantime counted as the merchant's own input, so the restore stood
  // down and the blank form was saved as a second, unnamed draft.
  const [serverDraftPendingId, setServerDraftPendingId] = useState('');
  // Set when ?resume= names an experiment that has already launched. Edit for
  // one of those is its details page; this wizard can only create.
  const [launchedResumeId, setLaunchedResumeId] = useState('');
  useEffect(() => {
    if (!launchedResumeId) return;
    navigate(buildClassicExperimentEditPath(launchedResumeId), { replace: true });
  }, [launchedResumeId, navigate]);

  const [name, setName] = useState('');
  // Whether the name has been settled rather than still being typed. Latched in
  // a ref, so returning to the first step to reword the name does not put the
  // title bar back to "New experiment" for a draft that already has one -- and a
  // resumed draft counts from the moment its saved values land, wherever it
  // reopens.
  const nameSettled = useRef(false);
  useEffect(() => {
    if (step > 0 || appliedSavedDraft) nameSettled.current = true;
    onTitleChange?.(nameSettled.current ? name.trim() : '');
  }, [step, appliedSavedDraft, name, onTitleChange]);
  const [hypothesis, setHypothesis] = useState('');
  const [experimentType, setExperimentType] = useState('price_test');
  const [shopGuardrailsReady, setShopGuardrailsReady] = useState(false);

  const [variations, setVariations] = useState(createDefaultVariations);

  /**
   * Why a live test blocks this launch, as the server answered on entering the
   * review step. Two tests pricing one product is two answers to what it
   * costs, and an offer test holds its product exactly as a price test does:
   * its discount lands on top of whatever price the other test is setting.
   */
  const [liveTestConflict, setLiveTestConflict] = useState('');

  const [opportunities, setOpportunities] = useState([]);
  /** How many products the catalog withheld because another test is pricing them. */
  const [withheldByOtherTests, setWithheldByOtherTests] = useState(null);
  /** True when the shop has more products than one catalog snapshot loads. */
  const [catalogTruncated, setCatalogTruncated] = useState(false);
  // How far the running catalog load has got; null when none is running.
  const [catalogProgress, setCatalogProgress] = useState(null);
  const [catalogLoadedProductCount, setCatalogLoadedProductCount] = useState(null);
  const [catalogSearching, setCatalogSearching] = useState(false);
  /** Last whole-catalog search from the product picker (`empty` | `found` | `error`). */
  const [catalogSearchHint, setCatalogSearchHint] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [maxSelection] = useState(CLASSIC_MAX_PRODUCT_SELECTION);
  const [pickMode, setPickMode] = useState('manual');
  const [collectionOptions, setCollectionOptions] = useState([
    { label: 'All products', value: '' },
  ]);
  // Reaching the products step kicks off a catalog load, so the spinner is on
  // from that first render instead of being switched on from an effect.
  const [loadingProducts, setLoadingProducts] = useKeyedState(
    `${shopDomain}|${step >= 2 ? 'on' : 'off'}`,
    step >= 2
  );
  const [productsLoadError, setProductsLoadError] = useState('');
  // Default to first test variation so Manual price inputs are editable (Control is read-only).
  const [activeArmIndex, setActiveArmIndex] = useState(1);
  /** Per-variation pricing UI (mode + bulk/AI bands). Prices themselves live in priceOverrides keyed by variant::arm. */
  const [pricingByArm, setPricingByArm] = useState({});
  const [priceOverrides, setPriceOverrides] = useState({});
  const [priceSuggestionMeta, setPriceSuggestionMeta] = useState({});
  const [offerByArm, setOfferByArm] = useState({});
  const [aiPriceMeta, setAiPriceMeta] = useState({
    source: null,
    summary: null,
    detail: null,
    busy: false,
  });
  // The variation the Suggest status line was written for.
  const [aiPriceMetaArmId, setAiPriceMetaArmId] = useState(null);
  const aiSuggestRequestId = useRef(0);
  const productsLoadRequestId = useRef(0);

  const activeArmId = variations[activeArmIndex]?.id || 'control';
  const activePricing = pricingByArm[activeArmId] || {};
  const defaultPriceMode = isOfferExperimentType(experimentType) ? 'manual' : 'ai';
  const priceMode = activePricing.priceMode || defaultPriceMode;
  const bulkPercent = activePricing.bulkPercent ?? '10';
  const bulkDirection = activePricing.bulkDirection || 'increase';
  // Each variation has its own band, because Suggest prices only the variation
  // on screen: a tab has to show the band that produced the prices in it.
  const aiMinPct = activePricing.aiMinPct ?? '10';
  const aiMaxPct = activePricing.aiMaxPct ?? '20';
  const aiUnit = activePricing.aiUnit === 'amount' ? 'amount' : 'percent';

  const patchActivePricing = useCallback(
    patch => {
      setPricingByArm(prev => ({
        ...prev,
        [activeArmId]: {
          priceMode: defaultPriceMode,
          bulkPercent: '10',
          bulkDirection: 'increase',
          aiMinPct: '10',
          aiMaxPct: '20',
          aiUnit: 'percent',
          ...(prev[activeArmId] || {}),
          ...patch,
        },
      }));
    },
    [activeArmId, defaultPriceMode]
  );

  const patchAiBand = patchActivePricing;

  const markArmsAiSuggested = useCallback(armIds => {
    const ids = (armIds || []).map(id => String(id || '').trim()).filter(Boolean);
    if (!ids.length) return;
    setPricingByArm(prev => {
      const next = { ...prev };
      ids.forEach(id => {
        next[id] = {
          bulkPercent: '10',
          bulkDirection: 'increase',
          aiMinPct: '10',
          aiMaxPct: '20',
          aiUnit: 'percent',
          ...(next[id] || {}),
          priceMode: 'ai',
          aiSuggested: true,
        };
      });
      return next;
    });
  }, []);
  const setBulkPercent = useCallback(
    value => patchActivePricing({ bulkPercent: String(value) }),
    [patchActivePricing]
  );
  const setBulkDirection = useCallback(
    value => patchActivePricing({ bulkDirection: value }),
    [patchActivePricing]
  );
  const [shopGuardrails, setShopGuardrails] = useState({});
  const [scenarioPreset, setScenarioPreset] = useState('recommended');

  const [audience, setAudience] = useState(createDefaultAudienceState);
  // Hoisted so the AI callbacks below depend on the metric itself rather than on
  // every change to the audience object.
  const primaryMetric = audience?.primaryMetric;
  const [globalAudience, setGlobalAudience] = useState(createEmptyAudienceSegments);
  const [goalByPlan, setGoalByPlan] = useState({});
  const [plans, setPlans] = useState([]);
  const [autoRound2, setAutoRound2] = useState(true);

  const { launching, launchMany } = useSmartPricingLaunch(shopDomain);
  const {
    readiness: checkoutReadiness,
    checkoutReady,
    offerCheckoutReady,
    loading: checkoutLoading,
    refresh: refreshCheckoutReadiness,
  } = useSmartPricingCheckoutReadiness(shopDomain);
  const isOfferTest = isOfferExperimentType(experimentType);
  useEffect(() => {
    if (isOfferTest || resumeId) return undefined;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setPricingByArm(prev => seedDefaultPricingByArm(prev, variations));
    });
    return () => {
      cancelled = true;
    };
  }, [variations, isOfferTest, resumeId]);
  const launchCheckoutReady = isOfferTest ? offerCheckoutReady : checkoutReady;
  const experimentTypeLabel =
    EXPERIMENT_TYPES.find(type => type.id === experimentType)?.title || 'Price test';

  const backToList = () => navigate(ROUTES.appSmartPricing(shopDomain));
  const backToTestDetails = () => {
    const planId = (Array.isArray(plans) ? plans : []).find(plan => plan?.id)?.id;
    navigate(planId ? ROUTES.appSmartPricingPlan(shopDomain, planId) : ROUTES.appSmartPricing(shopDomain));
  };
  const openCheckoutSetup = () => {
    const path = ROUTES.appSetup(shopDomain);
    if (typeof navigate === 'function') {
      navigate(path);
      return;
    }
    window.open(path, '_blank');
  };
  const openPriceSurfaceSettings = () => {
    const path = preserveEmbeddedSearch('/app/settings?tab=price-surfaces&automap=1');
    if (typeof navigate === 'function') {
      navigate(path);
      return;
    }
    window.open(path, '_blank');
  };

  const wizardSnapshot = useMemo(
    () => ({
      experiment_id: experimentId,
      step,
      name,
      hypothesis,
      experimentType,
      variations,
      selectedIds,
      pickMode,
      activeArmIndex,
      pricingByArm,
      priceOverrides,
      offerByArm,
      scenarioPreset,
      audience,
      globalAudience,
      goalByPlan,
      plans,
      autoRound2,
      priceSuggestionMeta,
    }),
    [
      experimentId,
      step,
      name,
      hypothesis,
      experimentType,
      variations,
      selectedIds,
      pickMode,
      activeArmIndex,
      pricingByArm,
      priceOverrides,
      offerByArm,
      scenarioPreset,
      audience,
      globalAudience,
      goalByPlan,
      plans,
      autoRound2,
      priceSuggestionMeta,
    ]
  );

  // Read inside callbacks without making the snapshot a dependency, which
  // would cancel and refire their work on every keystroke.
  const liveSnapshot = useRef(wizardSnapshot);
  // What the wizard looked like once it finished restoring, so later code can
  // tell "the merchant has been typing" from "this is still exactly what we
  // restored". `wizardSnapshotHasMerchantInput` cannot: a resumed draft is
  // full of input by definition, all of it the draft's own.
  const seededSnapshot = useRef(null);
  // What is on screen while a server draft is still loading is a blank form,
  // not the draft, so nothing may save it.
  const draftPending = useRef(false);
  useEffect(() => {
    liveSnapshot.current = wizardSnapshot;
    draftPending.current = Boolean(serverDraftPendingId);
    if (draftHydrated && seededSnapshot.current === null) {
      seededSnapshot.current = JSON.stringify(wizardSnapshot);
    }
  });
  /** Whether nothing has changed since the wizard finished restoring. */
  const isUntouchedSinceSeed = useCallback(
    () =>
      seededSnapshot.current !== null &&
      JSON.stringify(liveSnapshot.current) === seededSnapshot.current,
    []
  );

  // Autosave keeps the wizard reloadable. Continuing a step and Save draft both
  // write the server copy too, so an unfinished experiment appears under Drafts
  // from the moment it has a name and can be finished from another device. Only
  // the keystroke-level autosave below stays local: it fires while the merchant
  // is still typing, and a request per keystroke buys nothing that the next
  // Continue does not already save.
  const autosaveSuspended = useRef(false);

  const syncResumeUrl = useCallback(
    stepIndex => {
      const search = buildWizardResumeSearch(searchParams, { experimentId, stepIndex });
      if (search == null) return;
      // Replace, so the browser Back button still leaves the wizard rather than
      // walking back through every step the merchant visited.
      setSearchParams(search, { replace: true, preventScrollReset: true });
    },
    [searchParams, setSearchParams, experimentId]
  );

  const persistWizardDraft = useCallback(
    snapshot => {
      // A live edit never becomes a draft: the experiment already exists.
      if (autosaveSuspended.current || liveEdit || draftPending.current) return false;
      if (!shouldAutosaveWizardSnapshot(snapshot)) return false;
      try {
        writeClassicWizardDraft(shopDomain, snapshot);
      } catch {
        // Storage can be full or blocked. Losing the local copy is worth less
        // than the wizard, so the merchant keeps working without it.
        return false;
      }
      return true;
    },
    [shopDomain, liveEdit]
  );

  /**
   * Save the draft to the browser and the server both.
   *
   * Not awaited by the step change that triggers it: the merchant should not
   * wait on a request to move between steps, and the browser copy is already
   * written by the time this returns, so nothing is lost if the request is
   * still in flight when they navigate away.
   */
  const persistWizardDraftEverywhere = useCallback(
    snapshot => {
      if (autosaveSuspended.current || liveEdit) {
        return Promise.resolve({ local: false, server: false });
      }
      return saveWizardDraftEverywhere(shopDomain, snapshot);
    },
    [shopDomain, liveEdit]
  );

  // `fresh` carries state produced in the same tick as the move. wizardSnapshot
  // is memoised from the last render, so a step that builds plans and advances
  // immediately would otherwise persist a draft holding the step it moved to
  // and the plans from before it ran — resuming there fails to launch for want
  // of products the merchant had in fact chosen.
  const goToStep = useCallback(
    (next, fresh = null) => {
      const target = Math.max(0, Math.min(CLASSIC_CREATE_STEPS.length - 1, Number(next) || 0));
      setStep(target);
      // Moving between steps is the merchant committing to what they just
      // entered, so this is the moment the draft becomes real rather than a
      // browser-local scratch copy.
      void persistWizardDraftEverywhere({
        ...wizardSnapshot,
        ...(fresh || {}),
        step: target,
      }).then(saved => {
        // Not awaited, but not discarded either. Each step tells the merchant
        // their experiment is saved where another device can pick it up; when
        // only the browser copy landed, this is where they get to hear it,
        // rather than on the other device when it turns out not to be there.
        // A server copy without its pricing table still holds everything the
        // merchant entered, and the table is rebuilt on the Products step, so
        // that counts as saved here. Save draft is where it gets explained.
        if (!saved || saved.skipped || saved.server) return;
        // A warning, not an error. The browser copy is already written by the
        // time this runs, so nothing has been lost and the step has already
        // moved; a red banner across the top of every step said otherwise.
        setMessageType('warning');
        setMessage(draftServerFailureMessage(saved));
      });
      syncResumeUrl(target);
    },
    [setStep, persistWizardDraftEverywhere, wizardSnapshot, syncResumeUrl]
  );

  // Edits inside a step are saved on a short delay as well: a merchant who
  // types a name and refreshes before pressing Continue should still find it.
  useEffect(() => {
    if (!draftHydrated) return undefined;
    const timer = setTimeout(() => {
      // A restore that has not been edited has nothing new to write, and
      // writing anyway would stamp it as saved now -- which would make a
      // browser copy that just lost to a newer server one outrank it.
      if (isUntouchedSinceSeed()) return;
      if (!persistWizardDraft(wizardSnapshot)) return;
      syncResumeUrl(step);
    }, WIZARD_AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [
    draftHydrated,
    wizardSnapshot,
    persistWizardDraft,
    syncResumeUrl,
    step,
    isUntouchedSinceSeed,
  ]);

  // The delay above means the most recent keystrokes are still pending when a
  // merchant closes the tab or clicks away, and cancelling the timer on the way
  // out would drop them. Both exits write what is pending instead. Dependencies
  // are all stable, so this runs its cleanup on unmount rather than per edit.
  useEffect(() => {
    const flush = () => {
      if (isUntouchedSinceSeed()) return;
      persistWizardDraft(liveSnapshot.current);
    };
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [persistWizardDraft, isUntouchedSinceSeed]);

  const applyWizardSnapshot = useCallback(
    snapshot => {
      if (!snapshot || typeof snapshot !== 'object') return;
      setAppliedSavedDraft(true);
      if (snapshot.experiment_id) setExperimentId(String(snapshot.experiment_id));
      // A draft too large to sync whole was stored without its pricing table,
      // and neither Review nor Launch means anything without one. The Products
      // step is what rebuilds it from the selections that did survive, so that
      // is where such a draft opens, whatever step it was left on.
      const lastStep = urlStep != null ? urlStep : Number(snapshot.step);
      if (Number.isFinite(lastStep)) {
        const productsStep = classicCreateStepIndex('products') ?? 2;
        setStep(snapshot.plans_omitted ? Math.min(lastStep, productsStep) : lastStep);
      }
      if (snapshot.name !== null && snapshot.name !== undefined) setName(String(snapshot.name));
      if (snapshot.hypothesis !== null && snapshot.hypothesis !== undefined)
        setHypothesis(String(snapshot.hypothesis));
      if (snapshot.experimentType) setExperimentType(snapshot.experimentType);
      if (Array.isArray(snapshot.variations) && snapshot.variations.length) {
        setVariations(normalizeWholeTrafficSplit(snapshot.variations));
      }
      if (Array.isArray(snapshot.selectedIds)) setSelectedIds(snapshot.selectedIds);
      if (snapshot.pickMode) setPickMode(snapshot.pickMode);
      if (Number.isFinite(Number(snapshot.activeArmIndex))) {
        setActiveArmIndex(Number(snapshot.activeArmIndex));
      }
      if (snapshot.pricingByArm && typeof snapshot.pricingByArm === 'object') {
        setPricingByArm(snapshot.pricingByArm);
      } else if (
        snapshot.priceMode ||
        (snapshot.bulkPercent !== null && snapshot.bulkPercent !== undefined) ||
        snapshot.bulkDirection ||
        (snapshot.aiMinPct !== null && snapshot.aiMinPct !== undefined) ||
        (snapshot.aiMaxPct !== null && snapshot.aiMaxPct !== undefined)
      ) {
        // Migrate legacy single-arm draft fields onto the active arm.
        const armKey =
          (Array.isArray(snapshot.variations) &&
            snapshot.variations[Number(snapshot.activeArmIndex) || 1]?.id) ||
          'var_a';
        setPricingByArm({
          [armKey]: {
            priceMode:
              snapshot.priceMode ||
              (isOfferExperimentType(snapshot.experimentType || experimentType) ? 'manual' : 'ai'),
            bulkPercent:
              snapshot.bulkPercent !== null && snapshot.bulkPercent !== undefined
                ? String(snapshot.bulkPercent)
                : '10',
            bulkDirection: snapshot.bulkDirection || 'increase',
            aiMinPct:
              snapshot.aiMinPct !== null && snapshot.aiMinPct !== undefined
                ? String(snapshot.aiMinPct)
                : '10',
            aiMaxPct:
              snapshot.aiMaxPct !== null && snapshot.aiMaxPct !== undefined
                ? String(snapshot.aiMaxPct)
                : '20',
            // Without this a legacy dollar band restores as a percent band, so
            // "$10" silently becomes "10%".
            aiUnit: snapshot.aiUnit === 'amount' ? 'amount' : 'percent',
          },
        });
      }
      if (snapshot.priceOverrides && typeof snapshot.priceOverrides === 'object') {
        setPriceOverrides(snapshot.priceOverrides);
      }
      if (snapshot.priceSuggestionMeta && typeof snapshot.priceSuggestionMeta === 'object') {
        setPriceSuggestionMeta(snapshot.priceSuggestionMeta);
      }
      if (snapshot.offerByArm && typeof snapshot.offerByArm === 'object') {
        setOfferByArm(snapshot.offerByArm);
      }
      if (snapshot.scenarioPreset) setScenarioPreset(snapshot.scenarioPreset);
      if (snapshot.audience) {
        const nextAudience = {
          ...createDefaultAudienceState(),
          ...snapshot.audience,
          ...normalizeClassicAudienceTargeting(snapshot.audience),
          primaryMetric: normalizeClassicCreatePrimaryMetric(snapshot.audience.primaryMetric),
          secondaryMetrics: normalizeSecondaryEvents(snapshot.audience.secondaryMetrics),
          customGoals: normalizeCustomGoals(snapshot.audience.customGoals),
          primaryCustomGoal: null,
          guardrails: ensureRevenueGuardrailRows(snapshot.audience.guardrails),
        };
        setAudience(nextAudience);
        setGlobalAudience(segmentsFromClassicAudience(nextAudience, snapshot.globalAudience));
      } else if (snapshot.globalAudience) {
        setGlobalAudience(normalizeAudienceSegments(snapshot.globalAudience));
      }
      if (snapshot.goalByPlan && typeof snapshot.goalByPlan === 'object') {
        setGoalByPlan(snapshot.goalByPlan);
      }
      if (Array.isArray(snapshot.plans)) setPlans(snapshot.plans);
      if (typeof snapshot.autoRound2 === 'boolean') setAutoRound2(snapshot.autoRound2);
    },
    [urlStep, setStep, experimentType]
  );

  // The draft this URL names, if this browser still holds it. Looked up by id
  // because several unfinished experiments can be saved at once, and only the
  // one named here belongs in this wizard.
  const resumedLocalDraft = useMemo(
    () => (hydrated && resumeId ? readClassicWizardDraft(shopDomain, resumeId) : null),
    [hydrated, resumeId, shopDomain]
  );

  // Saved drafts live in browser storage, so they can only be read once the
  // client has taken over. Seeding during that first post-hydration render (not
  // from an effect) lets the restored wizard reach the screen in one commit.
  if (hydrated && !draftHydrated) {
    setDraftHydrated(true);
    if (resumeId) {
      const launchedHere = (readInboxPlans(shopDomain) || []).some(
        plan => planMatchesResumeId(plan, resumeId) && isLaunchedPlan(plan)
      );
      const livePlans = liveEditRequested
        ? (readInboxPlans(shopDomain) || []).filter(
            plan =>
              planMatchesResumeId(plan, resumeId) &&
              plan?.archived !== true &&
              LIVE_EDIT_PLAN_STATUSES.has(String(plan?.status || '').trim().toLowerCase())
          )
        : [];
      const editingLive = liveEditRequested && launchedHere && livePlans.length > 0;
      if (editingLive) setLiveEdit(true);
      // A live edit this browser cannot back with the live plans goes to the
      // details page's editor. Opening it as a draft would let Launch build a
      // second experiment.
      if ((launchedHere || liveEditRequested) && !editingLive) {
        setLaunchedResumeId(resumeId);
      } else if (resumedLocalDraft && !editingLive) {
        applyWizardSnapshot(resumedLocalDraft);
      } else {
        const inboxPlans = editingLive
          ? livePlans
          : (readInboxPlans(shopDomain) || []).filter(plan => planMatchesResumeId(plan, resumeId));
        if (inboxPlans.length) {
          setAppliedSavedDraft(true);
          setResumedFromInbox(true);
          const first = inboxPlans[0];
          setExperimentId(resumeId);
          setName(
            first.metadata?.experiment_title || String(first.title || '').split(' · ')[0] || ''
          );
          setHypothesis(first.hypothesis || first.metadata?.hypothesis || '');
          const restoredType =
            first.experiment_type || first.metadata?.experiment_type || 'price_test';
          setExperimentType(restoredType);
          const restoredArms = Array.isArray(first.price_arms) ? first.price_arms : [];
          if (restoredArms.length >= 2) {
            setVariations(variationsFromPlanArms(restoredArms, restoredType));
            setOfferByArm(offerByArmFromPlanArms(restoredArms));
          }
          const restoredIds = inboxPlans.map(plan => plan.variant_id).filter(Boolean);
          if (restoredIds.length) setSelectedIds(restoredIds);
          setPlans(inboxPlans);
          if (first.metadata?.audience_ui) {
            const nextAudience = {
              ...createDefaultAudienceState(),
              ...first.metadata.audience_ui,
              ...normalizeClassicAudienceTargeting({
                ...(first.audience || {}),
                ...first.metadata.audience_ui,
              }),
              // A live test keeps the goal it launched with, even one the create
              // flow no longer offers; re-goaling it would change what is measured.
              primaryMetric: editingLive
                ? first.metadata.audience_ui.primaryMetric || 'revenue_per_visitor'
                : normalizeClassicCreatePrimaryMetric(first.metadata.audience_ui.primaryMetric),
              secondaryMetrics: normalizeSecondaryEvents(
                first.metadata.audience_ui.secondaryMetrics
              ),
              customGoals: normalizeCustomGoals(first.metadata.audience_ui.customGoals),
              primaryCustomGoal: editingLive
                ? first.metadata.audience_ui.primaryCustomGoal || null
                : null,
              guardrails: ensureRevenueGuardrailRows(first.metadata.audience_ui.guardrails),
            };
            setAudience(nextAudience);
            setGlobalAudience(
              segmentsFromClassicAudience(
                nextAudience,
                first.audience?.segments || createEmptyAudienceSegments()
              )
            );
          }
          if (urlStep == null) {
            setStep(editingLive ? 0 : inboxPlans.some(p => p.price_arms?.length) ? 4 : 2);
          }
        } else {
          setServerDraftPendingId(resumeId);
        }
        // Neither store knows this id — a link to an experiment that was
        // launched, deleted, or aged out. Opening a blank wizard beats
        // restoring a different experiment's answers under its name.
      }
    }
    // Without ?resume= an unfinished draft stays available but must not hijack a
    // fresh create, so nothing is seeded here.
  }

  /**
   * Catch up with the server's copy of the draft being resumed.
   *
   * The seeding above has to finish inside one commit so the restored wizard
   * reaches the screen whole, which rules out a request. That makes the browser
   * copy a starting point rather than an answer: it is whatever this device
   * last saw, which on the device the merchant stepped away from is older than
   * what they did next somewhere else. So the server is asked either way --
   * when neither local store knew the id, and when one did but may be behind.
   * Latched with a ref: a miss must not re-request on every render.
   */
  const serverResumeTried = useRef('');
  useEffect(() => {
    if (!draftHydrated || !resumeId || launchedResumeId) return undefined;
    // Not `appliedSavedDraft`: seeding from the browser copy sets that too, so
    // testing it here would skip the lookup in exactly the case this exists
    // for -- a browser copy that another device has since moved past.
    if (resumedFromInbox) return undefined;
    // Keyed by id rather than a bare flag, so following a link to a second
    // draft without leaving the wizard still looks that one up.
    if (serverResumeTried.current === resumeId) return undefined;
    serverResumeTried.current = resumeId;
    // Read once: the loader has kept the wizard out of reach since seeding, so
    // nothing on screen can be the merchant's own input.
    const heldBehindLoader = serverDraftPendingId === resumeId;
    let cancelled = false;
    let settled = false;
    loadServerWizardDraft(shopDomain, resumeId).then(async match => {
      if (cancelled) return;
      // If the experiment has launched, it belongs to its details page, even
      // when a draft copy outlived the launch here or on the server: opening
      // that copy showed a paused test's Edit as the new-test form, and
      // launching it would build a second experiment.
      const tests = await Promise.resolve()
        .then(() => getSmartPricingExperimentTests(shopDomain, resumeId))
        .catch(() => []);
      if (cancelled) return;
      settled = true;
      setServerDraftPendingId(prev => (prev === resumeId ? '' : prev));
      const launched = (Array.isArray(tests) ? tests : []).some(test =>
        LAUNCHED_TEST_STATUSES.has(String(test?.status || '').trim().toLowerCase())
      );
      if (launched) {
        setLaunchedResumeId(resumeId);
        return;
      }
      if (!match) return;
      if (resumedLocalDraft) {
        // Restored from this browser already. Only a strictly newer server
        // copy is worth replacing it with, and only while the merchant has
        // not started editing the one in front of them.
        if (!isUntouchedSinceSeed()) return;
        const serverAt = wizardDraftSavedAt(match);
        const localAt = wizardDraftSavedAt(resumedLocalDraft);
        if (serverAt < localAt) return;
        // One save can stamp the same second on a full browser copy and a
        // server copy that dropped the pricing table. Never replace the richer
        // local copy with the poorer server one at the same timestamp.
        if (
          serverAt === localAt &&
          match.plans_omitted &&
          Array.isArray(resumedLocalDraft.plans) &&
          resumedLocalDraft.plans.length
        ) {
          return;
        }
        const serverPlans = Array.isArray(match.plans) ? match.plans.length : 0;
        const localPlans = Array.isArray(resumedLocalDraft.plans) ? resumedLocalDraft.plans.length : 0;
        if (serverAt === localAt && serverPlans < localPlans) return;
      } else if (!heldBehindLoader && wizardSnapshotHasMerchantInput(liveSnapshot.current)) {
        // The wizard is on screen and editable while this request is out, so
        // by the time it lands the merchant may have started typing. Their
        // work wins: restoring over it would wipe what they can watch
        // themselves entering, which is worse than not restoring at all.
        return;
      }
      applyWizardSnapshot(match);
      // The restored copy is the new baseline, or the next keystroke would
      // look like no change at all.
      seededSnapshot.current = null;
    });
    return () => {
      cancelled = true;
      // A lookup dropped before it answered never ran, so the next pass has to
      // ask again rather than find it marked as tried.
      if (!settled && serverResumeTried.current === resumeId) serverResumeTried.current = '';
    };
  }, [
    draftHydrated,
    resumeId,
    launchedResumeId,
    resumedLocalDraft,
    resumedFromInbox,
    serverDraftPendingId,
    shopDomain,
    applyWizardSnapshot,
    isUntouchedSinceSeed,
  ]);

  const applyShopGuardrails = useCallback(({ guardrails: g, ok }) => {
    if (ok) {
      setShopGuardrails(g);
      const seedShopDefaults = !appliedSavedDraft;
      // The sample floor is a Stat Setting now, with no field in this wizard,
      // so it is taken from the shop every time — including when a draft is
      // resumed. Honouring the draft's own copy would launch a test against a
      // number the merchant can no longer see, let alone change.
      const shopSample = Number(g.min_sample_size_per_variation);
      const seededSample =
        Number.isFinite(shopSample) && shopSample >= 1
          ? String(Math.round(shopSample))
          : String(DEFAULT_MIN_SAMPLE_SIZE);
      setAudience(prev => ({
        ...prev,
        minSampleSize: seededSample,
        guardrails: Number.isFinite(Number(g.max_revenue_drop_percent))
          ? ensureRevenueGuardrailRows(
              seedShopDefaults ? [] : prev?.guardrails,
              Number(g.max_revenue_drop_percent)
            )
          : prev?.guardrails,
      }));
      if (g.default_scenario_preset && seedShopDefaults) {
        setScenarioPreset(g.default_scenario_preset);
      }
      if (g.default_audience_template && seedShopDefaults) {
        setGlobalAudience(normalizeAudienceSegments(g.default_audience_template));
      }
      if (g.auto_round2_default === false && seedShopDefaults) setAutoRound2(false);
    } else {
      // Settings never answered. Fall back to the documented default rather
      // than leaving the floor blank, which would fail validation with no
      // field on screen to correct.
      setAudience(prev =>
        prev?.minSampleSize
          ? prev
          : { ...prev, minSampleSize: String(DEFAULT_MIN_SAMPLE_SIZE) }
      );
    }
    setShopGuardrailsReady(true);
  }, [appliedSavedDraft]);

  // Read by the catalog load below, which must not restart when the mode flips.
  const pickModeRef = useRef(pickMode);
  useEffect(() => {
    pickModeRef.current = pickMode;
  }, [pickMode]);

  const applyCatalog = useCallback(
    ({
      requestId,
      rows,
      defaults,
      withheld,
      catalogTruncated: truncated,
      catalogLoadedProductCount: loadedProductCount,
      error,
    }) => {
      if (productsLoadRequestId.current !== requestId) return;
      setCatalogProgress(null);
      if (error) {
        setProductsLoadError(error);
      } else {
        setOpportunities(rows);
        setWithheldByOtherTests(withheld || null);
        setCatalogTruncated(Boolean(truncated));
        setCatalogLoadedProductCount(
          loadedProductCount !== null && loadedProductCount !== undefined
            ? Number(loadedProductCount)
            : null
        );
        setProductsLoadError('');
        setSelectedIds(prev => {
          let next = prev;
          if (rows.length && prev.length > 0) {
            const reconciled = reconcileSelectedVariantIds(prev, rows);
            if (reconciled.length) next = reconciled;
          } else if (!prev.length && pickModeRef.current === 'all') {
            next = defaults.length ? limitSelectionToProducts(rows, defaults, maxSelection) : prev;
          }
          return next;
        });
      }
      setLoadingProducts(false);
    },
    [maxSelection, setLoadingProducts]
  );

  const loadOpportunities = useCallback(async () => {
    const requestId = productsLoadRequestId.current + 1;
    productsLoadRequestId.current = requestId;
    setLoadingProducts(true);
    setCatalogProgress(null);
    const result = await fetchCatalog(shopDomain, {
      onProgress: next => {
        if (productsLoadRequestId.current === requestId) setCatalogProgress(next);
      },
    });
    applyCatalog({ requestId, ...result });
  }, [shopDomain, applyCatalog, setLoadingProducts]);

  /**
   * Look up products the catalog snapshot did not load.
   *
   * A big catalog arrives in part, and the picker can only filter what it was
   * given -- so a merchant searching for their 400th product found nothing and
   * had no way to test it. This asks Shopify by title and folds the answers
   * into the catalog the wizard already holds, which is what everything after
   * this step reads: the pricing table, the cap, and launch itself.
   */
  const searchCatalog = useCallback(
    async query => {
      const q = String(query || '').trim();
      if (!q) return;
      setCatalogSearching(true);
      setCatalogSearchHint(null);
      try {
        const data = await getSmartPricingOpportunities(shopDomain, {
          filter: 'all',
          productSearch: q,
          // Folded into a catalog that was just loaded fresh. A cached answer
          // could be hours old and bring back products deleted since.
          refresh: true,
          // Results are folded into the loaded catalog, where a ranking of
          // just the matches has nothing to order.
          aiRanking: 'off',
        });
        const found = Array.isArray(data?.opportunities) ? data.opportunities : [];
        const summary = data?.summary && typeof data.summary === 'object' ? data.summary : {};
        const nextStoreCount = Number(
          summary.store_product_count ?? summary.catalog_product_count
        );
        if (Number.isFinite(nextStoreCount) && nextStoreCount > 0) {
          setCatalogLoadedProductCount(prev =>
            Math.max(Number(prev) || 0, nextStoreCount)
          );
        }
        if (summary.withheld_by_other_tests) {
          setWithheldByOtherTests(summary.withheld_by_other_tests);
        }
        if (!found.length) {
          setCatalogSearchHint({ query: q, status: 'empty' });
          return;
        }
        let addedCount = 0;
        setOpportunities(prev => {
          const seen = new Set(prev.map(row => variantIdentity(row.variant_id)));
          const added = found.filter(
            row => row.variant_id && !seen.has(variantIdentity(row.variant_id))
          );
          addedCount = added.length;
          return added.length ? [...prev, ...added] : prev;
        });
        setCatalogSearchHint({
          query: q,
          status: addedCount > 0 ? 'found' : 'empty',
        });
      } catch {
        setCatalogSearchHint({ query: q, status: 'error' });
      } finally {
        setCatalogSearching(false);
      }
    },
    [shopDomain]
  );

  useEffect(() => {
    if (!draftHydrated) return undefined;
    let cancelled = false;
    fetchShopGuardrails(shopDomain).then(result => {
      if (!cancelled) applyShopGuardrails(result);
    });
    return () => {
      cancelled = true;
    };
  }, [draftHydrated, shopDomain, applyShopGuardrails]);

  useEffect(() => {
    let cancelled = false;
    apiGet('/shopify/store-resources?type=collection&all=1', { shop: shopDomain })
      .then(res => {
        if (cancelled) return;
        const raw = res?.data?.resources || res?.resources || [];
        const list = Array.isArray(raw) ? raw : raw?.list || [];
        const options = [{ label: 'All products', value: '' }];
        list.forEach(item => {
          if (item?.id) options.push({ label: item.title || item.id, value: item.id });
        });
        setCollectionOptions(options);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [shopDomain]);

  // Loaded once on reaching the products step, not on every step change:
  // keyed on `step` it rebuilt the whole catalog from Shopify each time the
  // merchant moved between Products, Audience and Review. Try again reloads.
  const reachedProductsStep = step >= 2;
  useEffect(() => {
    // A live test's products are held by that test, so the catalog would
    // withhold them and drop them from the selection it is showing.
    if (!reachedProductsStep || liveEdit) return undefined;
    const requestId = productsLoadRequestId.current + 1;
    productsLoadRequestId.current = requestId;
    let cancelled = false;
    fetchCatalog(shopDomain, {
      onProgress: next => {
        if (!cancelled && productsLoadRequestId.current === requestId) setCatalogProgress(next);
      },
    }).then(result => {
      if (!cancelled) applyCatalog({ requestId, ...result });
    });
    return () => {
      cancelled = true;
    };
  }, [reachedProductsStep, shopDomain, applyCatalog, liveEdit]);

  const buildBatch = useCallback(async () => {
    const ids =
      pickMode === 'all'
        ? resolvePricingRows({ opportunities, pickMode, maxSelection })
            .map(row => row.variant_id)
            .filter(Boolean)
        : selectedIds;
    if (!ids.length) {
      throw new Error('Select at least one product.');
    }
    setBusy(true);
    try {
      const batch = await createSmartPricingBatch(shopDomain, {
        variant_ids: ids,
        scenario_preset: scenarioPreset,
        variant_count_by_sku: Object.fromEntries(
          ids.map(id => [id, Math.max(2, variations.length)])
        ),
        title_prefix: name || undefined,
      });
      let nextPlans = batch?.plans || [];
      const missingIds = Array.isArray(batch?.missing_variant_ids) ? batch.missing_variant_ids : [];
      const unavailableNotice = buildUnavailableSelectionNotice(missingIds, [
        ...(opportunities || []),
        ...(plans || []),
      ]);
      if (!nextPlans.length && unavailableNotice) {
        throw new Error(`${unavailableNotice} Pick other products to continue.`);
      }
      const missingKeys = new Set(missingIds.map(variantIdentity));
      const keptIds = ids.filter(id => !missingKeys.has(variantIdentity(id)));

      // Rebuild arms Control-first from wizard variations (do not index-patch scenario Lower→Control→Higher).
      const opportunityByVariant = new Map(
        (opportunities || [])
          .filter(row => row?.variant_id)
          .map(row => [String(row.variant_id), row])
      );
      nextPlans = nextPlans.map(plan => {
        const rebuiltArms = rebuildPlanArmsFromVariations(
          plan,
          variations,
          priceOverrides,
          offerByArm,
          priceSuggestionMeta
        );
        const opp = opportunityByVariant.get(String(plan.variant_id || '')) || null;
        const productHandle = String(
          plan.handle || plan.product_handle || opp?.handle || opp?.product_handle || ''
        ).trim();
        return {
          ...plan,
          title: name ? `${name} · ${plan.title || plan.product_title || ''}`.trim() : plan.title,
          hypothesis: hypothesis || plan.hypothesis,
          price_arms: rebuiltArms.length ? rebuiltArms : plan.price_arms,
          handle: productHandle,
          product_handle: productHandle,
          image_url: plan.image_url || opp?.image_url || '',
          batch_id: experimentId,
          experiment_id: experimentId,
          metadata: {
            ...(plan.metadata || {}),
            classic_wizard: true,
            experiment_id: experimentId,
            experiment_title: name || '',
            product_title: plan.product_title || plan.title || '',
            handle: productHandle,
            product_handle: productHandle,
            hypothesis,
            audience_ui: audience,
          },
        };
      });

      nextPlans = stampClassicExperimentMetadata(nextPlans, {
        experimentId,
        experimentTitle: name,
        hypothesis,
        audienceUi: audience,
        experimentType,
      });

      setPlans(nextPlans);
      setSelectedIds(keptIds);
      if (unavailableNotice) {
        setMessageType('warning');
        setMessage(unavailableNotice);
      }

      const goalsRes = await suggestSmartPricingGoals(shopDomain, nextPlans).catch(() => null);
      const goalMap = {};
      (goalsRes?.suggestions || []).forEach(row => {
        if (row.plan_id) goalMap[row.plan_id] = row.goal;
      });
      nextPlans.forEach(plan => {
        if (!goalMap[plan.id]) {
          const secondaryPayload = buildSecondaryGoalPayload(
            audience?.secondaryMetrics,
            audience?.customGoals
          );
          goalMap[plan.id] = {
            primary_metric: normalizeClassicCreatePrimaryMetric(
              audience?.primaryMetric || plan.objective || 'revenue_per_visitor'
            ),
            secondary_events: secondaryPayload.secondary_events,
            secondary: secondaryPayload.secondary,
          };
        }
      });
      setGoalByPlan(goalMap);
      return nextPlans;
    } finally {
      setBusy(false);
    }
  }, [
    pickMode,
    opportunities,
    maxSelection,
    selectedIds,
    shopDomain,
    scenarioPreset,
    variations,
    name,
    hypothesis,
    priceOverrides,
    offerByArm,
    priceSuggestionMeta,
    audience,
    experimentId,
    experimentType,
    plans,
  ]);

  const enrichPlansForLaunch = useCallback(
    (sourcePlans = plans, { status = 'queued' } = {}) => {
      const rawAudienceState = audience || createDefaultAudienceState();
      const launchPrimary = normalizeClassicCreatePrimaryMetric(rawAudienceState.primaryMetric);
      const audienceState = {
        ...rawAudienceState,
        primaryMetric: launchPrimary,
        primaryCustomGoal: null,
        // Only what Step 4 shows. A draft saved before custom goals and event
        // secondaries were retired, or a test duplicated from an older one,
        // can still carry them, and nothing on screen would say they were
        // about to launch.
        secondaryMetrics: normalizeSecondaryEvents(rawAudienceState.secondaryMetrics).filter(
          key => BUILTIN_SECONDARY_METRICS.has(key) && key !== launchPrimary
        ),
        customGoals: [],
        guardrails: ensureRevenueGuardrailRows(
          rawAudienceState.guardrails,
          shopGuardrails.max_revenue_drop_percent
        ),
      };
      const countryLists = resolveCountryLists(audienceState);
      const mappedSegments = segmentsFromClassicAudience(audienceState, globalAudience);
      const sampleSize = resolveMinSampleSize(audienceState.minSampleSize);
      const shopDesign = shopDesignFromGuardrails(shopGuardrails);
      const durationEstimate = estimateSignificanceDuration({
        plans: sourcePlans,
        opportunities,
        selectedIds,
        pickMode,
        maxSelection,
        variations,
        trafficAllocation: audienceState.trafficAllocation,
        minSampleSize: sampleSize,
        minConversionsPerVariation: shopDesign.minConversions,
        mdePercent: shopDesign.mdePercent,
        confidenceLevel: shopDesign.confidenceLevel,
        power: shopDesign.power,
      });
      const goalPayload = buildClassicGoalPayload(audienceState);
      const stamped = stampClassicExperimentMetadata(sourcePlans, {
        experimentId,
        experimentTitle: name,
        hypothesis,
        audienceUi: audienceState,
        experimentType,
      });
      return stamped.map(plan => {
        const planEstimate = durationEstimate.perSkuEstimates?.find(
          row => row.key === String(plan.variant_id || plan.id || '')
        );
        // A saved draft is not a launched test. Results settings apply when a
        // new test launches, so refresh the full statistical policy together
        // instead of keeping stale confidence while updating only its sample
        // floor.
        const stats = stampStatisticalFields({}, shopGuardrails);
        const planGoal = goalByPlan[plan.id] || {};
        return {
          ...plan,
          statistical_design: {
            ...(plan.statistical_design || {}),
            estimated_duration_days:
              planEstimate?.days ??
              durationEstimate.days ??
              plan.statistical_design?.estimated_duration_days ??
              null,
            estimate_detail: durationEstimate.detail,
            traffic_allocation: durationEstimate.trafficAllocation,
            duration_feasibility:
              planEstimate?.durationFeasibility || durationEstimate.durationFeasibility || null,
            practical_duration_range:
              planEstimate?.practicalDurationRange ||
              durationEstimate.practicalDurationRange ||
              null,
            traffic_evidence:
              planEstimate?.trafficEvidence || durationEstimate.trafficEvidence || null,
            traffic_source: plan.traffic_source || null,
            traffic_confidence: plan.traffic_confidence || null,
            practical_window_min_days: durationEstimate.practicalWindowMinDays || null,
            practical_window_max_days: durationEstimate.practicalWindowMaxDays || null,
            required_daily_visitors_for_practical_window:
              durationEstimate.requiredDailyVisitorsForPracticalWindow || null,
            visitors_per_variant_required:
              planEstimate?.recommendedSampleSize ||
              durationEstimate.recommendedSampleSize ||
              plan.statistical_design?.visitors_per_variant_required ||
              null,
            mde_percent: stats.mde_percent,
            confidence_level: stats.confidence_level,
            statistical_power: stats.statistical_power,
            analysis_method: stats.analysis_method,
            power_rating:
              planEstimate?.powerRating ||
              durationEstimate.powerRating ||
              plan.statistical_design?.power_rating,
          },
          audience: {
            inherit_from_shop_defaults: false,
            segments: mappedSegments,
            traffic_allocation: audienceState.trafficAllocation,
            devices: audienceState.devices,
            sources: audienceState.sources,
            countries: collapseCountrySelection(
              countryLists.countryMode === 'exclude'
                ? countryLists.excludeCountries
                : countryLists.includeCountries,
              countryLists.countryMode
            ),
            include_countries: countryLists.includeCountries,
            exclude_countries: countryLists.excludeCountries,
            device_mode: audienceState.deviceMode || 'include',
            source_mode: audienceState.sourceMode || 'include',
            country_mode: countryLists.countryMode,
            min_sample_size: sampleSize,
          },
          goal: {
            ...planGoal,
            // The metric chosen on the Audience step, never the per-product
            // suggestion: that is fetched on the Products step, before the
            // merchant has chosen, and was never refreshed afterwards.
            primary_metric: goalPayload.primary_metric,
            secondary_events: goalPayload.secondary_events,
            secondary: goalPayload.secondary,
            min_sample_size: sampleSize,
            analysis_method: stats.analysis_method,
            mde_percent: stats.mde_percent,
            statistical_power: stats.statistical_power,
            significance_level: stats.significance_level,
            visitors_per_variant_recommended:
              planEstimate?.recommendedSampleSize ||
              durationEstimate.recommendedSampleSize ||
              null,
            guardrails: revenueGuardrailGoalConfig(
              audienceState.guardrails,
              shopGuardrails.max_revenue_drop_percent
            ),
          },
          launch_preferences: {
            auto_start: status !== 'draft',
            auto_round2: autoRound2,
            // Left unset so the shop's configured learning-round cap applies;
            // stamping a value here overrode the Settings guardrail.
            manual_duration_cap_days: null,
            min_sample_size: sampleSize,
          },
          status,
        };
      });
    },
    [
      plans,
      globalAudience,
      audience,
      goalByPlan,
      autoRound2,
      experimentId,
      name,
      hypothesis,
      experimentType,
      opportunities,
      selectedIds,
      pickMode,
      maxSelection,
      variations,
      shopGuardrails,
    ]
  );

  const applyBulk = ({ unit = 'percent' } = {}) => {
    const amount = Math.abs(Number(bulkPercent) || 0);
    const sign = bulkDirection === 'decrease' ? -1 : 1;
    let armIndex = activeArmIndex;
    let arm = variations[armIndex];
    // Control stays at store price; apply to the first test variation instead.
    if (!arm || armIndex === 0 || arm.id === 'control') {
      armIndex = variations.findIndex((row, i) => i > 0 && row.id !== 'control');
      arm = armIndex >= 0 ? variations[armIndex] : null;
      if (arm) setActiveArmIndex(armIndex);
    }
    if (!arm) return;
    const rows = resolvePricingRows({
      opportunities,
      selectedIds,
      pickMode,
      maxSelection,
    });
    if (!rows.length || !(amount > 0)) return null;
    const maxChange = shopGuardrailsReady ? Number(shopGuardrails.max_price_change_percent) : NaN;
    const next = { ...priceOverrides };
    let capped = 0;
    rows.forEach(row => {
      const base = Number(row.current_price ?? row.price) || 0;
      const key = priceOverrideKey(row.variant_id, arm.id);
      const delta = unit === 'amount' ? amount : base * (amount / 100);
      let price = Math.max(0, base + sign * delta);
      // Held to max price change here rather than refused at launch, where the
      // merchant would have to come back to this step to find out why.
      const window = guardrailPriceWindow(base, maxChange);
      if (window && (price > window.high || price < window.low)) {
        price = Math.min(window.high, Math.max(window.low, price));
        capped += 1;
      }
      next[key] = price.toFixed(2);
    });
    setPriceOverrides(next);
    return {
      armId: arm.id,
      armLabel: arm.name || (arm.letter ? `Variation ${arm.letter}` : 'Variation'),
      total: rows.length,
      capped,
      maxChange: Number.isFinite(maxChange) ? maxChange : null,
    };
  };

  // Add variation refills a removed letter under the same id, so whatever the
  // removed one was priced at has to go with it or the new one inherits it.
  const handleVariationsChange = next => {
    const removed = removedArmIds(variations, next);
    setVariations(next);
    if (!removed.length) return;
    const lastIndex = Math.max(1, (next || []).length - 1);
    if (activeArmIndex > lastIndex) setActiveArmIndex(lastIndex);
    setPricingByArm(prev => dropArmEntries(prev, removed));
    setOfferByArm(prev => dropArmEntries(prev, removed));
    setPriceOverrides(prev => dropArmEntries(prev, removed, { byOverrideKey: true }));
    setPriceSuggestionMeta(prev => dropArmEntries(prev, removed, { byOverrideKey: true }));
  };

  const paintLocalAiBandPrices = useCallback(
    ({ unit = 'percent', rows, targetArms, spreadArms = targetArms, band }) => {
      if (!rows?.length || !targetArms?.length || !band) return false;
      const fallbackMin = unit === 'amount' ? 1 : 10;
      const fallbackMax = unit === 'amount' ? 5 : 20;
      const min = band.min ?? resolveBandEdge(aiMinPct, fallbackMin);
      const max = band.max ?? resolveBandEdge(aiMaxPct, fallbackMax);
      // Spread across every variation so each keeps its own slot in the band,
      // then keep only the ones being priced: spread alone, two variations
      // given the same band would land on the same price.
      const spreadOpts = {
        rows,
        targetArms: spreadArms,
        min,
        max,
        unit,
        uncapped: true,
      };
      const keep = keepArmKeys(targetArms);
      const localPatch = keep(buildAiBandPriceOverrides(spreadOpts));
      if (!Object.keys(localPatch).length) return false;
      const fullMeta = keep(buildLocalPriceSuggestionMeta(spreadOpts, 'local'));
      setPriceOverrides(prev => ({ ...prev, ...localPatch }));
      setPriceSuggestionMeta(metaPrev => ({ ...metaPrev, ...fullMeta }));
      markArmsAiSuggested(targetArms.map(arm => arm.id));
      return true;
    },
    [aiMinPct, aiMaxPct, markArmsAiSuggested]
  );

  const applyLocalAiBandFallback = useCallback(
    ({ unit = 'percent', targetArmsOverride = null } = {}) => {
      const targetArms =
        Array.isArray(targetArmsOverride) && targetArmsOverride.length
          ? targetArmsOverride
          : resolveAiSuggestTargetArms({
              variations,
              pricingByArm,
              defaultPriceMode: priceMode,
              activeArmIndex,
            });
      const rows = resolvePricingRows({
        opportunities,
        selectedIds,
        pickMode,
        maxSelection,
      });
      if (!rows.length || !targetArms.length) {
        setAiPriceMeta(prev => ({
          ...prev,
          source: null,
          summary: !rows.length
            ? 'Select products first, then click Suggest.'
            : 'Add a test variation before requesting AI prices.',
          busy: false,
        }));
        return false;
      }
      const band = normalizeAiPriceBand(aiMinPct, aiMaxPct);
      const fallbackMin = unit === 'amount' ? 1 : 10;
      const fallbackMax = unit === 'amount' ? 5 : 20;
      const min = band?.min ?? resolveBandEdge(aiMinPct, fallbackMin);
      const max = band?.max ?? resolveBandEdge(aiMaxPct, fallbackMax);
      const painted = paintLocalAiBandPrices({
        unit,
        rows,
        targetArms,
        spreadArms: resolveAiSuggestSpreadArms(variations),
        band,
      });
      const fallbackLine = painted
        ? `Even spread across your ${describeAiBandRange(min, max, unit)} band (AI unavailable).`
        : 'Could not build local prices — check product prices and try again.';
      const { status, detail } = composeAiSuggestBanner({
        source: 'deterministic',
        fallbackLine,
        unit,
        band: { min, max },
        hasPrices: Boolean(painted),
      });
      setAiPriceMeta({
        source: 'deterministic',
        summary: status,
        detail,
        busy: false,
      });
      return painted;
    },
    [
      aiMinPct,
      aiMaxPct,
      variations,
      pricingByArm,
      priceMode,
      activeArmIndex,
      opportunities,
      selectedIds,
      pickMode,
      maxSelection,
      paintLocalAiBandPrices,
    ]
  );

  const applyAiBand = useCallback(
    async ({ unit = 'percent' } = {}) => {
      const rows = resolvePricingRows({
        opportunities,
        selectedIds,
        pickMode,
        maxSelection,
      });
      const targetArms = resolveAiSuggestTargetArms({
        variations,
        pricingByArm,
        defaultPriceMode: priceMode,
        activeArmIndex,
      });
      setAiPriceMetaArmId(targetArms[0]?.id || null);
      if (!rows.length || !targetArms.length) {
        setAiPriceMeta({
          source: null,
          summary: !rows.length
            ? 'Select products first, then click Suggest.'
            : 'Add a test variation before requesting AI prices.',
          detail: null,
          busy: false,
        });
        return;
      }
      if (!shopGuardrailsReady) {
        setAiPriceMeta({
          source: null,
          summary: 'Still loading shop test defaults. Try again in a moment.',
          detail: null,
          busy: false,
        });
        return;
      }
      if (activeArmIndex === 0 && variations.length > 1) {
        setActiveArmIndex(1);
      }

      const band = normalizeAiPriceBand(aiMinPct, aiMaxPct);
      if (!band || aiBandOrderError(aiMinPct, aiMaxPct, { unit })) {
        setAiPriceMeta({
          source: null,
          summary:
            aiBandOrderError(aiMinPct, aiMaxPct, { unit }) ||
            'Enter a min and max, then click Suggest. Use a negative to test a lower price.',
          detail: null,
          busy: false,
        });
        return;
      }
      const amountMode = unit === 'amount';
      // Dollar bands are sent as dollars; the server applies the flat uplift to
      // each product and clamps it per SKU. Converting to a catalog-average
      // percent here would under-price cheap SKUs and over-price expensive ones.
      const minPct = amountMode ? null : band.min;
      const maxPct = amountMode ? null : band.max;

      const requestId = ++aiSuggestRequestId.current;
      const fallbackMin = unit === 'amount' ? 1 : 10;
      const fallbackMax = unit === 'amount' ? 5 : 20;
      const min = band.min ?? resolveBandEdge(aiMinPct, fallbackMin);
      const max = band.max ?? resolveBandEdge(aiMaxPct, fallbackMax);
      const spreadArms = resolveAiSuggestSpreadArms(variations);
      setAiPriceMeta({
        source: null,
        summary: 'Suggesting prices…',
        detail: null,
        busy: true,
      });
      let settled = false;
      try {
        const result = await suggestSmartPricingPrices(shopDomain, {
          variants: rows.map(row => ({
            variant_id: row.variant_id,
            // Lets the server ask about each product once, for all its variants.
            product_id: row.product_id || row.product_gid || null,
            title: row.product_title || row.title,
            current_price: Number(row.current_price ?? row.price) || 0,
            currency: row.currency || 'USD',
            margin_percent: row.margin_percent,
            units_sold_30d: row.units_sold_30d,
            revenue_30d: row.revenue_30d,
            daily_visitors: row.daily_visitors,
            visitors_30d: row.visitors_30d,
            product_type: row.product_type,
            opportunity_score: row.opportunity_score,
            recommended_scenario_preset: row.recommended_scenario_preset,
            ai_reason: row.ai_reason,
            scenario_rationale: row.scenario_rationale,
          })),
          // Every variation, so the one on screen keeps its own slot in the
          // spread; only its prices are applied below.
          arms: spreadArms.map(arm => ({
            id: arm.id,
            label: arm.name || arm.role || arm.id,
          })),
          target_arm_ids: targetArms.map(arm => arm.id),
          min_pct: minPct,
          max_pct: maxPct,
          unit,
          min_amount: amountMode ? band.min : null,
          max_amount: amountMode ? band.max : null,
          objective: primaryMetric || shopGuardrails.objective || 'revenue_per_visitor',
          guardrails: shopGuardrails,
          use_ai: true,
          sibling_prices: siblingArmPrices({ rows, spreadArms, targetArms, priceOverrides }),
        });
        if (requestId !== aiSuggestRequestId.current) return;
        const rawSuggestions = Array.isArray(result?.suggestions)
          ? result.suggestions
          : Array.isArray(result?.data?.suggestions)
            ? result.data.suggestions
            : [];
        const targetIds = new Set(targetArms.map(arm => String(arm.id)));
        // Suggest is a click, so it reprices the variation on screen whatever
        // set its prices before. Skipping hand-set and bulk prices left a
        // Re-suggest that changed nothing and said "Prices applied".
        const suggestions = rawSuggestions.filter(item =>
          targetIds.has(String(item?.arm_id || ''))
        );
        if (!suggestions.length) {
          if (applyLocalAiBandFallback({ unit, targetArmsOverride: targetArms })) {
            const { status, detail } = composeAiSuggestBanner({
              source: 'deterministic',
              fallbackLine: `Even spread across your ${describeAiBandRange(min, max, unit)} band (AI unavailable).`,
              unit,
              band: { min, max },
            });
            setAiPriceMeta({
              source: 'deterministic',
              summary: status,
              detail,
              busy: false,
            });
            settled = true;
            return;
          }
        }
        setPriceOverrides(prev => applyPriceSuggestionsToOverrides(prev, suggestions));
        const source = result?.source || result?.data?.source || 'deterministic';
        const pricingSource = source === 'openai' ? 'openai' : 'deterministic';
        const metaPatch = metaFromPriceSuggestions(suggestions, pricingSource);
        setPriceSuggestionMeta(prev => ({ ...prev, ...metaPatch }));
        const baseSummary =
          result?.summary ||
          result?.data?.summary ||
          (suggestions.length
            ? 'Prices applied.'
            : 'No prices returned — try Re-suggest or adjust the band.');
        const sourceNotice = describeAiSuggestionSource({
          source,
          skippedReason: result?.ai_skipped_reason || result?.data?.ai_skipped_reason,
        });
        const limitedNotice = describeGuardrailLimitedSuggestions(
          suggestions.filter(item => item?.guardrail_limited).length,
          suggestions.length,
          band,
          { unit }
        );
        const { status, detail } = composeAiSuggestBanner({
          source,
          skippedReason: result?.ai_skipped_reason || result?.data?.ai_skipped_reason,
          baseSummary,
          sourceNotice,
          limitedNotice,
          unit,
          band: { min, max },
          hasPrices: suggestions.length > 0,
        });
        setAiPriceMeta({
          source,
          summary: status,
          detail,
          busy: false,
        });
        markArmsAiSuggested(
          suggestions.length
            ? [...new Set(suggestions.map(item => item?.arm_id).filter(Boolean))]
            : targetArms.map(arm => arm.id)
        );
        settled = true;
      } catch (error) {
        if (requestId !== aiSuggestRequestId.current) return;
        const apiMessage =
          error?.message ||
          'Could not suggest prices right now. Check your connection and try again.';
        if (applyLocalAiBandFallback({ unit, targetArmsOverride: targetArms })) {
          const { status, detail } = composeAiSuggestBanner({
            source: 'deterministic',
            fallbackLine: `Even spread across your ${describeAiBandRange(min, max, unit)} band (AI unavailable).`,
            errorMessage: apiMessage,
            unit,
            band: { min, max },
          });
          setAiPriceMeta({
            source: 'deterministic',
            summary: status,
            detail,
            busy: false,
          });
        } else {
          const { status, detail } = composeAiSuggestBanner({
            errorMessage: apiMessage,
            unit,
            band: { min, max },
          });
          setAiPriceMeta({
            source: null,
            summary: status || apiMessage,
            detail,
            busy: false,
          });
        }
        settled = true;
      } finally {
        // Safety net: never leave the Re-suggest button stuck in Suggesting…
        if (!settled && requestId === aiSuggestRequestId.current) {
          setAiPriceMeta(prev => (prev.busy ? { ...prev, busy: false } : prev));
        }
      }
    },
    [
      opportunities,
      selectedIds,
      pickMode,
      maxSelection,
      variations,
      activeArmIndex,
      shopDomain,
      aiMinPct,
      aiMaxPct,
      primaryMetric,
      shopGuardrails,
      shopGuardrailsReady,
      applyLocalAiBandFallback,
      pricingByArm,
      priceMode,
      priceOverrides,
      markArmsAiSuggested,
    ]
  );

  /** Average selected-product price: the dollar equivalent of a percent cap. */
  const aiBandAveragePrice = useCallback(() => {
    const bases = resolvePricingRows({ opportunities, selectedIds, pickMode, maxSelection })
      .map(row => Number(row.current_price ?? row.price) || 0)
      .filter(n => n > 0);
    return bases.length ? bases.reduce((sum, n) => sum + n, 0) / bases.length : 0;
  }, [opportunities, selectedIds, pickMode, maxSelection]);

  // The status line quotes the band Suggest ran with. Once the band on screen
  // changes it describes prices from another band, so it has to go.
  const dropAiSuggestStatus = useCallback(() => {
    if (aiPriceMetaArmId !== activeArmId) return;
    setAiPriceMeta(prev => ({ ...prev, source: null, summary: null, detail: null }));
  }, [aiPriceMetaArmId, activeArmId]);

  const applyBandField = useCallback(
    (field, value) => {
      patchAiBand({ [field === 'max' ? 'aiMaxPct' : 'aiMinPct']: value, aiSuggested: false });
      dropAiSuggestStatus();
    },
    [patchAiBand, dropAiSuggestStatus]
  );

  const setAiMinPct = useCallback(value => applyBandField('min', value), [applyBandField]);
  const setAiMaxPct = useCallback(value => applyBandField('max', value), [applyBandField]);

  const setAiUnit = useCallback(
    value => {
      const nextUnit = value === 'amount' ? 'amount' : 'percent';
      if (nextUnit === aiUnit) return;
      const avg = aiBandAveragePrice();
      // Carry the merchant's intent across units instead of reusing the raw
      // number: on a $50 catalog, 10% means $5, not $10.
      const convert = value2 => {
        const n = Number(value2);
        if (!Number.isFinite(n) || n === 0 || avg <= 0) return null;
        const sign = n < 0 ? -1 : 1;
        const magnitude = Math.abs(n);
        const converted =
          nextUnit === 'amount' ? (avg * magnitude) / 100 : (magnitude / avg) * 100;
        return String(Math.round(sign * converted * 100) / 100);
      };
      const nextMin = convert(aiMinPct);
      const nextMax = convert(aiMaxPct);
      patchAiBand({
        aiUnit: nextUnit,
        aiSuggested: false,
        ...(nextMin != null ? { aiMinPct: nextMin } : {}),
        ...(nextMax != null ? { aiMaxPct: nextMax } : {}),
      });
      dropAiSuggestStatus();
    },
    [aiUnit, aiMinPct, aiMaxPct, aiBandAveragePrice, patchAiBand, dropAiSuggestStatus]
  );

  const handleAudienceChange = useCallback(nextAudience => {
    const next = {
      ...(nextAudience || createDefaultAudienceState()),
      ...normalizeClassicAudienceTargeting(nextAudience),
    };
    setAudience(next);
    setGlobalAudience(segmentsFromClassicAudience(next));
  }, []);

  const saveDraft = async () => {
    if (!String(name).trim()) {
      setMessageType('error');
      setMessage('Add a test name before saving a draft.');
      return;
    }
    if (!shopGuardrailsReady) {
      setMessageType('error');
      setMessage('Still loading shop test defaults. Try again in a moment.');
      return;
    }
    setSavingDraft(true);
    try {
      // Both copies, and awaited: pressing Save draft is a request for a saved
      // draft, so the message underneath has to report what actually landed.
      // This used to write the browser only and then say "Draft saved", which
      // is why a merchant who cleared their browser, or looked on another
      // device, found nothing.
      const saved = await persistWizardDraftEverywhere(wizardSnapshot);
      let inboxPlans = plans;
      if (!inboxPlans.length && (selectedIds.length || pickMode === 'all') && step >= 2) {
        try {
          inboxPlans = await buildBatch();
        } catch {
          /* wizard snapshot alone is enough for early drafts */
        }
      }
      if (inboxPlans.length) {
        const enriched = enrichPlansForLaunch(inboxPlans, { status: 'draft' });
        const merged = upsertExperimentPlansInInbox(
          readInboxPlans(shopDomain),
          enriched,
          experimentId
        );
        writeInboxPlans(shopDomain, merged);
        await persistInboxPlansNow(shopDomain, merged).catch(() => null);
        setPlans(enriched);
        // Resuming prefers the wizard draft over the inbox, so the draft has
        // to learn about these plans now. Left to the debounced autosave, a
        // refresh in the next moment would restore the copy saved above, which
        // was taken before the plans were built.
        await persistWizardDraftEverywhere({ ...wizardSnapshot, plans: enriched, step });
      }
      // Saving keeps the merchant on the step they were editing. The URL now
      // names the draft, so a refresh comes straight back here.
      syncResumeUrl(step);
      // A draft with no products still gets a row under Drafts, so the message
      // no longer has to send the merchant off to choose products before it
      // will appear. What it does still have to distinguish is whether the
      // server took it: if only the browser did, the draft is real but tied to
      // this one browser, and that is worth saying plainly rather than
      // discovering later on another device.
      if (!saved.server) {
        setMessageType('error');
        setMessage(draftServerFailureMessage(saved));
      } else {
        // Superseded and eviction are both things the merchant has to act on,
        // so they do not get the success colour.
        const unexpected = saved.superseded || (saved.evicted || []).length > 0;
        setMessageType(unexpected ? 'warning' : 'success');
        setMessage(draftSavedMessage(saved));
      }
    } catch (err) {
      setMessageType('error');
      setMessage(err.message || 'Could not save draft.');
    } finally {
      setSavingDraft(false);
    }
  };

  /**
   * Save an edit to a running or paused test. The variations and prices were
   * never editable here, so what is written is what the settings editor writes:
   * name, hypothesis, audience, metrics, guardrail and traffic allocation.
   */
  const saveLiveEdit = async () => {
    if (busy) return;
    const trimmedName = String(name).trim();
    if (!trimmedName) {
      setMessageType('error');
      setMessage('Test name is required.');
      return;
    }
    const check = validateClassicAudienceUi(audience || createDefaultAudienceState());
    if (!check.ok) {
      setMessageType('error');
      setMessage(check.message);
      return;
    }
    const livePlans = (Array.isArray(plans) ? plans : []).filter(plan => plan?.id);
    if (!livePlans.length) {
      setMessageType('error');
      setMessage('No products to update.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const nextAudience = audience || createDefaultAudienceState();
      const actor = livePlans[0]?.owner_name || livePlans[0]?.created_by_name || 'You';
      const savedAt = Date.now();
      const nextPlans = resolveLiveEditActivityEntries(
        livePlans[0]?.metadata?.audience_ui,
        nextAudience
      ).reduce(
        (acc, entry, index) =>
          appendActivityToPlans(
            acc,
            createActivityEntry({
              id: `updated_${savedAt}_${index}`,
              kind: 'updated',
              title: entry.title,
              detail: entry.detail,
              actor,
            })
          ),
        applyAudienceUiToPlans(livePlans, nextAudience, {
          experimentId,
          experimentTitle: trimmedName,
          hypothesis,
          experimentType,
          shopGuardrails,
        })
      );
      const merged = mergeInboxPlansById(readInboxPlans(shopDomain) || [], nextPlans);
      writeInboxPlans(shopDomain, merged, { persist: false });
      await persistInboxPlansNow(shopDomain, merged);
      const draft = readClassicWizardDraft(shopDomain, experimentId);
      if (draft) {
        writeClassicWizardDraft(shopDomain, {
          ...draft,
          name: trimmedName,
          hypothesis,
          audience: audience || createDefaultAudienceState(),
        });
      }
      const pausedTestIds = nextPlans
        .filter(plan => String(plan?.status || '').trim().toLowerCase() === 'paused')
        .map(plan => String(plan?.test_id || '').trim())
        .filter(Boolean);
      if (pausedTestIds.length) {
        // Resume applies these too; doing it now keeps the paused tests in step
        // with what the details page shows.
        await applyPausedSmartPricingSettings(shopDomain, pausedTestIds).catch(() => null);
      }
      navigate(ROUTES.appSmartPricingPlan(shopDomain, nextPlans[0].id));
    } catch (err) {
      setMessageType('error');
      setMessage(err?.message || 'Could not save your changes.');
    } finally {
      setBusy(false);
    }
  };

  const goNextLiveEdit = async () => {
    setMessage('');
    if (step === 0 && !String(name).trim()) {
      setMessageType('error');
      setMessage('Test name is required.');
      return;
    }
    if (step === 3) {
      const audienceCheck = validateClassicAudienceUi(audience || createDefaultAudienceState());
      if (!audienceCheck.ok) {
        setMessageType('error');
        setMessage(audienceCheck.message);
        return;
      }
    }
    if (step === 4) {
      await saveLiveEdit();
      return;
    }
    goToStep(step + 1);
  };

  const goNext = async () => {
    if (liveEdit) {
      await goNextLiveEdit();
      return;
    }
    setMessage('');
    if (step === 0) {
      if (!String(name).trim()) {
        setMessageType('error');
        setMessage('Test name is required.');
        return;
      }
      if (experimentType !== 'price_test' && experimentType !== 'offer_test') {
        setMessageType('error');
        setMessage('Priceify currently supports Price test and Offer test types.');
        return;
      }
      if (!shopGuardrailsReady) {
        setMessageType('error');
        setMessage('Still loading shop test defaults. Try again in a moment.');
        return;
      }
      goToStep(1);
      return;
    }
    if (step === 1) {
      // Continue is already disabled while this is unmet, and the panel prints
      // the same sentence in place. This stays as the backstop for a keyboard
      // activation that beats the disabled state.
      if (variationsStepGate.disabled) {
        setMessageType('error');
        setMessage(variationsStepGate.hint);
        return;
      }
      setProductsLoadError('');
      goToStep(2);
      return;
    }
    if (step === 2) {
      const gate = getProductsStepContinueState({
        loadingProducts,
        productsLoadError,
        pickMode,
        opportunities,
        selectedIds,
        maxSelection,
        variations,
        priceOverrides,
        experimentType,
        offerByArm,
        priceMode,
        maxChangePercent:
          shopGuardrailsReady && !liveEdit ? shopGuardrails.max_price_change_percent : null,
        priceSuggestionMeta,
      });
      if (gate.disabled) {
        setMessageType('error');
        setMessage(
          gate.hint ||
            (gate.reason === 'load_error'
              ? productsLoadError || 'Could not load products.'
              : gate.reason === 'no_offer'
                ? 'Set a percent or amount-off offer on at least one test variation.'
                : 'Finish selecting a product and a test price before continuing.')
        );
        return;
      }
      try {
        const builtPlans = await buildBatch();
        goToStep(3, Array.isArray(builtPlans) ? { plans: builtPlans } : null);
      } catch (err) {
        setMessageType('error');
        setMessage(
          err.message ||
            (isOfferTest ? 'Could not build offer plans.' : 'Could not build price plans.')
        );
      }
      return;
    }
    if (step === 3) {
      if (!shopGuardrailsReady) {
        setMessageType('error');
        setMessage('Still loading shop test defaults. Try again in a moment.');
        return;
      }
      const audienceCheck = validateClassicAudienceUi(audience || createDefaultAudienceState());
      if (!audienceCheck.ok) {
        setMessageType('error');
        setMessage(audienceCheck.message);
        return;
      }
      const enriched = enrichPlansForLaunch();
      setPlans(enriched);
      goToStep(4, { plans: enriched });
      return;
    }
    if (step === 4) {
      if (busy || launching) {
        return;
      }
      if (!shopGuardrailsReady) {
        setMessageType('error');
        setMessage('Still loading shop test defaults. Try again in a moment.');
        return;
      }
      // Same gate the Variations step uses, so a split broken by an edit made
      // after that step is reported in the words the merchant saw there.
      if (variationsStepGate.disabled) {
        setMessageType('error');
        setMessage(variationsStepGate.hint);
        return;
      }
      const launchAudienceCheck = validateClassicAudienceUi(
        audience || createDefaultAudienceState()
      );
      if (!launchAudienceCheck.ok) {
        setMessageType('error');
        setMessage(launchAudienceCheck.message);
        return;
      }
      if (checkoutLoading) {
        setMessageType('error');
        setMessage('Still checking checkout readiness. Try again in a moment.');
        return;
      }
      if (!launchCheckoutReady) {
        setMessageType('error');
        const detail =
          checkoutReadiness?.message ||
          (Array.isArray(checkoutReadiness?.failed_checks) && checkoutReadiness.failed_checks[0]) ||
          'Fix Store setup before launching.';
        setMessage(
          isOfferTest
            ? `Offer checkout is not ready. ${getOfferCheckoutBlockReason(checkoutReadiness)}`
            : `Checkout is not ready. ${detail}`
        );
        return;
      }
      // The loader goes up before any of the work below. Building the plans and
      // saving them used to run first, so the button sat unresponsive for
      // seconds and invited a second click.
      setBusy(true);
      setLaunchPhase('launching');
      setLaunchProgress(null);
      setMessage('');
      try {
        await new Promise(resolve => setTimeout(resolve, 0));
        const built = enrichPlansForLaunch();
        if (!built.length) {
          setLaunchPhase('');
          setMessageType('error');
          setMessage('No products to launch. Go back to Products and select at least one.');
          return;
        }
        // After a launch that stopped part way, the saved copies of the plans
        // that went live carry their test ids. Writing the freshly built plans
        // over them dropped those ids, which hid running tests from the list.
        const live = alreadyLaunchedPlanIds(shopDomain, built);
        const savedById = new Map(
          (readInboxPlans(shopDomain) || []).filter(plan => plan?.id).map(plan => [plan.id, plan])
        );
        const enriched = built.map(plan =>
          live.has(plan.id) ? savedById.get(plan.id) || plan : plan
        );
        const merged = upsertExperimentPlansInInbox(
          readInboxPlans(shopDomain),
          enriched,
          experimentId
        );
        writeInboxPlans(shopDomain, merged);
        try {
          await persistInboxPlansNow(shopDomain, merged);
        } catch (persistErr) {
          setMessageType('warning');
          setMessage(
            persistErr?.message ||
              'Could not save this test to your account. Launch will still try with this test.'
          );
        }
        await launchMany(enriched, { onProgress: setLaunchProgress });
        // Stop autosave before clearing, or a debounced write still in flight
        // would put the draft straight back after the experiment went live.
        autosaveSuspended.current = true;
        // Both copies: the launched experiment is the record now, and a
        // surviving server draft would sit under Drafts alongside the live test
        // it turned into.
        await forgetWizardDraftEverywhere(shopDomain, experimentId);
        const detailPlanId = enriched.find(plan => plan?.id)?.id || null;
        setLaunchPhase('opening');
        if (detailPlanId) {
          navigate(ROUTES.appSmartPricingPlan(shopDomain, detailPlanId));
        } else {
          navigate(ROUTES.appSmartPricing(shopDomain));
        }
      } catch (err) {
        setLaunchPhase('');
        setLaunchProgress(null);
        setMessageType('error');
        const detailText = Array.isArray(err?.details)
          ? err.details
              .map(item => (typeof item === 'string' ? item : item?.message || String(item)))
              .filter(Boolean)
              .join('; ')
          : '';
        setMessage(
          err?.failures?.length
            ? err.message
            : detailText || err.message || 'Launch failed.'
        );
      } finally {
        setBusy(false);
      }
    }
  };

  const continueLabel = step === 4 ? (liveEdit ? 'Save changes' : 'Launch test') : 'Continue';
  // A reduce over at most five rows; the compiler memoizes it on its own.
  const variationsStepGate = getVariationsStepContinueState({ variations });
  const productsStepGate = useMemo(
    () =>
      getProductsStepContinueState({
        loadingProducts,
        productsLoadError,
        pickMode,
        opportunities,
        selectedIds,
        maxSelection,
        variations,
        priceOverrides,
        experimentType,
        offerByArm,
        priceMode,
        maxChangePercent:
          shopGuardrailsReady && !liveEdit ? shopGuardrails.max_price_change_percent : null,
        priceSuggestionMeta,
      }),
    [
      loadingProducts,
      productsLoadError,
      pickMode,
      opportunities,
      selectedIds,
      maxSelection,
      variations,
      priceOverrides,
      experimentType,
      offerByArm,
      priceMode,
      shopGuardrailsReady,
      liveEdit,
      shopGuardrails.max_price_change_percent,
      priceSuggestionMeta,
    ]
  );

  /**
   * Ask the server whether a live test already holds any of these products,
   * every time the review step opens.
   *
   * The products step withholds anything another test is holding, but it read
   * the catalog when that step opened. A resumed draft chose its products days
   * ago, and a batch built this morning can be overtaken by a test started
   * since. Launch refuses either way; this turns a failed launch into a reason
   * on the page next to a button that will not fire.
   *
   * Keyed on the products, not the plan objects, which are rebuilt on most
   * edits.
   */
  const launchPlansKey = useMemo(
    () =>
      plans
        .map(plan => String(plan?.variant_id || plan?.product_id || ''))
        .filter(Boolean)
        .join('|'),
    [plans]
  );
  const launchPlansRef = useRef(plans);
  useEffect(() => {
    launchPlansRef.current = plans;
  });
  useEffect(() => {
    if (step !== 4 || !launchPlansKey) return undefined;
    let cancelled = false;
    batchPreviewSmartPricingLaunch(shopDomain, launchPlansRef.current)
      .then(preview => {
        if (cancelled) return;
        // One product is enough to stop the launch, and naming the test
        // holding it is what the merchant has to act on.
        const first = (preview?.live_conflicts || [])[0];
        setLiveTestConflict(first?.message || '');
      })
      .catch(() => {
        // Launch re-checks against the same table and refuses for real. Left
        // blocked on a failed preflight, a merchant could not launch at all.
        if (!cancelled) setLiveTestConflict('');
      });
    return () => {
      cancelled = true;
    };
  }, [step, launchPlansKey, shopDomain]);

  /**
   * Why Launch cannot run, in the order the launch handler checks.
   *
   * The handler has always had six gates; the button reflected one of them. So
   * a merchant reading a red "Checkout is not ready" alert still saw an
   * enabled Launch, clicked it, and got that same sentence handed back as an
   * error. This is the shared answer: the button refuses up front and says
   * why, and the handler keeps every check, because it is the one that must
   * not be wrong.
   *
   * `code` names which gate refused, for callers and tests that need more
   * than the sentence.
   */
  const launchGate = (() => {
    if (!shopGuardrailsReady) {
      return { disabled: true, code: 'loading', reason: 'Loading shop test defaults…' };
    }
    if (variationsStepGate.disabled) {
      return { disabled: true, code: 'variations', reason: variationsStepGate.hint };
    }
    const audienceCheck = validateClassicAudienceUi(audience || createDefaultAudienceState());
    if (!audienceCheck.ok) {
      return { disabled: true, code: 'audience', reason: audienceCheck.message };
    }
    if (checkoutLoading) {
      return { disabled: true, code: 'checkout_loading', reason: 'Checking checkout readiness…' };
    }
    if (!launchCheckoutReady) {
      return {
        disabled: true,
        code: 'checkout',
        reason: isOfferTest
          ? 'Offer checkout is not ready. Fix Store setup before launching.'
          : 'Checkout is not ready. Fix Store setup before launching.',
      };
    }
    // enrichPlansForLaunch maps these one for one, so the count it would
    // produce is this count, without building the plans on every render.
    if (!plans.length) {
      return {
        disabled: true,
        code: 'products',
        reason: 'No products to launch. Go back to Products and select at least one.',
      };
    }
    // Answered by the server on entering this step. Launch refuses it anyway,
    // so pressing the button could only produce the same sentence as an error.
    if (liveTestConflict) {
      return { disabled: true, code: 'conflict', reason: liveTestConflict };
    }
    return { disabled: false, code: '', reason: '' };
  })();

  const shopDesign = shopDesignFromGuardrails(shopGuardrails);
  const significanceEstimate = useMemo(
    () =>
      estimateSignificanceDuration({
        plans,
        opportunities,
        selectedIds,
        pickMode,
        maxSelection,
        variations,
        trafficAllocation: audience?.trafficAllocation,
        minSampleSize: resolveMinSampleSize(audience?.minSampleSize),
        minConversionsPerVariation: shopDesign.minConversions,
        mdePercent: shopDesign.mdePercent,
        confidenceLevel: shopDesign.confidenceLevel,
        power: shopDesign.power,
      }),
    [
      plans,
      opportunities,
      selectedIds,
      pickMode,
      maxSelection,
      variations,
      audience?.trafficAllocation,
      audience?.minSampleSize,
      shopDesign.minConversions,
      shopDesign.mdePercent,
      shopDesign.confidenceLevel,
      shopDesign.power,
    ]
  );
  const estimatedDays = significanceEstimate.days;

  // A price test only reaches shoppers by repainting the theme through mapped
  // selectors. With none mapped the experiment still launches, splits traffic
  // and reports numbers, but every visitor sees the catalog price — so it
  // measures nothing. That is worth saying while the run is still being built
  // rather than at the end of it, and it stands until the merchant fixes it.
  const priceSurfacesMissing =
    !isOfferTest &&
    step >= FIRST_STEP_AFTER_TYPE_CHOSEN &&
    priceSurfacesUnmapped(checkoutReadiness);

  // SSR and the first paint must match (hydration tests + no loader flash in HTML).
  // Full-page loading only after the client has taken over and defaults are still fetching.
  const wizardBootstrapping = hydrated && (!draftHydrated || !shopGuardrailsReady);
  const launchLoaderLabel =
    launchPhase === 'launching'
      ? launchProgress?.total > 1
        ? `Launching test… ${launchProgress.done} of ${launchProgress.total}`
        : 'Launching test…'
      : launchPhase === 'opening' || launchedResumeId
        ? 'Opening test…'
        : serverDraftPendingId
          ? 'Opening draft…'
          : '';
  if (wizardBootstrapping || launchLoaderLabel) {
    return (
      <PageShell>
        <ClassicPageLoader label={launchLoaderLabel || 'Loading…'} />
      </PageShell>
    );
  }

  return (
    <PageShell message={message} messageType={messageType} onCloseMessage={() => setMessage('')}>
      <ClassicWizardShell
        notice={
          priceSurfacesMissing && !liveEdit ? (
            <Banner tone="warning">
              <span className={styles.noticeLine}>
                No price selectors mapped.
                {/* The why and the how live in the guide this already opens,
                    rather than as a paragraph everyone reads once. */}
                <SettingsInfoLink hash="price-surfaces" label="Price locations" />
                <Button variant="plain" onClick={openPriceSurfaceSettings}>
                  Add price locations
                </Button>
              </span>
            </Banner>
          ) : null
        }
        stepIndex={step}
        experimentType={experimentType}
        title={liveEdit && step === 0 ? 'Edit test' : undefined}
        onBackToList={liveEdit ? backToTestDetails : backToList}
        onBack={() => goToStep(step - 1)}
        backLabel={step === 4 ? 'Back to edit' : 'Back'}
        onContinue={goNext}
        continueLabel={continueLabel}
        continueDisabled={
          liveEdit
            ? (step === 0 && !String(name).trim()) || ((step === 3 || step === 4) && !shopGuardrailsReady)
            : (step === 0 && !String(name).trim()) ||
              (step === 1 && variationsStepGate.disabled) ||
              (step === 2 && productsStepGate.disabled) ||
              (step === 4 && launchGate.disabled) ||
              ((step === 0 || step === 3) && !shopGuardrailsReady)
        }
        continueDisabledReason={
          step === 0 && !String(name).trim()
            ? 'Add a test name to continue.'
            : liveEdit
              ? (step === 3 || step === 4) && !shopGuardrailsReady
                ? 'Loading shop test defaults…'
                : ''
              : step === 1
                ? variationsStepGate.hint
                : step === 2
                  ? productsStepGate.hint
                  : step === 4
                    ? launchGate.reason
                    : (step === 0 || step === 3) && !shopGuardrailsReady
                      ? 'Loading shop test defaults…'
                      : ''
        }
        continueDisabledPending={
          liveEdit
            ? (step === 3 || step === 4) && !shopGuardrailsReady
            : (step === 4 && ['loading', 'checkout_loading'].includes(launchGate.code)) ||
              ((step === 0 || step === 3) && !shopGuardrailsReady)
        }
        continueBusy={busy || launching}
        showCancel={step === 0}
        onCancel={liveEdit ? backToTestDetails : backToList}
        onSaveDraft={step === 4 || liveEdit ? undefined : saveDraft}
        saveDraftLabel="Save draft"
        saveDraftBusy={savingDraft}
        saveDraftDisabled={!shopGuardrailsReady}
        onGoToStep={index => {
          if (busy || launching || savingDraft) return;
          const next = Number(index);
          if (!Number.isInteger(next) || next < 0 || next >= step) return;
          setMessage('');
          goToStep(next);
        }}
      >
        {message && messageType === 'success' && step !== 4 ? (
          <div className={styles.success}>{message}</div>
        ) : null}
        {message && messageType === 'error' ? <div className={styles.error}>{message}</div> : null}

        {step === 0 ? (
          <SetupStepPanel
            name={name}
            onNameChange={setName}
            hypothesis={hypothesis}
            onHypothesisChange={setHypothesis}
            experimentType={experimentType}
            typeLocked={liveEdit}
            onExperimentTypeChange={nextType => {
              const nextOffer = isOfferExperimentType(nextType);
              setExperimentType(nextType);
              setPlans([]);
              if (nextOffer) {
                setPriceOverrides({});
              } else {
                setOfferByArm({});
              }
              setVariations(prev =>
                prev.map((row, index) => {
                  if (index !== 0 && row.id !== 'control') return row;
                  const desc = String(row.description || '');
                  if (
                    !desc ||
                    desc === 'Current price' ||
                    desc === 'No offer (baseline)'
                  ) {
                    return {
                      ...row,
                      description: nextOffer ? 'No offer (baseline)' : 'Current price',
                    };
                  }
                  return row;
                })
              );
            }}
          />
        ) : null}

        {liveEdit && (step === 1 || step === 2) ? (
          <LiveEditLockedStep
            kind={step === 2 ? 'products' : 'variations'}
            variations={variations}
            plans={plans}
            experimentType={experimentType}
          />
        ) : null}

        {step === 1 && !liveEdit ? (
          <VariationsStepPanel
            variations={variations}
            onChange={handleVariationsChange}
            experimentType={experimentType}
            trafficAllocation={audience?.trafficAllocation}
            onTrafficAllocationChange={next =>
              handleAudienceChange({
                ...(audience || createDefaultAudienceState()),
                trafficAllocation: next,
              })
            }
          />
        ) : null}

        {step === 2 && !liveEdit ? (
          <ProductsPricingStepPanel
            opportunities={opportunities}
            withheldByOtherTests={withheldByOtherTests}
            catalogTruncated={catalogTruncated}
            catalogLoadedProductCount={catalogLoadedProductCount}
            onCatalogSearch={searchCatalog}
            catalogSearching={catalogSearching}
            catalogSearchHint={catalogSearchHint}
            onClearCatalogSearchHint={() => setCatalogSearchHint(null)}
            selectedIds={selectedIds}
            onSelectedIdsChange={setSelectedIds}
            maxSelection={maxSelection}
            pickMode={pickMode}
            onPickModeChange={mode => {
              setPickMode(mode);
              if (mode === 'all') {
                setSelectedIds(
                  resolvePricingRows({ opportunities, pickMode: 'all', maxSelection })
                    .map(row => row.variant_id)
                    .filter(Boolean)
                );
              }
            }}
            collectionOptions={collectionOptions}
            variations={variations}
            activeArmIndex={activeArmIndex}
            onActiveArmIndexChange={setActiveArmIndex}
            priceMode={priceMode}
            onPriceModeChange={mode => {
              // Control is read-only — store mode on the first test arm and switch to it.
              if (activeArmIndex === 0 && variations.length > 1) {
                const nextIndex = variations.findIndex((row, i) => i > 0 && row.id !== 'control');
                const armId = (nextIndex >= 0 ? variations[nextIndex]?.id : null) || activeArmId;
                setPricingByArm(prev => ({
                  ...prev,
                  [armId]: {
                    bulkPercent: '10',
                    bulkDirection: 'increase',
                    aiMinPct: '10',
                    aiMaxPct: '20',
                    ...(prev[armId] || {}),
                    priceMode: mode,
                    aiSuggested: mode === 'ai' ? false : prev[armId]?.aiSuggested,
                  },
                }));
                if (nextIndex >= 0) setActiveArmIndex(nextIndex);
                return;
              }
              patchActivePricing({
                priceMode: mode,
                ...(mode === 'ai' ? { aiSuggested: false } : {}),
              });
              // Only this variation's breakdowns: clearing every arm's left the
              // other tabs' AI prices with no ℹ to explain them.
              if (mode !== 'ai') {
                setPriceSuggestionMeta(prev => dropArmEntries(prev, [activeArmId], { byOverrideKey: true }));
              }
            }}
            priceOverrides={priceOverrides}
            priceSuggestionMeta={priceSuggestionMeta}
            onPriceOverrideChange={(key, value) => {
              setPriceOverrides(prev => ({ ...prev, [key]: value }));
              setPriceSuggestionMeta(prev => {
                if (!prev[key]) return prev;
                const next = { ...prev };
                delete next[key];
                return next;
              });
            }}
            bulkPercent={bulkPercent}
            onBulkPercentChange={setBulkPercent}
            bulkDirection={bulkDirection}
            onBulkDirectionChange={setBulkDirection}
            onApplyBulk={applyBulk}
            onAiSuggest={applyAiBand}
            aiSuggestBusy={aiPriceMeta.busy}
            aiSuggestSummary={aiPriceMetaArmId === activeArmId ? aiPriceMeta.summary : null}
            aiSuggestDetail={aiPriceMetaArmId === activeArmId ? aiPriceMeta.detail : null}
            aiSuggested={activePricing.aiSuggested === true}
            onAiBandDirty={() => patchActivePricing({ aiSuggested: false })}
            aiUnit={aiUnit}
            onAiUnitChange={setAiUnit}
            aiMinPct={aiMinPct}
            aiMaxPct={aiMaxPct}
            onAiMinPctChange={setAiMinPct}
            onAiMaxPctChange={setAiMaxPct}
            loading={loadingProducts}
            catalogProgress={catalogProgress}
            loadError={productsLoadError}
            onRetryLoad={loadOpportunities}
            shopDefaultsReady={shopGuardrailsReady}
            shopMaxChangePercent={shopGuardrails.max_price_change_percent}
            experimentType={experimentType}
            offerByArm={offerByArm}
            onOfferByArmChange={setOfferByArm}
          />
        ) : null}

        {step === 3 ? (
          <AudienceSuccessStepPanel
            value={audience}
            onChange={handleAudienceChange}
            significanceEstimate={significanceEstimate}
            disabled={!shopGuardrailsReady}
            // Asked for on Variations, beside the split it feeds. A live test's
            // Variations step is locked, so its allocation is edited here.
            showTrafficAllocation={liveEdit}
          />
        ) : null}

        {step === 4 ? (
          <ReviewLaunchStepPanel
            // Inside the panel's banner stack, so it is spaced like the rest
            // instead of pressed against the first of them.
            notice={
              liveEdit ? (
                <Banner tone="info" title="Saving does not restart the test">
                  <p>
                    {plans.some(plan => String(plan?.status || '').toLowerCase() === 'paused')
                      ? 'This test is paused, so it picks up these settings when you resume it.'
                      : 'This test is running, so it keeps its current settings for now. Changes take effect the next time you pause and resume it.'}
                  </p>
                </Banner>
              ) : null
            }
            name={name}
            experimentType={experimentType}
            experimentTypeLabel={experimentTypeLabel}
            variations={variations}
            selectedCount={selectedIds.length}
            pickMode={pickMode}
            priceMode={priceMode}
            pricingByArm={pricingByArm}
            audience={audience}
            estimatedDays={estimatedDays}
            estimatedTimeDetail={significanceEstimate.detail}
            significanceEstimate={significanceEstimate}
            checkoutReady={liveEdit || launchCheckoutReady}
            checkoutLoading={!liveEdit && checkoutLoading}
            checkoutReadiness={liveEdit ? null : checkoutReadiness}
            onFixSetup={openCheckoutSetup}
            onFixPriceSurfaces={openPriceSurfaceSettings}
            onRefreshCheckout={() => refreshCheckoutReadiness()}
            plans={plans}
          />
        ) : null}
      </ClassicWizardShell>
    </PageShell>
  );
}
