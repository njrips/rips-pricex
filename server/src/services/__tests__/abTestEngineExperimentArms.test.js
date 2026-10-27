jest.mock('../../models/testAssignment', () => ({
  getTestAssignment: jest.fn(),
  getTestAssignmentsBatch: jest.fn(),
  saveTestAssignment: jest.fn(),
}));
jest.mock('../../models/test', () => ({
  getTestById: jest.fn(),
  getTestsByIds: jest.fn(),
  getActiveTestsForStorefront: jest.fn(),
}));
jest.mock('../experimentationPolicyService', () => ({ getGlobalHoldoutPercent: jest.fn() }));
jest.mock('../featureFlagService', () => ({ evaluateFlags: jest.fn() }));

const {
  getTestAssignment,
  getTestAssignmentsBatch,
  saveTestAssignment,
} = require('../../models/testAssignment');
const { getTestById, getTestsByIds, getActiveTestsForStorefront } = require('../../models/test');
const { getGlobalHoldoutPercent } = require('../experimentationPolicyService');
const { evaluateFlags } = require('../featureFlagService');
const engine = require('../abTestEngine');

const SHOP = 'sofa-shop.myshopify.com';
const ARMS = ['Control', 'Variation A', 'Variation B', 'Variation C'];

/** One Smart Pricing test per variant of a product, as a classic experiment launches them. */
function variantTest(id, experimentId = 'exp-1') {
  return {
    id,
    type: 'price',
    status: 'running',
    target_type: 'product',
    segments: {},
    metadata: experimentId ? { experiment_id: experimentId } : {},
    variants: ARMS.map(name => ({ id: `${id}:${name}`, name, allocation: 25, config: {} })),
  };
}

const armOf = response => response.variantName;

beforeEach(() => {
  jest.clearAllMocks();
  getGlobalHoldoutPercent.mockResolvedValue(0);
  evaluateFlags.mockResolvedValue({});
  saveTestAssignment.mockResolvedValue(undefined);
  getTestAssignment.mockResolvedValue(null);
  getTestAssignmentsBatch.mockResolvedValue(new Map());
});

describe('arms across the variants of one experiment', () => {
  const tests = ['t-red', 't-blue', 't-green', 't-grey', 't-black'].map(id => variantTest(id));

  beforeEach(() => {
    getTestsByIds.mockResolvedValue(new Map(tests.map(t => [t.id, t])));
    getActiveTestsForStorefront.mockResolvedValue(tests);
  });

  it('puts a new visitor in the same arm on every variant', async () => {
    for (let i = 0; i < 40; i += 1) {
      const result = await engine.getVariantsBatch(
        tests.map(t => t.id),
        `visitor-${i}`,
        SHOP
      );
      const arms = new Set(Object.values(result).map(armOf));
      expect(arms.size).toBe(1);
    }
  });

  it("lines a visitor's new variants up with the arm they already hold", async () => {
    getTestAssignmentsBatch.mockResolvedValue(
      new Map([['t-red', { variant_id: 't-red:Variation B', variant_name: 'Variation B' }]])
    );
    const result = await engine.getVariantsBatch(
      tests.map(t => t.id),
      'visitor-held',
      SHOP
    );
    Object.values(result).forEach(response => expect(armOf(response)).toBe('Variation B'));
  });

  it('does the same on the single-test path', async () => {
    getTestById.mockResolvedValue(tests[1]);
    getTestAssignmentsBatch.mockResolvedValue(
      new Map([['t-red', { variant_id: 't-red:Variation C', variant_name: 'Variation C' }]])
    );
    const response = await engine.getVariant('t-blue', 'visitor-held', SHOP);
    expect(armOf(response)).toBe('Variation C');
  });

  it('still spreads visitors across every arm', async () => {
    const seen = new Set();
    for (let i = 0; i < 200; i += 1) {
      const result = await engine.getVariantsBatch(['t-red'], `spread-${i}`, SHOP);
      seen.add(armOf(result['t-red']));
    }
    expect(seen).toEqual(new Set(ARMS));
  });
});

describe('tests outside an experiment', () => {
  it('keep their own per-test arm', () => {
    const plain = variantTest('t-plain', null);
    expect(engine._getArmSaltKey(plain)).toBe('t-plain');
    expect(engine._getArmSaltKey(variantTest('t-red'))).toBe('experiment:exp-1');
  });
});
