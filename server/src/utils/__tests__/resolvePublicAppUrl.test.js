const { resolvePublicAppUrl } = require('../storefrontScriptRuntime');

function mockReq({ host, forwardedHost, forwardedProto, protocol = 'https', secure = true } = {}) {
  return {
    protocol,
    secure,
    get(name) {
      const key = String(name || '').toLowerCase();
      if (key === 'host') return host || '';
      if (key === 'x-forwarded-host') return forwardedHost || '';
      if (key === 'x-forwarded-proto') return forwardedProto || '';
      return '';
    },
  };
}

describe('resolvePublicAppUrl', () => {
  const prev = {
    PUBLIC: process.env.RIPSPRICEX_PUBLIC_API_BASE,
    APP: process.env.APP_URL,
    SHOPIFY: process.env.SHOPIFY_APP_URL,
  };

  afterEach(() => {
    process.env.RIPSPRICEX_PUBLIC_API_BASE = prev.PUBLIC;
    process.env.APP_URL = prev.APP;
    process.env.SHOPIFY_APP_URL = prev.SHOPIFY;
  });

  test('prefers live request tunnel host over stale PUBLIC_API_BASE', () => {
    process.env.RIPSPRICEX_PUBLIC_API_BASE = 'https://stale-dead.trycloudflare.com';
    process.env.APP_URL = 'https://stale-dead.trycloudflare.com';
    const url = resolvePublicAppUrl(
      mockReq({
        host: 'jul-render-kiss-refined.trycloudflare.com',
        forwardedProto: 'https',
      })
    );
    expect(url).toBe('https://jul-render-kiss-refined.trycloudflare.com');
  });

  test('falls back to PUBLIC_API_BASE when request host is local', () => {
    process.env.RIPSPRICEX_PUBLIC_API_BASE = 'https://jul-render-kiss-refined.trycloudflare.com';
    const url = resolvePublicAppUrl(mockReq({ host: '127.0.0.1:3456', protocol: 'http', secure: false }));
    expect(url).toBe('https://jul-render-kiss-refined.trycloudflare.com');
  });
});
