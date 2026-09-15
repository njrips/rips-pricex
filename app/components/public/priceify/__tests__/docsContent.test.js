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
  DOCS_FINAL_CTA,
  DOCS_NAV_SECTION,
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

describe('Priceify guides content', () => {
  it('exposes the Settings info-icon anchors', () => {
    assert.equal(PUBLIC_ROUTES.docs, '/docs');
    assert.equal(PUBLIC_ROUTES.docsSettings, '/docs/settings');
    assert.equal(DOCS_HERO.eyebrow, 'Guides');
    assert.ok(DOCS_NAV_SECTION.title && DOCS_NAV_SECTION.lead);
    assert.ok(DOCS_FINAL_CTA.titleLine1 && DOCS_FINAL_CTA.lead);
    assert.equal(/\bDocs\b/.test(DOCS_FINAL_CTA.lead), false);
    // Pinned to the group list rather than a hardcoded set of hrefs, so adding
    // a guide group fails here until it also gets a card someone can click.
    assert.deepEqual(
      DOCS_NAV_CARDS.map((card) => card.href).sort(),
      DOCS_GROUPS.map((group) => `#${group.id}`).sort()
    );
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
    // Removing the last section from a group leaves a heading with nothing
    // under it, which reads as a guide that failed to load.
    for (const group of DOCS_GROUPS) {
      assert.ok(
        DOCS_SECTIONS.some((section) => section.group === group.id),
        `empty group #${group.id}`
      );
    }
    const ids = DOCS_SECTIONS.map((section) => section.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate section ids');
    const ai = DOCS_SECTIONS.find((section) => section.id === 'ai-price');
    assert.ok(/hard cap/i.test(ai.paragraphs.join(' ')));
    // The band is signed, so the guide has to say so: a merchant who believes
    // Suggest only raises prices will never try the test their slow sellers
    // most need. The minimum margin is the limit on a cut, so it is named too.
    const aiCopy = ai.paragraphs.join(' ');
    assert.ok(/band is signed/i.test(aiCopy));
    assert.match(aiCopy, /cheaper/i);
    assert.match(aiCopy, /minimum margin/i);
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
      ...DOCS_SECTIONS.map((section) => section.summary || ''),
      ...DOCS_SECTIONS.flatMap((section) =>
        (section.facts || []).map((fact) => `${fact.label} ${fact.value}`)
      ),
      ...DOCS_FAQ.map((item) => `${item.q} ${item.a}`),
    ].join('\n');
    assert.equal(/\bDocs\b/.test(guideCopy), false);
  });

  // A guide nobody can skim is a guide nobody reads: the statistics sections
  // run past 3,500 characters, so the long ones lead with a summary and a facts
  // strip and fold the prose away behind a disclosure.
  it('gives every long section a skimmable summary', () => {
    for (const section of DOCS_SECTIONS) {
      if (section.paragraphs.length < 3) continue;
      assert.ok(
        section.summary,
        `#${section.id} has ${section.paragraphs.length} paragraphs and no summary`
      );
    }
  });

  it('keeps summaries short enough to be worth reading first', () => {
    for (const section of DOCS_SECTIONS) {
      if (!section.summary) continue;
      assert.ok(
        section.summary.length <= 320,
        `#${section.id} summary is ${section.summary.length} chars — too long to skim`
      );
      assert.ok(
        section.summary.length < section.paragraphs.join(' ').length,
        `#${section.id} summary is not shorter than its detail`
      );
    }
  });

  it('only attaches a facts strip to a section that also summarises', () => {
    for (const section of DOCS_SECTIONS) {
      if (!section.facts) continue;
      assert.ok(section.summary, `#${section.id} has facts but no summary`);
      assert.ok(section.facts.length >= 2, `#${section.id} facts strip is too thin`);
      for (const fact of section.facts) {
        assert.ok(fact.label && fact.value, `#${section.id} has an incomplete fact`);
        assert.ok(
          fact.label.length <= 24,
          `#${section.id} fact label "${fact.label}" is too long for the strip`
        );
      }
    }
  });

  // Settings was cut back to confidence level and minimum sample size, but the
  // limits it used to hold are all still enforced at a fixed value. The guides
  // have to keep saying so: a merchant whose band is capped at 15% needs to
  // find the reason, and must not be sent to a Settings field that is gone.
  it('describes the fixed limits without offering them as settings', () => {
    const byId = new Map(DOCS_SECTIONS.map((section) => [section.id, section]));
    const copyOf = (id) => {
      const section = byId.get(id);
      assert.ok(section, `missing #${id}`);
      return [section.summary || '', ...section.paragraphs].join(' ');
    };

    assert.match(copyOf('max-price-change'), /15%/);
    assert.match(copyOf('max-price-change'), /no longer a field in Settings/i);
    assert.match(copyOf('max-price-change'), /Products step/);
    assert.match(copyOf('cost-floor'), /35%/);
    assert.match(copyOf('cost-floor'), /55%/);
    assert.match(copyOf('cost-floor'), /not a field|is a field you edit/i);
    // Target lift and power lost their own section; the sample-size guide is
    // now the only place they are explained, so it has to name both values.
    assert.match(copyOf('min-sample'), /10% target lift/);
    assert.match(copyOf('min-sample'), /80%/);
    assert.equal(DOCS_SECTION_IDS.includes('target-lift'), false);

    // Only these two are editable shop-wide. Anything claiming otherwise sends
    // a merchant to a field that no longer exists.
    const settingsMap = copyOf('how-settings-work');
    assert.match(settingsMap, /confidence level/i);
    assert.match(settingsMap, /minimum sample size/i);
    assert.match(settingsMap, /fixed/i);

    // The revenue guardrail was documented twice, in two groups, with two
    // different accounts of where it is set.
    assert.equal(DOCS_SECTION_IDS.includes('max-revenue-drop'), false);
    const rail = copyOf('guardrail-metrics');
    assert.match(rail, /Audience step/);
    assert.match(rail, /3% to 50%/);
    assert.equal(/shop-wide ceiling above it: a test/.test(rail), true);
  });

  it('does not describe a feature that was removed', () => {
    const everything = [
      ...DOCS_SECTIONS.flatMap((section) => [section.summary || '', ...section.paragraphs]),
      ...DOCS_FAQ.map((item) => `${item.q} ${item.a}`),
      ...DOCS_NAV_CARDS.map((card) => `${card.title} ${card.body}`),
      DOCS_HERO.subtitle,
    ].join('\n');

    for (const gone of [
      /scenario preset/i,
      /conservative, recommended, or aggressive/i,
      /Settings → Installation/i,
      /AI audience/i,
      /Suggest from theme/i,
      /theme pack/i,
      /Generate with AI/i,
    ]) {
      assert.equal(gone.test(everything), false, `guides still describe ${gone}`);
    }

    // Profit per visitor may only be named to explain that it is retired, so a
    // merchant on a legacy experiment can still tell what their goal means.
    const profit = DOCS_SECTIONS.filter((section) =>
      /profit per visitor/i.test([section.summary || '', ...section.paragraphs].join(' '))
    );
    assert.ok(profit.length, 'retired metric needs explaining somewhere');
    for (const section of profit) {
      assert.match(
        [section.summary || '', ...section.paragraphs].join(' '),
        /no longer offered|is not shown|scaled by a constant/i,
        `#${section.id} names profit per visitor without retiring it`
      );
    }
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
