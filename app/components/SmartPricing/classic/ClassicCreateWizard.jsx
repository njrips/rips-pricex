import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collapseCountrySelection } from './countrySelection';
import { useNavigate, useSearchParams } from 'react-router';
import PageShell from '../../shared/PageShell';
import { ROUTES } from '../../../constants';
import { apiGet } from '../../../services';
import useClassicShopDomain from '../../../hooks/useClassicShopDomain';
import {
  createSmartPricingBatch,
  getSmartPricingGuardrails,
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
  mergeAudienceAiIntoState,
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
import { ensureRevenueGuardrailRows } from './revenueGuardrail';
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
  formatCatalogLoadError,
  getProductsStepContinueState,
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

export default function ClassicCreateWizard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const shopDomain = useClassicShopDomain();
  const resumeId = String(searchParams.get('resume') || '').trim();
  const stepParam = String(searchParams.get('step') || '').trim();

  const [step, setStep] = useState(0);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('error');
  const [busy, setBusy] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  // Stable on SSR + first client paint; assign a real id after mount (avoids hydration mismatch).
  const [experimentId, setExperimentId] = useState('');
  const [draftHydrated, setDraftHydrated] = useState(false);

  const [name, setName] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [experimentType, setExperimentType] = useState('price_test');
  const [minSampleSize, setMinSampleSize] = useState('5000');

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
  const [loadingProducts, setLoadingProducts] = useState(false);
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
  const aiMinPct = activePricing.aiMinPct ?? '10';
  const aiMaxPct = activePricing.aiMaxPct ?? '20';

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
          ...(prev[activeArmId] || {}),
          ...patch,
        },
      }));
    },
    [activeArmId]
  );

  const setPriceMode = useCallback(
    mode => patchActivePricing({ priceMode: mode }),
    [patchActivePricing]
  );
  const setBulkPercent = useCallback(
    value => patchActivePricing({ bulkPercent: String(value) }),
    [patchActivePricing]
  );
  const setBulkDirection = useCallback(
    value => patchActivePricing({ bulkDirection: value }),
    [patchActivePricing]
  );
  const setAiMinPct = useCallback(
    value => patchActivePricing({ aiMinPct: String(value) }),
    [patchActivePricing]
  );
  const setAiMaxPct = useCallback(
    value => patchActivePricing({ aiMaxPct: String(value) }),
    [patchActivePricing]
  );
  const [hypothesisBusy, setHypothesisBusy] = useState(false);
  const [audienceAiBusy, setAudienceAiBusy] = useState(false);
  const [shopGuardrails, setShopGuardrails] = useState({});
  const [scenarioPreset, setScenarioPreset] = useState('recommended');

  const [audience, setAudience] = useState(createDefaultAudienceState);
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

  const applyWizardSnapshot = useCallback(snapshot => {
    if (!snapshot || typeof snapshot !== 'object') return;
    if (snapshot.experiment_id) setExperimentId(String(snapshot.experiment_id));
    if (Number.isFinite(Number(snapshot.step))) setStep(Number(snapshot.step));
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
    } else if (snapshot.globalAudience) {
      setGlobalAudience(normalizeAudienceSegments(snapshot.globalAudience));
    }
    if (snapshot.goalByPlan && typeof snapshot.goalByPlan === 'object') {
      setGoalByPlan(snapshot.goalByPlan);
    }
    if (Array.isArray(snapshot.plans)) setPlans(snapshot.plans);
    if (typeof snapshot.autoRound2 === 'boolean') setAutoRound2(snapshot.autoRound2);
  }, []);

  useEffect(() => {
    if (draftHydrated) return;
    const localDraft = readClassicWizardDraft(shopDomain);
    if (resumeId) {
      if (localDraft && String(localDraft.experiment_id) === resumeId) {
        applyWizardSnapshot(localDraft);
      } else {
        const inboxPlans = (readInboxPlans(shopDomain) || []).filter(
          plan => getPlanExperimentId(plan) === resumeId
        );
        if (inboxPlans.length) {
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
              ...normalizeClassicAudienceTargeting(first.metadata.audience_ui),
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
          }
          setStep(inboxPlans.some(p => p.price_arms?.length) ? 4 : 2);
        } else if (localDraft) {
          applyWizardSnapshot(localDraft);
        }
      }
      setDraftHydrated(true);
      return;
    }
    if (localDraft?.experiment_id && localDraft?.name) {
      // Keep unfinished draft available but don't auto-hijack a fresh create.
      setDraftHydrated(true);
      return;
    }
    setDraftHydrated(true);
  }, [shopDomain, resumeId, draftHydrated, applyWizardSnapshot]);

  useEffect(() => {
    if (!draftHydrated) return;
    const index = classicCreateStepIndex(stepParam);
    if (index == null) return;
    setStep(index);
  }, [draftHydrated, stepParam]);

  useEffect(() => {
    if (!draftHydrated) return;
    setExperimentId(prev => (prev ? prev : createExperimentId()));
  }, [draftHydrated]);

  const loadGuardrails = useCallback(async () => {
    try {
      const data = await getSmartPricingGuardrails(shopDomain);
      const g = data?.guardrails || data || {};
      setShopGuardrails(g && typeof g === 'object' ? g : {});
      if (Number.isFinite(Number(g.max_revenue_drop_percent))) {
        setAudience(prev => ({
          ...prev,
          guardrails: ensureRevenueGuardrailRows(
            prev?.guardrails,
            Number(g.max_revenue_drop_percent)
          ),
        }));
      }
      if (g.default_scenario_preset) setScenarioPreset(g.default_scenario_preset);
      if (g.default_audience_template) {
        setGlobalAudience(normalizeAudienceSegments(g.default_audience_template));
      }
      if (g.auto_round2_default === false) setAutoRound2(false);
    } catch {
      /* defaults */
    }
  }, [shopDomain]);

  const pickModeRef = useRef(pickMode);
  pickModeRef.current = pickMode;

  const loadOpportunities = useCallback(async () => {
    const requestId = productsLoadRequestId.current + 1;
    productsLoadRequestId.current = requestId;
    setLoadingProducts(true);
    try {
      // Classic wizard product picker needs the full catalog.
      // `ai_pick` only returns recommended rows — empty when AI ranking fails or none are tagged.
      const data = await getSmartPricingOpportunities(shopDomain, {
        filter: 'all',
        refresh: false,
      });
      if (productsLoadRequestId.current !== requestId) return;
      const rows = Array.isArray(data?.opportunities) ? data.opportunities : [];
      if (data?.error && !rows.length) {
        throw new Error(String(data.error));
      }
      setOpportunities(rows);
      setProductsLoadError('');
      setSelectedIds(prev => {
        if (prev.length > 0) return prev;
        if (pickModeRef.current !== 'all') return prev;
        const defaults =
          data?.default_selected_variant_ids || rows.map(r => r.variant_id).filter(Boolean);
        return defaults.length ? defaults.slice(0, maxSelection) : prev;
      });
    } catch (err) {
      if (productsLoadRequestId.current !== requestId) return;
      setProductsLoadError(formatCatalogLoadError(err));
    } finally {
      if (productsLoadRequestId.current === requestId) {
        setLoadingProducts(false);
      }
    }
  }, [shopDomain, maxSelection]);

  useEffect(() => {
    loadGuardrails();
    apiGet('/shopify/store-resources?type=collection&first=40', { shop: shopDomain })
      .then(res => {
        const list = res?.data?.resources || res?.resources || [];
        const options = [{ label: 'All products', value: '' }];
        list.forEach(item => {
          if (item?.id) options.push({ label: item.title || item.id, value: item.id });
        });
        setCollectionOptions(options);
      })
      .catch(() => {});
  }, [loadGuardrails, shopDomain]);

  useEffect(() => {
    if (step === 2) loadOpportunities();
  }, [step, loadOpportunities]);

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
          const next = mergeAudienceAiIntoState(prev, stripClassicAudienceTargetingFields(a), {
            source: audienceRes.source,
            rationale: a.rationale || audienceRes.rationale,
          });
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
    experimentId,
    experimentType,
  ]);

  const enrichPlansForLaunch = useCallback(
    (sourcePlans = plans, { status = 'queued' } = {}) => {
      const audienceState = audience || createDefaultAudienceState();
      const mappedSegments = segmentsFromClassicAudience(audienceState, globalAudience);
      const goalPayload = buildClassicGoalPayload(audienceState);
      const stamped = stampClassicExperimentMetadata(sourcePlans, {
        experimentId,
        experimentTitle: name,
        hypothesis,
        audienceUi: audienceState,
        experimentType,
      });
      return stamped.map(plan => {
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
          audience: {
            inherit_from_shop_defaults: false,
            segments: mappedSegments,
            traffic_allocation: audienceState.trafficAllocation,
            devices: audienceState.devices,
            sources: audienceState.sources,
            countries: collapseCountrySelection(
              audienceState.countries,
              audienceState.countryMode || 'include'
            ),
            device_mode: audienceState.deviceMode || 'include',
            source_mode: audienceState.sourceMode || 'include',
            country_mode: audienceState.countryMode || 'include',
          },
          goal: {
            ...planGoal,
            primary_metric: planGoal.primary_metric || goalPayload.primary_metric,
            secondary_events: planSecondary.secondary_events,
            secondary: planSecondary.secondary,
          },
          launch_preferences: {
            auto_start: status !== 'draft',
            auto_round2: autoRound2,
            max_learning_rounds: 3,
            manual_duration_cap_days: null,
            min_sample_size: Number(audienceState.minSampleSize || minSampleSize) || null,
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
      const minRaw = Math.abs(Number(aiMinPct) || (unit === 'amount' ? 1 : 10));
      const maxRaw = Math.abs(Number(aiMaxPct) || (unit === 'amount' ? 5 : 20));
      const min = Math.min(minRaw, maxRaw);
      const max = Math.max(minRaw, maxRaw);
      let targetArms = variations.filter((row, i) => i > 0 && row.id !== 'control');
      const active = variations[activeArmIndex];
      if (active && active.id !== 'control' && activeArmIndex > 0) {
        targetArms = [active];
      }
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
      setPriceOverrides(prev => {
        const next = { ...prev };
        rows.forEach((row, index) => {
          const base = Number(row.current_price ?? row.price) || 0;
          targetArms.forEach((arm, armIndex) => {
            const t = (((index + armIndex) % 5) + 1) / 5;
            const span = min + (max - min) * t;
            const price = unit === 'amount' ? base + span : base * (1 + span / 100);
            next[`${row.variant_id}::${arm.id}`] = Math.max(0, price).toFixed(2);
          });
        });
        return next;
      });
      setAiPriceMeta({
        source: 'deterministic',
        summary:
          unit === 'amount'
            ? `Local $${min}–$${max} band fallback (AI unavailable).`
            : 'Local band fallback (AI unavailable).',
        busy: false,
      });
      return true;
    },
    [
      aiMinPct,
      aiMaxPct,
      variations,
      activeArmIndex,
      opportunities,
      selectedIds,
      pickMode,
      maxSelection,
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
      let targetArms = variations.filter((row, i) => i > 0 && row.id !== 'control');
      // Prefer regenerating the active variation; fall back to all test arms.
      const active = variations[activeArmIndex];
      if (active && active.id !== 'control' && activeArmIndex > 0) {
        targetArms = [active];
      }
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
      if (activeArmIndex === 0 && variations.length > 1) {
        setActiveArmIndex(1);
      }

      let minPct = Math.abs(Number(aiMinPct) || 10);
      let maxPct = Math.abs(Number(aiMaxPct) || 20);
      if (unit === 'amount') {
        // API bands are %-based; convert $ min/max using average base price.
        const bases = rows
          .map(row => Number(row.current_price ?? row.price) || 0)
          .filter(n => n > 0);
        const avg = bases.length ? bases.reduce((sum, n) => sum + n, 0) / bases.length : 100;
        minPct = (Math.abs(Number(aiMinPct) || 0) / avg) * 100;
        maxPct = (Math.abs(Number(aiMaxPct) || 0) / avg) * 100;
        if (maxPct < minPct) {
          const swap = minPct;
          minPct = maxPct;
          maxPct = swap;
        }
        if (maxPct <= 0) {
          minPct = 5;
          maxPct = 15;
        }
      }

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
          objective: audience?.primaryMetric || shopGuardrails.objective || 'revenue_per_visitor',
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
        setAiPriceMeta({
          source: result?.source || result?.data?.source || 'deterministic',
          summary:
            result?.summary ||
            result?.data?.summary ||
            (suggestions.length
              ? 'AI price suggestions applied.'
              : 'No AI prices returned — try Re-suggest or adjust the band.'),
          busy: false,
        });
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
      audience?.primaryMetric,
      shopGuardrails,
      applyLocalAiBandFallback,
    ]
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
        objective: audience?.primaryMetric || shopGuardrails.objective || 'revenue_per_visitor',
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
    audience?.primaryMetric,
    shopGuardrails,
  ]);

  const handleAudienceChange = useCallback(nextAudience => {
    setAudience(nextAudience);
    setGlobalAudience(segmentsFromClassicAudience(nextAudience));
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
        const next = mergeAudienceAiIntoState(prev, a, {
          source: result?.source,
          rationale: a.rationale,
        });
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
  }, [plans, shopDomain, buildBatch]);

  const saveDraft = async () => {
    if (!String(name).trim()) {
      setMessageType('error');
      setMessage('Add an experiment name before saving a draft.');
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
      setStep(1);
      return;
    }
    if (step === 1) {
      if (trafficTotal(variations) !== 100) {
        setMessageType('error');
        setMessage('Traffic must total 100%.');
        return;
      }
      setLoadingProducts(true);
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
      persistInboxPlansNow(shopDomain, merged).catch(() => null);
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
    ]
  );

  const estimatedDays =
    plans[0]?.statistical_design?.estimated_duration_days ||
    Math.max(5, Math.round(14 * (50 / Math.max(5, Number(audience?.trafficAllocation) || 50))));

  return (
    <PageShell message={message} messageType={messageType} onCloseMessage={() => setMessage('')}>
      <ClassicWizardShell
        stepIndex={step}
        experimentType={experimentType}
        onBackToList={backToList}
        onBack={() => setStep(s => Math.max(0, s - 1))}
        onContinue={goNext}
        continueLabel={continueLabel}
        continueDisabled={step === 2 && productsStepGate.disabled}
        continueDisabledReason={step === 2 ? productsStepGate.hint : ''}
        continueBusy={busy || launching}
        showCancel={step === 0}
        onCancel={backToList}
        onSaveDraft={saveDraft}
        saveDraftLabel="Save draft"
        saveDraftBusy={savingDraft}
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
            onMinSampleSizeChange={setMinSampleSize}
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
                  },
                }));
                if (nextIndex >= 0) setActiveArmIndex(nextIndex);
                return;
              }
              setPriceMode(mode);
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
            aiMinPct={aiMinPct}
            aiMaxPct={aiMaxPct}
            onAiMinPctChange={setAiMinPct}
            onAiMaxPctChange={setAiMaxPct}
            loading={loadingProducts}
            loadError={productsLoadError}
            onRetryLoad={loadOpportunities}
            continueHint={productsStepGate.hint}
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
