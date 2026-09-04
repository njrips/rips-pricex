import { describe, it, expect } from 'vitest';
import { mergeThemePackMappings } from '../priceSurfaceThemePacks';

const slot = row => `${row.surface}:${row.role}`;

describe('mergeThemePackMappings', () => {
  it('applies a pack to an empty configuration', () => {
    const rows = mergeThemePackMappings([], 'dawn');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(row => row.source === 'theme_pack')).toBe(true);
  });

  it('replaces a previous pack rather than stacking on top of it', () => {
    // Trying Dawn, then Horizon, then Legacy used to leave three different
    // "plp regular" selectors live at once, and the storefront painted them all.
    const afterDawn = mergeThemePackMappings([], 'dawn');
    const afterHorizon = mergeThemePackMappings(afterDawn, 'horizon');
    const afterLegacy = mergeThemePackMappings(afterHorizon, 'legacy');

    const plpRegular = afterLegacy.filter(row => slot(row) === 'plp:regular');
    expect(plpRegular).toHaveLength(1);
    expect(plpRegular[0].selector).toBe('.grid-view-item .money');
  });

  it('keeps a pack selector for a slot the new pack does not cover', () => {
    // Legacy has no search mapping, so Dawn's should survive.
    const afterDawn = mergeThemePackMappings([], 'dawn');
    const afterLegacy = mergeThemePackMappings(afterDawn, 'legacy');
    const search = afterLegacy.filter(row => slot(row) === 'search:regular');
    expect(search).toHaveLength(1);
    expect(search[0].selector).toBe('.price-item--regular');
  });

  it('never discards a merchant or visual pick', () => {
    const chosen = [
      {
        surface: 'plp',
        role: 'regular',
        selector: '.my-theme__price',
        source: 'visual',
        priority: 30,
      },
      {
        surface: 'pdp',
        role: 'regular',
        selector: '.my-theme__pdp-price',
        source: 'merchant',
        priority: 30,
      },
    ];
    const merged = mergeThemePackMappings(chosen, 'dawn');
    expect(merged.some(row => row.selector === '.my-theme__price')).toBe(true);
    expect(merged.some(row => row.selector === '.my-theme__pdp-price')).toBe(true);
  });

  it('returns the existing rows unchanged for an unknown pack', () => {
    const existing = mergeThemePackMappings([], 'dawn');
    expect(mergeThemePackMappings(existing, 'not-a-pack')).toHaveLength(existing.length);
  });
});
