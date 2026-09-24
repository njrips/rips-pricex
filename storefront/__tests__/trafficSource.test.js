// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'storefront-script.js');

function extractFunction(src, name) {
  const signature = `function ${name}(`;
  const start = src.indexOf(signature);
  if (start < 0) throw new Error(`missing ${name}`);
  let depth = 0;
  let i = src.indexOf('{', start);
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced ${name}`);
}

function loadTrafficApi() {
  const src = readFileSync(SCRIPT_PATH, 'utf8');
  const names = [
    'TRAFFIC_SOURCE_COOKIE',
    'normalizeTrafficHost',
    'isInternalShopReferrer',
    'pageHasFreshAttributionSignals',
    'classifyTrafficSourceFromSignals',
    'getTrafficSource',
    'setCookie',
    'getCookie',
  ];
  const bodies = names
    .map(name => {
      if (name === 'TRAFFIC_SOURCE_COOKIE') {
        const line = src.match(/var TRAFFIC_SOURCE_COOKIE = '[^']+';/);
        return line ? line[0] : '';
      }
      return extractFunction(src, name);
    })
    .filter(Boolean)
    .join('\n');

  const cookies = {};
  const factory = new Function(
    '__cookies',
    '__config',
    `
    var CONFIG = __config;
    function setCookie(name, value, days) { __cookies[name] = value; }
    function getCookie(name) { return Object.prototype.hasOwnProperty.call(__cookies, name) ? __cookies[name] : null; }
    ${bodies}
    return {
      classifyTrafficSourceFromSignals,
      getTrafficSource,
      isInternalShopReferrer,
      pageHasFreshAttributionSignals,
      cookies: __cookies,
    };
    `
  );
  return factory(cookies, { cookieExpiry: 365, shopDomain: 'demo.myshopify.com' });
}

describe('classifyTrafficSourceFromSignals', () => {
  let api;

  beforeEach(() => {
    api = loadTrafficApi();
  });

  it('maps Google Ads click ids to paid_search', () => {
    const params = new URLSearchParams('gclid=abc');
    expect(api.classifyTrafficSourceFromSignals(params, '')).toBe('paid_search');
  });

  it('maps utm cpc to paid_search before google referrer heuristics', () => {
    const params = new URLSearchParams('utm_medium=cpc&utm_source=google');
    expect(api.classifyTrafficSourceFromSignals(params, 'https://www.google.com/')).toBe(
      'paid_search'
    );
  });

  it('maps external search referrers to organic_search', () => {
    const params = new URLSearchParams('');
    expect(api.classifyTrafficSourceFromSignals(params, 'https://www.bing.com/search?q=shoes')).toBe(
      'organic_search'
    );
  });

  it('maps unknown external referrers to referral', () => {
    const params = new URLSearchParams('');
    expect(api.classifyTrafficSourceFromSignals(params, 'https://news.example.com/post')).toBe(
      'referral'
    );
  });
});

describe('getTrafficSource stickiness', () => {
  beforeEach(() => {
    Object.defineProperty(document, 'referrer', { configurable: true, value: '' });
  });

  it('keeps first-touch google when navigating on the same shop', () => {
    const api = loadTrafficApi();
    Object.defineProperty(document, 'referrer', {
      configurable: true,
      value: 'https://www.google.com/',
    });
    expect(api.getTrafficSource()).toBe('google');

    Object.defineProperty(document, 'referrer', {
      configurable: true,
      value: 'https://demo.myshopify.com/collections/all',
    });
    expect(api.getTrafficSource()).toBe('google');
  });

  it('treats same-host referrer as internal for stickiness', () => {
    const api = loadTrafficApi();
    expect(
      api.isInternalShopReferrer('https://demo.myshopify.com/collections/sale')
    ).toBe(true);
  });
});
