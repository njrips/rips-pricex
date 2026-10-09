const {
  getGlobalHoldoutPercent,
} = require('../experimentationPolicyService');

describe('experimentationPolicyService', () => {
  it('explicitly disables the unconfigured global holdout', async () => {
    await expect(getGlobalHoldoutPercent('demo.myshopify.com')).resolves.toBe(0);
  });
});
