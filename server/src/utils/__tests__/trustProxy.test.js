const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { resolveTrustProxy, DEFAULT_TRUST_PROXY } = require('../trustProxy');

function clientIpFor(app, forwardedFor) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const req = http.get(
        {
          host: '127.0.0.1',
          port: server.address().port,
          path: '/',
          headers: forwardedFor ? { 'X-Forwarded-For': forwardedFor } : {},
        },
        res => {
          let body = '';
          res.on('data', chunk => (body += chunk));
          res.on('end', () => server.close(() => resolve(body)));
        }
      );
      req.on('error', err => server.close(() => reject(err)));
    });
  });
}

describe('the client address behind the dev and production proxies', () => {
  let app;
  before(() => {
    app = express();
    app.set('trust proxy', resolveTrustProxy({}));
    app.get('/', (req, res) => res.send(req.ip));
  });
  after(() => {
    app = null;
  });

  // Cloudflare's tunnel, the Shopify CLI proxy and Vite: the shopper first,
  // then a loopback hop for each local proxy.
  it("is the shopper's address when every hop after it is local", async () => {
    assert.equal(await clientIpFor(app, '203.0.113.9, 127.0.0.1, ::1'), '203.0.113.9');
  });

  it('skips a private load balancer in front of the app', async () => {
    assert.equal(await clientIpFor(app, '198.51.100.4, 10.0.3.17'), '198.51.100.4');
  });

  it('does not believe hops a public client added itself', async () => {
    assert.equal(await clientIpFor(app, '127.0.0.1, 203.0.113.9'), '203.0.113.9');
  });

  it('uses the socket when nothing is forwarded', async () => {
    assert.match(await clientIpFor(app, ''), /127\.0\.0\.1$/);
  });

  it('can be overridden for an unusual host', () => {
    assert.equal(resolveTrustProxy({ RIPSPRICEX_TRUST_PROXY: '2' }), '2');
    assert.equal(resolveTrustProxy({ RIPSPRICEX_TRUST_PROXY: '  ' }), DEFAULT_TRUST_PROXY);
  });
});
