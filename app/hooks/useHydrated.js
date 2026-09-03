import { useSyncExternalStore } from 'react';

// Nothing to subscribe to: whether we are hydrated changes exactly once, and
// React re-renders for that transition on its own.
const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * True once the component has hydrated on the client, false during SSR and the
 * hydration pass itself.
 *
 * Use this for markup that can only be correct on the client — reading
 * localStorage, measuring the viewport, enabling an enhanced widget. Doing the
 * same thing with `useState(false)` plus an effect that sets it to true causes a
 * second render pass that React can no longer optimise away, whereas
 * `useSyncExternalStore` tells React up front that the server and client
 * answers differ, so hydration stays consistent without the extra pass.
 */
export function useHydrated() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export default useHydrated;
