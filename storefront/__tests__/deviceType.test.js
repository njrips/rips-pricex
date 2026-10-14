import { describe, expect, it } from 'vitest';
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

const body = extractFunction(readFileSync(SCRIPT_PATH, 'utf8'), 'getDeviceType');

function deviceFor({ userAgent = '', maxTouchPoints = 0, innerWidth = 1280 }) {
  const run = new Function('navigator', 'window', `${body}\nreturn getDeviceType();`);
  return run({ userAgent, maxTouchPoints }, { innerWidth });
}

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  ipadOs:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  androidPhone:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
  androidTablet:
    'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
};

describe('storefront device type', () => {
  it('reports tablets as their own device', () => {
    expect(deviceFor({ userAgent: UA.ipad, innerWidth: 768 })).toBe('tablet');
    expect(deviceFor({ userAgent: UA.androidTablet, innerWidth: 1280 })).toBe('tablet');
  });

  it('spots an iPad that reports a desktop Mac user agent', () => {
    expect(deviceFor({ userAgent: UA.ipadOs, maxTouchPoints: 5, innerWidth: 1024 })).toBe('tablet');
    expect(deviceFor({ userAgent: UA.ipadOs, maxTouchPoints: 0, innerWidth: 1440 })).toBe('desktop');
  });

  it('keeps phones on mobile and wide screens on desktop', () => {
    expect(deviceFor({ userAgent: UA.iphone, innerWidth: 390 })).toBe('mobile');
    expect(deviceFor({ userAgent: UA.androidPhone, innerWidth: 412 })).toBe('mobile');
    expect(deviceFor({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)', innerWidth: 1440 })).toBe('desktop');
  });
});
