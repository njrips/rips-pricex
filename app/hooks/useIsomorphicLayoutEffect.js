import { useEffect, useLayoutEffect } from 'react';

/**
 * `useLayoutEffect` in the browser, `useEffect` on the server.
 *
 * Positioning a popover has to happen before the browser paints, so those call
 * sites genuinely need a layout effect. The server renderer cannot run one and
 * warns about every component that asks, which fills the server log on any
 * route that renders such a component. Neither hook runs during SSR, so
 * swapping in `useEffect` there changes nothing except the warning.
 */
export const useIsomorphicLayoutEffect =
  typeof document === 'undefined' ? useEffect : useLayoutEffect;

export default useIsomorphicLayoutEffect;
