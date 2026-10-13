import { describe, expect, it } from 'vitest';
import { groupPlansIntoExperiments, wizardDraftAsExperimentRow } from '../classicExperimentHelpers';
import { classicExperimentMatchesQuery, classicSearchTerms } from '../classicExperimentSearch';

const meta = {
  experiment_id: 'exp-1',
  experiment_title: 'Holiday pricing',
  hypothesis: 'A lower price lifts conversion on winter gear',
};
const [experiment] = groupPlansIntoExperiments([
  {
    id: 'SP-1',
    test_id: 'test-aaa',
    status: 'running',
    title: 'Holiday pricing · Hydrogen Snowboard',
    product_title: 'Hydrogen Snowboard',
    product_id: 'gid://shopify/Product/15544111857737',
    variant_id: 'gid://shopify/ProductVariant/55699112624201',
    variant_title: 'Large',
    metadata: meta,
  },
  {
    id: 'SP-2',
    test_id: 'test-bbb',
    status: 'completed',
    title: 'Holiday pricing · Wax Kit',
    product_title: 'Wax Kit',
    metadata: meta,
  },
]);

const matches = query => classicExperimentMatchesQuery(experiment, query);

describe('classicExperimentMatchesQuery', () => {
  it('matches every test when the search is empty', () => {
    expect(matches('')).toBe(true);
    expect(matches('   ')).toBe(true);
  });

  it('finds a test by its name, case-insensitively', () => {
    expect(matches('HOLIDAY')).toBe(true);
  });

  it('finds a test by its hypothesis', () => {
    expect(matches('winter gear')).toBe(true);
  });

  it('finds a test by any of its products or variants', () => {
    expect(matches('wax kit')).toBe(true);
    expect(matches('hydrogen')).toBe(true);
    expect(matches('large')).toBe(true);
  });

  it('finds a test by product number, test ID, type or status', () => {
    expect(matches('15544111857737')).toBe(true);
    expect(matches('test-bbb')).toBe(true);
    expect(matches('price test')).toBe(true);
    expect(matches('running')).toBe(true);
  });

  it('needs every word, in any order and across fields', () => {
    expect(matches('snowboard holiday')).toBe(true);
    expect(matches('snowboard sunglasses')).toBe(false);
  });

  it('keeps the whole experiment when one product matches', () => {
    // Filtering plans first used to drop Wax Kit and report the subset's status.
    expect(experiment.plans).toHaveLength(2);
    expect(experiment.status).toBe('running');
  });

  it('finds an unfinished draft by name or hypothesis', () => {
    const draft = wizardDraftAsExperimentRow({
      experiment_id: 'draft-1',
      name: 'Spring offer',
      hypothesis: 'Free shipping beats a discount',
    });
    expect(classicExperimentMatchesQuery(draft, 'spring')).toBe(true);
    expect(classicExperimentMatchesQuery(draft, 'free shipping')).toBe(true);
    expect(classicExperimentMatchesQuery(draft, 'draft')).toBe(true);
    expect(classicExperimentMatchesQuery(draft, 'snowboard')).toBe(false);
  });

  it('splits the query into words', () => {
    expect(classicSearchTerms('  Wax   KIT ')).toEqual(['wax', 'kit']);
  });
});
