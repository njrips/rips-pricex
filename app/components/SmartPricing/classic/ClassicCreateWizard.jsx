import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collapseCountrySelection, resolveCountryLists } from './countrySelection';
import { estimateSignificanceDuration } from './estimateSignificanceDuration';
import { shopDesignFromGuardrails, stampStatisticalFields } from './sampleSizePolicy';
import { useNavigate, useSearchParams } from 'react-router';
import PageShell from '../../shared/PageShell';
import { ROUTES } from '../../../constants';
import { apiGet } from '../../../services';
import useClassicShopDomain from '../../../hooks/useClassicShopDomain';
import { useHydrated } from '../../../hooks/useHydrated';
import { useKeyedState } from '../../../hooks/useKeyedState';
import {
  createSmartPricingBatch,
  getSmartPricingGuardrails,
  saveSmartPricingGuardrails,
  getSmartPricingOpportunities,
  suggestSmartPricingAudience,
  suggestSmartPricingGoals,
  suggestSmartPricingHypothesis,
  suggestSmartPricingPrices,
  batchPreviewSmartPricingLaunch,
} from '../../../services/smartPricingApi';
import { useSmartPricingLaunch } from '../../../hooks/useSmartPricingLaunch';
import { useSmartPricingCheckoutReadiness } from '../../../hooks/useSmartPricingCheckoutReadiness';
import { readInboxPlans, writeInboxPlans } from '../smartPricingConstants';
import { persistInboxPlansNow } from '../smartPricingInboxPersistence';
/** Classic wizard: products per experiment (not parallel-test capacity). */
const CLASSIC_MAX_PRODUCT_SELECTION = 100;
import {
  buildClassicGoalPayload,
  buildSecondaryGoalPayload,
  classicAudienceToSegments,
  createEmptyAudienceSegments,
  mergeAudienceAiIntoStatePreservingSample,
  normalizeAudienceSegments,
  normalizeClassicAudienceTargeting,
  normalizeCustomGoals,
  normalizePrimaryMetric,
  normalizeSecondaryEvents,
  stripClassicAudienceTargetingFields,
} from '../targeting/smartPricingAudienceHelpers';
import ClassicWizardShell from './ClassicWizardShell';
import { classicCreateStepIndex } from './classicCreateSteps';
import SetupStepPanel, { EXPERIMENT_TYPES } from './SetupStepPanel';
import VariationsStepPanel, { createDefaultVariations, trafficTotal } from './VariationsStepPanel';
import { variationsFromPlanArms } from './variationsStepHelpers';
import ProductsPricingStepPanel from './ProductsPricingStepPanel';
import AudienceSuccessStepPanel, { createDefaultAudienceState } from './AudienceSuccessStepPanel';
import {
  capRevenueGuardrailRows,
  ensureRevenueGuardrailRows,
  revenueGuardrailGoalConfig,
} from './revenueGuardrail';
import ReviewLaunchStepPanel from './ReviewLaunchStepPanel';
import {
  clearClassicWizardDraft,
  getPlanExperimentId,
  readClassicWizardDraft,
  stampClassicExperimentMetadata,
  upsertExperimentPlansInInbox,
  writeClassicWizardDraft,
} from './classicExperimentHelpers';
import {
  DEFAULT_MIN_SAMPLE_SIZE,
  resolveMinSampleSize,
  validateClassicAudienceUi,
} from './classicAudienceEdit';
import {
  formatCatalogLoadError,
  getProductsStepContinueState,
  capAiBandToShopMax,
  clampAiBandValue,
  describeAiBandCap,
  describeGuardrailLimitedSuggestions,
  normalizeAiPriceBand,
  resolvePricingRows,
} from './productsStepReadiness';
import {
  isActionableOfferConfig,
  getOfferCheckoutBlockReason,
  isOfferExperimentType,
  normalizeOfferConfig,
  offerByArmFromPlanArms,
} from './offerSelection';
import styles from './SmartPricingClassic.module.css';

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
  offerByArm = {}
) {
  const base = Number(plan?.current_price) || 0;
  const variantId = plan?.variant_id;
  return (variations || []).map((variation, index) => {
    const isControl = index === 0 || variation.id === 'control';
    const key = `${variantId}::${variation.id}`;
    const raw = priceOverrides[key];
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
    };
  });
}

function hasPositiveVariationTraffic(variations = []) {
  return (
    Array.isArray(variations) &&
    variations.length >= 2 &&
    variations.every(row => Number(row?.traffic) > 0)
  );
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

async function fetchCatalog(shopDomain) {
  try {
    // Classic wizard product picker needs the full catalog.
    // `ai_pick` only returns recommended rows — empty when AI ranking fails or none are tagged.
    const data = await getSmartPricingOpportunities(shopDomain, {
      filter: 'all',
      refresh: false,
    });
    const rows = Array.isArray(data?.opportunities) ? data.opportunities : [];
    if (data?.error && !rows.length) {
      throw new Error(String(data.error));
    }
    return {
      rows,
      defaults: data?.default_selected_variant_ids || rows.map(r => r.variant_id).filter(Boolean),
      error: '',
    };
  } catch (err) {
    return { rows: [], defaults: [], error: formatCatalogLoadError(err) };
  }
}

export default function ClassicCreateWizard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const shopDomain = useClassicShopDomain();
  const resumeId = String(searchParams.get('resume') || '').trim();
  const stepParam = String(searchParams.get('step') || '').trim();

  // A ?step= deep link decides where the wizard opens; navigation inside the
  // wizard takes over from there without rewriting the URL.
  const urlStep = classicCreateStepIndex(stepParam);
  const [step, setStep] = useKeyedState(stepParam, urlStep ?? 0);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('error');
  const [busy, setBusy] = useState(false);
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

  const [name, setName] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [experimentType, setExperimentType] = useState('price_test');
  const [minSampleSize, setMinSampleSize] = useState('');
  const [shopGuardrailsReady, setShopGuardrailsReady] = useState(false);

  const [variations, setVariations] = useState(createDefaultVariations);

  const [opportunities, setOpportunities] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [maxSelection] = useState(CLASSIC_MAX_PRODUCT_SELECTION);
  const [pickMode, setPickMode] = useState('manual');
  const [productSearch, setProductSearch] = useState('');
  const [collectionId, setCollectionId] = useState('');
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
  const [offerByArm, setOfferByArm] = useState({});
  const [aiPriceMeta, setAiPriceMeta] = useState({
    source: null,
    summary: null,
    busy: false,
  });
  const aiSuggestRequestId = useRef(0);
  const productsLoadRequestId = useRef(0);

  const activeArmId = variations[activeArmIndex]?.id || 'control';
  const activePricing = pricingByArm[activeArmId] || {};
  const priceMode = activePricing.priceMode || 'manual';
  const bulkPercent = activePricing.bulkPercent ?? '10';
  const bulkDirection = activePricing.bulkDirection || 'increase';
  // The AI band describes the whole test: Suggest spreads one band across every
  // AI variation. Reading it per-arm would let a tab show a band that did not
  // produce the prices in front of you, so it is shared and written to all arms.
  const sharedAiBand =
    Object.values(pricingByArm).find(
      entry =>
        entry &&
        (entry.aiMinPct !== undefined ||
          entry.aiMaxPct !== undefined ||
          entry.aiUnit !== undefined)
    ) || {};
  const aiMinPct = sharedAiBand.aiMinPct ?? '10';
  const aiMaxPct = sharedAiBand.aiMaxPct ?? '20';
  const aiUnit = sharedAiBand.aiUnit === 'amount' ? 'amount' : 'percent';

  const patchActivePricing = useCallback(
    patch => {
      setPricingByArm(prev => ({
        ...prev,
        [activeArmId]: {
          priceMode: 'manual',
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
    [activeArmId]
  );

  /** Band edits apply to every variation, since one band drives them all. */
  const patchAiBand = useCallback(
    patch => {
      setPricingByArm(prev => {
        const next = { ...prev };
        new Set([...Object.keys(prev), activeArmId]).forEach(id => {
          next[id] = {
            priceMode: 'manual',
            bulkPercent: '10',
            bulkDirection: 'increase',
            aiMinPct: '10',
            aiMaxPct: '20',
            aiUnit: 'percent',
            ...(prev[id] || {}),
            ...patch,
          };
        });
        return next;
      });
    },
    [activeArmId]
  );

  const markArmsAiSuggested = useCallback(armIds => {
    const ids = (armIds || []).map(id => String(id || '').trim()).filter(Boolean);
    if (!ids.length) return;
    setPricingByArm(prev => {
      const next = { ...prev };
      ids.forEach(id => {
        next[id] = {
          priceMode: 'ai',
          bulkPercent: '10',
          bulkDirection: 'increase',
          aiMinPct: '10',
          aiMaxPct: '20',
          ...(next[id] || {}),
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
  const [hypothesisBusy, setHypothesisBusy] = useState(false);
  const [audienceAiBusy, setAudienceAiBusy] = useState(false);
  const [shopGuardrails, setShopGuardrails] = useState({});
  const [raisingMaxPriceChange, setRaisingMaxPriceChange] = useState(false);
  /** What the merchant typed when the shop cap forced a lower band value. */
  const [aiBandAttempt, setAiBandAttempt] = useState({ min: null, max: null });
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
  const launchCheckoutReady = isOfferTest ? offerCheckoutReady : checkoutReady;
  const experimentTypeLabel =
    EXPERIMENT_TYPES.find(type => type.id === experimentType)?.title || 'Price test';

  const backToList = () => navigate(ROUTES.appSmartPricing(shopDomain));
  const openCheckoutSetup = () => {
    const path = ROUTES.appSetup(shopDomain);
    if (typeof navigate === 'function') {
      navigate(path);
      return;
    }
    window.open(path, '_blank');
  };
  const openPriceSurfaceSettings = () => {
    const path = `${ROUTES.appSettings(shopDomain)}?tab=price-surfaces&automap=1`;
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
      minSampleSize,
      variations,
      selectedIds,
      pickMode,
      productSearch,
      collectionId,
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
    }),
    [
      experimentId,
      step,
      name,
      hypothesis,
      experimentType,
      minSampleSize,
      variations,
      selectedIds,
      pickMode,
      productSearch,
      collectionId,
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
    ]
  );

  const applyWizardSnapshot = useCallback(
    snapshot => {
      if (!snapshot || typeof snapshot !== 'object') return;
      setAppliedSavedDraft(true);
      if (snapshot.experiment_id) setExperimentId(String(snapshot.experiment_id));
      if (urlStep == null && Number.isFinite(Number(snapshot.step))) {
        setStep(Number(snapshot.step));
      }
      if (snapshot.name !== null && snapshot.name !== undefined) setName(String(snapshot.name));
      if (snapshot.hypothesis !== null && snapshot.hypothesis !== undefined)
        setHypothesis(String(snapshot.hypothesis));
      if (snapshot.experimentType) setExperimentType(snapshot.experimentType);
      if (snapshot.minSampleSize !== null && snapshot.minSampleSize !== undefined)
        setMinSampleSize(String(snapshot.minSampleSize));
      if (Array.isArray(snapshot.variations) && snapshot.variations.length) {
        setVariations(snapshot.variations);
      }
      if (Array.isArray(snapshot.selectedIds)) setSelectedIds(snapshot.selectedIds);
      if (snapshot.pickMode) setPickMode(snapshot.pickMode);
      if (snapshot.productSearch !== null && snapshot.productSearch !== undefined)
        setProductSearch(String(snapshot.productSearch));
      if (snapshot.collectionId !== null && snapshot.collectionId !== undefined)
        setCollectionId(String(snapshot.collectionId));
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
            priceMode: snapshot.priceMode || 'manual',
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
      if (snapshot.offerByArm && typeof snapshot.offerByArm === 'object') {
        setOfferByArm(snapshot.offerByArm);
      }
      if (snapshot.scenarioPreset) setScenarioPreset(snapshot.scenarioPreset);
      if (snapshot.audience) {
        const nextAudience = {
          ...createDefaultAudienceState(),
          ...snapshot.audience,
          ...normalizeClassicAudienceTargeting(snapshot.audience),
          primaryMetric: normalizePrimaryMetric(snapshot.audience.primaryMetric),
          secondaryMetrics: normalizeSecondaryEvents(snapshot.audience.secondaryMetrics),
          customGoals: normalizeCustomGoals(snapshot.audience.customGoals),
          primaryCustomGoal: snapshot.audience.primaryCustomGoal
            ? normalizeCustomGoals([snapshot.audience.primaryCustomGoal])[0] || null
            : null,
          guardrails: ensureRevenueGuardrailRows(snapshot.audience.guardrails),
        };
        setAudience(nextAudience);
        setGlobalAudience(segmentsFromClassicAudience(nextAudience, snapshot.globalAudience));
        if (nextAudience.minSampleSize !== null && nextAudience.minSampleSize !== undefined) {
          setMinSampleSize(String(nextAudience.minSampleSize));
        }
      } else if (snapshot.globalAudience) {
        setGlobalAudience(normalizeAudienceSegments(snapshot.globalAudience));
      }
      if (snapshot.goalByPlan && typeof snapshot.goalByPlan === 'object') {
        setGoalByPlan(snapshot.goalByPlan);
      }
      if (Array.isArray(snapshot.plans)) setPlans(snapshot.plans);
      if (typeof snapshot.autoRound2 === 'boolean') setAutoRound2(snapshot.autoRound2);
    },
    [urlStep, setStep]
  );

  // Saved drafts live in browser storage, so they can only be read once the
  // client has taken over. Seeding during that first post-hydration render (not
  // from an effect) lets the restored wizard reach the screen in one commit.
  if (hydrated && !draftHydrated) {
    const localDraft = readClassicWizardDraft(shopDomain);
    setDraftHydrated(true);
    if (resumeId) {
      if (localDraft && String(localDraft.experiment_id) === resumeId) {
        applyWizardSnapshot(localDraft);
      } else {
        const inboxPlans = (readInboxPlans(shopDomain) || []).filter(
          plan => getPlanExperimentId(plan) === resumeId
        );
        if (inboxPlans.length) {
          setAppliedSavedDraft(true);
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
              primaryMetric: normalizePrimaryMetric(first.metadata.audience_ui.primaryMetric),
              secondaryMetrics: normalizeSecondaryEvents(
                first.metadata.audience_ui.secondaryMetrics
              ),
              customGoals: normalizeCustomGoals(first.metadata.audience_ui.customGoals),
              primaryCustomGoal: first.metadata.audience_ui.primaryCustomGoal
                ? normalizeCustomGoals([first.metadata.audience_ui.primaryCustomGoal])[0] || null
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
            if (nextAudience.minSampleSize !== null && nextAudience.minSampleSize !== undefined) {
              setMinSampleSize(String(nextAudience.minSampleSize));
            }
          }
          if (urlStep == null) {
            setStep(inboxPlans.some(p => p.price_arms?.length) ? 4 : 2);
          }
        } else if (localDraft) {
          applyWizardSnapshot(localDraft);
        }
      }
    }
    // Without ?resume= an unfinished draft stays available but must not hijack a
    // fresh create, so nothing is seeded here.
  }

  const applyShopGuardrails = useCallback(({ guardrails: g, ok }) => {
    if (ok) {
      setShopGuardrails(g);
      const seedShopDefaults = !appliedSavedDraft;
      const shopSample = Number(g.min_sample_size_per_variation);
      const seededSample =
        Number.isFinite(shopSample) && shopSample >= 1 ? String(Math.round(shopSample)) : null;
      if (Number.isFinite(Number(g.max_revenue_drop_percent)) || (seededSample && seedShopDefaults)) {
        setAudience(prev => ({
          ...prev,
          ...(seededSample && seedShopDefaults ? { minSampleSize: seededSample } : {}),
          guardrails: Number.isFinite(Number(g.max_revenue_drop_percent))
            ? ensureRevenueGuardrailRows(
                seedShopDefaults ? [] : prev?.guardrails,
                Number(g.max_revenue_drop_percent)
              )
            : prev?.guardrails,
        }));
      }
      if (seededSample && seedShopDefaults) setMinSampleSize(seededSample);
      if (g.default_scenario_preset && seedShopDefaults) {
        setScenarioPreset(g.default_scenario_preset);
      }
      if (g.default_audience_template && seedShopDefaults) {
        setGlobalAudience(normalizeAudienceSegments(g.default_audience_template));
      }
      if (g.auto_round2_default === false && seedShopDefaults) setAutoRound2(false);
      if (seedShopDefaults && !seededSample) {
        setMinSampleSize(prev => prev || String(DEFAULT_MIN_SAMPLE_SIZE));
        setAudience(current =>
          current?.minSampleSize
            ? current
            : { ...current, minSampleSize: String(DEFAULT_MIN_SAMPLE_SIZE) }
        );
      }
    } else if (!appliedSavedDraft) {
      setMinSampleSize(prev => (prev ? prev : String(DEFAULT_MIN_SAMPLE_SIZE)));
    }
    setShopGuardrailsReady(true);
  }, [appliedSavedDraft]);

  const loadGuardrails = useCallback(async () => {
    applyShopGuardrails(await fetchShopGuardrails(shopDomain));
  }, [shopDomain, applyShopGuardrails]);

  // Read by the catalog load below, which must not restart when the mode flips.
  const pickModeRef = useRef(pickMode);
  useEffect(() => {
    pickModeRef.current = pickMode;
  }, [pickMode]);

  const applyCatalog = useCallback(
    ({ requestId, rows, defaults, error }) => {
      if (productsLoadRequestId.current !== requestId) return;
      if (error) {
        setProductsLoadError(error);
      } else {
        setOpportunities(rows);
        setProductsLoadError('');
        setSelectedIds(prev => {
          if (prev.length > 0) return prev;
          if (pickModeRef.current !== 'all') return prev;
          return defaults.length ? defaults.slice(0, maxSelection) : prev;
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
    applyCatalog({ requestId, ...(await fetchCatalog(shopDomain)) });
  }, [shopDomain, applyCatalog, setLoadingProducts]);

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
    apiGet('/shopify/store-resources?type=collection&first=40', { shop: shopDomain })
      .then(res => {
        if (cancelled) return;
        const list = res?.data?.resources || res?.resources || [];
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

  useEffect(() => {
    if (step < 2) return undefined;
    const requestId = productsLoadRequestId.current + 1;
    productsLoadRequestId.current = requestId;
    let cancelled = false;
    fetchCatalog(shopDomain).then(result => {
      if (!cancelled) applyCatalog({ requestId, ...result });
    });
    return () => {
      cancelled = true;
    };
  }, [step, shopDomain, applyCatalog]);

  const buildBatch = useCallback(async () => {
    const ids =
      pickMode === 'all'
        ? (opportunities || [])
            .map(o => o.variant_id)
            .filter(Boolean)
            .slice(0, maxSelection)
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
          offerByArm
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
      setSelectedIds(ids);

      const audienceRes = await suggestSmartPricingAudience(shopDomain, nextPlans, {
        useAi: true,
      }).catch(() => null);
      if (audienceRes?.audience) {
        const a = audienceRes.audience;
        setAudience(prev => {
          const preservedFloor = resolveMinSampleSize(prev?.minSampleSize, minSampleSize);
          const next = mergeAudienceAiIntoStatePreservingSample(
            { ...prev, minSampleSize: String(preservedFloor) },
            stripClassicAudienceTargetingFields(a),
            {
              source: audienceRes.source,
              rationale: a.rationale || audienceRes.rationale,
            }
          );
          setGlobalAudience(segmentsFromClassicAudience(next, a.segments));
          return next;
        });
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
            primary_metric: normalizePrimaryMetric(
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
    audience,
    minSampleSize,
    experimentId,
    experimentType,
  ]);

  const enrichPlansForLaunch = useCallback(
    (sourcePlans = plans, { status = 'queued' } = {}) => {
      const rawAudienceState = audience || createDefaultAudienceState();
      const audienceState = {
        ...rawAudienceState,
        guardrails: capRevenueGuardrailRows(
          rawAudienceState.guardrails,
          shopGuardrails.max_revenue_drop_percent
        ),
      };
      const countryLists = resolveCountryLists(audienceState);
      const mappedSegments = segmentsFromClassicAudience(audienceState, globalAudience);
      const sampleSize = resolveMinSampleSize(audienceState.minSampleSize, minSampleSize);
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
        const stats = stampStatisticalFields(plan, shopGuardrails);
        const planGoal = goalByPlan[plan.id] || {};
        const planSecondary =
          Array.isArray(planGoal.secondary) && planGoal.secondary.length
            ? buildSecondaryGoalPayload(
                planGoal.secondary_events || audienceState.secondaryMetrics,
                planGoal.secondary
              )
            : Array.isArray(planGoal.secondary_events) && planGoal.secondary_events.length
              ? buildSecondaryGoalPayload(planGoal.secondary_events, audienceState.customGoals)
              : goalPayload;
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
            primary_metric: planGoal.primary_metric || goalPayload.primary_metric,
            secondary_events: planSecondary.secondary_events,
            secondary: planSecondary.secondary,
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
      minSampleSize,
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
    if (!rows.length) return;
    const next = { ...priceOverrides };
    rows.forEach(row => {
      const base = Number(row.current_price ?? row.price) || 0;
      const key = `${row.variant_id}::${arm.id}`;
      const delta = unit === 'amount' ? amount : base * (amount / 100);
      next[key] = Math.max(0, base + sign * delta).toFixed(2);
    });
    setPriceOverrides(next);
  };

  const applyLocalAiBandFallback = useCallback(
    ({ unit = 'percent' } = {}) => {
      const testArms = variations.filter((row, i) => i > 0 && row.id !== 'control');
      const aiArms = testArms.filter(arm => (pricingByArm[arm.id]?.priceMode || '') === 'ai');
      const targetArms = aiArms.length ? aiArms : testArms;
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
            ? 'Select products first, then re-suggest prices.'
            : 'Add a test variation before requesting AI prices.',
          busy: false,
        }));
        return false;
      }
      const rawBand = normalizeAiPriceBand(aiMinPct, aiMaxPct);
      const bases = rows
        .map(row => Number(row.current_price ?? row.price) || 0)
        .filter(n => n > 0);
      const avg = bases.length ? bases.reduce((sum, n) => sum + n, 0) / bases.length : 0;
      const band =
        capAiBandToShopMax(rawBand, shopGuardrails.max_price_change_percent, {
          unit,
          averagePrice: avg,
        }) || rawBand;
      const min = band?.min ?? Math.abs(Number(aiMinPct) || (unit === 'amount' ? 1 : 10));
      const max = band?.max ?? Math.abs(Number(aiMaxPct) || (unit === 'amount' ? 5 : 20));
      const armCount = targetArms.length;
      const shopMaxChange = Number(shopGuardrails.max_price_change_percent);
      const maxChangePct = Number.isFinite(shopMaxChange) && shopMaxChange > 0 ? shopMaxChange : 15;
      setPriceOverrides(prev => {
        const next = { ...prev };
        rows.forEach(row => {
          const base = Number(row.current_price ?? row.price) || 0;
          const ceiling = base * (1 + maxChangePct / 100);
          targetArms.forEach((arm, armIndex) => {
            // Match the server: span the band so variations stay far enough
            // apart to resolve a price response.
            const position = armCount > 1 ? armIndex / (armCount - 1) : 0.5;
            const span = min + (max - min) * position;
            const raw = unit === 'amount' ? base + span : base * (1 + span / 100);
            // The band was capped against the catalog average, so a flat dollar
            // uplift can still breach max price change on a cheaper product.
            const price = Math.min(raw, ceiling);
            next[`${row.variant_id}::${arm.id}`] = Math.max(0, price).toFixed(2);
          });
        });
        return next;
      });
      setAiPriceMeta({
        source: 'deterministic',
        summary: [
          describeAiBandCap(band, { unit }),
          unit === 'amount'
            ? `Local $${min}–$${max} band fallback (AI unavailable).`
            : `Local ${min}%–${max}% band fallback (AI unavailable).`,
        ]
          .filter(Boolean)
          .join(' '),
        busy: false,
      });
      markArmsAiSuggested(targetArms.map(arm => arm.id));
      return true;
    },
    [
      aiMinPct,
      aiMaxPct,
      variations,
      pricingByArm,
      opportunities,
      selectedIds,
      pickMode,
      maxSelection,
      shopGuardrails.max_price_change_percent,
      markArmsAiSuggested,
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
      const testArms = variations.filter((row, i) => i > 0 && row.id !== 'control');
      const aiArms = testArms.filter(arm => (pricingByArm[arm.id]?.priceMode || '') === 'ai');
      const targetArms = aiArms.length ? aiArms : testArms;
      if (!rows.length || !targetArms.length) {
        setAiPriceMeta({
          source: null,
          summary: !rows.length
            ? 'Select products first, then re-suggest prices.'
            : 'Add a test variation before requesting AI prices.',
          busy: false,
        });
        return;
      }
      if (!shopGuardrailsReady) {
        setAiPriceMeta({
          source: null,
          summary: 'Still loading shop experiment defaults. Try again in a moment.',
          busy: false,
        });
        return;
      }
      if (activeArmIndex === 0 && variations.length > 1) {
        setActiveArmIndex(1);
      }

      const rawBand = normalizeAiPriceBand(aiMinPct, aiMaxPct);
      if (!rawBand) {
        setAiPriceMeta({
          source: null,
          summary: 'Enter a min and max greater than 0, then click Suggest.',
          busy: false,
        });
        return;
      }
      const bases = rows
        .map(row => Number(row.current_price ?? row.price) || 0)
        .filter(n => n > 0);
      const avg = bases.length ? bases.reduce((sum, n) => sum + n, 0) / bases.length : 0;
      const band =
        capAiBandToShopMax(rawBand, shopGuardrails.max_price_change_percent, {
          unit,
          averagePrice: avg,
        }) || rawBand;
      const bandNotice = describeAiBandCap(band, { unit });
      const amountMode = unit === 'amount';
      // Dollar bands are sent as dollars; the server applies the flat uplift to
      // each product and clamps it per SKU. Converting to a catalog-average
      // percent here would under-price cheap SKUs and over-price expensive ones.
      const minPct = amountMode ? null : band.min;
      const maxPct = amountMode ? null : band.max;

      const requestId = ++aiSuggestRequestId.current;
      setAiPriceMeta(prev => ({
        ...prev,
        busy: true,
        summary: prev.summary || 'Suggesting prices…',
      }));
      let settled = false;
      try {
        const result = await suggestSmartPricingPrices(shopDomain, {
          variants: rows.map(row => ({
            variant_id: row.variant_id,
            title: row.product_title || row.title,
            current_price: Number(row.current_price ?? row.price) || 0,
            currency: row.currency || 'USD',
            margin_percent: row.margin_percent,
            units_sold_30d: row.units_sold_30d,
            revenue_30d: row.revenue_30d,
            opportunity_score: row.opportunity_score,
            recommended_scenario_preset: row.recommended_scenario_preset,
          })),
          arms: targetArms.map(arm => ({
            id: arm.id,
            label: arm.name || arm.role || arm.id,
          })),
          min_pct: minPct,
          max_pct: maxPct,
          unit,
          min_amount: amountMode ? band.min : null,
          max_amount: amountMode ? band.max : null,
          objective: primaryMetric || shopGuardrails.objective || 'revenue_per_visitor',
          guardrails: shopGuardrails,
          use_ai: true,
        });
        if (requestId !== aiSuggestRequestId.current) return;
        const suggestions = Array.isArray(result?.suggestions)
          ? result.suggestions
          : Array.isArray(result?.data?.suggestions)
            ? result.data.suggestions
            : [];
        setPriceOverrides(prev => {
          const next = { ...prev };
          suggestions.forEach(item => {
            if (!item?.variant_id || !item?.arm_id) return;
            if (!Number.isFinite(Number(item.price))) return;
            next[`${item.variant_id}::${item.arm_id}`] = Number(item.price).toFixed(2);
          });
          return next;
        });
        const baseSummary =
          result?.summary ||
          result?.data?.summary ||
          (suggestions.length
            ? 'AI price suggestions applied.'
            : 'No AI prices returned — try Re-suggest or adjust the band.');
        const limitedNotice = describeGuardrailLimitedSuggestions(
          suggestions.filter(item => item?.guardrail_limited).length,
          suggestions.length,
          band,
          { unit }
        );
        setAiPriceMeta({
          source: result?.source || result?.data?.source || 'deterministic',
          summary: [bandNotice, baseSummary, limitedNotice].filter(Boolean).join(' '),
          busy: false,
        });
        if (suggestions.length) {
          markArmsAiSuggested(
            suggestions
              .map(item => item?.arm_id)
              .filter(Boolean)
          );
        }
        settled = true;
      } catch {
        if (requestId !== aiSuggestRequestId.current) return;
        applyLocalAiBandFallback({ unit });
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
      markArmsAiSuggested,
    ]
  );

  const raiseMaxPriceChange = useCallback(
    async target => {
      const next = Number(target);
      if (!Number.isFinite(next) || next <= 0) return;
      setRaisingMaxPriceChange(true);
      try {
        // Send the whole current object: the endpoint normalizes and persists a
        // full guardrail record, so a partial body would reset the other limits.
        await saveSmartPricingGuardrails(shopDomain, {
          ...shopGuardrails,
          max_price_change_percent: next,
        });
        await loadGuardrails();
        // Put back what the merchant originally typed, now that it is allowed.
        const restore = {};
        const attemptedMin = Number(aiBandAttempt.min);
        const attemptedMax = Number(aiBandAttempt.max);
        if (Number.isFinite(attemptedMin) && attemptedMin > 0) {
          restore.aiMinPct = String(attemptedMin);
        }
        if (Number.isFinite(attemptedMax) && attemptedMax > 0) {
          restore.aiMaxPct = String(attemptedMax);
        }
        if (Object.keys(restore).length) {
          patchAiBand({ ...restore, aiSuggested: false });
        }
        setAiBandAttempt({ min: null, max: null });
        setAiPriceMeta(prev => ({
          ...prev,
          summary: `Max price change is now ${next}%. Click Suggest to use your full band.`,
        }));
      } catch {
        setAiPriceMeta(prev => ({
          ...prev,
          summary: 'Could not update Max price change. Change it in Settings and try again.',
        }));
      } finally {
        setRaisingMaxPriceChange(false);
      }
    },
    [shopDomain, shopGuardrails, loadGuardrails, aiBandAttempt, patchAiBand]
  );

  const openGuardrailSettings = useCallback(() => {
    const path = `${ROUTES.appSettings(shopDomain)}?tab=guardrails`;
    if (typeof navigate === 'function') {
      navigate(path);
      return;
    }
    window.open(path, '_blank');
  }, [navigate, shopDomain]);

  /** Average selected-product price: the dollar equivalent of a percent cap. */
  const aiBandAveragePrice = useCallback(() => {
    const bases = resolvePricingRows({ opportunities, selectedIds, pickMode, maxSelection })
      .map(row => Number(row.current_price ?? row.price) || 0)
      .filter(n => n > 0);
    return bases.length ? bases.reduce((sum, n) => sum + n, 0) / bases.length : 0;
  }, [opportunities, selectedIds, pickMode, maxSelection]);

  const applyBandField = useCallback(
    (field, value) => {
      // Until the shop's real cap has loaded, clamping would reduce the field
      // against a placeholder the merchant never set.
      const { value: next, attempted } = clampAiBandValue(
        value,
        shopGuardrailsReady ? shopGuardrails.max_price_change_percent : null,
        { unit: aiUnit, averagePrice: aiBandAveragePrice() }
      );
      setAiBandAttempt(prev => ({ ...prev, [field]: attempted }));
      patchAiBand({ [field === 'max' ? 'aiMaxPct' : 'aiMinPct']: next, aiSuggested: false });
    },
    [
      shopGuardrailsReady,
      shopGuardrails.max_price_change_percent,
      aiUnit,
      aiBandAveragePrice,
      patchAiBand,
    ]
  );

  const setAiMinPct = useCallback(value => applyBandField('min', value), [applyBandField]);
  const setAiMaxPct = useCallback(value => applyBandField('max', value), [applyBandField]);

  const setAiUnit = useCallback(
    value => {
      const nextUnit = value === 'amount' ? 'amount' : 'percent';
      if (nextUnit === aiUnit) return;
      const avg = aiBandAveragePrice();
      // The remembered over-cap attempt was in the old unit, so it no longer
      // describes anything once the unit changes.
      setAiBandAttempt({ min: null, max: null });
      // Carry the merchant's intent across units instead of reusing the raw
      // number: on a $50 catalog, 10% means $5, not $10.
      const convert = value2 => {
        const n = Math.abs(Number(value2));
        if (!Number.isFinite(n) || n <= 0 || avg <= 0) return null;
        const converted = nextUnit === 'amount' ? (avg * n) / 100 : (n / avg) * 100;
        return String(Math.round(converted * 100) / 100);
      };
      const nextMin = convert(aiMinPct);
      const nextMax = convert(aiMaxPct);
      patchAiBand({
        aiUnit: nextUnit,
        aiSuggested: false,
        ...(nextMin ? { aiMinPct: nextMin } : {}),
        ...(nextMax ? { aiMaxPct: nextMax } : {}),
      });
    },
    [aiUnit, aiMinPct, aiMaxPct, aiBandAveragePrice, patchAiBand]
  );

  const generateHypothesisWithAi = useCallback(async () => {
    setHypothesisBusy(true);
    try {
      const rows = resolvePricingRows({
        opportunities,
        selectedIds,
        pickMode,
        maxSelection,
      }).slice(0, 12);
      const result = await suggestSmartPricingHypothesis(shopDomain, {
        name,
        experiment_type: experimentType,
        hint: hypothesis,
        objective: primaryMetric || shopGuardrails.objective || 'revenue_per_visitor',
        variants: rows.map(row => ({
          variant_id: row.variant_id,
          title: row.product_title || row.title,
          current_price: Number(row.current_price ?? row.price) || 0,
          margin_percent: row.margin_percent,
          units_sold_30d: row.units_sold_30d,
          opportunity_score: row.opportunity_score,
        })),
      });
      if (result?.hypothesis) {
        setHypothesis(result.hypothesis);
        setMessageType('success');
        setMessage(
          result.source === 'openai'
            ? 'Hypothesis generated with AI.'
            : 'Hypothesis drafted with a rule-based template (AI unavailable).'
        );
      }
    } catch (err) {
      setMessageType('error');
      setMessage(err.message || 'Could not generate hypothesis.');
    } finally {
      setHypothesisBusy(false);
    }
  }, [
    opportunities,
    selectedIds,
    pickMode,
    maxSelection,
    shopDomain,
    name,
    experimentType,
    hypothesis,
    primaryMetric,
    shopGuardrails,
  ]);

  const handleAudienceChange = useCallback(nextAudience => {
    const next = {
      ...(nextAudience || createDefaultAudienceState()),
      ...normalizeClassicAudienceTargeting(nextAudience),
    };
    if (next.minSampleSize !== null && next.minSampleSize !== undefined) {
      setMinSampleSize(String(next.minSampleSize));
    }
    setAudience(next);
    setGlobalAudience(segmentsFromClassicAudience(next));
  }, []);

  const suggestAudienceWithAi = useCallback(async () => {
    setAudienceAiBusy(true);
    try {
      let sourcePlans = plans;
      if (!sourcePlans.length) {
        sourcePlans = await buildBatch();
      }
      const result = await suggestSmartPricingAudience(shopDomain, sourcePlans, { useAi: true });
      const a = result?.audience || {};
      setAudience(prev => {
        const preservedFloor = resolveMinSampleSize(prev?.minSampleSize, minSampleSize);
        const next = mergeAudienceAiIntoStatePreservingSample(
          { ...prev, minSampleSize: String(preservedFloor) },
          a,
          {
            source: result?.source,
            rationale: a.rationale,
          }
        );
        setGlobalAudience(segmentsFromClassicAudience(next, a.segments));
        return next;
      });
      setMessageType('success');
      setMessage(
        result?.source === 'openai'
          ? 'Audience targeting updated with AI.'
          : 'Audience targeting drafted from shop defaults.'
      );
    } catch (err) {
      setMessageType('error');
      setMessage(err.message || 'Could not suggest audience.');
    } finally {
      setAudienceAiBusy(false);
    }
  }, [plans, shopDomain, buildBatch, minSampleSize]);

  const saveDraft = async () => {
    if (!String(name).trim()) {
      setMessageType('error');
      setMessage('Add an experiment name before saving a draft.');
      return;
    }
    if (!shopGuardrailsReady) {
      setMessageType('error');
      setMessage('Still loading shop experiment defaults. Try again in a moment.');
      return;
    }
    setSavingDraft(true);
    try {
      writeClassicWizardDraft(shopDomain, wizardSnapshot);
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
      }
      setMessageType('success');
      setMessage('Draft saved. You can finish this experiment later from Drafts.');
      navigate(`${ROUTES.appSmartPricing(shopDomain)}?tab=draft`);
    } catch (err) {
      setMessageType('error');
      setMessage(err.message || 'Could not save draft.');
    } finally {
      setSavingDraft(false);
    }
  };

  const goNext = async () => {
    setMessage('');
    if (step === 0) {
      if (!String(name).trim()) {
        setMessageType('error');
        setMessage('Experiment name is required.');
        return;
      }
      if (experimentType !== 'price_test' && experimentType !== 'offer_test') {
        setMessageType('error');
        setMessage('Smart Pricing currently supports Price test and Offer test experiments.');
        return;
      }
      if (!shopGuardrailsReady) {
        setMessageType('error');
        setMessage('Still loading shop experiment defaults. Try again in a moment.');
        return;
      }
      const sample = Number(minSampleSize);
      if (!Number.isFinite(sample) || sample < 1) {
        setMessageType('error');
        setMessage('Enter a minimum sample size of at least 1 visitor per variation.');
        return;
      }
      setStep(1);
      return;
    }
    if (step === 1) {
      if (trafficTotal(variations) !== 100) {
        setMessageType('error');
        setMessage('Traffic must total 100%.');
        return;
      }
      if (!hasPositiveVariationTraffic(variations)) {
        setMessageType('error');
        setMessage('Every variation must receive more than 0% traffic.');
        return;
      }
      setProductsLoadError('');
      setStep(2);
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
        await buildBatch();
        setStep(3);
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
        setMessage('Still loading shop experiment defaults. Try again in a moment.');
        return;
      }
      const audienceCheck = validateClassicAudienceUi(audience || createDefaultAudienceState());
      if (!audienceCheck.ok) {
        setMessageType('error');
        setMessage(audienceCheck.message);
        return;
      }
      setStep(4);
      const enriched = enrichPlansForLaunch();
      setPlans(enriched);
      batchPreviewSmartPricingLaunch(shopDomain, enriched).catch(() => {});
      return;
    }
    if (step === 4) {
      if (busy || launching) {
        return;
      }
      if (!shopGuardrailsReady) {
        setMessageType('error');
        setMessage('Still loading shop experiment defaults. Try again in a moment.');
        return;
      }
      if (trafficTotal(variations) !== 100 || !hasPositiveVariationTraffic(variations)) {
        setMessageType('error');
        setMessage('Every variation needs more than 0% traffic and the split must total 100%.');
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
          'Fix Setup before launching.';
        setMessage(
          isOfferTest
            ? `Offer checkout is not ready. ${getOfferCheckoutBlockReason(checkoutReadiness)}`
            : `Checkout is not ready. ${detail}`
        );
        return;
      }
      const enriched = enrichPlansForLaunch();
      if (!enriched.length) {
        setMessageType('error');
        setMessage('No products to launch. Go back to Products and select at least one.');
        return;
      }
      const merged = upsertExperimentPlansInInbox(
        readInboxPlans(shopDomain),
        enriched,
        experimentId
      );
      writeInboxPlans(shopDomain, merged);
      await persistInboxPlansNow(shopDomain, merged).catch(() => null);
      try {
        setBusy(true);
        const result = await launchMany(enriched);
        clearClassicWizardDraft(shopDomain);
        setMessageType('success');
        setMessage(`Launched ${result.launched} test${result.launched === 1 ? '' : 's'}.`);
        navigate(ROUTES.appSmartPricing(shopDomain));
      } catch (err) {
        setMessageType('error');
        const detailText = Array.isArray(err?.details)
          ? err.details
              .map(item => (typeof item === 'string' ? item : item?.message || String(item)))
              .filter(Boolean)
              .join('; ')
          : '';
        setMessage(detailText || err.message || 'Launch failed.');
      } finally {
        setBusy(false);
      }
    }
  };

  const continueLabel = step === 4 ? 'Launch experiment' : 'Continue';
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
    ]
  );

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
        minSampleSize: resolveMinSampleSize(audience?.minSampleSize, minSampleSize),
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
      minSampleSize,
      shopDesign.minConversions,
      shopDesign.mdePercent,
      shopDesign.confidenceLevel,
      shopDesign.power,
    ]
  );
  const estimatedDays = significanceEstimate.days;

  return (
    <PageShell message={message} messageType={messageType} onCloseMessage={() => setMessage('')}>
      <ClassicWizardShell
        stepIndex={step}
        experimentType={experimentType}
        onBackToList={backToList}
        onBack={() => setStep(s => Math.max(0, s - 1))}
        onContinue={goNext}
        continueLabel={continueLabel}
        continueDisabled={
          (step === 2 && productsStepGate.disabled) ||
          ((step === 0 || step === 3 || step === 4) && !shopGuardrailsReady)
        }
        continueDisabledReason={
          step === 2
            ? productsStepGate.hint
            : (step === 0 || step === 3 || step === 4) && !shopGuardrailsReady
              ? 'Loading shop experiment defaults…'
              : ''
        }
        continueBusy={busy || launching}
        showCancel={step === 0}
        onCancel={backToList}
        onSaveDraft={saveDraft}
        saveDraftLabel="Save draft"
        saveDraftBusy={savingDraft}
        saveDraftDisabled={!shopGuardrailsReady}
        onGoToStep={index => {
          if (busy || launching || savingDraft) return;
          const next = Number(index);
          if (!Number.isInteger(next) || next < 0 || next >= step) return;
          setMessage('');
          setStep(next);
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
            onGenerateHypothesis={generateHypothesisWithAi}
            hypothesisBusy={hypothesisBusy}
            experimentType={experimentType}
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
            minSampleSize={minSampleSize}
            significanceEstimate={significanceEstimate}
            onMinSampleSizeChange={value => {
              setMinSampleSize(String(value));
              setAudience(prev => ({ ...prev, minSampleSize: String(value) }));
            }}
          />
        ) : null}

        {step === 1 ? (
          <VariationsStepPanel
            variations={variations}
            onChange={setVariations}
            experimentType={experimentType}
          />
        ) : null}

        {step === 2 ? (
          <ProductsPricingStepPanel
            opportunities={opportunities}
            selectedIds={selectedIds}
            onSelectedIdsChange={setSelectedIds}
            maxSelection={maxSelection}
            pickMode={pickMode}
            onPickModeChange={mode => {
              setPickMode(mode);
              if (mode === 'all') {
                const ids = opportunities
                  .map(o => o.variant_id)
                  .filter(Boolean)
                  .slice(0, maxSelection);
                setSelectedIds(ids);
              }
            }}
            productSearch={productSearch}
            onProductSearchChange={setProductSearch}
            collectionId={collectionId}
            onCollectionChange={setCollectionId}
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
            }}
            priceOverrides={priceOverrides}
            onPriceOverrideChange={(key, value) =>
              setPriceOverrides(prev => ({ ...prev, [key]: value }))
            }
            onPriceOverridesPatch={patch =>
              setPriceOverrides(prev => ({ ...prev, ...(patch || {}) }))
            }
            bulkPercent={bulkPercent}
            onBulkPercentChange={setBulkPercent}
            bulkDirection={bulkDirection}
            onBulkDirectionChange={setBulkDirection}
            onApplyBulk={applyBulk}
            onAiSuggest={applyAiBand}
            aiSuggestBusy={aiPriceMeta.busy}
            aiSuggestSummary={aiPriceMeta.summary}
            aiSuggested={activePricing.aiSuggested === true}
            onAiBandDirty={() => patchActivePricing({ aiSuggested: false })}
            aiUnit={aiUnit}
            onAiUnitChange={setAiUnit}
            aiMinPct={aiMinPct}
            aiMaxPct={aiMaxPct}
            onAiMinPctChange={setAiMinPct}
            onAiMaxPctChange={setAiMaxPct}
            loading={loadingProducts}
            loadError={productsLoadError}
            onRetryLoad={loadOpportunities}
            continueHint={productsStepGate.hint}
            shopDefaultsReady={shopGuardrailsReady}
            shopMaxChangePercent={shopGuardrails.max_price_change_percent}
        onRaiseMaxPriceChange={raiseMaxPriceChange}
        raisingMaxPriceChange={raisingMaxPriceChange}
        aiBandAttempt={aiBandAttempt}
        onOpenGuardrailSettings={openGuardrailSettings}
            experimentType={experimentType}
            offerByArm={offerByArm}
            onOfferByArmChange={setOfferByArm}
          />
        ) : null}

        {step === 3 ? (
          <AudienceSuccessStepPanel
            value={audience}
            onChange={handleAudienceChange}
            onSuggestAi={suggestAudienceWithAi}
            suggestBusy={audienceAiBusy}
            shopDomain={shopDomain}
            significanceEstimate={significanceEstimate}
            shopMaxRevenueDropPercent={shopGuardrails.max_revenue_drop_percent}
            disabled={!shopGuardrailsReady}
          />
        ) : null}

        {step === 4 ? (
          <ReviewLaunchStepPanel
            name={name}
            hypothesis={hypothesis}
            experimentType={experimentType}
            experimentTypeLabel={experimentTypeLabel}
            variations={variations}
            selectedCount={selectedIds.length}
            pickMode={pickMode}
            priceMode={priceMode}
            bulkPercent={bulkPercent}
            bulkDirection={bulkDirection}
            pricingByArm={pricingByArm}
            offerByArm={offerByArm}
            audience={audience}
            estimatedDays={estimatedDays}
            estimatedTimeDetail={significanceEstimate.detail}
            significanceEstimate={significanceEstimate}
            checkoutReady={launchCheckoutReady}
            checkoutLoading={checkoutLoading}
            checkoutReadiness={checkoutReadiness}
            shopDomain={shopDomain}
            onFixSetup={openCheckoutSetup}
            onFixPriceSurfaces={openPriceSurfaceSettings}
            onRefreshCheckout={() => refreshCheckoutReadiness()}
            onEditStep={setStep}
            plans={plans}
          />
        ) : null}
      </ClassicWizardShell>
    </PageShell>
  );
}
