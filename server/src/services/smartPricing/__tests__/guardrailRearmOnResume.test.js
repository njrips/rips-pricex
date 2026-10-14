jest.mock('../../../utils/database', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  initDatabase: jest.fn(),
}));
jest.mock('../../../models/test', () => ({ updateTest: jest.fn(async () => ({})) }));

const { updateTest } = require('../../../models/test');
const { rearmRevenueGuardrailForResume } = require('../smartPricingProductLifecycleService');

describe('rearmRevenueGuardrailForResume', () => {
  beforeEach(() => updateTest.mockClear());

  it('clears a breach and asks for a fresh baseline', async () => {
    await rearmRevenueGuardrailForResume('t1', 'shop', {
      guardrail_config: {
        enabled: true,
        breached_at: '2026-10-01T00:00:00Z',
        observed_drop_percent: 40,
        baseline: { control: { visitors: 1 } },
      },
    });
    const config = updateTest.mock.calls[0][2].guardrail_config;
    expect(config.breached_at).toBeNull();
    expect(config.rebaseline).toBe(true);
    expect(config.baseline).toBeNull();
    expect(config.last_breach_at).toBe('2026-10-01T00:00:00Z');
    expect(config.last_breach_drop_percent).toBe(40);
  });

  it('re-arms a product the breach paused alongside the trigger', async () => {
    await rearmRevenueGuardrailForResume('t2', 'shop', {
      guardrail_config: JSON.stringify({ enabled: true, guardrail_paused_at: '2026-10-01T00:00:00Z' }),
    });
    const config = updateTest.mock.calls[0][2].guardrail_config;
    expect(config.guardrail_paused_at).toBeNull();
    expect(config.rebaseline).toBe(true);
    expect(config).not.toHaveProperty('last_breach_at');
  });

  it('leaves a manually paused test on its running totals', async () => {
    await rearmRevenueGuardrailForResume('t3', 'shop', { guardrail_config: { enabled: true } });
    expect(updateTest).not.toHaveBeenCalled();
  });
});
