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

  it('counts running price and offer tests, not other types', async () => {
    getTestsByShop.mockResolvedValue([
      { id: 1, type: 'price', status: 'running' },
      { id: 2, type: 'checkout', status: 'running' },
      { id: 3, type: 'pricing', status: 'running' },
      { id: 4, type: 'offer', status: 'running' },
    ]);

    await expect(countRunningPriceTests('demo.myshopify.com')).resolves.toBe(3);
  });

  it('allows launch when under parallel limit', async () => {
    getTestsByShop.mockResolvedValue([{ id: 1, type: 'price', status: 'running' }]);

    await expect(
      assertCanLaunchPriceTests('demo.myshopify.com', { additionalCount: 1, maxParallel: 5 })
    ).resolves.toMatchObject({ running_count: 1, max_parallel: 5 });
  });

  it('blocks launch when parallel limit would be exceeded', async () => {
    getTestsByShop.mockResolvedValue([
      { id: 1, type: 'price', status: 'running' },
      { id: 2, type: 'price', status: 'running' },
    ]);

    await expect(
      assertCanLaunchPriceTests('demo.myshopify.com', { additionalCount: 1, maxParallel: 2 })
    ).rejects.toMatchObject({
      isValidation: true,
      running_count: 2,
      max_parallel: 2,
    });
  });

  it('previews how many plans can launch in a batch', async () => {
    getTestsByShop.mockResolvedValue([{ id: 1, type: 'price', status: 'running' }]);

    await expect(
      resolveLaunchCapacity('demo.myshopify.com', { requestedCount: 4, maxParallel: 5 })
    ).resolves.toMatchObject({
      running_count: 1,
      max_parallel: 5,
      available_slots: 4,
      launchable_count: 4,
      blocked_count: 0,
      can_launch_all: true,
    });
  });

  it('reports blocked plans when batch exceeds available slots', async () => {
    getTestsByShop.mockResolvedValue([
      { id: 1, type: 'price', status: 'running' },
      { id: 2, type: 'price', status: 'running' },
    ]);

    await expect(
      resolveLaunchCapacity('demo.myshopify.com', { requestedCount: 3, maxParallel: 3 })
    ).resolves.toMatchObject({
      available_slots: 1,
      launchable_count: 1,
      blocked_count: 2,
      can_launch_all: false,
    });
  });
});
