import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  EXPERIMENT_INTRO,
  EXPERIMENT_POINTS,
  FAQ_ITEMS,
    FEATURE_CARDS,
  HERO_SETUP_MOCK,
    FOOTER_BLURB,
    FOOTER_COLUMNS,
    FOOTER_TAGLINE,
    HOW_IT_WORKS_STEPS,
  PROBLEM_CARDS,
    LANDING_SECTION_ORDER,
  PUBLIC_COPY_FORBIDDEN,
  RESULTS_BOARD,
  USE_CASES,
  WALKTHROUGH_EYEBROW,
  WALKTHROUGH_MOCKS,
  WALKTHROUGH_STEPS,
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

describe('Priceify FAQ copy', () => {
  it('uses the seven Figma questions', () => {
    assert.deepEqual(
      FAQ_ITEMS.map((item) => item.q),
      [
        'Is Priceify really free?',
        'Do I need coding experience?',
        'Can I choose which products to test?',
        'Can I control how much traffic sees each price?',
        'What metrics can I measure?',
        'Can I stop an experiment?',
        'Does Priceify work with my Shopify store?',
      ]
    );
    assert.match(FAQ_ITEMS[0].a, /free to install/);
    assert.match(FAQ_ITEMS[0].a, /no paid tier/);
    assert.match(FAQ_ITEMS[1].a, /theme app embed/);
    assert.match(FAQ_ITEMS[6].a, /Shopify-native/);
  });

  it('keeps the finalized section titles and drops old marketing claims', () => {
    assert.deepEqual(
      HOW_IT_WORKS_STEPS.map((step) => step.title),
      ['Choose your products', 'Create price variations', 'Split your traffic', 'Measure the results']
    );
    assert.deepEqual(
      FEATURE_CARDS.map((card) => card.title),
      ['Data-driven decisions', 'Controlled experimentation', 'Meaningful metrics', 'Free to use']
    );
    assert.deepEqual(
      EXPERIMENT_POINTS.map((point) => point.title),
      ['Control vs. variation', 'Traffic allocation', 'Performance comparison', 'Guardrail metrics']
    );
    assert.match(PROBLEM_CARDS[0].body, /everyone at once/);
    assert.match(PROBLEM_CARDS[1].body, /not what you assume they will/);
    assert.match(PROBLEM_CARDS[2].body, /industry benchmarks/);
    assert.match(FEATURE_CARDS[0].body, /rather than relying on assumptions/);
    assert.match(FEATURE_CARDS[1].body, /Keep your existing price/);
    assert.match(FEATURE_CARDS[2].body, /surface-level click data/);
    assert.match(FEATURE_CARDS[3].body, /Shopify App Store/);
    assert.match(HOW_IT_WORKS_STEPS[1].body, /alternative prices to test/);
    assert.match(HOW_IT_WORKS_STEPS[2].body, /during the experiment/);
    assert.match(WALKTHROUGH_STEPS[1].body, /which products are included/);
    assert.match(WALKTHROUGH_STEPS[2].body, /how each price point behaved/);
    assert.match(USE_CASES[0].body, /permanent for your entire store/);
    assert.match(USE_CASES[1].body, /specific products and audience/);
    assert.match(USE_CASES[2].body, /new product or variant/);
    assert.match(USE_CASES[3].body, /meaningful business impact/);
    assert.deepEqual(
      USE_CASES.map((card) => card.title),
      [
        'Test a price increase',
        'Find a stronger price point',
        'Validate a new product price',
        'Optimize high-value products',
      ]
    );
    assert.deepEqual(
      PUBLIC_HEADER_NAV.map((item) => item.label),
      ['How it works', 'Features', 'FAQ', 'Guides']
    );
    assert.equal(WALKTHROUGH_EYEBROW, 'Build your experiment');
    assert.match(WALKTHROUGH_STEPS[0].body, /timeframe/);
    assert.match(FOOTER_BLURB, /Pricing experimentation for Shopify merchants/);
    assert.equal(FOOTER_TAGLINE, 'Built for Shopify merchants.');
    assert.deepEqual(
      FOOTER_COLUMNS.map((column) => column.heading),
      ['Product', 'Legal', 'Support']
    );
    assert.deepEqual(
      FOOTER_COLUMNS.map((column) => column.links.map((link) => link.label)),
      [
        ['How it works', 'Features', 'FAQ', 'Guides'],
        ['Privacy Policy', 'Terms of Service'],
        ['Contact', 'Staff login', 'Install on Shopify'],
      ]
    );
    assert.equal(PUBLIC_ROUTES.docs, '/docs');
    assert.equal(PUBLIC_ROUTES.docsSettings, '/docs/settings');
    assert.equal(PUBLIC_ROUTES.staff, '/staff/login');
    assert.equal(
      FOOTER_COLUMNS.find((column) => column.heading === 'Support')?.links.find((link) => link.label === 'Staff login')
        ?.to,
      '/staff/login'
    );
    assert.equal(PUBLIC_ROUTES.login, '/auth/login');
    const shellSrc = fs.readFileSync(new URL('../PriceifyShell.jsx', import.meta.url), 'utf8');
    assert.match(shellSrc, /reloadDocument=\{staffPath/);
    assert.doesNotMatch(shellSrc, />\s*Log in\s*</);
    assert.deepEqual(LANDING_SECTION_ORDER, [
      'hero',
      'problem',
      'how-it-works',
      'walkthrough',
      'benefits',
      'experiment-safely',
      'results',
      'use-cases',
      'faq',
      'cta',
    ]);
    assert.equal(RESULTS_BOARD.variation.lift, '+61%');
    assert.equal(RESULTS_BOARD.variation.conv, '4.4%');
    assert.equal(RESULTS_BOARD.variation.rev, '$3.04');
    assert.match(RESULTS_BOARD.insight, /\$69\.00 price point/);
    assert.equal(WALKTHROUGH_MOCKS.hypothesis.next, 'Next: Add Products');
    assert.equal(WALKTHROUGH_MOCKS.hypothesis.name, 'Summer Collection Price Test');
    assert.equal(WALKTHROUGH_MOCKS.variations.product, 'Wool Blend Hoodie');
    assert.equal(HERO_SETUP_MOCK.title, 'Summer Hoodie Price Test');
    assert.equal(HERO_SETUP_MOCK.status, 'Running');
    assert.equal(HERO_SETUP_MOCK.meta, 'Started Aug 12 · 1,020 visitors · 7 days left');
    assert.deepEqual(HERO_SETUP_MOCK.nav, ['Experiments', 'Analytics', 'Settings']);
    assert.equal(HERO_SETUP_MOCK.control.price, '$59.00');
    assert.equal(HERO_SETUP_MOCK.control.share, '50%');
    assert.equal(HERO_SETUP_MOCK.variation.price, '$69.00');
    assert.equal(HERO_SETUP_MOCK.progress, '62%');
    assert.match(EXPERIMENT_INTRO, /With controlled traffic/);
    assert.match(EXPERIMENT_POINTS[0].body, /real customers/);
    const publicCopy = [
      ...FAQ_ITEMS.map((item) => `${item.q} ${item.a}`),
      ...FEATURE_CARDS.map((card) => `${card.title} ${card.body}`),
      ...HOW_IT_WORKS_STEPS.map((step) => `${step.title} ${step.body}`),
      ...PROBLEM_CARDS.map((card) => `${card.title} ${card.body}`),
      ...EXPERIMENT_POINTS.map((point) => `${point.title} ${point.body}`),
      ...USE_CASES.map((card) => `${card.title} ${card.body}`),
    ].join('\n');
    assert.equal(PUBLIC_COPY_FORBIDDEN.test(publicCopy), false);
  });

  it('exposes FAQPage JSON-LD for crawlers', () => {
    const data = buildFaqJsonLd();
    assert.equal(data['@type'], 'FAQPage');
    assert.equal(data.mainEntity.length, 7);
    assert.equal(data.mainEntity[0]['@type'], 'Question');
    assert.equal(data.mainEntity[0].acceptedAnswer['@type'], 'Answer');
    assert.match(data.mainEntity[0].acceptedAnswer.text, /free to install/);
  });
});

describe('publicSectionHref', () => {
  it('parses Figma nav hashes and stays on-page on home', () => {
    assert.equal(parsePublicSectionId('/#how-it-works'), 'how-it-works');
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
