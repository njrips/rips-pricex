/**
 * The mapping row is a five-column grid of controls that cannot compress below
 * their own widths, and the panel around it sets `overflow: hidden`. Those two
 * facts together once made the last control in the row — Remove — impossible
 * to click on a narrow admin: it rendered past the panel's right edge and was
 * clipped away, so a hit test at the icon landed on the page behind it.
 *
 * jsdom has no layout, so a rendering test cannot see this. What it can check
 * is the contract that keeps it from coming back: whatever the row's width, the
 * table has to be able to scroll rather than let the panel swallow a control.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  join(import.meta.dirname, '..', 'TargetingSection.module.css'),
  'utf8'
);

/** The body of a top-level rule, given any one of its selectors. */
const ruleBody = selector => {
  const at = css.indexOf(selector);
  expect(at, `${selector} is missing`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
};

describe('the price surface mapping table', () => {
  it('scrolls instead of clipping a row it cannot fit', () => {
    expect(ruleBody('.priceSurfaceMappingTable {')).toMatch(/overflow-x:\s*auto/);
  });

  it('keeps the panel from being the thing that clips the row', () => {
    // The panel may keep `overflow: hidden` for its rounded corners only
    // because the table above scrolls its own content.
    expect(ruleBody('.priceSurfacePanelCompact {')).toMatch(/overflow:\s*hidden/);
  });

  it('never squeezes the controls column', () => {
    const row = ruleBody('.priceSurfaceMappingGridRow {');
    const columns = row.match(/grid-template-columns:([^;]+);/)?.[1] || '';
    // An `auto` or `fr` final track lets the switch, Pick and Remove compress
    // or overflow before the text fields give up any width.
    expect(columns.trim()).toMatch(/max-content$/);
  });

  it('lets a scrolled row keep its full width', () => {
    const row = ruleBody('.priceSurfaceMappingGridRow {');
    expect(row).toMatch(/width:\s*max-content/);
    expect(row).toMatch(/min-width:\s*100%/);
  });

  it('does not let the selector field alone force the row past the panel', () => {
    const field = ruleBody('.priceSurfaceSelectorField {');
    const min = Number(field.match(/min-width:\s*(\d+)px/)?.[1]);
    expect(min).toBeLessThanOrEqual(160);
  });
});
