import { describe, expect, it } from 'vitest';
import {
  buildAllProductsCapHelp,
  buildAllProductsSelectionCountLabel,
  buildCatalogTruncatedHelp,
  buildProductPickerEmptyMessage,
  buildProductsStepEmptyMessage,
  buildWithheldDetail,
  countCatalogProducts,
  resolveCatalogLoadedProductCount,
  resolveStoreCatalogProductCount,
  buildStoreCatalogStatusText,
  shouldShowCatalogTruncatedHelp,
} from '../productsStepCatalogCopy';

describe('productsStepCatalogCopy', () => {
  it('resolves store total from server count or available plus withheld', () => {
    expect(
      resolveStoreCatalogProductCount({
        catalogLoadedProductCount: 480,
        availableProductCount: 254,
        withheldCount: 226,
      })
    ).toBe(480);
    expect(
      resolveStoreCatalogProductCount({
        availableProductCount: 30,
        withheldCount: 226,
      })
    ).toBe(256);
    expect(buildStoreCatalogStatusText({
      storeProductCount: 480,
      availableProductCount: 254,
      withheldCount: 226,
    })).toBe(
      '480 active products in your store · 254 available to add · 226 in other tests'
    );
  });

  it('shows store total with zero available when everything is in other tests', () => {
    expect(
      buildStoreCatalogStatusText({
        storeProductCount: 226,
        availableProductCount: 0,
        withheldCount: 226,
      })
    ).toBe('226 active products in your store · 0 available to add · 226 in other tests');
  });

  it('accounts for store products that cannot be priced, so the line adds up', () => {
    expect(
      buildStoreCatalogStatusText({
        storeProductCount: 299,
        availableProductCount: 282,
        withheldCount: 15,
      })
    ).toBe(
      '299 active products in your store · 282 available to add · 15 in other tests · 2 can’t be tested (gift cards or no price)'
    );
  });

  it('names the all-products cap as the top of the list, not the first', () => {
    expect(
      buildAllProductsSelectionCountLabel({ availableProductCount: 282, maxSelection: 250 })
    ).toBe('Top 250 of 282 products');
    expect(
      buildAllProductsSelectionCountLabel({ availableProductCount: 40, maxSelection: 250 })
    ).toBe('All 40 products');
    expect(buildAllProductsCapHelp({ availableProductCount: 282, maxSelection: 250 })).toMatch(
      /leaves 32 out\. Once it launches, those 250 are held, so a second All products test picks up the other 32\./
    );
    expect(buildAllProductsCapHelp({ availableProductCount: 250, maxSelection: 250 })).toBe('');
  });

  it('uses server loaded count for truncation copy, not the shortened pick list', () => {
    const help = buildCatalogTruncatedHelp({
      catalogTruncated: true,
      catalogLoadedProductCount: 250,
    });
    expect(help).toContain('more than 250 active products');
    expect(help).not.toContain('23');
  });

  it('matches step and picker empty copy when everything is in other tests', () => {
    const ctx = {
      availableProductCount: 0,
      withheldCount: 12,
      catalogTruncated: true,
    };
    const step = buildProductsStepEmptyMessage(ctx);
    const picker = buildProductPickerEmptyMessage({
      opportunities: [],
      matchedCount: 0,
      withheldCount: 12,
      catalogTruncated: true,
    });
    expect(step).toContain('No products available to pick');
    expect(picker).toBe(step);
  });

  it('explains filter and search misses differently from an empty catalog', () => {
    const opportunities = [
      { product_id: 'p1', variant_id: 'v1', title: 'Alpha' },
    ];
    expect(
      buildProductPickerEmptyMessage({
        opportunities,
        matchedCount: 0,
        productSearch: 'zzz',
        hasRemoteSearch: true,
      })
    ).toMatch(/No products match that search/);
    expect(
      buildProductPickerEmptyMessage({
        opportunities,
        matchedCount: 0,
        activeGroupValue: 'gid://collection/1',
      })
    ).toMatch(/collection or category/);
  });

  it('counts unique products in opportunity rows', () => {
    const rows = [
      { product_id: 'p1', variant_id: 'v1' },
      { product_id: 'p1', variant_id: 'v2' },
      { product_id: 'p2', variant_id: 'v3' },
    ];
    expect(countCatalogProducts(rows)).toBe(2);
    expect(resolveCatalogLoadedProductCount(250, rows)).toBe(250);
    expect(resolveCatalogLoadedProductCount(null, rows)).toBe(2);
  });

  it('hides truncation help when nothing is pickable', () => {
    expect(
      shouldShowCatalogTruncatedHelp({
        catalogTruncatedHelp: buildCatalogTruncatedHelp({
          catalogTruncated: true,
          catalogLoadedProductCount: 250,
        }),
        availableProductCount: 0,
      })
    ).toBe(false);
    expect(
      shouldShowCatalogTruncatedHelp({
        catalogTruncatedHelp: buildCatalogTruncatedHelp({
          catalogTruncated: true,
          catalogLoadedProductCount: 250,
        }),
        availableProductCount: 12,
      })
    ).toBe(true);
  });

  it('reports whole-catalog search misses by query', () => {
    expect(
      buildProductPickerEmptyMessage({
        opportunities: [{ product_id: 'p1', variant_id: 'v1', title: 'Alpha' }],
        matchedCount: 0,
        productSearch: 'missing sku',
        hasRemoteSearch: true,
        remoteSearchHint: { query: 'missing sku', status: 'empty' },
      })
    ).toContain('No products in your catalog matched "missing sku"');
  });

  it('builds withheld detail for the step tooltip', () => {
    expect(
      buildWithheldDetail({
        total: 2,
        tests: [{ name: 'Summer pricing' }],
      })
    ).toContain('2 products in other tests');
    expect(
      buildWithheldDetail({
        total: 2,
        tests: [{ name: 'Summer pricing' }],
      })
    ).toContain('Summer pricing');
  });

  it('names the experiments holding products, not one test per product', () => {
    const detail = buildWithheldDetail({
      total: 242,
      tests: [{ name: 'Smart Pricing · AAAAA · DZR Minna - 43' }],
      experiments: [
        { title: 'Offer Test Example', products: 180, live: true },
        { title: 'AAAAA', products: 50, live: true },
        { title: 'Spring', products: 7, live: false },
        { title: 'Old', products: 5, live: true },
      ],
    });
    expect(detail).toBe(
      '242 products in other tests: Offer Test Example (180 products, running); AAAAA (50 products, running); Spring (7 products, paused); and 1 more. End those tests on the Tests page to reuse them here.'
    );
    expect(detail).not.toContain('DZR Minna');
  });
});
