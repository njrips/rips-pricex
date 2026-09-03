import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import { Banner, BlockStack, Box, Card, Text, TextField } from '@shopify/polaris';
import { ProductIcon } from '@shopify/polaris-icons';
import PriceSurfaceMappingsPanel from '../../TestWizard/PriceSurfaceMappingsPanel';
import targetingStyles from '../../TestWizard/TargetingSection.module.css';
import { SectionTitleWithTip } from '../primitives/SectionTitleWithTip';
import { SECTION_HELP } from '../config/settingsSectionHelp';
import {
  buildPriceSurfacePickerPath,
  inferPriceSurfaceFromHref,
  inferPriceSurfaceRoleFromPickerHints,
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
import styles from '../Settings.module.css';

function productPathFromResource(product) {
  const handle = String(product?.handle || '')
    .trim()
    .replace(/^\/+/, '');
  if (!handle) return '';
  return `/products/${encodeURIComponent(handle)}`;
}

export function StoreSettingsPriceSurfacesSection({
  showAllAppSections,
  shopDomain = '',
  autoMapRequestToken = 0,
  bare = false,
}) {
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
  const { path: pickerProductPath, loading: pickerProductLoading } = pickerProduct;
  const [manualProductPath, setManualProductPath] = useState('');
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
    apiGet('/shopify/store-resources?type=product&first=1', { shop: domain })
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

  const resolvedProductPath = useMemo(() => {
    const manual = String(manualProductPath || '').trim();
    if (manual) {
      if (manual.startsWith('/products/')) return manual;
      if (manual.startsWith('products/')) return `/${manual}`;
      if (!manual.includes('/')) return `/products/${encodeURIComponent(manual)}`;
      try {
        const url = new URL(manual);
        if (url.pathname.includes('/products/')) return url.pathname;
      } catch {
        // keep as path-like input
      }
      return manual.startsWith('/') ? manual : `/${manual}`;
    }
    return pickerProductPath || '';
  }, [manualProductPath, pickerProductPath]);

  const localDevPasswordUi = isLocalDevStorefrontPasswordUiEnabled();
  // When .env provides the password, never render the Settings password field.
  const allowPasswordField = localDevPasswordUi && !envPassword;

  const getPickerLaunchUrl = useCallback(
    (surface = 'pdp') => {
      const domain = String(shopDomain || '').trim();
      if (!domain) {
        return '';
      }
      const password = resolveStorefrontPasswordForPreview(
        domain,
        envPassword || (allowPasswordField ? storefrontPassword : '')
      );
      const path = buildPriceSurfacePickerPath(surface, {
        productPath: resolvedProductPath || undefined,
        collectionPath: '/collections/all',
      });
      // Avoid opening homepage for PDP picks when no product is available yet.
      if (
        (surface === 'pdp' ||
          surface === 'recommendation' ||
          surface === 'quickview' ||
          surface === 'global') &&
        (!resolvedProductPath || path === '/')
      ) {
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
      if (roleHint) {
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

  const sectionSummary = useMemo(
    () =>
      'Shop defaults apply to every Classic Smart Pricing test. When a visitor is bucketed, Pricify paints mapped selectors on PDP, listings, and cart.',
    []
  );

  const beginVisualPick = useCallback(
    target => {
      const surface = String(target?.surface || 'pdp').toLowerCase();
      const needsProduct =
        surface === 'pdp' ||
        surface === 'recommendation' ||
        surface === 'quickview' ||
        surface === 'global';
      if (needsProduct && !resolvedProductPath) {
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

  const body = bare ? (
    <div className={classicStyles.adminStackTight}>
      <p className={classicStyles.help}>{sectionSummary}</p>
      <Banner tone="info" title="One mapping for all price tests">
        <p>
          Suggest from theme or Auto-map (scans theme files + live pages), then verify with
          visual pick on a real product page. Test Wizard can still add per-test overrides when
          needed.
        </p>
      </Banner>
      {shopDomain ? (
        <TextField
          label="Product path for visual pick"
          value={manualProductPath}
          onChange={setManualProductPath}
          autoComplete="off"
          placeholder={
            pickerProductLoading
              ? 'Loading a sample product…'
              : resolvedProductPath || '/products/your-product-handle'
          }
          helpText={
            resolvedProductPath
              ? `Pick PDP opens ${resolvedProductPath}. Override with a handle or /products/… path if needed.`
              : 'Enter a product handle so Pick PDP opens a real product page (not the homepage).'
          }
        />
      ) : (
        <p className={classicStyles.help}>
          Open Settings from a connected shop to edit theme price selectors.
        </p>
      )}
      {shopDomain ? (
        <PriceSurfaceMappingsPanel
          mode="shop"
          styles={targetingStyles}
          testMappings={[]}
          shopDomain={shopDomain}
          storefrontPassword={envPassword || storefrontPassword}
          envStorefrontPassword={envPassword}
          onStorefrontPasswordChange={
            allowPasswordField ? handleStorefrontPasswordChange : undefined
          }
          productPath={resolvedProductPath}
          autoMapRequestToken={autoMapRequestToken}
          getPickerLaunchUrl={getPickerLaunchUrl}
          pickTarget={pickTarget}
          onBeginVisualPick={beginVisualPick}
          onCancelVisualPick={() => {
            pickTargetRef.current = null;
            setPickTarget(null);
          }}
          onRegisterShopPickHandler={handler => {
            shopPickHandlerRef.current = handler;
          }}
          onTestMappingsChange={() => {}}
        />
      ) : null}
    </div>
  ) : (
        <BlockStack gap="400">
          <div className={styles.sectionHeader}>
            <div className={styles.sectionHeaderIcon}>
              <ProductIcon />
            </div>
            <div className={styles.sectionHeaderContent}>
              <SectionTitleWithTip
                title="Theme price selectors"
                tip={SECTION_HELP.themePriceSelectors}
              />
              <Text as="p" variant="bodySm" tone="subdued">
                {sectionSummary}
              </Text>
            </div>
          </div>

          <Banner tone="info" title="One mapping for all price tests">
            <p>
              Configure selectors once here. Test Wizard can still add per-test overrides when a
              theme needs a one-off. Auto-map scans theme files and live pages; visual pick is
              the fallback for custom blocks.
            </p>
          </Banner>

          {shopDomain ? (
            <TextField
              label="Product path for visual pick"
              value={manualProductPath}
              onChange={setManualProductPath}
              autoComplete="off"
              placeholder={
                pickerProductLoading
                  ? 'Loading a sample product…'
                  : resolvedProductPath || '/products/your-product-handle'
              }
              helpText={
                resolvedProductPath
                  ? `Pick PDP opens ${resolvedProductPath}. Override with a handle or /products/… path if needed.`
                  : 'Enter a product handle so Pick PDP opens a real product page (not the homepage).'
              }
            />
          ) : null}

          {!shopDomain ? (
            <Text as="p" variant="bodySm" tone="caution">
              Open Settings from a connected shop to edit theme price selectors.
            </Text>
          ) : (
            <PriceSurfaceMappingsPanel
              mode="shop"
              styles={targetingStyles}
              testMappings={[]}
              shopDomain={shopDomain}
              storefrontPassword={envPassword || storefrontPassword}
              envStorefrontPassword={envPassword}
              onStorefrontPasswordChange={
                allowPasswordField ? handleStorefrontPasswordChange : undefined
              }
              productPath={resolvedProductPath}
              autoMapRequestToken={autoMapRequestToken}
              getPickerLaunchUrl={getPickerLaunchUrl}
              pickTarget={pickTarget}
              onBeginVisualPick={beginVisualPick}
              onCancelVisualPick={() => {
                pickTargetRef.current = null;
                setPickTarget(null);
              }}
              onRegisterShopPickHandler={handler => {
                shopPickHandlerRef.current = handler;
              }}
              onTestMappingsChange={() => {}}
            />
          )}
        </BlockStack>
  );

  if (bare) {
    return body;
  }

  return (
    <Card
      className={`${styles.settingsPanelCard} ${showAllAppSections ? styles.settingsPanelCardFull : ''}`}
    >
      <Box padding="500">{body}</Box>
    </Card>
  );
}
