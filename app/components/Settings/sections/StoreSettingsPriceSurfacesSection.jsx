import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import { Button, InlineStack, Text } from '@shopify/polaris';
import PriceSurfaceMappingsPanel from '../../TestWizard/PriceSurfaceMappingsPanel';
import targetingStyles from '../../TestWizard/TargetingSection.module.css';
import {
  buildPriceSurfacePickerPath,
  inferPriceSurfaceFromHref,
  inferPriceSurfaceRoleFromPickerHints,
  priceSurfacePageUrlError,
  priceSurfacePagePath,
  priceSurfacePickerPath,
} from '../../../utils/priceSurfaceRegistry';
import {
  buildVisualPickerLaunchUrl,
  getDevStorefrontPasswordDefault,
  isLocalDevStorefrontPasswordUiEnabled,
  loadPersistedStorefrontPassword,
  persistStorefrontPassword,
  resolvePreviewBaseUrl,
  resolveStorefrontPasswordForPreview,
} from '../../../utils/previewUrl';
import { getApiBaseUrl } from '../../../services';
import { apiPost, apiPut, unwrapData } from '../../../services/api';
import { useKeyedState } from '../../../hooks/useKeyedState';
import classicStyles from '../../SmartPricing/classic/SmartPricingClassic.module.css';

// These surfaces are all previewed on a product page, so each needs a real
// product handle before Pick can open anything.
const PRODUCT_PAGE_PICK_SURFACES = new Set(['pdp', 'recommendation', 'quickview', 'global']);

function checkProductPath(shopDomain) {
  return `/settings/price-surfaces/check-product?domain=${encodeURIComponent(shopDomain)}`;
}

/** App Bridge's product picker, or null outside the Shopify admin. */
function getResourcePicker() {
  const picker = typeof window !== 'undefined' ? window.shopify?.resourcePicker : null;
  return typeof picker === 'function' ? picker : null;
}

/** "Prices are checked on: …" with Choose / Automatic, under the table's buttons. */
export function describeCheckProduct({ loading, chosen, sample, storeHasSale, storeHasBuyable }) {
  if (loading) return 'Finding a product to check prices on…';
  const title = sample?.title || chosen?.title || '';
  if (chosen) {
    const note =
      sample && sample.available === false
        ? ' It is sold out, so cart prices cannot be checked.'
        : sample && sample.on_sale === false
          ? ' It is not on sale, so the “was” price cannot be checked.'
          : '';
    return `Prices are checked on “${title || 'your chosen product'}”, which you chose.${note}`;
  }
  if (!sample) {
    return storeHasBuyable === false
      ? 'No in-stock product on your Online Store to check prices on. Choose one, or restock a product.'
      : 'No product found to check prices on. Choose one.';
  }
  const why = sample.on_sale
    ? sample.available === false
      ? 'a sold-out product on sale (no on-sale product is in stock; it still shows both prices)'
      : 'an in-stock product on sale'
    : storeHasSale === false
      ? 'an in-stock product (none are on sale, so the “was” price cannot be checked)'
      : 'an in-stock product';
  return `Prices are checked on “${title || sample.path}”, ${why}, picked automatically.`;
}

/**
 * Settings → Price surfaces: the mapping table and nothing else.
 *
 * The product that Pick opens and Auto-detect checks comes from the server: the
 * merchant's choice, or an in-stock product on sale it finds itself, so neither
 * lands on a sold-out page or a product with no "was" price. Any other page — a
 * landing page, a hand-built bundle page — is reached with a Specific URL row.
 */
export function StoreSettingsPriceSurfacesSection({ shopDomain = '', autoMapRequestToken = 0 }) {
  const outletCtx = useOutletContext() || {};
  const envPassword = String(
    outletCtx.devStorefrontPassword || getDevStorefrontPasswordDefault() || ''
  ).trim();
  // Only what the merchant typed, stored per shop. It wins over the configured
  // password, which can be stale once the Online Store password changes.
  const passwordKey = `${envPassword}:${shopDomain}`;
  const initialPassword = useMemo(
    () => (shopDomain ? loadPersistedStorefrontPassword(shopDomain) : ''),
    [shopDomain]
  );
  const [storefrontPassword, setStorefrontPassword] = useKeyedState(passwordKey, initialPassword);
  const [pickTarget, setPickTarget] = useState(null);
  const initialPickerProduct = useMemo(
    () => ({
      path: '',
      loading: Boolean(String(shopDomain || '').trim()),
      chosen: null,
      sample: null,
      storeHasSale: null,
      storeHasBuyable: null,
    }),
    [shopDomain]
  );
  const [pickerProduct, setPickerProduct] = useKeyedState(shopDomain, initialPickerProduct);
  const { path: pickerProductPath } = pickerProduct;
  const [checkProductReload, setCheckProductReload] = useState(0);
  const [checkProductSaving, setCheckProductSaving] = useState(false);
  const [checkProductError, setCheckProductError] = useState('');
  const lastLookupPasswordRef = useRef(null);
  const pickTargetRef = useRef(null);
  const shopPickHandlerRef = useRef(null);

  const handleStorefrontPasswordChange = useCallback(
    value => {
      setStorefrontPassword(value);
      persistStorefrontPassword(shopDomain || '', value);
    },
    [shopDomain, setStorefrontPassword]
  );

  useEffect(() => {
    pickTargetRef.current = pickTarget;
  }, [pickTarget]);

  const lookupPassword =
    (isLocalDevStorefrontPasswordUiEnabled() ? storefrontPassword : '') || envPassword;
  useEffect(() => {
    const domain = String(shopDomain || '').trim();
    if (!domain) return undefined;
    let cancelled = false;
    const lookup = () =>
      apiPost(checkProductPath(domain), {
        storefront_password:
          resolveStorefrontPasswordForPreview(domain, lookupPassword) || undefined,
      })
        .then(response => {
          if (cancelled) return;
          const data = unwrapData(response) || {};
          setPickerProduct({
            // The pinned variant, so Pick opens the variant that is on sale.
            path: String(data.sample?.page_path || data.sample?.path || ''),
            loading: false,
            chosen: data.chosen || null,
            sample: data.sample || null,
            storeHasSale: data.store_has_sale_product ?? null,
            storeHasBuyable: data.store_has_buyable_product ?? null,
          });
        })
        .catch(() => {
          if (!cancelled) setPickerProduct({ ...initialPickerProduct, loading: false });
        });
    // Typing a password re-runs this; wait for a pause instead of unlocking per key.
    let timer = null;
    const previous = lastLookupPasswordRef.current;
    lastLookupPasswordRef.current = lookupPassword;
    if (previous !== null && previous !== lookupPassword) {
      timer = setTimeout(lookup, 300);
    } else {
      lookup();
    }
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [shopDomain, setPickerProduct, lookupPassword, checkProductReload, initialPickerProduct]);

  const saveCheckProduct = useCallback(
    async productId => {
      const domain = String(shopDomain || '').trim();
      if (!domain) return;
      setCheckProductSaving(true);
      setCheckProductError('');
      try {
        await apiPut(checkProductPath(domain), { product_id: productId || null });
        setCheckProductReload(n => n + 1);
      } catch (saveError) {
        setCheckProductError(saveError?.message || 'Could not save the product to check with.');
      } finally {
        setCheckProductSaving(false);
      }
    },
    [shopDomain]
  );

  const chooseCheckProduct = useCallback(async () => {
    const picker = getResourcePicker();
    if (!picker) return;
    const selected = await picker({
      type: 'product',
      action: 'select',
      multiple: false,
      filter: { draft: false, archived: false, hidden: false, variants: false },
    }).catch(() => undefined);
    const productId = Array.isArray(selected) ? selected[0]?.id : null;
    if (productId) await saveCheckProduct(productId);
  }, [saveCheckProduct]);

  const resolvedProductPath = pickerProductPath || '';
  const { loading: pickerProductLoading } = pickerProduct;

  const localDevPasswordUi = isLocalDevStorefrontPasswordUiEnabled();
  // The panel decides when to render the field; with a configured password it
  // appears only after that password is rejected.
  const allowPasswordField = localDevPasswordUi;

  const getPickerLaunchUrl = useCallback(
    row => {
      const domain = String(shopDomain || '').trim();
      if (!domain) {
        return '';
      }
      const surface = String(row?.surface || 'pdp').toLowerCase();
      const password = resolveStorefrontPasswordForPreview(
        domain,
        (allowPasswordField ? storefrontPassword : '') || envPassword
      );
      // A url row names its own page, so it skips the per-surface templates
      // entirely. Only the path travels: previewing a custom domain through the
      // shop domain reaches the same page and is the only host the proxy can
      // unlock a storefront password on.
      const path =
        surface === 'url'
          ? priceSurfacePickerPath(row?.pageUrl)
          : buildPriceSurfacePickerPath(surface, {
              productPath: resolvedProductPath || undefined,
              collectionPath: '/collections/all',
            });
      if (!path) {
        return '';
      }
      // Without a product handle these surfaces fall back to the homepage,
      // where the price the merchant means to click is not on the page.
      // getPickBlockedReason explains this on the disabled button.
      if (PRODUCT_PAGE_PICK_SURFACES.has(surface) && (!resolvedProductPath || path === '/')) {
        return '';
      }
      const baseUrl = resolvePreviewBaseUrl({
        variantUrl: null,
        overrideUrl: null,
        domain,
        path,
      });
      if (!baseUrl) {
        return '';
      }
      return (
        buildVisualPickerLaunchUrl({
          baseUrl,
          tenantDomain: domain,
          apiBaseUrl: getApiBaseUrl(),
          storefrontPassword: password || undefined,
          parentOrigin: typeof window !== 'undefined' ? window.location.origin : undefined,
          priceSurfacePick: true,
        }) || ''
      );
    },
    [shopDomain, storefrontPassword, resolvedProductPath, allowPasswordField, envPassword]
  );

  /**
   * Why Pick cannot run for a row, in the row's own terms.
   *
   * Pick is gated on a preview URL, and a row cannot always produce one. Left
   * unexplained the button reads as broken, which is what it looked like while
   * the sample-product lookup was silently returning nothing.
   */
  const getPickBlockedReason = useCallback(
    row => {
      if (!String(shopDomain || '').trim()) {
        return 'Connect your shop to pick a price on your storefront.';
      }
      const surface = String(row?.surface || 'pdp').toLowerCase();
      if (surface === 'url') {
        const pageUrl = String(row?.pageUrl || '').trim();
        if (!pageUrl) {
          return 'Enter this row\u2019s page URL first, then Pick opens that page.';
        }
        return priceSurfacePageUrlError(pageUrl) || '';
      }
      if (PRODUCT_PAGE_PICK_SURFACES.has(surface)) {
        if (pickerProductLoading) {
          return 'Finding a product to preview\u2026';
        }
        if (!resolvedProductPath) {
          return 'No in-stock product on your Online Store to preview this on. Choose a product to check with, or add a Specific URL row and pick on a page you name.';
        }
      }
      return '';
    },
    [shopDomain, pickerProductLoading, resolvedProductPath]
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const onMessage = event => {
      const data = event?.data;
      if (!data || data.type !== 'ripx-visual-selector') {
        return;
      }
      const source = String(data.source || '');
      const sameOrigin = event.origin === window.location.origin;
      if (!sameOrigin && source !== 'ripx-picker' && source !== 'ripx-visual-editor') {
        return;
      }
      const sel = typeof data.selector === 'string' ? data.selector.trim() : '';
      if (!sel || sel.length > 2048) {
        return;
      }
      const pricePick = pickTargetRef.current;
      if (
        !pricePick ||
        pricePick.scope !== 'shop' ||
        !Number.isInteger(pricePick.index) ||
        pricePick.index < 0
      ) {
        return;
      }
      const inferredSurface = data.surfaceHint || inferPriceSurfaceFromHref(data.pageUrl);
      const roleHint = inferPriceSurfaceRoleFromPickerHints({
        selector: sel,
        roleHint: data.roleHint,
      });
      const patch = {
        selector: sel,
        source: 'visual',
      };
      // Prefer the surface the merchant started picking for (Pick PDP) over homepage inference.
      const intendedSurface = String(pricePick.surface || '')
        .trim()
        .toLowerCase();
      if (intendedSurface && intendedSurface !== 'global') {
        patch.surface = intendedSurface;
      } else if (inferredSurface) {
        patch.surface = inferredSurface;
      }
      // A url row is pinned to the regular price and to the page the merchant
      // named, so neither the inferred role nor the inferred surface applies.
      if (roleHint && intendedSurface !== 'url') {
        patch.role = roleHint;
      }
      const handler = shopPickHandlerRef.current;
      if (typeof handler === 'function') {
        handler(pricePick.index, patch);
      }
      pickTargetRef.current = null;
      setPickTarget(null);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (!pickTarget) {
      return undefined;
    }
    const timeout = setTimeout(
      () => {
        pickTargetRef.current = null;
        setPickTarget(null);
      },
      15 * 60 * 1000
    );
    return () => clearTimeout(timeout);
  }, [pickTarget]);


  const beginVisualPick = useCallback(
    target => {
      const surface = String(target?.surface || 'pdp').toLowerCase();
      if (surface === 'url') {
        if (!priceSurfacePagePath(target?.pageUrl)) {
          return;
        }
      } else if (
        (surface === 'pdp' ||
          surface === 'recommendation' ||
          surface === 'quickview' ||
          surface === 'global') &&
        !resolvedProductPath
      ) {
        return;
      }
      // Stamp intended surface onto pick target so href inference cannot rewrite PDP → home.
      const next = {
        ...target,
        surface: surface || target?.surface || 'pdp',
      };
      pickTargetRef.current = next;
      setPickTarget(next);
    },
    [resolvedProductPath]
  );

  // Only the mapping table is rendered. What each column means, and how a row
  // reaches the storefront, lives in the guide behind the tab's info icon
  // rather than in prose above a table that already says it.
  if (!shopDomain) {
    return (
      <div className={classicStyles.adminStackTight}>
        <p className={classicStyles.help}>
          Open App settings from a connected shop to edit price locations.
        </p>
      </div>
    );
  }

  const canChooseProduct = Boolean(getResourcePicker());
  const checkProductControl = (
    <InlineStack gap="200" blockAlign="center" wrap>
      <Text as="p" variant="bodySm" tone="subdued">
        {describeCheckProduct(pickerProduct)}
      </Text>
      {canChooseProduct ? (
        <Button
          size="slim"
          variant="plain"
          onClick={chooseCheckProduct}
          loading={checkProductSaving}
          disabled={pickerProductLoading}
        >
          {pickerProduct.chosen ? 'Change product' : 'Choose product'}
        </Button>
      ) : null}
      {pickerProduct.chosen ? (
        <Button
          size="slim"
          variant="plain"
          onClick={() => saveCheckProduct(null)}
          disabled={checkProductSaving}
        >
          Pick automatically
        </Button>
      ) : null}
      {checkProductError ? (
        <Text as="p" variant="bodySm" tone="critical">
          {checkProductError}
        </Text>
      ) : null}
    </InlineStack>
  );

  return (
    <PriceSurfaceMappingsPanel
      styles={targetingStyles}
      shopDomain={shopDomain}
      storefrontPassword={storefrontPassword}
      envStorefrontPassword={envPassword}
      onStorefrontPasswordChange={allowPasswordField ? handleStorefrontPasswordChange : undefined}
      checkProductControl={checkProductControl}
      autoMapRequestToken={autoMapRequestToken}
      getPickerLaunchUrl={getPickerLaunchUrl}
      getPickBlockedReason={getPickBlockedReason}
      pickTarget={pickTarget}
      onBeginVisualPick={beginVisualPick}
      onCancelVisualPick={() => {
        pickTargetRef.current = null;
        setPickTarget(null);
      }}
      onRegisterShopPickHandler={handler => {
        shopPickHandlerRef.current = handler;
      }}
    />
  );
}
