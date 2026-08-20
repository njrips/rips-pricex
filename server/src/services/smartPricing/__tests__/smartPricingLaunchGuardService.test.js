jest.mock('../../../models/test', () => ({
  getTestsByShop: jest.fn(),
}));

const { getTestsByShop } = require('../../../models/test');
const {
  countRunningPriceTests,
  assertCanLaunchPriceTests,
  resolveLaunchCapacity,
} = require('../smartPricingLaunchGuardService');

describe('smartPricingLaunchGuardService', () => {
  beforeEach(() => {
    getTestsByShop.mockReset();
  });

  it('counts running price and offer tests, not other types or preview drafts', async () => {
    getTestsByShop.mockResolvedValue([
      { id: 1, type: 'price', status: 'running' },
      { id: 2, type: 'checkout', status: 'running' },
      { id: 3, type: 'pricing', status: 'running' },
      { id: 4, type: 'offer', status: 'running' },
      {
        id: 5,
        type: 'price',
        status: 'running',
        name: 'Smart Pricing Preview · Liquid',
        metadata: { smart_pricing_experiment_preview: true },
      },
    ]);

    await expect(countRunningPriceTests('demo.myshopify.com')).resolves.toBe(3);
  });

  it('allows launch with no parallel cap even when many tests are running', async () => {
    getTestsByShop.mockResolvedValue(
      Array.from({ length: 21 }, (_, i) => ({ id: i + 1, type: 'price', status: 'running' }))
    );

    await expect(
      assertCanLaunchPriceTests('demo.myshopify.com', { additionalCount: 3 })
    ).resolves.toMatchObject({
      max_parallel: null,
      capacity: { unlimited: true, can_launch: true },
    });
    expect(getTestsByShop).not.toHaveBeenCalled();
  });

  it('previews a full batch as launchable regardless of running count', async () => {
    getTestsByShop.mockResolvedValue([{ id: 1, type: 'price', status: 'running' }]);

    await expect(
      resolveLaunchCapacity('demo.myshopify.com', { requestedCount: 4 })
    ).resolves.toMatchObject({
      running_count: 1,
      max_parallel: null,
      unlimited: true,
      launchable_count: 4,
      blocked_count: 0,
      can_launch_all: true,
      can_launch: true,
      at_capacity: false,
    });
  });
});
