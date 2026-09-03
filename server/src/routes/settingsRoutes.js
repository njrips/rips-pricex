/**
 * Slim settings routes for RipsPriceX:
 * installation snippet, cart-transform ensure/status, price-surface mappings.
 */

const express = require('express');
const router = express.Router();
const { sendError, sendSuccess } = require('../utils/response');
const { asyncHandler } = require('../middleware/asyncHandler');
const shopifyService = require('../services/shopifyService');
const { getShopSession } = require('../models/shopSession');
const { HTTP_STATUS } = require('../constants');
const { SCRIPT_VERSION } = require('../utils/storefrontScriptRuntime');

function clearShopInstallStateCaches(shopDomain) {
  const normalized = String(shopDomain || '')
    .trim()
    .toLowerCase();
  if (!normalized) return;
  try {
    const { clearShopCapabilityCache } = require('../services/priceTestCheckoutResolve');
    if (typeof clearShopCapabilityCache === 'function') {
      clearShopCapabilityCache(normalized);
    }
  } catch {
    // optional in slim API
  }
}

function escapeHtmlAttr(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function pickCartTransformFunction(functionsList = []) {
  if (!Array.isArray(functionsList) || functionsList.length === 0) {
    return null;
  }
  const normalized = functionsList.filter(Boolean);
  const cartTransforms = normalized.filter(fn => {
    const apiType = String(fn?.apiType || '')
      .trim()
      .toLowerCase();
    return apiType.includes('cart_transform') || apiType.includes('cart transform');
  });
  const preferred = cartTransforms.find(fn => {
    const title = String(fn?.title || '')
      .trim()
      .toLowerCase();
    return (
      title.includes('pricify') ||
      title.includes('ripspricex') ||
      title.includes('ripx') ||
      title.includes('rips price')
    );
  });
  if (preferred) return preferred;
  return cartTransforms.length > 0 ? cartTransforms[0] : null;
}

async function fetchShopifyFunctions(shopDomain, accessToken) {
  const fnQuery = `
    query rpxShopifyFunctions {
      shopifyFunctions(first: 50) {
        nodes {
          id
          title
          apiType
        }
      }
    }
  `;
  const fnResp = await shopifyService.requestAdminGraphql(shopDomain, accessToken, fnQuery);
  return fnResp?.data?.shopifyFunctions?.nodes || [];
}

async function fetchCartTransformsViaAdmin(shopDomain, accessToken) {
  const queryText = `
    query rpxExistingCartTransforms {
      cartTransforms(first: 20) {
        nodes {
          id
          functionId
          blockOnFailure
        }
      }
    }
  `;
  const resp = await shopifyService.requestAdminGraphql(shopDomain, accessToken, queryText);
  return resp?.data?.cartTransforms?.nodes || [];
}

function isReadCartTransformsScopeError(error) {
  const message = String(error?.message || '')
    .trim()
    .toLowerCase();
  return (
    message.includes('read_cart_transforms') || message.includes('access denied for carttransforms')
  );
}

function isWriteCartTransformsScopeError(error) {
  const message = String(error?.message || '')
    .trim()
    .toLowerCase();
  return (
    message.includes('write_cart_transforms') ||
    message.includes('access denied for carttransformcreate')
  );
}

function isCartTransformFunctionIdTypeMismatchError(error) {
  const message = String(error?.message || '')
    .trim()
    .toLowerCase();
  // Shopify has flipped ID! vs String across Admin API versions:
  // "Type mismatch on variable $functionId and argument functionId (ID! / String)"
  return (
    message.includes('type mismatch') &&
    message.includes('functionid') &&
    (message.includes('id!') || message.includes('string'))
  );
}

function resolveShopDomain(req) {
  return (
    req.shopDomain ||
    String(req.query.domain || req.query.shop || '')
      .trim()
      .toLowerCase() ||
    null
  );
}

/**
 * GET /api/settings/installation
 */
router.get(
  '/installation',
  asyncHandler(async (req, res) => {
    const shopDomain = resolveShopDomain(req);
    if (!shopDomain || shopDomain.includes('@')) {
      return sendError(res, 401, 'Shop domain required');
    }

    const appUrl = (process.env.APP_URL || process.env.SHOPIFY_APP_URL || '').replace(/\/$/, '');
    const scriptUrl = `https://${shopDomain}/apps/ripspricex/script.js?v=${SCRIPT_VERSION || '1'}`;
    const directUrl = `${appUrl}/api/track/script.js?shop=${encodeURIComponent(shopDomain)}&v=${SCRIPT_VERSION || '1'}`;
    let scriptOrigin = '';
    try {
      scriptOrigin = appUrl ? new URL(appUrl).origin : '';
    } catch {
      scriptOrigin = '';
    }
    const resourceHints = scriptOrigin
      ? `<!-- Optional: early connection to API origin -->
<link rel="preconnect" href="${escapeHtmlAttr(scriptOrigin)}" crossorigin>
<link rel="dns-prefetch" href="${escapeHtmlAttr(scriptOrigin)}">
`
      : '';
    const snippetHtml = `<!-- Pricify - Shopify. Prefer Theme App Embed. -->
${resourceHints}<script src="${scriptUrl}" defer crossorigin="anonymous" fetchpriority="high"></script>`;

    // Prefer live MAIN theme id for embed deep links (`/themes/current` can open a draft).
    let mainTheme = null;
    try {
      const session = await getShopSession(shopDomain);
      const accessToken = session?.access_token || session?.accessToken || null;
      if (accessToken) {
        const { fetchMainTheme } = require('../services/priceSurfaceSuggestService');
        const theme = await fetchMainTheme(shopDomain, accessToken);
        if (theme?.id || theme?.name) {
          const gid = String(theme.id || '');
          const numericMatch = gid.match(/\/(\d+)\s*$/);
          mainTheme = {
            id: theme.id || null,
            numericId: numericMatch ? numericMatch[1] : null,
            name: theme.name || null,
            role: theme.role || null,
          };
        }
      }
    } catch {
      mainTheme = null;
    }

    const apiKey = String(process.env.SHOPIFY_API_KEY || '').trim();
    const blockHandle = 'ripspricex-app-embed';
    const storeHandle = shopDomain.replace(/\.myshopify\.com$/i, '');
    const themeSegment = mainTheme?.numericId || 'current';
    const activateAppId = apiKey ? `${apiKey}/${blockHandle}` : null;
    const query = activateAppId
      ? `context=apps&activateAppId=${activateAppId}`
      : 'context=apps';
    const themeEmbed = activateAppId
      ? {
          blockHandle,
          activateAppId,
          themeSegment,
          shopifyUrl: `shopify://admin/themes/${themeSegment}/editor?${query}`,
          httpsUrl: `https://admin.shopify.com/store/${encodeURIComponent(storeHandle)}/themes/${themeSegment}/editor?${query}`,
        }
      : {
          blockHandle,
          activateAppId: null,
          themeSegment,
          shopifyUrl: null,
          httpsUrl: null,
        };

    return sendSuccess(res, HTTP_STATUS.OK, {
      platform: 'shopify',
      scriptUrl,
      directUrl,
      snippetHtml,
      mainTheme,
      themeEmbed,
      instructions: {
        method: 'App Proxy + App Embed (recommended)',
        steps: [
          'Configure App Proxy: subpath prefix "apps", subpath "ripspricex"',
          'Enable Pricify theme app embed in Online Store → Themes → Customize',
          'Deploy cart transform extension (ripspricex-cart-transform) for charged-price parity',
          'Deploy checkout discount (ripspricex-checkout-discount) and Ensure it for offer tests',
        ],
      },
    });
  })
);

/**
 * POST /api/settings/cart-transform/ensure
 */
router.post(
  '/cart-transform/ensure',
  asyncHandler(async (req, res) => {
    const shopDomain = resolveShopDomain(req);
    if (!shopDomain) {
      return sendError(res, 401, 'Shop domain required');
    }

    const fallbackSession = await getShopSession(shopDomain);
    const accessToken = req.shopifyAccessToken || fallbackSession?.access_token || '';
    if (!accessToken) {
      return sendError(
        res,
        400,
        'Missing Shopify access token for this shop. Re-open Pricify from Shopify Admin and try again.'
      );
    }

    const functionNodes = await fetchShopifyFunctions(shopDomain, accessToken);
    const chosenFunction = pickCartTransformFunction(functionNodes);
    if (!chosenFunction?.id) {
      return sendError(
        res,
        404,
        'No cart transform function found for this app on the shop. Deploy ripspricex-cart-transform and try again.'
      );
    }

    let existingTransforms = null;
    let cartTransformsLookupUnavailableReason = null;
    try {
      existingTransforms = await fetchCartTransformsViaAdmin(shopDomain, accessToken);
    } catch (lookupError) {
      existingTransforms = null;
      cartTransformsLookupUnavailableReason = isReadCartTransformsScopeError(lookupError)
        ? 'missing_read_cart_transforms_scope'
        : 'lookup_error';
    }
    const chosenFunctionId = String(chosenFunction.id || '').trim();
    if (Array.isArray(existingTransforms)) {
      const alreadyInstalled = existingTransforms.find(
        node => String(node?.functionId || '').trim() === chosenFunctionId
      );
      if (alreadyInstalled) {
        clearShopInstallStateCaches(shopDomain);
        return res.json({
          success: true,
          created: false,
          cartTransform: alreadyInstalled,
          function: {
            id: chosenFunction.id,
            title: chosenFunction.title || null,
            apiType: chosenFunction.apiType || null,
          },
        });
      }
    }

    if (Array.isArray(existingTransforms) && existingTransforms.length > 0) {
      return sendError(
        res,
        409,
        'A different cart transform is already installed on this shop. Shopify allows only one cart transform per store.',
        {
          existingCartTransforms: existingTransforms,
          function: {
            id: chosenFunction.id,
            title: chosenFunction.title || null,
            apiType: chosenFunction.apiType || null,
          },
        }
      );
    }

    // Current Admin API expects String for cartTransformCreate.functionId; keep ID! fallback.
    const createMutationString = `
      mutation rpxCreateCartTransform($functionId: String!) {
        cartTransformCreate(functionId: $functionId) {
          cartTransform {
            id
            functionId
            blockOnFailure
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
    const createMutationId = `
      mutation rpxCreateCartTransformId($functionId: ID!) {
        cartTransformCreate(functionId: $functionId) {
          cartTransform {
            id
            functionId
            blockOnFailure
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
    let createResp;
    try {
      createResp = await shopifyService.requestAdminGraphql(
        shopDomain,
        accessToken,
        createMutationString,
        { functionId: chosenFunctionId }
      );
    } catch (createErr) {
      if (isCartTransformFunctionIdTypeMismatchError(createErr)) {
        try {
          createResp = await shopifyService.requestAdminGraphql(
            shopDomain,
            accessToken,
            createMutationId,
            { functionId: chosenFunctionId }
          );
        } catch (idErr) {
          if (isCartTransformFunctionIdTypeMismatchError(idErr)) {
            const compatMutation = `
              mutation rpxCreateCartTransformCompat {
                cartTransformCreate(functionId: ${JSON.stringify(chosenFunctionId)}) {
                  cartTransform {
                    id
                    functionId
                    blockOnFailure
                  }
                  userErrors {
                    field
                    message
                  }
                }
              }
            `;
            createResp = await shopifyService.requestAdminGraphql(
              shopDomain,
              accessToken,
              compatMutation,
              {}
            );
          } else if (isWriteCartTransformsScopeError(idErr)) {
            return sendError(
              res,
              403,
              'Missing write_cart_transforms scope for cartTransformCreate. Re-install the app with updated scopes and retry.',
              {
                function: {
                  id: chosenFunction.id,
                  title: chosenFunction.title || null,
                  apiType: chosenFunction.apiType || null,
                },
              }
            );
          } else {
            throw idErr;
          }
        }
      } else if (isWriteCartTransformsScopeError(createErr)) {
        return sendError(
          res,
          403,
          'Missing write_cart_transforms scope for cartTransformCreate. Re-install the app with updated scopes and retry.',
          {
            function: {
              id: chosenFunction.id,
              title: chosenFunction.title || null,
              apiType: chosenFunction.apiType || null,
            },
          }
        );
      } else {
        throw createErr;
      }
    }
    const payload = createResp?.data?.cartTransformCreate;
    const userErrors = Array.isArray(payload?.userErrors) ? payload.userErrors : [];
    if (userErrors.length > 0 || !payload?.cartTransform?.id) {
      const firstUserErrorMessage = String(userErrors[0]?.message || '').trim();
      if (
        !payload?.cartTransform?.id &&
        firstUserErrorMessage &&
        cartTransformsLookupUnavailableReason &&
        /already|one cart transform|max/i.test(firstUserErrorMessage)
      ) {
        clearShopInstallStateCaches(shopDomain);
        return res.json({
          success: true,
          created: false,
          assumedInstalled: true,
          note: 'Cart transform create returned an "already exists" style response, but install verification is unavailable without read_cart_transforms scope.',
          cartTransform: null,
          function: {
            id: chosenFunction.id,
            title: chosenFunction.title || null,
            apiType: chosenFunction.apiType || null,
          },
          installCheck: {
            status: 'unknown',
            reason: cartTransformsLookupUnavailableReason,
          },
        });
      }
      return sendError(res, 400, userErrors[0]?.message || 'Could not install cart transform.', {
        function: {
          id: chosenFunction.id,
          title: chosenFunction.title || null,
          apiType: chosenFunction.apiType || null,
        },
        shopifyUserErrors: userErrors.map(err => ({
          field: Array.isArray(err?.field) ? err.field.join('.') : err?.field || null,
          message: err?.message || null,
        })),
      });
    }

    clearShopInstallStateCaches(shopDomain);
    try {
      const {
        clearSmartPricingCheckoutReadinessCache,
      } = require('../services/smartPricing/smartPricingCheckoutReadinessService');
      clearSmartPricingCheckoutReadinessCache?.(shopDomain);
    } catch {
      // optional
    }
    return res.json({
      success: true,
      created: true,
      cartTransform: payload.cartTransform,
      function: {
        id: chosenFunction.id,
        title: chosenFunction.title || null,
        apiType: chosenFunction.apiType || null,
      },
      installCheck: {
        status: Array.isArray(existingTransforms) ? 'verified' : 'unknown',
        reason: cartTransformsLookupUnavailableReason,
      },
    });
  })
);

/**
 * GET /api/settings/cart-transform/status
 */
router.get(
  '/cart-transform/status',
  asyncHandler(async (req, res) => {
    const shopDomain = resolveShopDomain(req);
    if (!shopDomain) {
      return sendError(res, 401, 'Shop domain required');
    }

    const fallbackSession = await getShopSession(shopDomain);
    const accessToken = req.shopifyAccessToken || fallbackSession?.access_token || '';
    if (!accessToken) {
      return sendError(
        res,
        400,
        'Missing Shopify access token for this shop. Re-open Pricify from Shopify Admin and try again.'
      );
    }

    const functionNodes = await fetchShopifyFunctions(shopDomain, accessToken);
    const chosenFunction = pickCartTransformFunction(functionNodes);
    let existingTransforms = null;
    let installCheckStatus = 'ok';
    let installCheckReason = null;
    try {
      existingTransforms = await fetchCartTransformsViaAdmin(shopDomain, accessToken);
    } catch (lookupError) {
      existingTransforms = null;
      if (isReadCartTransformsScopeError(lookupError)) {
        installCheckStatus = 'scope_missing';
        installCheckReason = 'missing_read_cart_transforms_scope';
      } else {
        installCheckStatus = 'error';
        installCheckReason = lookupError?.message || 'lookup_error';
      }
    }
    const chosenFunctionId = String(chosenFunction?.id || '').trim();
    const matchedTransforms = Array.isArray(existingTransforms)
      ? existingTransforms.filter(
          node => String(node?.functionId || '').trim() === chosenFunctionId
        )
      : [];

    return res.json({
      success: true,
      function: chosenFunction
        ? {
            id: chosenFunction.id,
            title: chosenFunction.title || null,
            apiType: chosenFunction.apiType || null,
          }
        : null,
      installedCount: Array.isArray(existingTransforms) ? existingTransforms.length : null,
      installedTransforms: Array.isArray(existingTransforms) ? existingTransforms : [],
      matchedCount: matchedTransforms.length,
      matchedTransforms,
      installedForRipxFunction: Array.isArray(existingTransforms)
        ? matchedTransforms.length > 0
        : null,
      installCheck: {
        status: installCheckStatus,
        reason: installCheckReason,
      },
    });
  })
);

/**
 * POST /api/settings/checkout-discount/ensure
 * Create (or reuse) the automatic app discount that runs ripspricex-checkout-discount.
 */
router.post(
  '/checkout-discount/ensure',
  asyncHandler(async (req, res) => {
    const shopDomain = resolveShopDomain(req);
    if (!shopDomain) {
      return sendError(res, 401, 'Shop domain required');
    }

    const fallbackSession = await getShopSession(shopDomain);
    const accessToken = req.shopifyAccessToken || fallbackSession?.access_token || '';
    const {
      ensureOfferCheckoutDiscount,
    } = require('../services/smartPricing/offerCheckoutDiscountService');
    const {
      clearSmartPricingCheckoutReadinessCache,
    } = require('../services/smartPricing/smartPricingCheckoutReadinessService');

    try {
      const result = await ensureOfferCheckoutDiscount({
        shopDomain,
        accessToken,
        title: String(req.body?.title || '').trim() || undefined,
      });
      clearSmartPricingCheckoutReadinessCache(shopDomain);
      return res.json({
        success: true,
        created: result.created === true,
        titleAdjusted: result.titleAdjusted === true,
        discount: result.discount,
        function: result.function,
        installedForRipxFunction: Boolean(
          result.discount?.discountId || result.discount?.id
        ),
      });
    } catch (err) {
      const status =
        err?.code === 'TOKEN_MISSING' || err?.code === 'SCOPE_MISSING'
          ? 400
          : err?.code === 'FUNCTION_MISSING'
            ? 404
            : 400;
      return sendError(res, status, err.message || 'Could not attach checkout discount.', {
        code: err.code || null,
        shopifyUserErrors: err.userErrors || [],
      });
    }
  })
);

/**
 * GET /api/settings/checkout-discount/status
 */
router.get(
  '/checkout-discount/status',
  asyncHandler(async (req, res) => {
    const shopDomain = resolveShopDomain(req);
    if (!shopDomain) {
      return sendError(res, 401, 'Shop domain required');
    }

    const fallbackSession = await getShopSession(shopDomain);
    const accessToken = req.shopifyAccessToken || fallbackSession?.access_token || '';
    if (!accessToken) {
      return sendError(
        res,
        400,
        'Missing Shopify access token for this shop. Re-open Pricify from Shopify Admin and try again.'
      );
    }

    const {
      getOfferCheckoutDiscountStatus,
    } = require('../services/smartPricing/offerCheckoutDiscountService');
    const status = await getOfferCheckoutDiscountStatus({ shopDomain, accessToken });
    return res.json({
      success: true,
      function: status.function,
      discount: status.discount,
      installedForRipxFunction: status.automatic_discount_available === true,
      functionAvailable: status.function_available === true,
      installCheck: {
        status: status.lookup_status,
        reason: status.error || null,
      },
    });
  })
);

/**
 * GET /api/settings/price-surfaces
 */
router.get(
  '/price-surfaces',
  asyncHandler(async (req, res) => {
    const shopDomain = resolveShopDomain(req);
    if (!shopDomain || shopDomain.includes('@')) {
      return sendError(res, 401, 'Shop domain required');
    }
    const { getShopPriceSurfaceMappings } = require('../services/priceSurfaceRegistryService');
    const mappings = await getShopPriceSurfaceMappings(shopDomain, { allowEmptySelector: true });
    return sendSuccess(res, HTTP_STATUS.OK, { mappings });
  })
);

/**
 * PUT /api/settings/price-surfaces
 */
router.put(
  '/price-surfaces',
  asyncHandler(async (req, res) => {
    const shopDomain = resolveShopDomain(req);
    if (!shopDomain || shopDomain.includes('@')) {
      return sendError(res, 401, 'Shop domain required');
    }
    const { saveShopPriceSurfaceMappings } = require('../services/priceSurfaceRegistryService');
    const mappings = await saveShopPriceSurfaceMappings(shopDomain, req.body?.mappings, {
      allowEmptySelector: true,
    });
    const themeMetaInput = req.body?.auto_map_theme || req.body?.autoMapTheme || null;
    if (themeMetaInput && typeof themeMetaInput === 'object') {
      try {
        const { savePriceSurfaceThemeMeta } = require('../services/priceSurfaceAutoMapService');
        await savePriceSurfaceThemeMeta(shopDomain, {
          theme_id: themeMetaInput.id || themeMetaInput.theme_id || null,
          theme_name: themeMetaInput.name || themeMetaInput.theme_name || null,
          mapped_at: new Date().toISOString(),
        });
      } catch {
        // best-effort
      }
    }
    return sendSuccess(res, HTTP_STATUS.OK, { mappings });
  })
);

/**
 * POST /api/settings/price-surfaces/suggest
 */
router.post(
  '/price-surfaces/suggest',
  asyncHandler(async (req, res) => {
    const shopDomain = resolveShopDomain(req);
    if (!shopDomain || shopDomain.includes('@')) {
      return sendError(res, 401, 'Shop domain required');
    }
    const fallbackSession = await getShopSession(shopDomain);
    const accessToken = req.shopifyAccessToken || fallbackSession?.access_token || '';
    const { suggestShopPriceSurfaceMappings } = require('../services/priceSurfaceSuggestService');
    const suggestion = await suggestShopPriceSurfaceMappings(shopDomain, { accessToken });
    return sendSuccess(res, HTTP_STATUS.OK, suggestion);
  })
);

/**
 * POST /api/settings/price-surfaces/auto-map
 */
router.post(
  '/price-surfaces/auto-map',
  asyncHandler(async (req, res) => {
    const shopDomain = resolveShopDomain(req);
    if (!shopDomain || shopDomain.includes('@')) {
      return sendError(res, 401, 'Shop domain required');
    }
    const fallbackSession = await getShopSession(shopDomain);
    const accessToken = req.shopifyAccessToken || fallbackSession?.access_token || '';
    const {
      resolveStorefrontPasswordForPreviewRequest,
    } = require('../utils/storefrontPasswordPreview');
    const storefrontPassword = resolveStorefrontPasswordForPreviewRequest(
      typeof req.body?.storefront_password === 'string'
        ? req.body.storefront_password
        : typeof req.body?.storefrontPassword === 'string'
          ? req.body.storefrontPassword
          : '',
      req.get('host') || ''
    );
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);
    try {
      const { autoMapShopPriceSurfaces } = require('../services/priceSurfaceAutoMapService');
      const result = await autoMapShopPriceSurfaces(shopDomain, {
        accessToken,
        storefrontPassword,
        productPath: req.body?.product_path || req.body?.productPath || '',
        collectionPath: req.body?.collection_path || req.body?.collectionPath || '',
        signal: controller.signal,
      });
      return sendSuccess(res, HTTP_STATUS.OK, result);
    } finally {
      clearTimeout(timeoutId);
    }
  })
);

module.exports = router;
