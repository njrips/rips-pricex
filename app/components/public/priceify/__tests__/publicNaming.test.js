import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FAQ_ITEMS,
  FEATURES_SECTION,
  FINAL_CTA,
  GET_STARTED_SECTION,
  HERO,
  PLATFORM_SECTION,
  PRICING_SECTION,
  PUBLIC_NAMING_FORBIDDEN,
} from '../landingContent.js';
import { DOCS_FAQ, DOCS_NAV_CARDS, DOCS_SECTIONS } from '../docsContent.js';

const publicRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const routesRoot = join(publicRoot, '..', '..', 'routes');

const PUBLIC_ROUTE_META_FILES = [
  '_public._index.tsx',
  '_public.docs.tsx',
  '_public.docs.settings.tsx',
  '_public.faq.tsx',
  '_public.contact.tsx',
  '_public.privacy.tsx',
  '_public.terms.tsx',
];

const PUBLIC_SOURCE_FILES = [
  join(publicRoot, 'legal/privacyContent.js'),
  join(publicRoot, 'legal/termsContent.js'),
  join(publicRoot, 'priceify/ContactPage.jsx'),
  join(publicRoot, 'priceify/LandingPage.jsx'),
  join(dirname(fileURLToPath(import.meta.url)), '../docsContent.js'),
];

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('public naming (Priceify global principles)', () => {
  it('keeps landing, FAQ, pricing, and CTA copy on "test" vocabulary', () => {
    const blob = [
      HERO.title,
      HERO.lead,
      PLATFORM_SECTION.lead,
      ...PLATFORM_SECTION.steps.map(step => `${step.title} ${step.body}`),
      FEATURES_SECTION.title,
      ...FEATURES_SECTION.items.map(item => `${item.title} ${item.body}`),
      PRICING_SECTION.lead,
      ...PRICING_SECTION.tiers.flatMap(tier => [tier.name, tier.blurb, ...(tier.features || [])]),
      ...FAQ_ITEMS.map(item => `${item.q} ${item.a}`),
      ...GET_STARTED_SECTION.cards.map(card => `${card.title} ${card.body}`),
      FINAL_CTA.lead,
    ].join('\n');
    expect(blob).not.toMatch(PUBLIC_NAMING_FORBIDDEN);
  });

  it('keeps guides content on "test" and "Price locations" vocabulary', () => {
    const blob = [
      ...DOCS_NAV_CARDS.map(card => `${card.title} ${card.body}`),
      ...DOCS_SECTIONS.flatMap(section => [
        section.title,
        section.summary,
        ...(section.paragraphs || []),
        ...(section.facts || []).map(f => `${f.label} ${f.value}`),
      ]),
      ...DOCS_FAQ.map(item => `${item.q} ${item.a}`),
    ].join('\n');
    expect(blob).not.toMatch(PUBLIC_NAMING_FORBIDDEN);
  });

  for (const file of PUBLIC_SOURCE_FILES) {
    it(`avoids legacy experiment/surface labels in ${file.split('/').slice(-2).join('/')}`, () => {
      const source = stripComments(readFileSync(file, 'utf8'));
      expect(source).not.toMatch(PUBLIC_NAMING_FORBIDDEN);
    });
  }

  for (const file of PUBLIC_ROUTE_META_FILES) {
    it(`avoids legacy experiment/surface labels in route meta ${file}`, () => {
      const source = stripComments(readFileSync(join(routesRoot, file), 'utf8'));
      expect(source).not.toMatch(PUBLIC_NAMING_FORBIDDEN);
    });
  }
});
