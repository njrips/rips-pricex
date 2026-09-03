import { useCallback, useState } from "react";

/** A value, or a factory called only when the value is actually needed. */
export type Initial<V> = V | (() => V);

/** A stored value together with the key it belongs to. */
export type KeyedStamp<K, V> = { key: K; value: V };

export type KeyedUpdate<V> = V | ((current: V) => V);

export function resolveInitial<V>(initial: Initial<V>): V {
  return typeof initial === "function" ? (initial as () => V)() : initial;
}

/** Whether `stamped` holds a value belonging to some key other than `key`. */
export function isStaleStamp<K, V>(
  stamped: KeyedStamp<K, V> | null | undefined,
  key: K,
): boolean {
  return !stamped || !Object.is(stamped.key, key);
}

/** The stamp a key starts out with. */
export function freshStamp<K, V>(key: K, initial: Initial<V>): KeyedStamp<K, V> {
  return { key, value: resolveInitial(initial) };
}

/** The stamp after `next` is applied, as either a value or an updater. */
export function nextStamp<K, V>(
  stamped: KeyedStamp<K, V>,
  key: K,
  next: KeyedUpdate<V>,
): KeyedStamp<K, V> {
  return {
    key,
    value: typeof next === "function" ? (next as (current: V) => V)(stamped.value) : next,
  };
}

/**
 * Local state that starts over whenever `key` changes.
 *
 * This replaces the common `useEffect(() => setValue(initial), [key])` shape —
 * closing a menu when the route changes, clearing a field when the record being
 * edited changes, dropping edits when a form action returns. That effect has to
 * render the stale value first and then immediately render again, and anything
 * reading the value in between sees state belonging to the previous key.
 *
 * `key` must keep a stable identity for as long as it means the same thing, so
 * pass a primitive or a memoized object; an identity that changed on every
 * render would reconcile forever. `initial` carries no such requirement — it is
 * only read when a key starts — and the returned setter keeps a stable identity
 * regardless of it, which matters because callers list the setter in effect
 * dependency arrays.
 */
export function useKeyedState<K, V>(
  key: K,
  initial: Initial<V>,
): [V, (next: KeyedUpdate<V>) => void] {
  const [stamped, setStamped] = useState<KeyedStamp<K, V>>(() => freshStamp(key, initial));

  const setValue = useCallback((next: KeyedUpdate<V>) => {
    // `prev` always belongs to `key`: a changed key is reconciled below during
    // render, before anything can commit or fire an event.
    setStamped((prev) => nextStamp(prev, key, next));
  }, [key]);

  if (isStaleStamp(stamped, key)) {
    // Reconciling here rather than in an effect re-runs this component before
    // anything commits, so no render sees the previous key's value, and the
    // stale value is dropped instead of lingering in state where returning to
    // an earlier key would surface it again.
    const fresh = freshStamp(key, initial);
    setStamped(fresh);
    return [fresh.value, setValue];
  }

  return [stamped.value, setValue];
}

export default useKeyedState;
