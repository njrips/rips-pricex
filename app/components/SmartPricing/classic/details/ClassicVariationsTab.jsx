import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Select, TextField } from '@shopify/polaris';
import { ensureSmartPricingPlanPreviewTest } from '../../../../services/smartPricingApi';
import { formatCurrency } from '../../smartPricingConstants';
import { formatOfferRule, formatOfferSummary } from '../offerSelection';
import {
  VARIATION_PRODUCTS_PAGE_SIZE,
  VARIATION_PRODUCTS_PAGE_SIZES,
  averageGroupArmPrice,
  buildQrImageUrl,
  buildVariationPreviewUrl,
  buildVariationProductsMatrix,
  filterSortVariationProducts,
  formatNumber,
  formatRate,
  formatSmartPricingPreviewVariantName,
  formatVariationVariantLabel,
  groupArmPricesAreMixed,
  groupVariationProductsByProduct,
  paginateVariationProducts,
  resolvePlanProductPath,
} from '../classicExperimentDetailsHelpers';
import {
  ButtonIconExternalLink,
  ButtonIconQr,
  IconChevron,
  IconChevronRight,
  IconTrophy,
} from '../classicIcons';
import styles from '../SmartPricingClassic.module.css';

function openPreview(url) {
  if (!url || typeof window === 'undefined') return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Resolve a storefront PDP path for preview. Prefer handle; if missing, look up
 * the Shopify product and refuse unpublished products (storefront 404 = blank preview).
 */
function withShopifyVariantQuery(path, product) {
  const base = String(path || '').trim();
  if (!base.startsWith('/products/')) return base;
  if (/[?&]variant=\d+/i.test(base)) return base;
  const variantNumeric = String(product?.variantId || product?.variant_id || '')
    .trim()
    .match(/(\d+)$/)?.[1];
  if (!variantNumeric) return base;
  return `${base}${base.includes('?') ? '&' : '?'}variant=${variantNumeric}`;
}

async function resolvePreviewProductPath(product) {
  const existing = resolvePlanProductPath(product || null);
  if (existing.startsWith('/products/')) {
    return { path: withShopifyVariantQuery(existing, product), error: null };
  }
  const productId = String(product?.productId || product?.product_id || '').trim();
  if (!productId || typeof window === 'undefined') {
    return { path: null, error: 'Preview needs a product handle from the catalog.' };
  }
  try {
    const res = await fetch(`/api/shopify/products/${encodeURIComponent(productId)}`, {
      credentials: 'include',
    });
    const data = await res.json().catch(() => null);
    const handle = String(data?.product?.handle || '').trim();
    if (!res.ok || !handle) {
      return {
        path: null,
        error: 'Could not load this product from Shopify. It may have been deleted.',
      };
    }
    if (!data.product.publishedAt && !data.product.onlineStoreUrl) {
      return {
        path: null,
        error:
          `"${data.product.title || 'Product'}" is not published to the Online Store. ` +
          'Publish it in Shopify Admin → Products, then retry Preview.',
      };
    }
    return {
      path: withShopifyVariantQuery(`/products/${encodeURIComponent(handle)}`, product),
      error: null,
    };
  } catch {
    return { path: null, error: 'Could not verify product availability for preview.' };
  }
}

function matchEnsuredArmVariant(ensuredVariants, arm) {
  const rows = Array.isArray(ensuredVariants) ? ensuredVariants : [];
  if (!rows.length || !arm) return null;
  const byId = rows.find(row => String(row.armId) === String(arm.id));
  if (byId) return byId;
  const label = String(arm.label || '')
    .trim()
    .toLowerCase();
  if (label) {
    const byLabel = rows.find(
      row =>
        String(row.label || '')
          .trim()
          .toLowerCase() === label
    );
    if (byLabel) return byLabel;
  }
  if (Number.isFinite(Number(arm.armIndex))) {
    return rows[Number(arm.armIndex)] || null;
  }
  return null;
}

/**
 * Prepare + optionally open a storefront preview for one arm/SKU.
 * @returns {Promise<string|null>} preview URL when successful
 */
async function prepareArmPreviewUrl(arm, product, shopDomain, fallbackTestId) {
  const baseProduct = product || arm?.products?.[0] || null;
  let nextProduct = { ...(baseProduct || {}) };
  // Drop experiment-level arm.variantName so sibling SKUs rebuild their own priced name.
  let nextArm = {
    ...arm,
    variantName: null,
    variantId: undefined,
  };

  // Queued multi-SKU experiments share one consolidated draft preview test so
  // every selected product can paint — not only the first plan with a test_id.
  const planId = String(nextProduct.planId || nextProduct.plan_id || '').trim();
  if (!shopDomain) {
    window.alert('Preview needs an active shop domain. Reload the app and try again.');
    return null;
  }
  if (planId) {
    try {
      const ensured = await ensureSmartPricingPlanPreviewTest(shopDomain, planId);
      if (!ensured?.testId) {
        window.alert('Could not prepare a preview test for this product.');
        return null;
      }
      if (!ensured.storefrontReady && !ensured.handle) {
        window.alert(
          'This product is not available on the Online Store yet. Publish it in Shopify Admin, then retry Preview.'
        );
        return null;
      }
      const armMatch = matchEnsuredArmVariant(ensured.variants, arm);
      nextProduct = {
        ...nextProduct,
        testId: ensured.testId,
        handle: ensured.handle || nextProduct.handle,
        product_handle: ensured.handle || nextProduct.product_handle,
        variantId: ensured.variantId || nextProduct.variantId,
        price:
          armMatch?.price !== null && armMatch?.price !== undefined
            ? armMatch.price
            : (nextProduct.price ?? nextProduct.pricesByArmId?.[String(arm?.id)]),
      };
      if (armMatch?.variantName || armMatch?.variantId) {
        nextArm = {
          ...nextArm,
          variantId: armMatch.variantId || undefined,
          variantName: armMatch.variantName || null,
          price: armMatch.price ?? nextArm.price,
        };
      }
      if (ensured.productPath && ensured.productPath.startsWith('/products/')) {
        const pathHandle = ensured.productPath
          .replace(/^\/products\//, '')
          .split('?')[0]
          .trim();
        if (pathHandle) {
          nextProduct.handle = decodeURIComponent(pathHandle);
          nextProduct.product_handle = nextProduct.handle;
        }
        const variantMatch = String(ensured.productPath).match(/[?&]variant=(\d+)/);
        if (variantMatch?.[1]) {
          nextProduct.variantId =
            nextProduct.variantId || `gid://shopify/ProductVariant/${variantMatch[1]}`;
        }
      }
    } catch (err) {
      window.alert(
        (err && (err.message || err.error)) ||
          'Could not prepare storefront preview for this product.'
      );
      return null;
    }
  }

  const resolved = await resolvePreviewProductPath(nextProduct);
  if (resolved.error) {
    window.alert(resolved.error);
    return null;
  }
  const handle = String(resolved.path || '')
    .replace(/^\/products\//, '')
    .split('?')[0]
    .trim();
  const url = armPreviewUrl(
    nextArm,
    {
      ...nextProduct,
      handle,
      product_handle: handle,
      price: nextProduct.price ?? nextProduct.pricesByArmId?.[String(arm?.id)] ?? nextArm.price,
    },
    shopDomain,
    nextProduct.testId || fallbackTestId
  );
  if (!url) {
    window.alert(
      'Preview unavailable for this variation until the experiment is launched and linked.'
    );
    return null;
  }
  return url;
}

async function openArmPreview(arm, product, shopDomain, fallbackTestId, { onBusy } = {}) {
  const busyKey = String(
    product?.planId || product?.plan_id || product?.productId || arm?.id || 'preview'
  );
  try {
    if (typeof onBusy === 'function') onBusy(busyKey);
    const url = await prepareArmPreviewUrl(arm, product, shopDomain, fallbackTestId);
    if (url) openPreview(url);
  } finally {
    if (typeof onBusy === 'function') onBusy('');
  }
}

const TEST_VARIANT_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Build preview URL for an arm on a product/SKU.
 * Always send variantName so multi-test experiments can still force the arm.
 * Never put display labels like "$854.94 Variation A" into ab_preview_variant —
 * only real test variant UUIDs belong there.
 * Never pair a product PDP with another plan's testId — byProduct won't match and
 * the storefront correctly refuses to paint (matrix miss).
 */
function armPreviewUrl(arm, product, shopDomain, fallbackTestId) {
  if (!shopDomain || !arm) return null;
  const productTestId =
    product?.testId !== null && product?.testId !== undefined && String(product.testId).trim()
      ? String(product.testId).trim()
      : '';
  // Only fall back when we don't have a concrete product row (arm-level preview).
  const testId =
    productTestId ||
    (!product?.productId &&
    fallbackTestId !== null &&
    fallbackTestId !== undefined &&
    String(fallbackTestId).trim()
      ? String(fallbackTestId).trim()
      : '');
  if (!testId) return null;
  const rawVariantId =
    arm.variantId !== null && arm.variantId !== undefined ? String(arm.variantId).trim() : '';
  // UUID is safe when:
  // - this product row already has its own preview testId (from ensure), or
  // - UUID belongs to the same fallback test (single-test experiments).
  // Cross-plan UUIDs without a product testId are omitted — name matching covers those.
  const uuidOk = TEST_VARIANT_UUID_RE.test(rawVariantId);
  const productOwnsTest = Boolean(productTestId);
  const sameFallbackTest =
    Boolean(fallbackTestId) && testId && String(testId) === String(fallbackTestId);
  const safeVariantId = uuidOk && (productOwnsTest || sameFallbackTest) ? rawVariantId : undefined;
  const productForName = product || arm?.products?.[0] || null;
  return buildVariationPreviewUrl({
    shopDomain,
    testId,
    variantId: safeVariantId,
    // Prefer "$884.94 Variation A" over short "Variation A" so preview does not
    // fall back to Control when the experiment-level test row has no variantName.
    variantName: formatSmartPricingPreviewVariantName(arm, {
      price: productForName?.price ?? arm.price,
      currency: productForName?.currency,
    }),
    productPath: resolvePlanProductPath(productForName),
  });
}

function VariationCard({
  arm,
  currency,
  shopDomain,
  fallbackTestId,
  productCount,
  qrOpenId,
  setQrOpenId,
  previewBusyKey,
  onPreviewBusy,
  isOfferTest = false,
}) {
  const popoverRef = useRef(null);
  const copyTimerRef = useRef(null);
  const primaryProduct = arm.products?.[0] || null;
  const busyKey = String(primaryProduct?.planId || primaryProduct?.productId || arm?.id || '');
  const isBusy = Boolean(previewBusyKey) && String(previewBusyKey) === busyKey;
  const multiSku = productCount > 1;
  const previewUrl = useMemo(
    () => armPreviewUrl(arm, primaryProduct, shopDomain, fallbackTestId),
    [arm, primaryProduct, shopDomain, fallbackTestId]
  );
  const [ensuredQrUrl, setEnsuredQrUrl] = useState('');
  const qrUrl = buildQrImageUrl(ensuredQrUrl || previewUrl, 168);
  const isQrOpen = qrOpenId === arm.id;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isQrOpen) return undefined;
    const onDoc = event => {
      if (popoverRef.current && !popoverRef.current.contains(event.target)) {
        setQrOpenId('');
      }
    };
    const onKey = event => {
      if (event.key === 'Escape') setQrOpenId('');
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [isQrOpen, setQrOpenId]);

  useEffect(
    () => () => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    },
    []
  );

  const runPreview = () =>
    openArmPreview(arm, primaryProduct, shopDomain, fallbackTestId, {
      onBusy: onPreviewBusy,
    });

  const openQr = async () => {
    if (isQrOpen) {
      setQrOpenId('');
      return;
    }
    if (previewUrl) {
      setEnsuredQrUrl(previewUrl);
      setQrOpenId(arm.id);
      return;
    }
    try {
      if (typeof onPreviewBusy === 'function') onPreviewBusy(busyKey);
      const url = await prepareArmPreviewUrl(arm, primaryProduct, shopDomain, fallbackTestId);
      if (!url) return;
      setEnsuredQrUrl(url);
      setQrOpenId(arm.id);
    } finally {
      if (typeof onPreviewBusy === 'function') onPreviewBusy('');
    }
  };

  const copyLink = async () => {
    try {
      if (typeof onPreviewBusy === 'function') onPreviewBusy(busyKey);
      const url =
        ensuredQrUrl ||
        previewUrl ||
        (await prepareArmPreviewUrl(arm, primaryProduct, shopDomain, fallbackTestId));
      if (!url) return;
      setEnsuredQrUrl(url);
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore
    } finally {
      if (typeof onPreviewBusy === 'function') onPreviewBusy('');
    }
  };

  const offerLabel = arm?.offer ? formatOfferRule(arm.offer, currency) : '';
  const offerSummary = arm?.offer ? formatOfferSummary(arm.offer, currency) : '';
  const priceLabel =
    isOfferTest || (offerLabel && offerLabel !== 'No offer')
      ? arm.isControl
        ? 'No offer'
        : offerLabel && offerLabel !== 'No offer'
          ? offerLabel
          : 'No offer'
      : multiSku
        ? `${productCount} SKUs`
        : arm.price !== null && arm.price !== undefined && Number.isFinite(Number(arm.price))
          ? formatCurrency(arm.price, currency)
          : '—';

  const canPreview =
    Boolean(shopDomain) &&
    Boolean(primaryProduct?.planId || primaryProduct?.productId || previewUrl);

  return (
    <div className={`${styles.statCard} ${styles.variationArmCard}`}>
      <div className={styles.reviewHead}>
        <h3 className={styles.panelTitle}>
          {arm.label}
          {arm.isControl ? <span className={styles.controlBadge}>Control</span> : null}
          {arm.isWinner ? (
            <span className={styles.winnerBadge}>
              <IconTrophy size={10} /> Winner
            </span>
          ) : null}
        </h3>
        <strong>{priceLabel}</strong>
      </div>
      {isOfferTest && !arm.isControl && offerSummary && offerSummary !== offerLabel ? (
        <p className={styles.help} style={{ marginTop: 0 }}>
          {arm.offer?.offer_message}
        </p>
      ) : null}

      <div className={styles.selectionBar}>
        <span>Traffic split</span>
        <strong>
          {arm.allocation !== null && arm.allocation !== undefined ? `${arm.allocation}%` : '—'}
        </strong>
      </div>
      {isOfferTest ? null : (
        <div className={styles.selectionBar}>
          <span>Delta vs control</span>
          <strong>
            {arm.deltaPercent !== null && arm.deltaPercent !== undefined
              ? `${Number(arm.deltaPercent) >= 0 ? '+' : ''}${Number(arm.deltaPercent).toFixed(1)}%`
              : '—'}
          </strong>
        </div>
      )}
      <div className={styles.selectionBar}>
        <span>Visitors</span>
        <strong>{formatNumber(arm.visitors)}</strong>
      </div>
      <div className={styles.selectionBar}>
        <span>Conversion rate</span>
        <strong>{formatRate(arm.conversionRate)}</strong>
      </div>

      <div className={styles.variationPreviewRow} ref={popoverRef}>
        {canPreview ? (
          <>
            <Button
              icon={ButtonIconExternalLink}
              disabled={Boolean(previewBusyKey)}
              loading={isBusy}
              onClick={runPreview}
            >
              Preview
            </Button>
            <Button
              icon={ButtonIconQr}
              aria-expanded={isQrOpen}
              disabled={Boolean(previewBusyKey)}
              onClick={openQr}
            >
              QR
            </Button>
          </>
        ) : (
          <p className={styles.help} style={{ margin: 0 }}>
            Preview available after this arm is linked to a running test.
          </p>
        )}
        {isQrOpen && (ensuredQrUrl || previewUrl) ? (
          <div
            className={styles.variationQrPopover}
            role="dialog"
            aria-label={`QR preview for ${arm.label}`}
          >
            {qrUrl ? (
              <img className={styles.variationQrImage} src={qrUrl} alt={`QR for ${arm.label}`} />
            ) : null}
            <p className={styles.help}>
              Scan to open {arm.label}
              {primaryProduct?.title ? ` on ${primaryProduct.title}` : ''}.
              {multiSku ? ' Per-SKU previews are also in the products table below.' : ''}
            </p>
            <div className={styles.variationPreviewRow}>
              <Button disabled={Boolean(previewBusyKey)} onClick={runPreview}>
                Open link
              </Button>
              <Button disabled={Boolean(previewBusyKey)} onClick={copyLink}>
                {copied ? 'Copied' : 'Copy link'}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatArmCell(group, armId, currency, { variantRow = null, isOfferTest = false, arms = [] } = {}) {
  if (isOfferTest) {
    const arm = (arms || []).find(row => String(row.id) === String(armId));
    if (arm?.isControl) return 'No offer';
    return formatOfferRule(arm?.offer, currency);
  }
  if (variantRow) {
    const price = variantRow.pricesByArmId?.[String(armId)];
    return price !== null && price !== undefined && Number.isFinite(Number(price))
      ? formatCurrency(price, variantRow.currency || currency)
      : '—';
  }
  if (groupArmPricesAreMixed(group, armId)) return 'Mixed';
  const avg = averageGroupArmPrice(group, armId);
  return avg !== null && avg !== undefined ? formatCurrency(avg, group.currency || currency) : '—';
}

function VariationsProductsTable({
  variations,
  currency,
  shopDomain,
  fallbackTestId,
  resetKey = '',
  previewBusyKey = '',
  onPreviewBusy,
  isOfferTest = false,
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(VARIATION_PRODUCTS_PAGE_SIZE);
  const [previewArmId, setPreviewArmId] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());

  const arms = variations || [];
  const controlArm = arms.find(arm => arm.isControl) || arms[0] || null;
  const matrix = useMemo(() => buildVariationProductsMatrix(arms), [arms]);
  const defaultArmId =
    controlArm?.id !== null && controlArm?.id !== undefined ? String(controlArm.id) : '';

  useEffect(() => {
    setQuery('');
    setPage(1);
    setPageSize(VARIATION_PRODUCTS_PAGE_SIZE);
    setPreviewArmId(defaultArmId);
    setExpanded(new Set());
  }, [resetKey, defaultArmId]);

  useEffect(() => {
    const valid = arms.some(arm => String(arm.id) === String(previewArmId));
    if (!valid && defaultArmId) setPreviewArmId(defaultArmId);
  }, [arms, previewArmId, defaultArmId]);

  const filteredMatrix = useMemo(
    () =>
      filterSortVariationProducts(matrix, {
        query,
        sort: 'title',
      }),
    [matrix, query]
  );

  const groups = useMemo(() => groupVariationProductsByProduct(filteredMatrix), [filteredMatrix]);

  const pageData = useMemo(
    () => paginateVariationProducts(groups, page, pageSize),
    [groups, page, pageSize]
  );

  useEffect(() => {
    if (page !== pageData.page) setPage(pageData.page);
  }, [page, pageData.page]);

  // Auto-expand the first multi-variant group on each result set.
  useEffect(() => {
    const firstMulti = pageData.items.find(g => (g.variants || []).length > 1);
    if (!firstMulti) return;
    setExpanded(prev => {
      if (prev.size) return prev;
      return new Set([firstMulti.key]);
    });
  }, [pageData.items]);

  if (!matrix.length) {
    return (
      <div className={styles.statCard}>
        <h3 className={styles.panelTitle}>Products</h3>
        <p className={styles.help}>No products are attached to this experiment yet.</p>
      </div>
    );
  }

  const previewArm =
    arms.find(arm => String(arm.id) === String(previewArmId)) || controlArm || arms[0];
  const showPager = pageData.totalPages > 1 || pageData.total > VARIATION_PRODUCTS_PAGE_SIZE;

  const toggleExpand = key => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandAllOnPage = () => {
    setExpanded(prev => {
      const next = new Set(prev);
      pageData.items.forEach(group => {
        if ((group.variants || []).length > 1) next.add(group.key);
      });
      return next;
    });
  };

  const collapseAll = () => setExpanded(new Set());

  return (
    <div className={`${styles.statCard} ${styles.variationsProductsPanel}`}>
      <div className={styles.variationProductBlockHead}>
        <div>
          <h3 className={styles.panelTitle}>Products</h3>
          <p className={styles.help} style={{ margin: 0 }}>
            {groups.length} product{groups.length === 1 ? '' : 's'} · {filteredMatrix.length} SKU
            {filteredMatrix.length === 1 ? '' : 's'} · expand for variants · Open prepares a shared
            preview test for every selected SKU
            {previewBusyKey ? ' · Preparing preview…' : ''}
          </p>
        </div>
        <div className={styles.variationPreviewRow} style={{ marginTop: 0 }}>
          <Button onClick={expandAllOnPage}>Expand</Button>
          <Button onClick={collapseAll}>Collapse</Button>
        </div>
      </div>

      <div className={styles.variationsProductsToolbar}>
        <div className={styles.variationsProductsSearch}>
          <TextField
            label="Search products"
            labelHidden
            value={query}
            onChange={value => {
              setQuery(value);
              setPage(1);
            }}
            autoComplete="off"
            placeholder="Search products, variants, or handle"
          />
        </div>
        <div className={styles.tablePageSize}>
          <Select
            label="Preview as"
            labelHidden
            value={String(previewArmId || defaultArmId || '')}
            onChange={setPreviewArmId}
            options={arms.map(arm => ({
              label: arm.label,
              value: String(arm.id),
            }))}
          />
        </div>
      </div>

      <div className={`${styles.tableScroll} ${styles.variationsProductsTableScroll}`}>
        <table className={styles.table} aria-label="Experiment products grouped by variant">
          <thead>
            <tr>
              <th scope="col">Product</th>
              {arms.map(arm => (
                <th key={arm.id} scope="col" className={styles.variationsPriceCol}>
                  {arm.label}
                </th>
              ))}
              <th scope="col" className={styles.variationsActionsCol}>
                Preview
              </th>
            </tr>
          </thead>
          <tbody>
            {!pageData.items.length ? (
              <tr>
                <td colSpan={arms.length + 2}>
                  <p className={styles.help} style={{ margin: '8px 0' }}>
                    {query.trim() ? 'No products match that search.' : 'No products to show.'}
                  </p>
                </td>
              </tr>
            ) : (
              pageData.items.map(group => {
                const multi = (group.variants || []).length > 1;
                const isOpen = expanded.has(group.key);
                const primaryVariant = group.variants[0] || null;
                const groupPreviewUrl = armPreviewUrl(
                  previewArm,
                  primaryVariant,
                  shopDomain,
                  fallbackTestId
                );

                return (
                  <React.Fragment key={group.key}>
                    <tr className={styles.productPriceRow}>
                      <td>
                        <div className={styles.tableProductCell}>
                          {multi ? (
                            <button
                              type="button"
                              className={styles.expandToggle}
                              onClick={() => toggleExpand(group.key)}
                              aria-expanded={isOpen}
                              aria-label={
                                isOpen
                                  ? `Collapse variants for ${group.title}`
                                  : `Expand variants for ${group.title}`
                              }
                            >
                              {isOpen ? <IconChevron size={12} /> : <IconChevronRight size={12} />}
                            </button>
                          ) : (
                            <span className={styles.expandSpacer} aria-hidden />
                          )}
                          {group.imageUrl ? (
                            <img className={styles.tableThumb} src={group.imageUrl} alt="" />
                          ) : (
                            <span className={styles.tableThumb} aria-hidden />
                          )}
                          <div className={styles.productMeta}>
                            <div className={styles.productName}>{group.title}</div>
                            <div className={styles.productSub}>
                              {group.handle ? `/${group.handle}` : 'Catalog'}
                              {multi ? (
                                <>
                                  {' · '}
                                  <span className={styles.variantCountAccent}>
                                    {group.variants.length} variants
                                  </span>
                                </>
                              ) : primaryVariant ? (
                                <> · {formatVariationVariantLabel(primaryVariant)}</>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </td>
                      {arms.map(arm => (
                        <td key={arm.id} className={styles.variationsPriceCol}>
                          {formatArmCell(group, arm.id, currency, { isOfferTest, arms })}
                        </td>
                      ))}
                      <td className={styles.variationsActionsCol}>
                        <Button
                          size="slim"
                          disabled={
                            Boolean(previewBusyKey) ||
                            !shopDomain ||
                            (!groupPreviewUrl &&
                              !group.productId &&
                              !primaryVariant?.planId &&
                              !primaryVariant)
                          }
                          loading={
                            Boolean(previewBusyKey) &&
                            String(previewBusyKey) ===
                              String(primaryVariant?.planId || group.productId || '')
                          }
                          onClick={() =>
                            openArmPreview(
                              previewArm,
                              primaryVariant || {
                                planId: group.variants?.[0]?.planId || null,
                                testId: group.variants?.[0]?.testId || null,
                                productId: group.productId,
                                variantId: group.variants?.[0]?.variantId || null,
                                handle: group.handle,
                                title: group.title,
                                price:
                                  group.variants?.[0]?.pricesByArmId?.[String(previewArm?.id)] ??
                                  null,
                                currency: group.currency || null,
                              },
                              shopDomain,
                              fallbackTestId,
                              { onBusy: onPreviewBusy }
                            )
                          }
                        >
                          Open
                        </Button>
                      </td>
                    </tr>
                    {multi && isOpen
                      ? group.variants.map(variant => {
                          const variantUrl = armPreviewUrl(
                            previewArm,
                            variant,
                            shopDomain,
                            fallbackTestId
                          );
                          return (
                            <tr key={variant.key} className={styles.variantRow}>
                              <td>
                                <div className={styles.variantLabel}>
                                  <span className={styles.variantBullet} aria-hidden />
                                  {formatVariationVariantLabel(variant)}
                                </div>
                              </td>
                              {arms.map(arm => (
                                <td key={arm.id} className={styles.variationsPriceCol}>
                                  {formatArmCell(group, arm.id, currency, {
                                    variantRow: variant,
                                    isOfferTest,
                                    arms,
                                  })}
                                </td>
                              ))}
                              <td className={styles.variationsActionsCol}>
                                <Button
                                  size="slim"
                                  disabled={
                                    Boolean(previewBusyKey) ||
                                    !shopDomain ||
                                    (!variantUrl &&
                                      !variant.planId &&
                                      !variant.productId &&
                                      !variant.handle)
                                  }
                                  loading={
                                    Boolean(previewBusyKey) &&
                                    String(previewBusyKey) ===
                                      String(variant.planId || variant.productId || '')
                                  }
                                  onClick={() =>
                                    openArmPreview(
                                      previewArm,
                                      variant,
                                      shopDomain,
                                      fallbackTestId,
                                      { onBusy: onPreviewBusy }
                                    )
                                  }
                                >
                                  Open
                                </Button>
                              </td>
                            </tr>
                          );
                        })
                      : null}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {showPager || pageData.total > 0 ? (
        <div className={styles.variationsProductsFooter}>
          <div className={styles.tablePageSize}>
            <span>
              {pageData.total
                ? `${(pageData.page - 1) * pageData.pageSize + 1}–${Math.min(
                    pageData.page * pageData.pageSize,
                    pageData.total
                  )} of ${pageData.total} products`
                : '0 products'}
            </span>
            <div className={styles.tablePageSize}>
              <Select
                label="Rows"
                labelHidden
                value={String(pageSize)}
                onChange={value => {
                  setPageSize(Number(value) || VARIATION_PRODUCTS_PAGE_SIZE);
                  setPage(1);
                }}
                options={VARIATION_PRODUCTS_PAGE_SIZES.map(size => ({
                  label: String(size),
                  value: String(size),
                }))}
              />
            </div>
          </div>
          {showPager ? (
            <div className={styles.tablePager}>
              <Button
                size="slim"
                disabled={pageData.page <= 1}
                accessibilityLabel="Previous page"
                onClick={() => setPage(current => Math.max(1, current - 1))}
              >
                <span className={styles.tablePagerChevronPrev} aria-hidden>
                  <IconChevronRight size={14} />
                </span>
              </Button>
              <span className={styles.help} style={{ margin: 0 }}>
                Page {pageData.page} / {pageData.totalPages}
              </span>
              <Button
                size="slim"
                disabled={pageData.page >= pageData.totalPages}
                accessibilityLabel="Next page"
                onClick={() => setPage(current => Math.min(pageData.totalPages, current + 1))}
              >
                <IconChevronRight size={14} />
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function ClassicVariationsTab({
  variations,
  currency = 'USD',
  shopDomain = '',
  testId = null,
  isOfferTest = false,
}) {
  const [qrOpenId, setQrOpenId] = useState('');
  const [previewBusyKey, setPreviewBusyKey] = useState('');

  const matrix = useMemo(() => buildVariationProductsMatrix(variations || []), [variations]);
  const productCount = matrix.length;
  const resetKey = useMemo(
    () => `${testId || ''}:${(variations || []).map(arm => arm.id).join('|')}:${productCount}`,
    [variations, testId, productCount]
  );

  if (!variations?.length) {
    return (
      <div className={styles.statCard}>
        <h3 className={styles.panelTitle}>Variations</h3>
        <p className={styles.help}>
          {isOfferTest ? 'No offer variations on this experiment yet.' : 'No price arms on this experiment yet.'}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.detailStack}>
      <div className={styles.variationArmGrid}>
        {variations.map(arm => (
          <VariationCard
            key={arm.id}
            arm={arm}
            currency={currency}
            shopDomain={shopDomain}
            fallbackTestId={testId}
            productCount={productCount}
            qrOpenId={qrOpenId}
            setQrOpenId={setQrOpenId}
            previewBusyKey={previewBusyKey}
            onPreviewBusy={setPreviewBusyKey}
            isOfferTest={isOfferTest}
          />
        ))}
      </div>

      <VariationsProductsTable
        variations={variations}
        currency={currency}
        shopDomain={shopDomain}
        fallbackTestId={testId}
        resetKey={resetKey}
        previewBusyKey={previewBusyKey}
        onPreviewBusy={setPreviewBusyKey}
        isOfferTest={isOfferTest}
      />
    </div>
  );
}
