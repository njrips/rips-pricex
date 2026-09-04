/**
 * Smart Pricing stamps its statistical design, plan id, and arm-to-price map
 * into tests.metadata at launch, and the sequential decision reads the designed
 * baseline back out of it. The column was never in the insert column list or the
 * update allow-list, so every launch dropped it and the decision fell back to
 * guessing a baseline from the pooled rate it was meant to be measured against.
 */

jest.mock('../../utils/database', () => ({
  query: jest.fn(),
}));

jest.mock('../tenant', () => ({
  getTenantByDomain: jest.fn().mockResolvedValue(null),
}));

const { query } = require('../../utils/database');

/**
 * Answers the column probes, then the write, and hands back a freshly loaded
 * model. The presence of each column is probed once per process and cached, so
 * a shared instance would carry the first test's schema into the rest.
 */
function loadModel({ metadata = true, scheduling = false } = {}) {
  query.mockImplementation(async sql => {
    if (sql.includes('information_schema.columns')) {
      const wants = sql.includes("column_name = 'metadata'") ? metadata : scheduling;
      return { rows: wants ? [{ column_name: 'x' }] : [] };
    }
    return { rows: [{ id: 'test-1', goal: '{}', variants: '[]', segments: '{}' }] };
  });
  let model;
  jest.isolateModules(() => {
    model = require('../test');
  });
  return model;
}

function writeCall() {
  return query.mock.calls.find(
    call => typeof call[0] === 'string' && !call[0].includes('information_schema')
  );
}

const launchPayload = {
  shop_domain: 'demo.myshopify.com',
  name: 'Smart Pricing · Hoodie',
  type: 'price',
  variants: [{ id: 'a', name: 'Control' }],
  metadata: {
    smart_pricing_plan_id: 'SP-1',
    statistical_design: { baseline_conversion_rate: 0.021 },
    price_arms: [{ name: 'Control', price: 49 }],
  },
};

describe('tests.metadata persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('writes metadata on create so the designed baseline survives launch', async () => {
    const { createTest } = loadModel({ metadata: true });

    await createTest(launchPayload);

    const [sql, params] = writeCall();
    expect(sql).toContain('metadata');
    const stored = params.find(p => typeof p === 'string' && p.includes('statistical_design'));
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored).statistical_design.baseline_conversion_rate).toBe(0.021);
  });

  it('omits the column on a database that predates it, rather than failing the launch', async () => {
    const { createTest } = loadModel({ metadata: false });

    await createTest(launchPayload);

    const [sql] = writeCall();
    expect(sql).not.toContain('metadata');
  });

  it('leaves metadata out when a caller sends none', async () => {
    const { createTest } = loadModel({ metadata: true });

    await createTest({ ...launchPayload, metadata: undefined });

    expect(writeCall()[0]).not.toContain('metadata');
  });

  // Rebuilding an experiment's arms rewrites variants; the arm-to-price map in
  // metadata has to move with them or analytics reads arms the test no longer has.
  it('accepts metadata on update as jsonb', async () => {
    const { updateTest } = loadModel({ metadata: true });

    await updateTest('test-1', 'demo.myshopify.com', {
      variants: [{ id: 'b', name: 'Control' }],
      metadata: { price_arms: [{ name: 'Control', price: 52 }] },
    });

    const [sql, params] = writeCall();
    expect(sql).toContain('metadata = $');
    expect(sql).toMatch(/metadata = \$\d+::jsonb/);
    const stored = params.find(p => typeof p === 'string' && p.includes('price_arms'));
    expect(JSON.parse(stored).price_arms[0].price).toBe(52);
  });
});
