const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

/**
 * /api/shopify/store-resources.
 *
 * The route branched on `type` but only ever implemented `type=collection`.
 * A `type=product` request fell through to the empty tail response, so it
 * answered `{ resources: [] }` with a 200 and no error anywhere. Settings →
 * Price surfaces asks it for a sample product to preview a Pick against, so
 * every product-page row had its Pick button permanently disabled and nothing
 * said why.
 */

const ROUTES = path.join(__dirname, '..', 'shopifySlimRoutes.js');

let calls;
let productResult;
let collectionResult;

function loadRouter() {
  const stubs = {
    '../services/shopifyService': {
      listProducts: async (shop, token, search, first, after) => {
        calls.push({ kind: 'products', shop, token, search, first, after });
        if (productResult instanceof Error) throw productResult;
        return productResult;
      },
      listCollections: async (shop, token, search, first, after) => {
        calls.push({ kind: 'collections', shop, token, search, first, after });
        return collectionResult;
      },
    },
    '../middleware/shopContext': {
      requireShop: (req, _res, next) => {
        req.shopDomain = 'demo.myshopify.com';
        next();
      },
    },
    '../models/shopSession': {
      getShopSession: async () => ({ access_token: 'token-123' }),
    },
  };

  const original = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (stubs[request]) return stubs[request];
    return original.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve(ROUTES)];
    return require(ROUTES);
  } finally {
    Module._load = original;
  }
}

/** Drive the route's handler directly rather than standing up a server. */
async function get(query) {
  const router = loadRouter();
  const layer = router.stack.find(entry => entry.route?.path === '/store-resources');
  assert.ok(layer, 'store-resources route is not registered');
  const handlers = layer.route.stack.map(entry => entry.handle);
  const req = { query, headers: {} };
  let payload = null;
  let status = 200;
  const res = {
    status(code) {
      status = code;
      return this;
    },
    json(body) {
      payload = body;
      return this;
    },
  };
  let failure = null;
  for (const handler of handlers) {
    let advanced = false;
    handler(req, res, err => {
      if (err) failure = err;
      advanced = true;
    });
    // asyncHandler does not return its promise, so there is nothing to await.
    // Settle pending microtasks until the handler answers or calls next.
    for (let tick = 0; tick < 50 && payload === null && !advanced; tick += 1) {
      await new Promise(resolve => setImmediate(resolve));
    }
    if (failure) throw failure;
    if (!advanced) break;
  }
  return { status, payload };
}

beforeEach(() => {
  calls = [];
  productResult = { list: [{ id: 'gid://1', title: 'Tee', handle: 'sample-tee' }], pageInfo: {} };
  collectionResult = [{ id: 'gid://c1', title: 'All', handle: 'all' }];
});

describe('store-resources', () => {
  it('returns products for type=product', async () => {
    const { status, payload } = await get({ type: 'product', first: '5' });
    assert.equal(status, 200);
    assert.deepEqual(
      payload.resources.map(row => row.handle),
      ['sample-tee']
    );
    assert.equal(calls[0].kind, 'products');
  });

  // listProducts pages, so it answers { list, pageInfo }; listCollections
  // answers a bare array. Returning the wrapper object would have given the
  // client a `resources` it could not map over.
  it('unwraps the paged product shape', async () => {
    const { payload } = await get({ type: 'product' });
    assert.ok(Array.isArray(payload.resources), 'resources must be an array');
    assert.equal(payload.resources[0].title, 'Tee');
  });

  it('tolerates a service that returns a bare array instead', async () => {
    productResult = [{ handle: 'plain' }];
    const { payload } = await get({ type: 'product' });
    assert.deepEqual(
      payload.resources.map(row => row.handle),
      ['plain']
    );
  });

  // Callers use this to ask for a product a storefront preview can load; an
  // unpublished one 404s and would open the picker on an error page.
  it('passes a query through to Shopify', async () => {
    await get({ type: 'product', query: 'published_status:published' });
    assert.equal(calls[0].search, 'published_status:published');
  });

  it('passes a query through for collections too', async () => {
    await get({ type: 'collection', query: 'title:Sale' });
    assert.equal(calls[0].kind, 'collections');
    assert.equal(calls[0].search, 'title:Sale');
  });

  it('caps first at 100 and defaults it to 40', async () => {
    await get({ type: 'product', first: '5000' });
    assert.equal(calls[0].first, 100);
    calls = [];
    await get({ type: 'product' });
    assert.equal(calls[0].first, 40);
  });

  it('reports a Shopify failure rather than an empty list', async () => {
    productResult = new Error('throttled');
    const { status, payload } = await get({ type: 'product' });
    assert.equal(status, 502);
    assert.equal(payload.success, false);
    assert.match(payload.error, /throttled/);
  });

  it('still answers empty for a type it does not know', async () => {
    const { status, payload } = await get({ type: 'giftcard' });
    assert.equal(status, 200);
    assert.deepEqual(payload.resources, []);
    assert.equal(calls.length, 0);
  });
});
