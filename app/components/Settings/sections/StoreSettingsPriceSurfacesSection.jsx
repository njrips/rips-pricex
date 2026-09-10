import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
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
  persistStorefrontPassword,
  resolvePreviewBaseUrl,
  resolveStorefrontPasswordForPreview,
} from '../../../utils/previewUrl';
import { apiGet, getApiBaseUrl } from '../../../services';
import { useKeyedState } from '../../../hooks/useKeyedState';
import classicStyles from '../../SmartPricing/classic/SmartPricingClassic.module.css';

// These surfaces are all previewed on a product page, so each needs a real
// product handle before Pick can open anything.
const PRODUCT_PAGE_PICK_SURFACES = new Set(['pdp', 'recommendation', 'quickview', 'global']);

function productPathFromResource(product) {
  const handle = String(product?.handle || '')
    .trim()
    .replace(/^\/+/, '');
  if (!handle) return '';
  return `/products/${encodeURIComponent(handle)}`;
}

/**
 * Settings → Price surfaces: the mapping table and nothing else.
 *
 * A sample product is still fetched so a product-page row can be picked
 * without the merchant typing a URL. Any other page — a landing page, a
 * hand-built bundle page — is reached with a Specific URL row, which is why
 * there is no longer a shop-wide "product path" field above the table.
 */
export function StoreSettingsPriceSurfacesSection({ shopDomain = '', autoMapRequestToken = 0 }) {
  const outletCtx = useOutletContext() || {};
  const envPassword = String(
    outletCtx.devStorefrontPassword || getDevStorefrontPasswordDefault() || ''
  ).trim();
  // The password is stored per shop, so a shop switch (or a newly provided .env
  // value) starts over from whatever is on record for that shop.
  const passwordKey = `${envPassword}:${shopDomain}`;
  const initialPassword = useMemo(
    () => envPassword || resolveStorefrontPasswordForPreview(shopDomain || '', ''),
    [envPassword, shopDomain]
  );
  const [storefrontPassword, setStorefrontPassword] = useKeyedState(passwordKey, initialPassword);
  const [pickTarget, setPickTarget] = useState(null);
  const initialPickerProduct = useMemo(
    () => ({ path: '', loading: Boolean(String(shopDomain || '').trim()) }),
    [shopDomain]
  );
  const [pickerProduct, setPickerProduct] = useKeyedState(shopDomain, initialPickerProduct);
  const { path: pickerProductPath } = pickerProduct;
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

  useEffect(() => {
    const domain = String(shopDomain || '').trim();
    if (!domain) return undefined;
    let cancelled = false;
    // Published only: an unpublished product 404s on the storefront, so it
    // would open the picker on an error page. Several are requested because the
    // first one back can be a draft-handle oddity with no handle at all.
    apiGet(
      `/shopify/store-resources?type=product&first=5&query=${encodeURIComponent(
        'published_status:published'
      )}`,
      { shop: domain }
    )
      .then(res => {
        if (cancelled) return;
        const product = Array.isArray(res?.data?.resources)
          ? res.data.resources.find(p => p?.handle)
          : null;
        setPickerProduct({ path: productPathFromResource(product), loading: false });
      })
      .catch(() => {
        if (!cancelled) setPickerProduct({ path: '', loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [shopDomain, setPickerProduct]);

  const resolvedProductPath = pickerProductPath || '';
  const { loading: pickerProductLoading } = pickerProduct;

  const localDevPasswordUi = isLocalDevStorefrontPasswordUiEnabled();
  // When .env provides the password, never render the Settings password field.
  const allowPasswordField = localDevPasswordUi && !envPassword;

  const getPickerLaunchUrl = useCallback(
    row => {
      const domain = String(shopDomain || '').trim();
      if (!domain) {
        return '';
      }
      const surface = String(row?.surface || 'pdp').toLowerCase();
      const password = resolveStorefrontPasswordForPreview(
        domain,
        envPassword || (allowPasswordField ? storefrontPassword : '')
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
          return 'No published product to preview this on. Publish a product to your Online Store, or add a Specific URL row and pick on a page you name.';
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
          Open Settings from a connected shop to edit theme price selectors.
        </p>
      </div>
    );
  }

  return (
    <PriceSurfaceMappingsPanel
      styles={targetingStyles}
      shopDomain={shopDomain}
      storefrontPassword={envPassword || storefrontPassword}
      envStorefrontPassword={envPassword}
      onStorefrontPasswordChange={allowPasswordField ? handleStorefrontPasswordChange : undefined}
      productPath={resolvedProductPath}
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
