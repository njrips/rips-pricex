import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'storefront-script.js');
const SRC = readFileSync(SCRIPT_PATH, 'utf8');

function extractFunction(name) {
  const start = SRC.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`missing ${name}`);
  let depth = 0;
  for (let i = SRC.indexOf('{', start); i < SRC.length; i += 1) {
    if (SRC[i] === '{') depth += 1;
    else if (SRC[i] === '}') {
      depth -= 1;
      if (depth === 0) return SRC.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced ${name}`);
}

function extractVar(name) {
  const start = SRC.indexOf(`var ${name} =`);
  if (start < 0) throw new Error(`missing ${name}`);
  return SRC.slice(start, SRC.indexOf(';', start) + 1);
}

const BODY = [
  'VISITOR_COUNTRY_KEY',
  'VISITOR_COUNTRY_TTL_MS',
  'VISITOR_COUNTRY_MISS_TTL_MS',
  'VISITOR_COUNTRY_TIMEOUT_MS',
  '_visitorCountryPromise',
]
  .map(extractVar)
  .concat(
    [
      'readVisitorCountryLookup',
      'writeVisitorCountryLookup',
      'readCachedVisitorCountry',
      'getCountryCode',
      'hasCountryTargetedTest',
      'ensureVisitorCountry',
    ].map(extractFunction)
  )
  .join('\n');

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: key => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
  };
}

function load({ storage = memoryStorage(), market = 'US', activeTests, fetchImpl }) {
  const win = { localStorage: storage, Shopify: { country: market } };
  const config = { activeTests: activeTests ?? [{ id: 't1', countryTargeting: true }] };
  const run = new Function(
    'window',
    'CONFIG',
    'fetch',
    `${BODY}\nreturn { getCountryCode, ensureVisitorCountry };`
  );
  return { ...run(win, config, fetchImpl), storage };
}

function respondWith(country) {
  return vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ detected_values: { country: { handle: country } } }),
    })
  );
}

describe('visitor country detection', () => {
  it('uses the detected country over the market country once looked up', async () => {
    const fetchImpl = respondWith('BD');
    const api = load({ fetchImpl });
    expect(api.getCountryCode()).toBe('US');
    await api.ensureVisitorCountry();
    expect(api.getCountryCode()).toBe('BD');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('skips the lookup when no live test targets countries', async () => {
    const fetchImpl = respondWith('BD');
    const api = load({ fetchImpl, activeTests: [{ id: 't1', countryTargeting: false }] });
    await api.ensureVisitorCountry();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(api.getCountryCode()).toBe('US');
  });

  it('does not look up again on the next page while the answer is fresh', async () => {
    const first = load({ fetchImpl: respondWith('BD') });
    await first.ensureVisitorCountry();
    const fetchImpl = respondWith('GB');
    const next = load({ storage: first.storage, fetchImpl });
    await next.ensureVisitorCountry();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(next.getCountryCode()).toBe('BD');
  });

  it('remembers a failed lookup so later pages do not wait on it again', async () => {
    const failing = vi.fn(() => Promise.reject(new Error('offline')));
    const first = load({ fetchImpl: failing });
    await first.ensureVisitorCountry();
    expect(first.getCountryCode()).toBe('US');

    const retry = respondWith('BD');
    const next = load({ storage: first.storage, fetchImpl: retry });
    await next.ensureVisitorCountry();
    expect(retry).not.toHaveBeenCalled();
  });

  it('looks up again once a failed lookup is an hour old', async () => {
    const storage = memoryStorage({
      ripx_visitor_country: JSON.stringify({ c: '', t: Date.now() - 61 * 60 * 1000 }),
    });
    const fetchImpl = respondWith('BD');
    const api = load({ storage, fetchImpl });
    await api.ensureVisitorCountry();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(api.getCountryCode()).toBe('BD');
  });

  it('stops waiting after the timeout but caches a late answer for the next page', async () => {
    vi.useFakeTimers();
    try {
      let answer;
      const fetchImpl = vi.fn(
        () =>
          new Promise(resolve => {
            answer = resolve;
          })
      );
      const api = load({ fetchImpl });
      const waiting = api.ensureVisitorCountry();
      await vi.advanceTimersByTimeAsync(1200);
      await waiting;
      expect(api.getCountryCode()).toBe('US');

      answer({
        ok: true,
        json: () => Promise.resolve({ detected_values: { country: { handle: 'bd' } } }),
      });
      await vi.runAllTimersAsync();
      expect(api.getCountryCode()).toBe('BD');
    } finally {
      vi.useRealTimers();
    }
  });
});
