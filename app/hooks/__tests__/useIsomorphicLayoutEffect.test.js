import { useEffect, useLayoutEffect } from 'react';
import { describe, expect, it } from 'vitest';
import useIsomorphicLayoutEffect from '../useIsomorphicLayoutEffect';

// This file deliberately runs in the node environment, which is the only place
// the server-side branch can be observed: under jsdom a document exists even
// while react-dom/server renders, so the hook would pick useLayoutEffect there.
describe('useIsomorphicLayoutEffect without a document', () => {
  it('runs where the server renderer runs', () => {
    expect(typeof document).toBe('undefined');
  });

  it('falls back to useEffect, which the server renderer does not warn about', () => {
    expect(useIsomorphicLayoutEffect).toBe(useEffect);
    expect(useIsomorphicLayoutEffect).not.toBe(useLayoutEffect);
  });
});
