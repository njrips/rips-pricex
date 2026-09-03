import { describe, expect, it } from 'vitest';
import {
  buildActivityTimeline,
  buildAudienceSummary,
  buildConversionRows,
  buildMetricsSummary,
  buildDecisionCaption,
  buildOverviewKpis,
  formatProductDecisionLabel,
  buildProductPerformanceGrid,
  buildSettingsSummary,
  buildPreviewBusyKey,
  buildQrImageUrl,
  buildVariationAveragePerformance,
  buildVariationPreviewUrl,
  buildVariationSharePreviewUrl,
  buildVariationProductsMatrix,
  buildVariationsSummary,
  formatSmartPricingPreviewVariantName,
  collectExperimentTestIds,
  conversionBarWidth,
  filterSortProductPerformance,
  filterSortVariationProducts,
  formatPrimaryMetricLabel,
  formatAudienceSegmentLabel,
  formatAudienceFactValue,
  formatActivityMeta,
  groupActivityByDay,
  groupVariationProductsByProduct,
  isControlArm,
  isPreviewControlBusy,
  canAcquirePreviewBusy,
  previewButtonState,
  shouldReleasePreviewBusy,
  matchArmOnPlan,
  mergeExperimentAnalytics,
  paginateVariationProducts,
  productRowKey,
  resolvePlanProductPath,
} from '../classicExperimentDetailsHelpers';

describe('classicExperimentDetailsHelpers', () => {
  it('formats primary metric labels', () => {
    expect(formatPrimaryMetricLabel('conversion_rate')).toBe('Conversion rate');
    expect(formatPrimaryMetricLabel('profit_per_visitor')).toBe('Profit per visitor');
  });

  it('formats audience segment labels', () => {
    expect(formatAudienceSegmentLabel('all')).toBe('All visitors');
    expect(formatAudienceSegmentLabel('new_visitors')).toBe('New visitors');
    expect(formatAudienceSegmentLabel('returning')).toBe('Returning visitors');
  });

  it('joins audience fact values like the details cards', () => {
    expect(formatAudienceFactValue(['desktop', 'mobile'], 'All devices')).toBe('Desktop, Mobile');
    expect(formatAudienceFactValue([], 'All devices')).toBe('All devices');
    expect(formatAudienceFactValue(undefined, 'All devices')).toBe('All devices');
  });

  it('formats activity meta as actor · timestamp', () => {
    expect(
      formatActivityMeta({
        actor: 'Maya Chen',
        at: '2026-07-12T09:14:00.000Z',
      })
    ).toMatch(/^Maya Chen · /);
  });

  it('groups activity items by calendar day', () => {
    const groups = groupActivityByDay([
      { id: 'a', at: '2026-08-20T10:00:00.000Z', title: 'Started' },
      { id: 'b', at: '2026-08-20T12:00:00.000Z', title: 'Paused' },
      { id: 'c', at: '2026-08-19T09:00:00.000Z', title: 'Created' },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].items.map(item => item.id)).toEqual(['a', 'b']);
    expect(groups[1].items.map(item => item.id)).toEqual(['c']);
  });

  it('detects control arms', () => {
    expect(isControlArm({ role: 'control' })).toBe(true);
    expect(isControlArm({ label: 'Control' })).toBe(true);
    expect(isControlArm({ role: 'challenger', label: 'A' })).toBe(false);
  });

  it('never invents fake conversion bar widths', () => {
    expect(conversionBarWidth(0, 10)).toBe(0);
    expect(conversionBarWidth(null, 10)).toBe(0);
    expect(conversionBarWidth(5, 0)).toBe(0);
    expect(conversionBarWidth(5, 10)).toBe(50);
    expect(conversionBarWidth(10, 10)).toBe(100);
  });

  it('builds overview KPIs from analytics summary', () => {
    const kpis = buildOverviewKpis({
      analytics: {
        winner_arm_id: 'arm_a',
        summary: {
          visitors: 25083,
          conversions: 1360,
          overall_conversion_rate: 5.42,
          lift: 21.4,
          confidence: 97,
          significant: true,
        },
        arms: [{}, {}],
      },
      plan: {
        goal: { primary_metric: 'conversion_rate' },
        audience: { traffic_allocation: 60 },
      },
    });
    expect(kpis.visitors).toBe(25083);
    expect(kpis.lift).toBe(21.4);
    expect(kpis.confidence).toBe(97);
    expect(kpis.significant).toBe(true);
    expect(kpis.trafficAllocation).toBe(60);
    expect(kpis.winnerArmId).toBe('arm_a');
    expect(kpis.decisionCaption).toBe('Winner called');
  });

  it('captions mixed per-product decisions while siblings still run', () => {
    expect(
      buildDecisionCaption({
        significant: false,
        experiment: {
          plans: [
            { status: 'applied' },
            { status: 'running' },
            { status: 'completed' },
          ],
        },
      })
    ).toBe('Deciding per product · 2 of 3 done');
  });

  it('labels product decisions without treating control retain as applied', () => {
    expect(formatProductDecisionLabel({ status: 'applied' })).toBe('Applied');
    expect(formatProductDecisionLabel({ status: 'completed' })).toBe('Kept catalog');
    expect(formatProductDecisionLabel({ status: 'completed' }, { isOffer: true })).toBe(
      'Completed'
    );
    expect(formatProductDecisionLabel({ status: 'running' })).toBe('Running');
  });

  it('does not mark overview KPIs significant while the sample floor is unmet', () => {
    const kpis = buildOverviewKpis({
      analytics: {
        summary: { visitors: 400, lift: 18, confidence: 97, significant: false },
        significance: { significant: false, sampleReady: false, minSampleSize: 5000, confidence: 97 },
      },
    });
    expect(kpis.significant).toBe(false);
    expect(kpis.confidence).toBe(97);
  });

  it('does not treat sequential confidence as a fixed-horizon call', () => {
    const kpis = buildOverviewKpis({
      analytics: {
        summary: { visitors: 8000, lift: 12, confidence: 97, significant: true },
        significance: {
          sequential: true,
          method: 'msprt',
          significant: false,
          sampleReady: true,
          confidence: 97,
        },
      },
    });
    expect(kpis.significant).toBe(false);
  });

  it('reads min sample size from launch preferences when audience_ui is missing', () => {
    expect(
      buildAudienceSummary({
        launch_preferences: { min_sample_size: 2200 },
        audience: {},
      }).minSampleSize
    ).toBe(2200);
    expect(
      buildMetricsSummary({
        launch_preferences: { min_sample_size: 2200 },
        goal: {
          visitors_per_variant_recommended: 18000,
          analysis_method: 'sequential',
          mde_percent: 10,
        },
      })
    ).toMatchObject({
      minSampleSize: 2200,
      recommendedSampleSize: 18000,
      analysisMethod: 'sequential',
      mdePercent: 10,
      confidenceLevel: 90,
    });
    expect(
      buildMetricsSummary({
        goal: { significance_level: 0.95, mde_percent: 8, analysis_method: 'sequential' },
      })
    ).toMatchObject({
      confidenceLevel: 95,
      mdePercent: 8,
    });
  });

  it('reads the stamped practical duration plan for post-launch details', () => {
    expect(
      buildMetricsSummary({
        statistical_design: {
          duration_feasibility: 'not_feasible',
          traffic_evidence: 'estimated',
          required_daily_visitors_for_practical_window: 320,
        },
      })
    ).toMatchObject({
      durationFeasibility: 'not_feasible',
      trafficEvidence: 'estimated',
      requiredDailyVisitorsForPracticalWindow: 320,
    });
  });

  it('builds conversion rows with relative widths and no synthetic fallback', () => {
    const rows = buildConversionRows({
      analytics: {
        winner_arm_id: 'b',
        arms: [
          { arm_id: 'a', role: 'control', label: 'Control', conversion_rate: 4.9 },
          { arm_id: 'b', role: 'challenger', label: 'Warm', conversion_rate: 5.94 },
        ],
      },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].isControl).toBe(true);
    expect(rows[1].isWinner).toBe(true);
    expect(rows[0].barWidth).toBeCloseTo((4.9 / 5.94) * 100, 5);
    expect(rows[1].barWidth).toBe(100);
  });

  it('keeps zero-rate conversion bars at width 0', () => {
    const rows = buildConversionRows({
      analytics: {
        arms: [
          { arm_id: 'a', role: 'control', label: 'Control', conversion_rate: 0 },
          { arm_id: 'b', role: 'challenger', label: 'A', conversion_rate: 0 },
        ],
      },
    });
    expect(rows.every(row => row.barWidth === 0)).toBe(true);
    // A measured 0% is real data and must stay 0 so the UI renders "0.00%";
    // collapsing it to null showed a dash that reads as "no traffic yet".
    expect(rows.every(row => row.rate === 0)).toBe(true);
  });

  it('distinguishes a missing conversion rate from a measured zero', () => {
    const rows = buildConversionRows({
      analytics: {
        arms: [
          { arm_id: 'a', role: 'control', label: 'Control', conversion_rate: 0 },
          { arm_id: 'b', role: 'challenger', label: 'A' },
          { arm_id: 'c', role: 'challenger', label: 'B', conversion_rate: null },
        ],
      },
    });
    expect(rows[0].rate).toBe(0);
    expect(rows[1].rate).toBeNull();
    expect(rows[2].rate).toBeNull();
  });

  it('summarizes variations, audience, and metrics from plan', () => {
    const plan = {
      price_arms: [
        { id: 'c', role: 'control', label: 'Control', price: 59, allocation_percent: 50 },
        { id: 'a', role: 'challenger', label: 'A', price: 54, allocation_percent: 50 },
      ],
      audience: {
        devices: ['Desktop'],
        device_mode: 'include',
        sources: ['Direct'],
        countries: ['US'],
        traffic_allocation: 50,
        segments: { exclude_bots: true, customer: 'all' },
      },
      goal: {
        primary_metric: 'conversion_rate',
        secondary: [{ event_name: 'page_view', label: 'Page view' }],
        secondary_events: ['page_view'],
        cogs: { enabled: true, type: 'percentage', value: 55 },
      },
    };
    expect(buildVariationsSummary(plan)).toHaveLength(2);
    expect(buildVariationsSummary(plan)[1].offer).toBeNull();
    expect(buildAudienceSummary(plan).countries).toEqual(['US']);
    expect(buildAudienceSummary(plan).segmentLabel).toBe('All visitors');
    expect(buildMetricsSummary(plan).secondaryEvents).toEqual(['page_view']);
  });

  it('hides the primary custom goal from secondary metric chips', () => {
    const summary = buildMetricsSummary({
      goal: {
        primary_metric: 'vip_checkout',
        secondary: [
          { event_name: 'vip_checkout', label: 'VIP checkout', metric_role: 'primary' },
          { event_name: 'page_view', label: 'Page view' },
        ],
        secondary_events: ['vip_checkout', 'page_view'],
      },
    });
    expect(summary.secondaryEvents).toEqual(['page_view']);
    expect(summary.secondary.map(item => item.event_name)).toEqual(['page_view']);
  });

  it('attaches offer rules from plan arms or test variant config', () => {
    const plan = {
      price_arms: [
        { id: 'c', role: 'control', label: 'Control', price: 40 },
        {
          id: 'a',
          role: 'challenger',
          label: 'A',
          price: 40,
          offer: { discount_type: 'percent', discount_value: 15, offer_message: 'Save 15%' },
        },
      ],
    };
    const fromPlan = buildVariationsSummary(plan);
    expect(fromPlan[1].offer).toEqual({
      discount_type: 'percent',
      discount_value: 15,
      offer_message: 'Save 15%',
    });

    const fromTest = buildVariationsSummary(
      {
        price_arms: [
          { id: 'c', role: 'control', label: 'Control' },
          { id: 'a', role: 'challenger', label: 'A' },
        ],
      },
      null,
      {
        test: {
          variants: [
            { id: 'v0', config: {} },
            {
              id: 'v1',
              config: { discount_type: 'fixed', discount_value: 5, offer_message: 'Five off' },
            },
          ],
        },
      }
    );
    expect(fromTest[1].offer).toEqual({
      discount_type: 'fixed',
      discount_value: 5,
      offer_message: 'Five off',
    });
  });

  it('lists per-product prices when an experiment has multiple plans', () => {
    const plans = [
      {
        id: 'p1',
        status: 'applied',
        product_title: 'Alpha Tee',
        product_id: 'prod_1',
        handle: 'alpha-tee',
        test_id: 't1',
        price_arms: [
          { id: 'c', role: 'control', label: 'Control', price: 40 },
          { id: 'a', role: 'challenger', label: 'A', price: 36 },
        ],
      },
      {
        id: 'p2',
        status: 'running',
        product_title: 'Beta Hoodie',
        product_id: 'prod_2',
        handle: 'beta-hoodie',
        test_id: 't2',
        price_arms: [
          { id: 'c', role: 'control', label: 'Control', price: 80 },
          { id: 'a', role: 'challenger', label: 'A', price: 72 },
        ],
      },
    ];
    const rows = buildVariationsSummary(plans[0], null, { plans });
    expect(rows).toHaveLength(2);
    expect(rows[0].products).toHaveLength(2);
    expect(rows[0].products.map(p => p.price)).toEqual([40, 80]);
    expect(rows[1].products.map(p => p.price)).toEqual([36, 72]);
    expect(rows[0].products[0].handle).toBe('alpha-tee');
    expect(rows[0].products.map(p => p.decisionLabel)).toEqual(['Applied', 'Running']);

    const matrix = buildVariationProductsMatrix(rows);
    expect(matrix).toHaveLength(2);
    expect(matrix.find(p => p.handle === 'alpha-tee')?.pricesByArmId).toEqual({
      c: 40,
      a: 36,
    });
    expect(matrix.find(p => p.handle === 'beta-hoodie')?.pricesByArmId).toEqual({
      c: 80,
      a: 72,
    });
  });

  it('matches arms by label/index instead of shared challenger role', () => {
    const secondary = {
      price_arms: [
        { id: 'ctrl_other', role: 'control', label: 'Control', price: 50 },
        { id: 'x', role: 'challenger', label: 'A', price: 45 },
        { id: 'y', role: 'challenger', label: 'B', price: 55 },
      ],
    };
    expect(matchArmOnPlan(secondary, { id: 'a', role: 'challenger', label: 'A' }, 1)?.price).toBe(
      45
    );
    expect(matchArmOnPlan(secondary, { id: 'b', role: 'challenger', label: 'B' }, 2)?.price).toBe(
      55
    );
    // Without labels, fall back to index — not the first challenger for every arm.
    expect(matchArmOnPlan(secondary, { id: 'b', role: 'challenger' }, 2)?.price).toBe(55);

    const plans = [
      {
        id: 'p1',
        product_title: 'One',
        product_id: 'prod_1',
        price_arms: [
          { id: 'c1', role: 'control', label: 'Control', price: 50 },
          { id: 'a1', role: 'challenger', label: 'A', price: 45 },
          { id: 'b1', role: 'challenger', label: 'B', price: 55 },
        ],
      },
      {
        id: 'p2',
        product_title: 'Two',
        product_id: 'prod_2',
        price_arms: [
          { id: 'c2', role: 'control', label: 'Control', price: 80 },
          { id: 'a2', role: 'challenger', label: 'A', price: 70 },
          { id: 'b2', role: 'challenger', label: 'B', price: 90 },
        ],
      },
    ];
    const rows = buildVariationsSummary(plans[0], null, { plans });
    const matrix = buildVariationProductsMatrix(rows);
    expect(matrix.find(p => p.title === 'One')?.pricesByArmId).toEqual({
      c1: 50,
      a1: 45,
      b1: 55,
    });
    expect(matrix.find(p => p.title === 'Two')?.pricesByArmId).toEqual({
      c1: 80,
      a1: 70,
      b1: 90,
    });
  });

  it('builds variation preview and QR helper urls', () => {
    const preview = buildVariationPreviewUrl({
      shopDomain: 'ripx-plus.myshopify.com',
      testId: 'test_1',
      variantId: 'var_a',
      variantName: 'A',
      productPath: '/products/alpha-tee',
      previewSessionId: 'sess-price-1',
    });
    expect(preview).toContain('https://ripx-plus.myshopify.com/products/alpha-tee');
    expect(preview).not.toContain('price-preview-bootstrap');
    expect(preview).toContain('ab_preview=1');
    expect(preview).toContain('ab_preview_test=test_1');
    expect(preview).toContain('ab_preview_variant=var_a');
    expect(preview).toContain('ab_preview_reset=1');
    expect(preview).toContain('ab_preview_simple=1');
    expect(preview).toContain('ab_preview_test_type=price');
    expect(preview).toContain('ab_preview_session=sess-price-1');
    expect(
      buildVariationPreviewUrl({
        shopDomain: 'ripx-plus.myshopify.com',
        testId: 'test_1',
        productPath: '/',
      })
    ).toBeNull();
    const share = buildVariationSharePreviewUrl({
      shopDomain: 'ripx-plus.myshopify.com',
      testId: 'test_1',
      variantId: 'var_a',
      variantName: 'A',
      productPath: '/products/alpha-tee',
    });
    expect(share).toContain('https://ripx-plus.myshopify.com/products/alpha-tee');
    expect(share).not.toContain('price-preview-bootstrap');
    const qr = buildQrImageUrl(share, 160);
    expect(qr).toContain('api.qrserver.com');
    expect(qr).toContain(encodeURIComponent(share));
    const offerPreview = buildVariationPreviewUrl({
      shopDomain: 'ripx-plus.myshopify.com',
      testId: 'offer_1',
      variantName: '10% off Variation A',
      productPath: '/products/alpha-tee',
      testType: 'offer',
    });
    expect(offerPreview).toContain('https://ripx-plus.myshopify.com/products/alpha-tee');
    expect(offerPreview).toContain('ab_preview_test_type=offer');
    expect(offerPreview).not.toContain('price-preview-bootstrap');
  });

  it('keeps variation preview busy keys unique when arms share a product', () => {
    const product = { planId: 'plan-1', productId: 'gid://shopify/Product/1' };
    const control = buildPreviewBusyKey({
      scope: 'arm',
      action: 'preview',
      armId: 'control',
      product,
    });
    const variantA = buildPreviewBusyKey({
      scope: 'arm',
      action: 'preview',
      armId: 'var_a',
      product,
    });
    const variantAQr = buildPreviewBusyKey({
      scope: 'arm',
      action: 'qr',
      armId: 'var_a',
      product,
    });
    expect(control).not.toBe(variantA);
    expect(variantA).not.toBe(variantAQr);
    expect(isPreviewControlBusy(variantA, control)).toBe(false);
    expect(isPreviewControlBusy(variantA, variantA)).toBe(true);
    expect(isPreviewControlBusy('', variantA)).toBe(false);
    expect(canAcquirePreviewBusy('', variantA)).toBe(true);
    expect(canAcquirePreviewBusy(control, variantA)).toBe(false);
    expect(canAcquirePreviewBusy(variantA, variantA)).toBe(false);
    expect(shouldReleasePreviewBusy(variantA, variantA)).toBe(true);
    expect(shouldReleasePreviewBusy(variantA, control)).toBe(false);
    expect(previewButtonState(variantA, variantA)).toEqual({ loading: true, disabled: false });
    expect(previewButtonState(variantA, control)).toEqual({ loading: false, disabled: true });
    expect(previewButtonState('', variantA)).toEqual({ loading: false, disabled: false });
    expect(canAcquirePreviewBusy('', '')).toBe(false);
    expect(canAcquirePreviewBusy(variantA, '')).toBe(false);
    expect(shouldReleasePreviewBusy('', variantA)).toBe(false);
    expect(shouldReleasePreviewBusy(variantA, '')).toBe(false);
  });

  it('formats Smart Pricing preview variant names with price prefix', () => {
    expect(
      formatSmartPricingPreviewVariantName(
        { label: 'Variation A', role: 'challenger' },
        { price: 884.94, currency: 'USD' }
      )
    ).toBe('$884.94 Variation A');
    expect(
      formatSmartPricingPreviewVariantName(
        { label: 'Control', role: 'control', variantName: '$749.95 Control' },
        { price: 749.95 }
      )
    ).toBe('$749.95 Control');
    // Per-SKU price must win over a leaked primary-plan variantName.
    expect(
      formatSmartPricingPreviewVariantName(
        { label: 'Variation A', role: 'challenger', variantName: '$884.94 Variation A' },
        { price: 1148, currency: 'USD' }
      )
    ).toBe('$1,148.00 Variation A');
    expect(
      formatSmartPricingPreviewVariantName(
        {
          label: 'Variation A',
          role: 'challenger',
          offer: { discount_type: 'percent', discount_value: 10 },
        },
        { isOffer: true, currency: 'USD' }
      )
    ).toBe('10% off Variation A');
    expect(
      formatSmartPricingPreviewVariantName(
        { label: 'Control', role: 'control' },
        { isOffer: true }
      )
    ).toBe('Control');
  });

  it('groups matrix SKUs under products for accordion rows', () => {
    const matrix = [
      {
        key: 'plan:p1',
        planId: 'p1',
        productId: 'prod_1',
        productTitle: 'Tee',
        variantTitle: 'S',
        title: 'Tee — S',
        handle: 'tee',
        pricesByArmId: { c: 20, a: 18 },
      },
      {
        key: 'plan:p2',
        planId: 'p2',
        productId: 'prod_1',
        productTitle: 'Tee',
        variantTitle: 'M',
        title: 'Tee — M',
        handle: 'tee',
        pricesByArmId: { c: 20, a: 19 },
      },
      {
        key: 'plan:p3',
        planId: 'p3',
        productId: 'prod_2',
        productTitle: 'Hoodie',
        variantTitle: '',
        title: 'Hoodie',
        handle: 'hoodie',
        pricesByArmId: { c: 40, a: 36 },
      },
    ];
    const groups = groupVariationProductsByProduct(matrix);
    expect(groups).toHaveLength(2);
    const tee = groups.find(g => g.title === 'Tee');
    expect(tee.variants).toHaveLength(2);
    expect(groups.find(g => g.title === 'Hoodie').variants).toHaveLength(1);
  });

  it('filters, sorts, and paginates variation products for the View-all modal', () => {
    const products = [
      { title: 'Zebra', handle: 'zebra', price: 30 },
      { title: 'Alpha', handle: 'alpha', price: 10 },
      { title: 'Beta', handle: 'beta-kit', price: 20 },
    ];
    const byName = filterSortVariationProducts(products, { sort: 'title' });
    expect(byName.map(p => p.title)).toEqual(['Alpha', 'Beta', 'Zebra']);
    const byPrice = filterSortVariationProducts(products, { sort: 'price_desc' });
    expect(byPrice.map(p => p.price)).toEqual([30, 20, 10]);
    const searched = filterSortVariationProducts(products, { query: 'beta' });
    expect(searched).toHaveLength(1);
    expect(searched[0].title).toBe('Beta');
    const page = paginateVariationProducts(byName, 2, 2);
    expect(page.totalPages).toBe(2);
    expect(page.page).toBe(2);
    expect(page.items.map(p => p.title)).toEqual(['Zebra']);
  });

  it('includes Shopify variant id on plan product paths', () => {
    expect(
      resolvePlanProductPath({
        handle: 'ass-savers',
        variantId: 'gid://shopify/ProductVariant/55854605762633',
      })
    ).toBe('/products/ass-savers?variant=55854605762633');
  });

  it('uses stable product row keys and PDP paths from handles', () => {
    expect(productRowKey({ planId: 'p1', title: 'A' }, 9)).toBe('plan:p1');
    expect(productRowKey({ productId: 'prod_1', title: 'A' }, 9)).toBe('product:prod_1:9');
    expect(productRowKey({ productId: 'prod_1', testId: 't1' }, 9)).toBe('product:prod_1:t1');
    expect(productRowKey({ handle: 'alpha', title: 'Alpha' }, 2)).toBe('handle:alpha:Alpha');
    expect(productRowKey({ title: 'Same' }, 0)).not.toBe(productRowKey({ title: 'Same' }, 1));
    expect(resolvePlanProductPath({ handle: 'alpha-tee' })).toBe('/products/alpha-tee');
    expect(resolvePlanProductPath({ metadata: { product_handle: 'beta' } })).toBe('/products/beta');
    expect(resolvePlanProductPath({})).toBe('/');
  });

  it('does not promise catalog rollout on offer-test activity', () => {
    const items = buildActivityTimeline({
      plan: {
        experiment_type: 'offer_test',
        status: 'winner_ready',
        updated_at: '2026-07-04T00:00:00.000Z',
        winner_applied_at: '2026-07-05T00:00:00.000Z',
      },
      test: { status: 'stopped', stopped_at: '2026-07-04T00:00:00.000Z', type: 'offer' },
    });
    expect(items.find(item => item.id === 'winner_applied')?.detail).toMatch(/catalog prices were not changed/);
    expect(items.find(item => item.id === 'winner_ready')).toBeUndefined();
    expect(items.find(item => item.id === 'paused')).toBeUndefined();
  });

  it('records a per-product control retain without a catalog write', () => {
    const items = buildActivityTimeline({
      plan: {
        status: 'completed',
        control_retained_at: '2026-08-29T00:00:00.000Z',
        updated_at: '2026-08-29T00:00:00.000Z',
      },
      test: { status: 'completed', stopped_at: '2026-08-29T00:00:00.000Z', type: 'price' },
    });
    expect(items.find(item => item.id === 'control_retained')?.title).toBe('Kept catalog price');
    expect(items.find(item => item.id === 'winner_applied')).toBeUndefined();
    expect(items.find(item => item.id === 'paused')).toBeUndefined();
  });

  it('builds activity timeline newest first', () => {
    const items = buildActivityTimeline({
      plan: {
        created_at: '2026-07-01T00:00:00.000Z',
        test_id: 't1',
        status: 'running',
        title: 'Test',
      },
      test: { started_at: '2026-07-02T00:00:00.000Z', status: 'running' },
      qaRuns: [{ id: 'r1', status: 'pass', finished_at: '2026-07-03T00:00:00.000Z' }],
    });
    expect(items[0].id).toBe('qa_r1');
    expect(items.some(item => item.id === 'created')).toBe(true);
    expect(items.find(item => item.id === 'created')?.title).toBe('Created experiment');
    expect(items.find(item => item.id === 'started')?.title).toBe('Launched experiment');
    expect(items.find(item => item.id === 'created')?.actor).toBe('You');
  });

  it('includes shop guardrail notes in settings summary', () => {
    const settings = buildSettingsSummary(
      { id: 'p1', audience: { traffic_allocation: 40 } },
      { status: 'running', segments: {} },
      { max_parallel_tests: 5, max_price_change_percent: 15, min_margin_percent: 35 }
    );
    expect(settings.trafficRampPercent).toBe(40);
    expect(settings.guardrailNotes.length).toBeGreaterThanOrEqual(3);
    expect(settings.maxParallelTests).toBe(5);
    expect(settings.priceApplicationMethod).toBe('direct_price_override');
    expect(settings.autoStopEnabled).toBe(false);
  });

  it('includes the revenue drop limit and treats auto-stop as on', () => {
    const settings = buildSettingsSummary(
      { id: 'p1', audience: { traffic_allocation: 40 } },
      {
        status: 'running',
        auto_stop: true,
        guardrail_config: { auto_stop: true, max_revenue_drop_percent: 10 },
        goal: { guardrails: { auto_stop: true, max_revenue_drop_percent: 10 } },
      },
      { max_revenue_drop_percent: 10, max_parallel_tests: 5 }
    );
    expect(settings.autoStopEnabled).toBe(true);
    expect(settings.guardrailNotes.some(note => /Max revenue drop: 10%/.test(note))).toBe(true);
  });

  it('marks offer tests as checkout-discount application', () => {
    const settings = buildSettingsSummary(
      { id: 'p1', experiment_type: 'offer_test', audience: { traffic_allocation: 50 } },
      { type: 'offer', status: 'running', variants: [{ config: {} }] },
      { max_parallel_tests: 5, max_price_change_percent: 15 }
    );
    expect(settings.priceApplicationMethod).toBe('checkout_discount_function');
    expect(settings.guardrailNotes.some(note => note.includes('Max price change'))).toBe(false);
  });

  it('hides the parallel-test cap when guardrails are unlimited', () => {
    const settings = buildSettingsSummary(
      { id: 'p1', audience: { traffic_allocation: 40 } },
      { status: 'running', segments: {} },
      { max_parallel_tests: 0, max_price_change_percent: 15 }
    );
    expect(settings.maxParallelTests).toBeNull();
    expect(settings.guardrailNotes.some(note => /parallel/i.test(note))).toBe(false);
  });

  it('averages variation performance across product tests without double-counting', () => {
    const plans = [
      {
        id: 'p1',
        product_title: 'Alpha',
        test_id: 't1',
        price_arms: [
          { id: 'c', role: 'control', label: 'Control', price: 40 },
          { id: 'a', role: 'challenger', label: 'A', price: 36 },
        ],
      },
      {
        id: 'p2',
        product_title: 'Beta',
        test_id: 't2',
        price_arms: [
          { id: 'c', role: 'control', label: 'Control', price: 80 },
          { id: 'a', role: 'challenger', label: 'A', price: 72 },
        ],
      },
      {
        id: 'p3',
        product_title: 'Alpha SKU 2',
        test_id: 't1',
        price_arms: [
          { id: 'c', role: 'control', label: 'Control', price: 42 },
          { id: 'a', role: 'challenger', label: 'A', price: 38 },
        ],
      },
    ];
    const analyticsByTestId = {
      t1: {
        test_id: 't1',
        winner_arm_id: 'a',
        arms: [
          {
            arm_id: 'c',
            label: 'Control',
            role: 'control',
            visitors: 100,
            conversion_rate: 4,
            profit_per_visitor: 1,
          },
          {
            arm_id: 'a',
            label: 'A',
            role: 'challenger',
            visitors: 120,
            conversion_rate: 6,
            profit_per_visitor: 1.5,
          },
        ],
      },
      t2: {
        test_id: 't2',
        arms: [
          {
            arm_id: 'c',
            label: 'Control',
            role: 'control',
            visitors: 200,
            conversion_rate: 2,
            profit_per_visitor: 2,
          },
          {
            arm_id: 'a',
            label: 'A',
            role: 'challenger',
            visitors: 180,
            conversion_rate: 8,
            profit_per_visitor: 2.5,
          },
        ],
      },
    };

    expect(collectExperimentTestIds(plans, 't1')).toEqual(['t1', 't2']);

    const averages = buildVariationAveragePerformance({
      plan: plans[0],
      plans,
      analyticsByTestId,
    });
    expect(averages).toHaveLength(2);
    const control = averages.find(row => row.id === 'c');
    const challenger = averages.find(row => row.id === 'a');
    expect(control.sampleCount).toBe(2);
    expect(control.avg_visitors).toBe(150);
    expect(control.avg_conversion_rate).toBe(3);
    expect(challenger.avg_conversion_rate).toBe(7);
    expect(challenger.isWinner).toBe(true);
    expect(challenger.conversionBarWidth).toBe(100);

    const grid = buildProductPerformanceGrid({
      plan: plans[0],
      plans,
      analyticsByTestId,
    });
    expect(grid).toHaveLength(3);
    expect(grid.find(row => row.planId === 'p1')?.sharedTest).toBe(true);
    expect(grid.find(row => row.planId === 'p2')?.metricsByArmId.a.conversion_rate).toBe(8);

    const sorted = filterSortProductPerformance(grid, { sort: 'conversion_desc' });
    expect(sorted[0].planId).toBe('p2');
    const searched = filterSortProductPerformance(grid, { query: 'beta' });
    expect(searched).toHaveLength(1);

    const merged = mergeExperimentAnalytics(analyticsByTestId, analyticsByTestId.t1);
    expect(merged.multi_test).toBe(true);
    expect(merged.test_count).toBe(2);
    // summaries missing → fall back to arm visitor totals (100+120 + 200+180)
    expect(merged.summary.visitors).toBe(600);

    const mergedWithSummary = mergeExperimentAnalytics(
      {
        t1: {
          ...analyticsByTestId.t1,
          summary: { visitors: 220, conversions: 12, lift: 10, confidence: 90 },
        },
        t2: {
          ...analyticsByTestId.t2,
          summary: { visitors: 380, conversions: 20, lift: 20, confidence: 95, significant: true },
        },
      },
      analyticsByTestId.t1
    );
    expect(mergedWithSummary.summary.visitors).toBe(600);
    expect(mergedWithSummary.summary.confidence).toBe(90);
    expect(mergedWithSummary.summary.significant).toBe(false);
  });

  it('does not mark a multi-SKU experiment ready when only one test is significant', () => {
    const merged = mergeExperimentAnalytics(
      {
        t1: {
          summary: { visitors: 8000, lift: 12, confidence: 97, significant: true },
          significance: { sequential: true, method: 'msprt', significant: true, sampleReady: true },
        },
        t2: {
          summary: { visitors: 8000, lift: 4, confidence: 72, significant: false },
          significance: { sequential: true, method: 'msprt', significant: false, sampleReady: true },
        },
      },
      null
    );
    expect(merged.summary.significant).toBe(false);
    expect(merged.significance.significant).toBe(false);
    expect(merged.summary.confidence).toBe(72);
  });

  it('marks a multi-SKU experiment ready only when every test is sequentially significant', () => {
    const merged = mergeExperimentAnalytics(
      {
        t1: {
          summary: { visitors: 8000, lift: 12, confidence: 97, significant: true },
          significance: { sequential: true, method: 'msprt', significant: true, sampleReady: true },
        },
        t2: {
          summary: { visitors: 9000, lift: 11, confidence: 96, significant: true },
          significance: { sequential: true, method: 'msprt', significant: true, sampleReady: true },
        },
      },
      null
    );
    expect(merged.summary.significant).toBe(true);
    expect(merged.significance.significant).toBe(true);
    expect(merged.significance.sequential).toBe(true);
    expect(merged.summary.confidence).toBe(96);
  });

  it('claims validated evidence only when every product has earned it', () => {
    const validated = {
      sequential: true,
      method: 'beta_binomial_cs',
      significant: true,
      sampleReady: true,
      evidenceValidated: true,
      outcomesMatured: true,
    };
    const both = mergeExperimentAnalytics({ t1: { significance: validated }, t2: { significance: validated } }, null);
    expect(both.significance.evidenceValidated).toBe(true);
    expect(both.significance.method).toBe('beta_binomial_cs');

    const mixed = mergeExperimentAnalytics(
      {
        t1: { significance: validated },
        t2: { significance: { ...validated, method: 'msprt', evidenceValidated: false } },
      },
      null
    );
    expect(mixed.significance.evidenceValidated).toBe(false);
    expect(mixed.significance.method).toBe('msprt');
  });

  it('surfaces one product’s split mismatch across the experiment', () => {
    // A tracking fault on a single SKU is still a reason to distrust the run,
    // so it must not be hidden by the products that look healthy.
    const clean = { sequential: true, significant: true, sampleReady: true, srm: { detected: false } };
    const merged = mergeExperimentAnalytics(
      {
        t1: { significance: clean },
        t2: { significance: { ...clean, srm: { detected: true, pValue: 0.0001 } } },
      },
      null
    );
    expect(merged.significance.srm.detected).toBe(true);
    expect(merged.significance.srm.pValue).toBe(0.0001);
  });

  it('reports an unsettled product as unsettled for the experiment', () => {
    const base = { sequential: true, significant: true, sampleReady: true, evidenceValidated: true };
    const merged = mergeExperimentAnalytics(
      {
        t1: { significance: { ...base, outcomesMatured: true } },
        t2: { significance: { ...base, outcomesMatured: false } },
      },
      null
    );
    expect(merged.significance.outcomesMatured).toBe(false);
  });
});
