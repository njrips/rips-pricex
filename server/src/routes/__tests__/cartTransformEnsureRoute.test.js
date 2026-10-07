jest.mock('../../services/shopifyService', () => ({
  requestAdminGraphql: jest.fn(),
}));
jest.mock('../../models/shopSession', () => ({
  getShopSession: jest.fn(async () => ({ access_token: 'shpat_test' })),
}));
jest.mock('../../services/smartPricing/smartPricingCheckoutReadinessService', () => ({
  clearSmartPricingCheckoutReadinessCache: jest.fn(),
}));

const shopifyService = require('../../services/shopifyService');
const router = require('../settingsRoutes');

const FUNCTION = {
  id: '019fe84a-3eca-76fa-9c5a-94b3427b77be',
  handle: 'ripspricex-cart-transform',
  title: 'Priceify cart transform',
  apiType: 'cart_transform',
};

function ensureHandler() {
  const layer = router.stack.find(
    l => l.route?.path === '/cart-transform/ensure' && l.route.methods.post
  );
  return layer.route.stack[0].handle;
}

function callEnsure() {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        resolve(this);
        return this;
      },
    };
    ensureHandler()({ shopDomain: 'shop.myshopify.com', query: {} }, res, err =>
      reject(err || new Error('handler called next without a response'))
    );
  });
}

function answer(query) {
  if (query.includes('shopifyFunctions')) {
    return { data: { shopifyFunctions: { nodes: [FUNCTION] } } };
  }
  if (query.includes('cartTransforms(')) {
    return { data: { cartTransforms: { nodes: [] } } };
  }
  return null;
}

describe('POST /cart-transform/ensure', () => {
  beforeEach(() => shopifyService.requestAdminGraphql.mockReset());

  it('installs by function handle, the only form current Admin API versions accept', async () => {
    shopifyService.requestAdminGraphql.mockImplementation(async (_shop, _token, query, vars) => {
      const known = answer(query);
      if (known) return known;
      if (query.includes('cartTransformCreate(functionHandle')) {
        expect(vars).toEqual({ functionHandle: 'ripspricex-cart-transform' });
        return {
          data: {
            cartTransformCreate: {
              cartTransform: { id: 'gid://shopify/CartTransform/1', functionId: FUNCTION.id },
              userErrors: [],
            },
          },
        };
      }
      throw new Error(`unexpected query: ${query}`);
    });

    const res = await callEnsure();
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, created: true });
    const sent = shopifyService.requestAdminGraphql.mock.calls.map(call => call[2]);
    expect(sent.some(q => q.includes('cartTransformCreate(functionId'))).toBe(false);
  });

  it('falls back to the function id on a version without functionHandle', async () => {
    shopifyService.requestAdminGraphql.mockImplementation(async (_shop, _token, query) => {
      const known = answer(query);
      if (known) return known;
      if (query.includes('cartTransformCreate(functionHandle')) {
        throw new Error("Field 'cartTransformCreate' doesn't accept argument 'functionHandle'");
      }
      if (query.includes('cartTransformCreate(functionId')) {
        return {
          data: {
            cartTransformCreate: {
              cartTransform: { id: 'gid://shopify/CartTransform/2', functionId: FUNCTION.id },
              userErrors: [],
            },
          },
        };
      }
      throw new Error(`unexpected query: ${query}`);
    });

    const res = await callEnsure();
    expect(res.body).toMatchObject({ success: true, created: true });
  });
});
