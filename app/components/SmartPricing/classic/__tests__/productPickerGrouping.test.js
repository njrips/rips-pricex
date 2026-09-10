/**
 * The picker listed one row per variant and called that count "products",
 * while the step beside it counted products: one catalog of 80 products with
 * 120 variants read as "80 products" on the step and "All products (120)" in
 * the picker. A price test is picked per product -- the cap counts products,
 * the footer counts products, and checking one variant pulls its siblings in
 * with it -- so the list belongs in products too.
 */
import { describe, expect, it } from 'vitest';
import {
  groupOpportunitiesByProduct,
  productPriceRange,
  splitTitleParts,
} from '../productsStepReadiness';

function variant(productId, variantId, overrides = {}) {
  return {
    product_id: productId,
    variant_id: variantId,
    product_title: 'Runner Shoe',
    title: 'Runner Shoe',
    current_price: 40,
    ...overrides,
  };
}

describe('groupOpportunitiesByProduct', () => {
  it('folds a product\u2019s variants into one entry', () => {
    const groups = groupOpportunitiesByProduct([
      variant('p1', 'v1'),
      variant('p1', 'v2'),
      variant('p1', 'v3'),
      variant('p2', 'v4', { product_title: 'Trail Shoe' }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].variantIds).toEqual(['v1', 'v2', 'v3']);
    expect(groups[1].variantIds).toEqual(['v4']);
  });

  it('counts the same products the step counts', () => {
    // The whole point: 120 variant rows over 80 products is 80 either side.
    const rows = [];
    for (let product = 0; product < 80; product += 1) {
      rows.push(variant(`p${product}`, `v${product}a`));
      if (product < 40) rows.push(variant(`p${product}`, `v${product}b`));
    }
    expect(rows).toHaveLength(120);
    expect(groupOpportunitiesByProduct(rows)).toHaveLength(80);
  });

  it('keeps every variant reachable, so selecting a product selects all of it', () => {
    const [group] = groupOpportunitiesByProduct([variant('p1', 'v1'), variant('p1', 'v2')]);
    expect(group.rows).toHaveLength(2);
    expect(group.variantIds).toEqual(['v1', 'v2']);
  });

  it('drops a row with nothing to group it by rather than inventing a product', () => {
    const groups = groupOpportunitiesByProduct([
      { variant_id: '', product_id: '', title: '' },
      variant('p1', 'v1'),
    ]);
    expect(groups).toHaveLength(1);
  });

  it('falls back to the title when the catalog gives no product id', () => {
    const groups = groupOpportunitiesByProduct([
      { variant_id: 'v1', title: 'Runner Shoe' },
      { variant_id: 'v2', title: 'Runner Shoe' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].variantIds).toEqual(['v1', 'v2']);
  });

  it('answers an empty catalog with an empty list', () => {
    expect(groupOpportunitiesByProduct([])).toEqual([]);
    expect(groupOpportunitiesByProduct(null)).toEqual([]);
  });
});

describe('productPriceRange', () => {
  it('reads one price when every variant costs the same', () => {
    const [group] = groupOpportunitiesByProduct([variant('p1', 'v1'), variant('p1', 'v2')]);
    expect(productPriceRange(group)).toEqual({ min: 40, max: 40 });
  });

  it('reads a range when the variants disagree, rather than picking the first', () => {
    const [group] = groupOpportunitiesByProduct([
      variant('p1', 'v1', { current_price: 40 }),
      variant('p1', 'v2', { current_price: 65 }),
    ]);
    expect(productPriceRange(group)).toEqual({ min: 40, max: 65 });
  });

  it('ignores a variant with no usable price', () => {
    const [group] = groupOpportunitiesByProduct([
      variant('p1', 'v1', { current_price: 0 }),
      variant('p1', 'v2', { current_price: 50 }),
    ]);
    expect(productPriceRange(group)).toEqual({ min: 50, max: 50 });
  });

  it('says nothing rather than zero when no variant has a price', () => {
    const [group] = groupOpportunitiesByProduct([variant('p1', 'v1', { current_price: null })]);
    expect(productPriceRange(group)).toEqual({ min: null, max: null });
  });
});

describe('splitTitleParts', () => {
  it('prefers the explicit product title the catalog sends', () => {
    expect(splitTitleParts({ product_title: 'Runner Shoe', variant_title: 'Blue' })).toEqual({
      productTitle: 'Runner Shoe',
      variantTitle: 'Blue',
    });
  });

  it('splits a combined title, so a grouped row names the product only', () => {
    expect(splitTitleParts({ title: 'Runner Shoe — Blue / 42' })).toEqual({
      productTitle: 'Runner Shoe',
      variantTitle: 'Blue / 42',
    });
  });

  it('treats Shopify\u2019s placeholder variant name as no variant at all', () => {
    expect(
      splitTitleParts({ product_title: 'Runner Shoe', variant_title: 'Default Title' }).variantTitle
    ).toBe('');
  });
});
