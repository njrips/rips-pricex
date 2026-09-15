import { describe, expect, it } from 'vitest';
import {
  DOCS_NAV_CARDS,
  DOCS_SECTIONS,
  searchDocsNavTopics,
  searchDocsSections,
} from '../docsContent.js';

const ids = (query) => searchDocsSections(query).map((section) => section.id);

describe('guide search', () => {
  it('finds nothing for an empty or unmatched query', () => {
    expect(searchDocsSections('')).toEqual([]);
    expect(searchDocsSections('   ')).toEqual([]);
    expect(ids('kombucha')).toEqual([]);
  });

  // Help searched only its own 11 answers before this, so a merchant typing the
  // name of a setting found nothing about it.
  it('finds a setting by the name it carries in Settings', () => {
    expect(ids('confidence level')[0]).toBe('confidence');
    expect(ids('minimum sample size per variation')[0]).toBe('min-sample');
  });

  it('ranks the section named after the term above ones that mention it', () => {
    const found = ids('confidence');
    expect(found[0]).toBe('confidence');
    // Several sections discuss confidence; they should come after, not instead.
    expect(found.length).toBeGreaterThan(1);
  });

  // Word-by-word matching is the point: the field is labelled "Minimum sample
  // size per variation", and no wording of that should come back empty.
  it('matches word by word rather than as one phrase', () => {
    expect(ids('sample size')[0]).toBe('min-sample');
    expect(ids('per-variation sample size')[0]).toBe('min-sample');
    expect(ids('size sample minimum')[0]).toBe('min-sample');
  });

  it('requires every word, so a long phrase does not return everything', () => {
    expect(ids('price').length).toBeGreaterThan(ids('price kombucha').length);
    expect(ids('price kombucha')).toEqual([]);
  });

  it('keeps percentages searchable', () => {
    expect(ids('95%')).toContain('confidence');
  });

  it('returns real sections, so Help can render them', () => {
    for (const section of searchDocsSections('confidence')) {
      expect(DOCS_SECTIONS).toContain(section);
      expect(Array.isArray(section.paragraphs)).toBe(true);
    }
  });
});

describe('guide topic search', () => {
  const topicTitles = (query) => searchDocsNavTopics(query).map((card) => card.title);

  it('finds nav topics by title or group theme', () => {
    expect(topicTitles('price safety')[0]).toBe('Price safety');
    expect(topicTitles('statistics')[0]).toBe('Confidence and sample size');
    expect(topicTitles('offer tests')[0]).toBe('Offer tests');
  });

  it('returns cards that match public guide anchors', () => {
    for (const card of searchDocsNavTopics('AI')) {
      expect(DOCS_NAV_CARDS).toContain(card);
      expect(card.href).toMatch(/^#[a-z0-9-]+$/);
    }
  });

  it('finds nothing for an empty query', () => {
    expect(searchDocsNavTopics('')).toEqual([]);
  });
});
