const { buildCheckoutPriceDiagnostics } = require('../priceCheckoutDiagnostics');

describe('classic checkout diagnostics', () => {
  const envKeys = [
    'NODE_ENV',
    'APP_URL',
    'RIPX_PRICE_RESOLVE_BATCH_URL',
    'RIPX_CHECKOUT_PRICE_SECRET',
    'RIPX_PRICE_ASSIGNMENT_SIGNATURE_SECRET',
    'RIPX_CHECKOUT_REQUIRE_SIGNED_ASSIGNMENT',
    'RIPSPRICEX_CLASSIC_PRICE_TEST_ONLY',
    'RIPX_DIAGNOSTICS_SKIP_EXTENSION_CONFIG',
  ];
  /** @type {Record<string, string | undefined>} */
  let previous = {};

  beforeEach(() => {
    previous = {};
    envKeys.forEach(key => {
      previous[key] = process.env[key];
    });
    process.env.NODE_ENV = 'production';
    process.env.APP_URL = 'https://pricefy.echologyx.com';
    delete process.env.RIPX_PRICE_RESOLVE_BATCH_URL;
    delete process.env.RIPX_CHECKOUT_PRICE_SECRET;
    delete process.env.RIPX_PRICE_ASSIGNMENT_SIGNATURE_SECRET;
    delete process.env.RIPX_CHECKOUT_REQUIRE_SIGNED_ASSIGNMENT;
    delete process.env.RIPSPRICEX_CLASSIC_PRICE_TEST_ONLY;
  });

  afterEach(() => {
    envKeys.forEach(key => {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  });

  it('does not fail Classic ready on missing checkout/assignment secrets', () => {
    const functionId = '01a01dd3-c2c1-72eb-89f3-f541e09f9241';
    const diag = buildCheckoutPriceDiagnostics({
      shopDomain: 'splitter-plus.myshopify.com',
      tenantRegistered: true,
      extensionConfig: { source: 'omit' },
      shopifyFunctions: [
        {
          id: functionId,
          title: 'RipsPriceX cart transform',
          apiType: 'cart_transform',
        },
      ],
      shopifyCartTransforms: [
        { id: 'gid://shopify/CartTransform/135626941', functionId },
      ],
      cartTransformsLookupStatus: 'ok',
    });
    expect(diag.summary.overall_ok).toBe(true);
    const failed = (diag.checklist || []).filter(row => !row.ok).map(row => row.id);
    expect(failed).toEqual([]);
  });
});
