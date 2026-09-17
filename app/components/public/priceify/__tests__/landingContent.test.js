import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  FAQ_ITEMS,
  FEATURES_SECTION,
  FOOTER_BRAND_TAGLINE,
  FOOTER_COPYRIGHT,
  FOOTER_LINK_SECTIONS,
  FOOTER_NEWSLETTER,
  GET_STARTED_SECTION,
  HERO,
  LANDING_ASSETS,
  LANDING_SECTION_ORDER,
  PLATFORM_SECTION,
  PRICING_SECTION,
  PUBLIC_COPY_FORBIDDEN,
  PUBLIC_NAMING_FORBIDDEN,
  buildFaqJsonLd,
} from '../landingContent.js';
import { PUBLIC_HEADER_NAV, PUBLIC_ROUTES } from '../../../../constants/publicRoutes.js';
import { publicErrorTitle } from '../../publicMeta.js';
import {
  FALLBACK_HEADER_OFFSET,
  headerOffset,
  parsePublicSectionId,
  publicSectionHref,
} from '../scrollToPublicHash.js';

describe('Priceify landing copy (Figma brochure)', () => {
  it('matches hero, nav, sections, and FAQ from the updated design', () => {
    assert.equal(HERO.badge, 'A/B PRICE TESTING FOR SHOPIFY');
    assert.match(HERO.title, /Growth Test/);
    assert.equal(HERO.primaryCta, 'Add to Shopify');
    assert.equal(FAQ_ITEMS.length, 6);
    assert.match(FAQ_ITEMS[0].q, /slow down/);
    assert.match(FAQ_ITEMS[2].a, /Theme connection/);
    assert.match(FAQ_ITEMS[2].a, /Store setup/);
    assert.deepEqual(
      PUBLIC_HEADER_NAV.map(item => item.label),
      ['Features', 'How it works', 'Pricing', 'Guides', 'FAQ']
    );
    assert.deepEqual(LANDING_SECTION_ORDER, [
      'hero',
      'logo-cloud',
      'price-test-demo',
      'platform',
      'features',
      'pricing',
      'faq',
      'get-started',
      'final-cta',
    ]);
    assert.equal(GET_STARTED_SECTION.cards.length, 3);
    assert.equal(GET_STARTED_SECTION.cards[1].title, 'Discover Resources');
    assert.equal(FEATURES_SECTION.items.length, 6);
    assert.equal(PRICING_SECTION.tiers.length, 3);
    assert.equal(PRICING_SECTION.tiers[1].badge, 'MOST POPULAR');
    assert.equal(PRICING_SECTION.tiers[2].features[0], 'Everything in Growth');
    assert.equal(PRICING_SECTION.seeAllPlansLabel, 'See All Plans');
    assert.deepEqual(
      PLATFORM_SECTION.steps.map(step => step.title),
      ['Choose products', 'Split traffic', 'Create price variations', 'Measure the results']
    );
    assert.equal(FOOTER_BRAND_TAGLINE, 'Test Your Way to Better Pricing.');
    assert.equal(FOOTER_NEWSLETTER.title, 'Join our newsletter');
    assert.equal(FOOTER_COPYRIGHT, 'Copyright © Priceify. All rights reserved.');
    assert.deepEqual(
      FOOTER_LINK_SECTIONS.map(section => section.heading),
      ['Product', 'Integrations', 'Resources', 'Company']
    );
    assert.deepEqual(
      FOOTER_LINK_SECTIONS.find(section => section.heading === 'Resources').links.map(
        link => link.label,
      ),
      ['FAQ', 'Blog'],
    );
    assert.deepEqual(
      FOOTER_LINK_SECTIONS.find(section => section.heading === 'Company').links.map(
        link => link.label,
      ),
      ['About Us', 'Contact Us', 'Privacy Policy', 'Terms and Conditions', 'Cookies Policy'],
    );
    assert.equal(PUBLIC_ROUTES.staff, '/staff/login');
    const shellSrc = fs.readFileSync(new URL('../PriceifyShell.jsx', import.meta.url), 'utf8');
    assert.match(shellSrc, /PriceifyFooter/);
    assert.match(shellSrc, /Login/);
    assert.match(shellSrc, /PUBLIC_ROUTES\.staff/);
    const landingSrc = fs.readFileSync(new URL('../LandingPage.jsx', import.meta.url), 'utf8');
    assert.match(landingSrc, /LANDING_ASSETS\.heroDashboard/);
    assert.match(landingSrc, /px-get-started-card/);
    assert.match(landingSrc, /px-get-started-inner/);
    assert.match(landingSrc, /px-final-cta--brochure/);
    assert.match(landingSrc, /FeatureBoard/);
    assert.match(landingSrc, /px-section--pricing-brochure/);
    for (const item of FEATURES_SECTION.items) {
      assert.ok(item.iconSrc, item.title);
      assert.ok(fs.existsSync(new URL(`../../../../../public${item.iconSrc}`, import.meta.url).pathname));
    }
    assert.equal(LANDING_ASSETS.logoMarquee, '/priceify/landing/logo-marquee.png');
    const faviconSrc = fs.readFileSync(
      new URL('../../../../../public/priceify/favicon.svg', import.meta.url),
      'utf8',
    );
    assert.doesNotMatch(faviconSrc, /<svg[^>]*>[\s\S]*<svg/);
    const rootSrc = fs.readFileSync(new URL('../../../../root.tsx', import.meta.url), 'utf8');
    assert.match(rootSrc, /FAVICON_VERSION/);
    assert.match(rootSrc, /apple-touch-icon/);

    const publicCopy = [
      HERO.title,
      HERO.lead,
      ...FAQ_ITEMS.map(item => `${item.q} ${item.a}`),
      ...FEATURES_SECTION.items.map(item => `${item.title} ${item.body}`),
      ...PLATFORM_SECTION.steps.map(step => `${step.title} ${step.body}`),
      ...PRICING_SECTION.tiers.map(tier => `${tier.name} ${tier.blurb}`),
    ].join('\n');
    assert.equal(PUBLIC_COPY_FORBIDDEN.test(publicCopy), false);
    assert.equal(PUBLIC_NAMING_FORBIDDEN.test(publicCopy), false);
  });

  it('exposes FAQPage JSON-LD for crawlers', () => {
    const data = buildFaqJsonLd();
    assert.equal(data['@type'], 'FAQPage');
    assert.equal(data.mainEntity.length, 6);
    assert.equal(data.mainEntity[0]['@type'], 'Question');
    assert.match(data.mainEntity[0].acceptedAnswer.text, /guardrail/);
  });
});

describe('publicSectionHref', () => {
  it('parses Figma nav hashes and stays on-page on home', () => {
    assert.equal(parsePublicSectionId('/#how-it-works'), 'how-it-works');
    assert.equal(parsePublicSectionId('/#pricing'), 'pricing');
    assert.equal(parsePublicSectionId('#faq'), 'faq');
    assert.equal(parsePublicSectionId(''), '');
    assert.equal(publicSectionHref('faq', '/'), '#faq');
    assert.equal(publicSectionHref('#features', '/privacy'), '/#features');
    assert.equal(publicSectionHref('', '/'), '/');
    assert.equal(publicSectionHref('cta', '/contact'), '/#cta');
  });
});

describe('publicErrorTitle', () => {
  it('titles public error chrome', () => {
    assert.equal(publicErrorTitle(true), 'Page not found — Priceify');
    assert.equal(publicErrorTitle(false), 'Something went wrong — Priceify');
  });
});

describe('headerOffset', () => {
  it('ignores the expanded mobile drawer height', () => {
    const previous = globalThis.document;
    globalThis.document = {
      querySelector(selector) {
        if (selector !== '.px-header') return null;
        return {
          querySelector: () => ({ classList: { contains: (name) => name === 'is-open' } }),
          getBoundingClientRect: () => ({ height: 420 }),
        };
      },
    };
    try {
      assert.equal(headerOffset(), FALLBACK_HEADER_OFFSET);
    } finally {
      if (previous === undefined) delete globalThis.document;
      else globalThis.document = previous;
    }
  });
});
