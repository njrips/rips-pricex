import { describe, expect, it } from 'vitest';
import {
  autoMapPrimaryActionLabel,
  buildDefaultAcceptedSlots,
  buildAutoMapModalIntro,
  filterAutoMapModalSurfaces,
  shouldAutoPersistAutoMapResult,
  shouldQuickSaveAutoMapResult,
  summarizeAutoMapResult,
} from '../priceSurfaceAutoMapUi';

describe('priceSurfaceAutoMapUi', () => {
  const baseResult = {
    ready_to_save: true,
    password_gate: false,
    theme_drift: { detected: false },
    surfaces: [
      { surface: 'pdp', role: 'regular', status: 'matched', selector: '.price-item--regular' },
      { surface: 'plp', role: 'regular', status: 'matched', selector: '.card__price' },
      { surface: 'cart', role: 'regular', status: 'missing', selector: '' },
    ],
  };

  it('defaults acceptance to matched slots only', () => {
    const slots = buildDefaultAcceptedSlots(baseResult.surfaces);
    expect(slots.has('pdp:regular')).toBe(true);
    expect(slots.has('cart:regular')).toBe(false);
  });

  it('auto-persists when server says ready (setup link or Auto-detect)', () => {
    expect(shouldAutoPersistAutoMapResult(baseResult)).toBe(true);
    expect(shouldQuickSaveAutoMapResult(baseResult)).toBe(true);
  });

  it('shows only gaps in the simplified modal', () => {
    const visible = filterAutoMapModalSurfaces(baseResult.surfaces, { showTechnical: false });
    expect(visible).toHaveLength(1);
    expect(visible[0].surface).toBe('cart');
  });

  it('writes a plain-language scan intro', () => {
    const intro = buildAutoMapModalIntro(baseResult, summarizeAutoMapResult(baseResult));
    expect(intro).toMatch(/live storefront/i);
    expect(intro).toMatch(/2 location/);
  });

  it('blocks quick-save when theme drift or ambiguous', () => {
    expect(
      shouldAutoPersistAutoMapResult({
        ...baseResult,
        theme_drift: { detected: true },
      })
    ).toBe(false);
    expect(
      shouldAutoPersistAutoMapResult({
        ...baseResult,
        surfaces: [
          ...baseResult.surfaces,
          { surface: 'home', role: 'regular', status: 'ambiguous', selector: '.price' },
        ],
      })
    ).toBe(false);
  });

  it('summarizes counts for the modal header', () => {
    expect(summarizeAutoMapResult(baseResult)).toMatchObject({
      matchedCount: 2,
      missingCount: 1,
      hasPdpRegular: true,
    });
  });

  it('labels the primary action from accepted count', () => {
    expect(autoMapPrimaryActionLabel(baseResult, 2)).toBe('Save 2 locations');
    expect(autoMapPrimaryActionLabel({ ready_to_save: false }, 1)).toBe('Add 1 to price table');
  });
});
