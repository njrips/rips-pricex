const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertPublicHttpUrl,
  addressIsBlocked,
  BlockedUrlError,
} = require('../outboundUrlGuard');

async function expectBlocked(url, reason) {
  await assert.rejects(
    () => assertPublicHttpUrl(url),
    err => {
      assert.ok(err instanceof BlockedUrlError, `expected BlockedUrlError for ${url}`);
      if (reason) {
        assert.equal(err.reason, reason, `unexpected reason for ${url}`);
      }
      return true;
    },
    `expected ${url} to be blocked`
  );
}

test('blocks the cloud metadata endpoint', async () => {
  await expectBlocked('http://169.254.169.254/latest/meta-data/', 'private_address');
});

test('blocks loopback and localhost', async () => {
  await expectBlocked('http://127.0.0.1:3000/admin', 'private_address');
  await expectBlocked('http://localhost:5433/', 'private_address');
  await expectBlocked('http://[::1]/', 'private_address');
});

test('blocks private LAN ranges', async () => {
  for (const host of ['10.0.0.5', '192.168.1.1', '172.16.0.9', '172.31.255.254']) {
    await expectBlocked(`http://${host}/`, 'private_address');
  }
});

test('allows public ranges that neighbour private ones', () => {
  for (const host of ['172.15.0.1', '172.32.0.1', '11.0.0.1', '192.167.1.1']) {
    assert.equal(addressIsBlocked(host), false, `${host} should be allowed`);
  }
});

test('blocks non-http schemes', async () => {
  await expectBlocked('file:///etc/passwd', 'bad_scheme');
  await expectBlocked('gopher://example.com/', 'bad_scheme');
});

test('rejects malformed input', async () => {
  await expectBlocked('not a url', 'invalid_url');
  await expectBlocked('', 'invalid_url');
});

test('blocks IPv4-mapped IPv6 pointing at a private address', () => {
  assert.equal(addressIsBlocked('::ffff:10.0.0.1'), true);
  assert.equal(addressIsBlocked('::ffff:127.0.0.1'), true);
});

test('blocks unique-local and link-local IPv6', () => {
  assert.equal(addressIsBlocked('fd00::1'), true);
  assert.equal(addressIsBlocked('fe80::1'), true);
});

test('allows a real public host', async () => {
  const url = await assertPublicHttpUrl('https://example.com/products/tee');
  assert.equal(url.hostname, 'example.com');
});
