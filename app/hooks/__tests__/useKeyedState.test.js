import { describe, expect, it } from 'vitest';
import { freshStamp, isStaleStamp, nextStamp, resolveInitial } from '../useKeyedState';

describe('resolveInitial', () => {
  it('passes a plain value through', () => {
    expect(resolveInitial('start')).toBe('start');
  });

  it('calls a factory so callers can build a fresh object each time', () => {
    const first = resolveInitial(() => ({ items: [] }));
    const second = resolveInitial(() => ({ items: [] }));
    expect(first).toEqual({ items: [] });
    expect(first).not.toBe(second);
  });
});

describe('isStaleStamp', () => {
  it('treats nothing stored yet as stale', () => {
    expect(isStaleStamp(undefined, 'a')).toBe(true);
  });

  it('is not stale while the key matches', () => {
    expect(isStaleStamp({ key: 'a', value: 'edited' }, 'a')).toBe(false);
  });

  it('is stale once the key has moved on', () => {
    expect(isStaleStamp({ key: 'a', value: 'edited' }, 'b')).toBe(true);
  });

  it('compares object keys by identity, so a memoized key is required', () => {
    const key = { shop: 'demo' };
    expect(isStaleStamp({ key, value: 1 }, key)).toBe(false);
    expect(isStaleStamp({ key, value: 1 }, { shop: 'demo' })).toBe(true);
  });
});

describe('freshStamp', () => {
  it('labels the initial value with the key it belongs to', () => {
    expect(freshStamp('a', 'start')).toEqual({ key: 'a', value: 'start' });
  });

  it('keeps a stored false rather than treating it as missing', () => {
    const stamped = freshStamp('a', false);
    expect(stamped.value).toBe(false);
    expect(isStaleStamp(stamped, 'a')).toBe(false);
  });
});

describe('nextStamp', () => {
  it('stamps a new value with the current key', () => {
    expect(nextStamp(freshStamp('a', ''), 'a', 'typed')).toEqual({ key: 'a', value: 'typed' });
  });

  it('applies an updater to the value stored for the key', () => {
    expect(nextStamp({ key: 'a', value: 1 }, 'a', n => n + 1)).toEqual({ key: 'a', value: 2 });
  });

  it('re-stamps under the current key so the update survives a later read', () => {
    const updated = nextStamp({ key: 'a', value: 'old' }, 'a', 'new');
    expect(isStaleStamp(updated, 'a')).toBe(false);
    expect(updated.value).toBe('new');
  });

  it('never leaves a value labelled with the key it no longer belongs to', () => {
    // A setter captured under an older key writes under that key, so the write
    // is discarded by the next read instead of leaking into the current key.
    const updated = nextStamp({ key: 'a', value: 41 }, 'a', n => n + 1);
    expect(isStaleStamp(updated, 'b')).toBe(true);
  });
});
