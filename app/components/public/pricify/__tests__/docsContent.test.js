import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_ROUTES } from '../../../../constants/publicRoutes.js';
import { ADMIN_DOCS_HASHES } from '../../../Settings/settingsGuideLinks.js';
import {
  DOCS_FAQ,
  DOCS_GROUPS,
  DOCS_HERO,
  DOCS_NAV_CARDS,
  DOCS_SECTION_IDS,
  DOCS_SECTIONS,
  getDocsSection,
} from '../docsContent.js';

function collectAdminInfoHashes() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const roots = [
    path.resolve(here, '../../../Settings'),
    path.resolve(here, '../../../SmartPricing/classic'),
  ];
  const hashes = new Set();
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        walk(full);
        continue;
      }
      if (!/\.(jsx|js|tsx)$/.test(entry.name)) continue;
      const src = fs.readFileSync(full, 'utf8');
      for (const match of src.matchAll(/\bhash=["']([a-z0-9-]+)["']/g)) {
        hashes.add(match[1]);
      }
    }
  };
  roots.forEach(walk);
  return [...hashes].sort();
}

describe('Pricify guides content', () => {
  it('exposes the Settings info-icon anchors', () => {
    assert.equal(PUBLIC_ROUTES.docs, '/docs');
    assert.equal(PUBLIC_ROUTES.docsSettings, '/docs/settings');
    assert.equal(DOCS_HERO.eyebrow, 'GUIDES');
    assert.deepEqual(DOCS_NAV_CARDS.map((card) => card.href), [
      '#price-safety',
      '#statistics',
      '#enforced',
      '#ai-pricing',
    ]);
    for (const id of ADMIN_DOCS_HASHES) {
      assert.ok(DOCS_SECTION_IDS.includes(id), `missing #${id}`);
    }
    assert.ok(DOCS_SECTIONS.some((section) => /directional/i.test(section.paragraphs.join(' '))));
    assert.ok(DOCS_SECTIONS.some((section) => /manual winner review/i.test(section.paragraphs.join(' '))));
    // The rollout queue is the only place the app writes live catalog prices in
    // bulk, so the guide has to state what it will and will not do on its own.
    const rolloutQueue = DOCS_SECTIONS.find((section) => section.id === 'rollout-queue');
    assert.ok(rolloutQueue, 'missing rollout-queue section');
    const rolloutCopy = rolloutQueue.paragraphs.join(' ');
    assert.match(rolloutCopy, /one row per product/i);
    assert.match(rolloutCopy, /rest of the experiment keeps running/i);
    assert.match(rolloutCopy, /revenue guardrail stopped is never offered for rollout/i);
    assert.match(rolloutCopy, /only ever mentioned once/i);
    assert.ok(DOCS_FAQ.length >= 3);
    const groupIds = new Set(DOCS_GROUPS.map((group) => group.id));
    for (const section of DOCS_SECTIONS) {
      assert.ok(groupIds.has(section.group), `orphaned #${section.id}`);
    }
    const ids = DOCS_SECTIONS.map((section) => section.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate section ids');
    const ai = DOCS_SECTIONS.find((section) => section.id === 'ai-price');
    assert.ok(/hard cap/i.test(ai.paragraphs.join(' ')));
    assert.ok(/increase/i.test(ai.paragraphs.join(' ')));
    const offers = DOCS_SECTIONS.find((section) => section.id === 'offers');
    assert.ok(/checkout/i.test(offers.paragraphs.join(' ')));
    const sequential = DOCS_SECTIONS.find((section) => section.id === 'sequential');
    assert.ok(/per product/i.test(sequential.paragraphs.join(' ')));
    // The two evidence layers are a safety promise, so the guides have to keep
    // describing both rather than collapsing them into one confidence number.
    assert.ok(/directional/i.test(sequential.paragraphs.join(' ')));
    assert.ok(/exact/i.test(sequential.paragraphs.join(' ')));
    const autoApply = DOCS_SECTIONS.find((section) => section.id === 'auto-apply');
    assert.ok(/never auto-apply/i.test(autoApply.paragraphs.join(' ')));
    assert.ok(/14 days/i.test(autoApply.paragraphs.join(' ')));
    const srm = DOCS_SECTIONS.find((section) => section.id === 'srm');
    assert.ok(/blocks/i.test(srm.paragraphs.join(' ')));
    assert.ok(DOCS_FAQ.some((item) => /every product/i.test(item.q)));
    const rail = DOCS_SECTIONS.find((section) => section.id === 'guardrail-metrics');
    assert.ok(/revenue per visitor/i.test(rail.paragraphs.join(' ')));
    assert.equal(/page load|planning notes/i.test(rail.paragraphs.join(' ')), false);
    assert.ok(
      DOCS_NAV_CARDS.every((card) => groupIds.has(card.href.replace('#', ''))),
      'nav cards must point at a rendered group'
    );
    const guideCopy = [
      ...DOCS_SECTIONS.flatMap((section) => section.paragraphs),
      ...DOCS_FAQ.map((item) => `${item.q} ${item.a}`),
    ].join('\n');
    assert.equal(/\bDocs\b/.test(guideCopy), false);
  });

  it('keeps every Admin info-icon hash wired to a rendered guide', () => {
    const used = collectAdminInfoHashes();
    assert.ok(used.includes('ai-price'));
    assert.ok(used.includes('offers'));
    assert.ok(used.includes('traffic-split'));
    assert.equal(getDocsSection('ai-price')?.id, 'ai-price');
    assert.equal(getDocsSection('#traffic-split')?.id, 'traffic-split');
    assert.equal(getDocsSection('missing'), null);
    assert.deepEqual(used, [...used].sort());
    for (const hash of used) {
      assert.ok(ADMIN_DOCS_HASHES.includes(hash), `ADMIN_DOCS_HASHES missing ${hash}`);
      assert.ok(DOCS_SECTION_IDS.includes(hash), `docs missing #${hash}`);
    }
  });
});
