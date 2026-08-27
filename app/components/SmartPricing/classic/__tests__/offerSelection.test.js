import { describe, expect, it } from 'vitest';
import {
  formatOfferRule,
  formatOfferSummary,
  resolveOfferPdpDisplayText,
  hasAnyTestOfferConfigured,
  offerByArmFromPlanArms,
  isActionableOfferConfig,
  getOfferCheckoutBlockReason,
  isOfferCheckoutReady,
  isOfferExperimentType,
  normalizeOfferConfig,
  slugOfferCodeName,
} from '../offerSelection';
import { getProductsStepContinueState } from '../productsStepReadiness';
import { variationsFromPlanArms } from '../variationsStepHelpers';

describe('offerSelection', () => {
  it('treats percent and fixed values as actionable, rejects empty control-like configs', () => {
    expect(isActionableOfferConfig({ discount_type: 'percent', discount_value: 10 })).toBe(true);
    expect(isActionableOfferConfig({ discount_type: 'fixed', discount_value: 5 })).toBe(true);
    expect(isActionableOfferConfig({ discount_type: 'percent', discount_value: '' })).toBe(false);
    expect(isActionableOfferConfig({ discount_type: 'percent', discount_value: 120 })).toBe(false);
  });

  it('formats offer rules and slugs code names', () => {
    expect(formatOfferRule({ discount_type: 'percent', discount_value: 10 })).toBe('10% off');
    expect(
      resolveOfferPdpDisplayText({
        discount_type: 'percent',
        discount_value: 10,
        offer_message: 'Save 10%',
      })
    ).toBe('Save 10%');
    expect(resolveOfferPdpDisplayText({ discount_type: 'percent', discount_value: 15 })).toBe(
      '15% off'
    );
    expect(
      formatOfferSummary({
        discount_type: 'percent',
        discount_value: 10,
        offer_message: 'Save 10%',
      })
    ).toBe('10% off — Save 10%');
    expect(slugOfferCodeName('Summer sale', 'Variation A')).toMatch(/^[A-Z0-9-]+$/);
    expect(isOfferExperimentType('offer_test')).toBe(true);
    expect(isOfferCheckoutReady(null, { loading: true })).toBe(false);
    expect(
      isOfferCheckoutReady({ live_api_checked: true, discount_function_available: false })
    ).toBe(false);
    expect(
      isOfferCheckoutReady({ live_api_checked: true, discount_function_available: true })
    ).toBe(true);
    expect(
      isOfferCheckoutReady({
        live_api_checked: true,
        discount_function_available: false,
        automatic_discount_available: true,
      })
    ).toBe(true);
    expect(
      isOfferCheckoutReady({ live_api_checked: true, offer_ready: true })
    ).toBe(true);
    expect(
      getOfferCheckoutBlockReason({
        live_api_checked: true,
        discount_function_available: false,
        message: 'Checkout price override path looks configured (live Shopify check).',
      })
    ).toMatch(/checkout discount function/i);
    expect(
      offerByArmFromPlanArms([
        { id: 'control', role: 'control' },
        {
          id: 'var_a',
          role: 'challenger',
          offer: { discount_type: 'percent', discount_value: 12, offer_message: 'Save 12%' },
        },
      ]).var_a
    ).toEqual({
      discount_type: 'percent',
      discount_value: '12',
      offer_message: 'Save 12%',
    });
    expect(normalizeOfferConfig({ discountType: 'fixed', discountValue: 3 }).discount_type).toBe(
      'fixed'
    );
  });

  it('requires a test variation offer before Continue on offer tests', () => {
    const variations = [
      { id: 'control', name: 'Control' },
      { id: 'var_a', name: 'A' },
    ];
    expect(hasAnyTestOfferConfigured({ variations, offerByArm: {} })).toBe(false);
    expect(
      hasAnyTestOfferConfigured({
        variations,
        offerByArm: { var_a: { discount_type: 'percent', discount_value: 15 } },
      })
    ).toBe(true);
    expect(
      getProductsStepContinueState({
        pickMode: 'manual',
        opportunities: [{ variant_id: 'var-1' }],
        selectedIds: ['var-1'],
        variations,
        experimentType: 'offer_test',
        offerByArm: {},
      }).reason
    ).toBe('no_offer');
    expect(
      getProductsStepContinueState({
        pickMode: 'manual',
        opportunities: [{ variant_id: 'var-1' }],
        selectedIds: ['var-1'],
        variations,
        experimentType: 'offer_test',
        offerByArm: { var_a: { discount_type: 'percent', discount_value: 10 } },
      }).disabled
    ).toBe(false);
  });

  it('restores variations and offers from saved plan arms', () => {
    const arms = [
      { id: 'control', role: 'control', label: 'Control', allocation_percent: 40 },
      {
        id: 'var_a',
        role: 'challenger',
        label: 'Variation A',
        allocation_percent: 60,
        offer: { discount_type: 'fixed', discount_value: 5 },
      },
    ];
    const variations = variationsFromPlanArms(arms, 'offer_test');
    expect(variations[0].description).toBe('No offer (baseline)');
    expect(variations[1].traffic).toBe(60);
    expect(offerByArmFromPlanArms(arms).var_a.discount_type).toBe('fixed');
  });
});
