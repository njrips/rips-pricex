jest.mock('../../utils/database', () => ({
  query: jest.fn(async () => ({ rowCount: 0, rows: [] })),
}));

const http = require('http');
const zlib = require('zlib');
const express = require('express');
const trackRoutes = require('../trackSlimRoutes');

let server;
let port;

beforeAll(async () => {
  const app = express();
  app.use('/api/track', trackRoutes);
  await new Promise(resolve => {
    server = app.listen(0, resolve);
  });
  port = server.address().port;
});

afterAll(() => new Promise(resolve => server.close(resolve)));

function getScript(acceptEncoding) {
  return new Promise((resolve, reject) => {
    const headers = acceptEncoding ? { 'Accept-Encoding': acceptEncoding } : {};
    http
      .get({ port, path: '/api/track/script.js', headers }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ res, raw: Buffer.concat(chunks) }));
      })
      .on('error', reject);
  });
}

describe('GET /track/script.js delivery', () => {
  it('sends brotli when the browser accepts it', async () => {
    const { res, raw } = await getScript('gzip, deflate, br');
    expect(res.headers['content-encoding']).toBe('br');
    expect(res.headers.vary).toMatch(/Accept-Encoding/);
    const text = zlib.brotliDecompressSync(raw).toString('utf8');
    expect(text).toContain('window.AB_TEST_RUNTIME_CONFIG=');
    expect(raw.length).toBeLessThan(text.length / 3);
  });

  it('falls back to gzip, then to plain text', async () => {
    const gz = await getScript('gzip');
    expect(gz.res.headers['content-encoding']).toBe('gzip');
    const text = zlib.gunzipSync(gz.raw).toString('utf8');

    const plain = await getScript('');
    expect(plain.res.headers['content-encoding']).toBeUndefined();
    expect(plain.raw.toString('utf8')).toBe(text);
  });
});
