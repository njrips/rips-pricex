/**
 * Attach the Classic offer-test Discount Function as a Shopify automatic app discount.
 * A deployed function does nothing until this binding exists.
 */

const DEFAULT_DISCOUNT_TITLE = 'RipsPriceX Offer Checkout Function';
const DEFAULT_DISCOUNT_CLASSES = ['PRODUCT'];
const CHECKOUT_DISCOUNT_FUNCTION_HANDLE = 'ripspricex-checkout-discount';
const ENSURE_TIMEOUT_MS = 20000;
const ENSURE_RESULT_TTL_MS = 60 * 1000;
const recentEnsureByShop = new Map();

function shopKey(shopDomain) {
  return String(shopDomain || '')
    .trim()
    .toLowerCase();
}

function peekRecentEnsure(shopDomain) {
  const key = shopKey(shopDomain);
  const entry = recentEnsureByShop.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    recentEnsureByShop.delete(key);
    return null;
  }
  return entry.result;
}

function rememberEnsure(shopDomain, result) {
  const key = shopKey(shopDomain);
  if (!key || !result) return;
  recentEnsureByShop.set(key, {
    result,
    expiresAt: Date.now() + ENSURE_RESULT_TTL_MS,
  });
}

function getShopifyService() {
  return require('../shopifyService');
}

function normalizeShopifyIdentifier(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const tail = raw.includes('/') ? raw.split('/').filter(Boolean).pop() : raw;
  return String(tail || '')
    .trim()
    .toLowerCase();
}

function discountRecordId(discount) {
  return String(discount?.discountId || discount?.id || '').trim();
}

function pickCheckoutDiscountFunction(functionsList = []) {
  if (!Array.isArray(functionsList) || functionsList.length === 0) {
    return null;
  }
  const normalized = functionsList.filter(Boolean);
  const byHandle = normalized.find(
    fn => normalizeShopifyIdentifier(fn?.handle) === CHECKOUT_DISCOUNT_FUNCTION_HANDLE
  );
  if (byHandle) return byHandle;
  const looksLikeDiscount = fn => {
    const api = String(fn?.apiType || '')
      .trim()
      .toLowerCase();
    const title = String(fn?.title || '')
      .trim()
      .toLowerCase();
    if (api.includes('cart_transform') || title.includes('cart transform')) return false;
    return api.includes('discount') || title.includes('discount') || title.includes('checkout');
  };
  const discountFns = normalized.filter(looksLikeDiscount);
  const preferred = discountFns.find(fn => {
    const title = String(fn?.title || '')
      .trim()
      .toLowerCase();
    return (
      title.includes('ripspricex') ||
      title.includes('rips price') ||
      title.includes('ripx')
    );
  });
  if (preferred) return preferred;
  return discountFns[0] || null;
}

function identifiersOfDiscount(discount) {
  return [
    discount?.appDiscountType?.functionId,
    discount?.appDiscountType?.functionHandle,
    discount?.functionId,
    discount?.functionHandle,
  ]
    .map(value => String(value || '').trim())
    .filter(Boolean);
}

function matchDiscountsToFunction(discounts = [], ...needles) {
  const ids = new Set(
    needles
      .flat()
      .map(normalizeShopifyIdentifier)
      .filter(Boolean)
  );
  if (!ids.size) return [];
  return (Array.isArray(discounts) ? discounts : []).filter(discount =>
    identifiersOfDiscount(discount).some(id => ids.has(normalizeShopifyIdentifier(id)))
  );
}

function findDiscountByTitle(discounts = [], title = DEFAULT_DISCOUNT_TITLE) {
  const needle = String(title || '')
    .trim()
    .toLowerCase();
  if (!needle) return null;
  return (Array.isArray(discounts) ? discounts : []).find(
    discount =>
      String(discount?.title || '')
        .trim()
        .toLowerCase() === needle
  );
}

function isAlreadyAttachedError(errors = []) {
  return (Array.isArray(errors) ? errors : []).some(err => {
    const message = String(err?.message || '')
      .trim()
      .toLowerCase();
    return (
      message.includes('already') ||
      message.includes('in use') ||
      message.includes('taken') ||
      message.includes('duplicate')
    );
  });
}

async function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error(message);
          err.code = 'TIMEOUT';
          reject(err);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchShopifyFunctions(shopDomain, accessToken) {
  const queryWithHandle = `
    query rpxOfferCheckoutShopifyFunctions {
      shopifyFunctions(first: 50) {
        nodes {
          id
          handle
          title
          apiType
        }
      }
    }
  `;
  const queryWithoutHandle = `
    query rpxOfferCheckoutShopifyFunctions {
      shopifyFunctions(first: 50) {
        nodes {
          id
          title
          apiType
        }
      }
    }
  `;
  try {
    const response = await getShopifyService().requestAdminGraphql(
      shopDomain,
      accessToken,
      queryWithHandle
    );
    return response?.data?.shopifyFunctions?.nodes || [];
  } catch (err) {
    if (!/handle/i.test(String(err?.message || ''))) {
      throw err;
    }
    const response = await getShopifyService().requestAdminGraphql(
      shopDomain,
      accessToken,
      queryWithoutHandle
    );
    return response?.data?.shopifyFunctions?.nodes || [];
  }
}

async function fetchAutomaticAppDiscounts(shopDomain, accessToken) {
  const queryWithHandle = `
    query rpxOfferAutomaticAppDiscounts {
      discountNodes(first: 100) {
        nodes {
          discount {
            ... on DiscountAutomaticApp {
              discountId
              title
              status
              discountClasses
              appDiscountType {
                functionId
                functionHandle
              }
            }
          }
        }
      }
    }
  `;
  const queryWithoutHandle = `
    query rpxOfferAutomaticAppDiscounts {
      discountNodes(first: 100) {
        nodes {
          discount {
            ... on DiscountAutomaticApp {
              discountId
              title
              status
              discountClasses
              appDiscountType {
                functionId
              }
            }
          }
        }
      }
    }
  `;
  let response;
  try {
    response = await getShopifyService().requestAdminGraphql(
      shopDomain,
      accessToken,
      queryWithHandle
    );
  } catch (err) {
    if (!/functionhandle/i.test(String(err?.message || ''))) {
      throw err;
    }
    response = await getShopifyService().requestAdminGraphql(
      shopDomain,
      accessToken,
      queryWithoutHandle
    );
  }
  const nodes = response?.data?.discountNodes?.nodes || [];
  return nodes.map(node => node?.discount).filter(Boolean);
}

function isDiscountScopeError(error) {
  const message = String(error?.message || '')
    .trim()
    .toLowerCase();
  return (
    message.includes('read_discounts') ||
    message.includes('write_discounts') ||
    message.includes('access denied for discount')
  );
}

async function getOfferCheckoutDiscountStatus({
  shopDomain,
  accessToken,
  functionNodes = null,
} = {}) {
  if (!shopDomain || !accessToken) {
    return {
      function: null,
      discount: null,
      function_available: false,
      automatic_discount_available: false,
      lookup_status: 'not_checked',
    };
  }

  let resolvedFunctions = Array.isArray(functionNodes) ? functionNodes : null;
  try {
    if (!resolvedFunctions) {
      resolvedFunctions = await fetchShopifyFunctions(shopDomain, accessToken);
    }
  } catch (err) {
    return {
      function: null,
      discount: null,
      function_available: false,
      automatic_discount_available: false,
      lookup_status: 'error',
      error: err?.message || String(err),
    };
  }

  const chosenFunction = pickCheckoutDiscountFunction(resolvedFunctions);
  let discounts = [];
  let lookupStatus = 'ok';
  let lookupError = null;
  try {
    discounts = await fetchAutomaticAppDiscounts(shopDomain, accessToken);
  } catch (err) {
    discounts = [];
    lookupStatus = isDiscountScopeError(err) ? 'scope_missing' : 'error';
    lookupError = err?.message || String(err);
  }

  let matched = matchDiscountsToFunction(
    discounts,
    chosenFunction?.id,
    chosenFunction?.handle,
    CHECKOUT_DISCOUNT_FUNCTION_HANDLE
  );
  if (!matched.length) {
    const titled = findDiscountByTitle(discounts, DEFAULT_DISCOUNT_TITLE);
    if (titled) matched = [titled];
  }
  return {
    function: chosenFunction
      ? {
          id: chosenFunction.id,
          handle: chosenFunction.handle || CHECKOUT_DISCOUNT_FUNCTION_HANDLE,
          title: chosenFunction.title || null,
          apiType: chosenFunction.apiType || null,
        }
      : null,
    discount: matched[0] || null,
    matched_count: matched.length,
    function_available: Boolean(chosenFunction?.id),
    automatic_discount_available: matched.length > 0,
    lookup_status: lookupStatus,
    error: lookupError,
  };
}

async function createAutomaticAppDiscount({
  shopDomain,
  accessToken,
  functionId,
  functionHandle,
  title,
  discountClasses = DEFAULT_DISCOUNT_CLASSES,
}) {
  const mutation = `
    mutation rpxCreateAutomaticAppDiscount($automaticAppDiscount: DiscountAutomaticAppInput!) {
      discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
        automaticAppDiscount {
          discountId
          title
          status
        }
        userErrors {
          field
          message
          code
        }
      }
    }
  `;
  const startsAt = new Date().toISOString();
  const attempts = [];
  const handle = String(functionHandle || '').trim();
  const id = String(functionId || '').trim();
  // 2025-10+ prefers the stable extension handle; older APIs still take functionId.
  if (handle) {
    attempts.push({ title, discountClasses, startsAt, functionHandle: handle });
  }
  if (id) {
    attempts.push({ title, discountClasses, startsAt, functionId: id });
  }

  let last = {
    discount: null,
    userErrors: [{ message: 'No checkout discount function identifier to attach.' }],
  };
  for (const automaticAppDiscount of attempts) {
    try {
      const response = await getShopifyService().requestAdminGraphql(
        shopDomain,
        accessToken,
        mutation,
        { automaticAppDiscount }
      );
      const payload = response?.data?.discountAutomaticAppCreate;
      const userErrors = Array.isArray(payload?.userErrors) ? payload.userErrors : [];
      last = {
        discount: payload?.automaticAppDiscount || null,
        userErrors,
      };
      if (discountRecordId(last.discount) && last.userErrors.length === 0) {
        return last;
      }
    } catch (err) {
      last = {
        discount: null,
        userErrors: [{ message: err?.message || String(err) }],
      };
    }
  }
  return last;
}

async function ensureOfferCheckoutDiscount({
  shopDomain,
  accessToken,
  title = DEFAULT_DISCOUNT_TITLE,
} = {}) {
  if (!shopDomain) {
    const err = new Error('Shop domain required');
    err.code = 'SHOP_REQUIRED';
    throw err;
  }
  if (!accessToken) {
    const err = new Error(
      'Missing Shopify access token. Re-open RipsPriceX from Shopify Admin and try again.'
    );
    err.code = 'TOKEN_MISSING';
    throw err;
  }

  const recent = peekRecentEnsure(shopDomain);
  if (recent) {
    return { ...recent, cached: true };
  }

  const run = async () => {
    const status = await getOfferCheckoutDiscountStatus({ shopDomain, accessToken });
    if (status.automatic_discount_available && status.discount) {
      return {
        created: false,
        discount: status.discount,
        function: status.function,
      };
    }
    if (!status.function?.id) {
      const err = new Error(
        'No checkout discount function found for this app. Deploy ripspricex-checkout-discount, then try again.'
      );
      err.code = 'FUNCTION_MISSING';
      throw err;
    }
    if (status.lookup_status === 'scope_missing') {
      const err = new Error(
        'This shop token is missing read_discounts / write_discounts. Re-approve app permissions, then Ensure again.'
      );
      err.code = 'SCOPE_MISSING';
      throw err;
    }

    const resolveExisting = async () => {
      const discounts = await fetchAutomaticAppDiscounts(shopDomain, accessToken).catch(() => []);
      return (
        matchDiscountsToFunction(
          discounts,
          status.function?.id,
          status.function?.handle,
          CHECKOUT_DISCOUNT_FUNCTION_HANDLE
        )[0] ||
        findDiscountByTitle(discounts, title) ||
        findDiscountByTitle(discounts, DEFAULT_DISCOUNT_TITLE) ||
        null
      );
    };

    const existingBeforeCreate = await resolveExisting();
    if (discountRecordId(existingBeforeCreate)) {
      return {
        created: false,
        discount: existingBeforeCreate,
        function: status.function,
      };
    }

    const createFunctionId =
      normalizeShopifyIdentifier(status.function.id) || status.function.id;
    let create = await createAutomaticAppDiscount({
      shopDomain,
      accessToken,
      functionId: createFunctionId,
      functionHandle: status.function.handle || CHECKOUT_DISCOUNT_FUNCTION_HANDLE,
      title,
    });
    if (discountRecordId(create.discount) && create.userErrors.length === 0) {
      return {
        created: true,
        discount: create.discount,
        function: status.function,
      };
    }

    if (isAlreadyAttachedError(create.userErrors)) {
      const existing = await resolveExisting();
      if (discountRecordId(existing)) {
        return {
          created: false,
          discount: existing,
          function: status.function,
        };
      }
    }

    const fallbackTitle = `${title} (${shopDomain})`;
    if (fallbackTitle !== title) {
      create = await createAutomaticAppDiscount({
        shopDomain,
        accessToken,
        functionId: createFunctionId,
        functionHandle: status.function.handle || CHECKOUT_DISCOUNT_FUNCTION_HANDLE,
        title: fallbackTitle,
      });
      if (discountRecordId(create.discount) && create.userErrors.length === 0) {
        return {
          created: true,
          titleAdjusted: true,
          discount: create.discount,
          function: status.function,
        };
      }
      if (isAlreadyAttachedError(create.userErrors)) {
        const existing = await resolveExisting();
        if (discountRecordId(existing)) {
          return {
            created: false,
            discount: existing,
            function: status.function,
          };
        }
      }
    }

    const err = new Error(
      create.userErrors[0]?.message ||
        'Could not create the automatic checkout discount. Re-approve write_discounts and try again.'
    );
    err.code = 'CREATE_FAILED';
    err.userErrors = create.userErrors;
    throw err;
  };

  const result = await withTimeout(
    run(),
    ENSURE_TIMEOUT_MS,
    'Timed out attaching the checkout discount. Open Setup, tap Ensure, then launch again.'
  );
  rememberEnsure(shopDomain, result);
  return result;
}

module.exports = {
  DEFAULT_DISCOUNT_TITLE,
  CHECKOUT_DISCOUNT_FUNCTION_HANDLE,
  pickCheckoutDiscountFunction,
  matchDiscountsToFunction,
  normalizeShopifyIdentifier,
  discountRecordId,
  findDiscountByTitle,
  getOfferCheckoutDiscountStatus,
  ensureOfferCheckoutDiscount,
};
