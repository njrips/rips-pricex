import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeOfferPdpCutout, resolveOfferPdpDisplayText } from '../offerSelection.js';
import {
  OFFER_PDP_CUTOUT_ATTR,
  OFFER_PDP_HOST_HIDDEN_ATTR,
  OFFER_PDP_HOST_PAINTED_ATTR,
  OFFER_PDP_MESSAGE_ATTR,
  OFFER_PDP_RELATED_SEL,
  OFFER_PDP_STACK_ATTR,
  OFFER_PDP_TEST_ATTR,
  isOfferPdpInjectedNode,
  offerPdpMessageNodeNeedsMove,
  resolveOfferPdpLightHost,
  resolveOfferPdpMessageHost,
} from '../offerPdpMessage.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../');
const storefrontSrc = fs.readFileSync(path.join(repoRoot, 'storefront/storefront-script.js'), 'utf8');

function mockEl(closestMap) {
  return {
    closest(selector) {
      const raw = String(selector || '');
      if (Object.prototype.hasOwnProperty.call(closestMap, raw)) return closestMap[raw];
      const parts = raw.split(',').map(part => part.trim());
      for (const part of parts) {
        if (closestMap[part]) return closestMap[part];
      }
      return null;
    },
  };
}

describe('offer PDP message', () => {
  it('prefers the custom offer message and falls back to the formatted offer', () => {
    assert.equal(
      resolveOfferPdpDisplayText({
        discount_type: 'percent',
        discount_value: 10,
        offer_message: 'Limited-time 10% off',
      }),
      'Limited-time 10% off'
    );
    assert.equal(
      resolveOfferPdpDisplayText({ discount_type: 'percent', discount_value: 10 }),
      '10% off'
    );
    assert.equal(resolveOfferPdpDisplayText({ discount_type: 'percent', discount_value: '' }), '');
    assert.equal(resolveOfferPdpDisplayText({ discount_type: 'percent', discount_value: 120 }), '');
  });

  it('computes the sale cutout from catalog minus the offer', () => {
    assert.deepEqual(computeOfferPdpCutout(20, { discount_type: 'percent', discount_value: 15 }), {
      was: 20,
      now: 17,
    });
    assert.deepEqual(computeOfferPdpCutout(20, { discount_type: 'fixed', discount_value: 5 }), {
      was: 20,
      now: 15,
    });
    assert.equal(computeOfferPdpCutout(20, { discount_type: 'percent', discount_value: '' }), null);
    assert.equal(computeOfferPdpCutout(20, { discount_type: 'percent', discount_value: 0 }), null);
  });

  it('anchors below the outer Dawn price block, not the money leaf', () => {
    const priceBlock = { id: 'price' };
    const leaf = mockEl({
      '.price': priceBlock,
      '.product__price': null,
    });
    assert.equal(resolveOfferPdpMessageHost(leaf), priceBlock);
    const horizonHost = { id: 'horizon' };
    const horizonLeaf = mockEl({
      'product-price': horizonHost,
      '.price': { id: 'inner-price' },
    });
    assert.equal(resolveOfferPdpMessageHost(horizonLeaf), horizonHost);
    const debut = { id: 'product-price' };
    const debutLeaf = mockEl({
      '.price': null,
      '.product__price, .product-price, .product-single__price, [data-price-container], sale-price, .product-form__price':
        debut,
    });
    assert.equal(resolveOfferPdpMessageHost(debutLeaf), debut);
    const bare = mockEl({ '.price': null });
    assert.equal(resolveOfferPdpMessageHost(bare), bare);
    const parent = { id: 'parent' };
    const first = {
      parentNode: parent,
      hasAttribute(name) {
        return name === OFFER_PDP_MESSAGE_ATTR;
      },
      nextElementSibling: null,
    };
    const second = {
      parentNode: parent,
      hasAttribute(name) {
        return name === OFFER_PDP_MESSAGE_ATTR;
      },
      nextElementSibling: null,
    };
    first.nextElementSibling = second;
    priceBlock.parentNode = parent;
    priceBlock.nextElementSibling = first;
    assert.equal(offerPdpMessageNodeNeedsMove(first, priceBlock), false);
    assert.equal(offerPdpMessageNodeNeedsMove(second, priceBlock), false);
    assert.equal(offerPdpMessageNodeNeedsMove({ parentNode: { id: 'other' } }, priceBlock), true);
    assert.equal(offerPdpMessageNodeNeedsMove({ previousElementSibling: null }, priceBlock), true);
    const shadowHost = { id: 'product-price' };
    const shadowLeaf = {
      closest() {
        return null;
      },
      getRootNode() {
        return { host: shadowHost };
      },
    };
    shadowHost.closest = function closest(selector) {
      if (String(selector) === 'product-price') return shadowHost;
      return null;
    };
    assert.equal(resolveOfferPdpLightHost(shadowLeaf), shadowHost);
    const stack = {
      hasAttribute(name) {
        return name === OFFER_PDP_STACK_ATTR;
      },
    };
    assert.equal(isOfferPdpInjectedNode(stack), true);
    assert.equal(isOfferPdpInjectedNode({ hasAttribute: () => false }), false);
  });

  it('keeps storefront paint wired to the same contract', () => {
    assert.match(storefrontSrc, new RegExp(OFFER_PDP_MESSAGE_ATTR.replace(/-/g, '\\-')));
    assert.match(storefrontSrc, new RegExp(OFFER_PDP_TEST_ATTR.replace(/-/g, '\\-')));
    assert.match(storefrontSrc, /function upsertOfferPdpMessage\s*\(/);
    assert.match(storefrontSrc, /function resolveOfferPdpDisplayText\s*\(/);
    assert.match(storefrontSrc, /function resolveOfferPdpMessageHost\s*\(/);
    assert.match(storefrontSrc, /function resolveOfferPdpLightHost\s*\(/);
    assert.match(storefrontSrc, /function computeOfferPdpCutoutPrices\s*\(/);
    assert.match(storefrontSrc, /function paintThemeOfferCutout\s*\(/);
    assert.match(storefrontSrc, /function queryOfferPdpMessageNodes\s*\(/);
    assert.match(storefrontSrc, new RegExp(OFFER_PDP_STACK_ATTR.replace(/-/g, '\\-')));
    assert.match(storefrontSrc, new RegExp(OFFER_PDP_CUTOUT_ATTR.replace(/-/g, '\\-')));
    assert.match(storefrontSrc, new RegExp(OFFER_PDP_HOST_PAINTED_ATTR.replace(/-/g, '\\-')));
    assert.match(storefrontSrc, new RegExp(OFFER_PDP_HOST_HIDDEN_ATTR.replace(/-/g, '\\-')));
    assert.match(storefrontSrc, /function hideOfferPdpControlPrice\s*\(/);
    assert.match(storefrontSrc, /function revealOfferPdpControlPrice\s*\(/);
    assert.match(storefrontSrc, /price--on-sale/);
    assert.match(storefrontSrc, /alreadyOnSale/);
    assert.match(storefrontSrc, /Never add price--on-sale/);
    assert.match(storefrontSrc, /product-info input\[name="product-id"\]/);
    assert.doesNotMatch(storefrontSrc, /document\.querySelector\('input\[name="product-id"\]'\)/);
    assert.match(storefrontSrc, /window\.meta/);
    assert.match(storefrontSrc, /function insertOfferPdpMessageAfterHost\s*\(/);
    assert.match(storefrontSrc, /function installOfferPdpThemeListeners\s*\(/);
    assert.match(storefrontSrc, /function isPrimaryOfferPdpTest\s*\(/);
    assert.match(storefrontSrc, /el\.closest\('product-price'\)/);
    assert.match(storefrontSrc, /\.compare-at-price/);
    assert.match(storefrontSrc, /isPdpProductPath\(\)/);
    assert.match(storefrontSrc, /applyOfferPdpMessageOnAssignedVariant/);
    assert.match(storefrontSrc, /function reapplyRememberedOfferPdpMessages\s*\(/);
    assert.match(storefrontSrc, /_ripxOfferPdpLastApplyByTest/);
    assert.match(storefrontSrc, /querySelectorAllWithShadowRoots\(root, sel\)/);
    assert.match(storefrontSrc, /\.price-item--sale/);
    assert.match(storefrontSrc, /product-recommendations/);
    assert.match(storefrontSrc, /isOfferPdpForeignProductNode/);
    assert.match(storefrontSrc, new RegExp(OFFER_PDP_RELATED_SEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
});
