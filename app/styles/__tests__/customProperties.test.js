/**
 * A `var(--x)` with no fallback naming a property nobody defines is invalid at
 * computed-value time, so the browser drops the whole declaration rather than
 * the one value: borders resolve to `none`, backgrounds to transparent, and
 * `color` falls back to inheriting, which renders subdued copy at full body
 * weight. Nothing errors and the build stays green, so the Admin reskin left
 * 17 such names behind for a long time.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_DIR = join(import.meta.dirname, '..', '..');

const cssFiles = (dir, found = []) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      cssFiles(full, found);
    } else if (entry.endsWith('.css')) {
      found.push(full);
    }
  }
  return found;
};

describe('app stylesheets', () => {
  it('never reads a custom property that nothing defines', () => {
    const files = cssFiles(APP_DIR);
    expect(files.length).toBeGreaterThan(0);

    const defined = new Set();
    const used = new Map();
    for (const file of files) {
      const css = readFileSync(file, 'utf8');
      for (const [, name] of css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) {
        defined.add(name);
      }
      // Only fallback-less reads can break; `var(--x, #fff)` degrades safely.
      for (const [, name] of css.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*\)/g)) {
        if (!used.has(name)) used.set(name, new Set());
        used.get(name).add(file.slice(APP_DIR.length + 1));
      }
    }

    // Polaris supplies --p-color-* at runtime from its AppProvider.
    const missing = [...used.keys()]
      .filter(name => !defined.has(name) && !name.startsWith('--p-'))
      .map(name => `${name} (used in ${[...used.get(name)].join(', ')})`);

    expect(missing).toEqual([]);
  });
});
