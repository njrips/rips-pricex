/**
 * Guard for URLs that this server fetches on a caller's behalf.
 *
 * Storefront preview takes a target URL from a public endpoint, so without a
 * check the API would happily fetch loopback services, private LAN hosts, or
 * the cloud metadata endpoint and hand the response back — a server-side
 * request forgery. Hostnames are resolved before use so a public-looking name
 * that points at a private address is rejected too.
 */

const dns = require('node:dns').promises;
const net = require('node:net');

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

class BlockedUrlError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = 'BlockedUrlError';
    this.reason = reason;
  }
}

function ipv4IsBlocked(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, includes cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

function ipv6IsBlocked(ip) {
  const value = ip.toLowerCase().split('%')[0];
  if (value === '::' || value === '::1') return true;
  // IPv4-mapped (::ffff:10.0.0.1) must be judged on the embedded address.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped) return ipv4IsBlocked(mapped[1]);
  if (value.startsWith('fe80')) return true; // link-local
  if (/^f[cd]/.test(value)) return true; // unique local
  if (value.startsWith('ff')) return true; // multicast
  return false;
}

function addressIsBlocked(ip) {
  const version = net.isIP(ip);
  if (version === 4) return ipv4IsBlocked(ip);
  if (version === 6) return ipv6IsBlocked(ip);
  return true;
}

/**
 * Throws BlockedUrlError unless the URL is a public http(s) destination.
 * @param {string|URL} candidate
 * @returns {Promise<URL>}
 */
async function assertPublicHttpUrl(candidate) {
  let url;
  try {
    url = candidate instanceof URL ? candidate : new URL(String(candidate || '').trim());
  } catch {
    throw new BlockedUrlError('Preview target is not a valid URL', 'invalid_url');
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new BlockedUrlError(`Unsupported URL scheme: ${url.protocol}`, 'bad_scheme');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (!hostname) {
    throw new BlockedUrlError('Preview target has no host', 'no_host');
  }

  if (net.isIP(hostname)) {
    if (addressIsBlocked(hostname)) {
      throw new BlockedUrlError('Preview target points at a private address', 'private_address');
    }
    return url;
  }

  if (hostname.toLowerCase() === 'localhost' || hostname.toLowerCase().endsWith('.localhost')) {
    throw new BlockedUrlError('Preview target points at localhost', 'private_address');
  }

  let resolved;
  try {
    resolved = await dns.lookup(hostname, { all: true });
  } catch {
    throw new BlockedUrlError('Preview target host could not be resolved', 'unresolvable');
  }
  if (!resolved.length || resolved.some(entry => addressIsBlocked(entry.address))) {
    throw new BlockedUrlError('Preview target resolves to a private address', 'private_address');
  }

  return url;
}

module.exports = {
  BlockedUrlError,
  assertPublicHttpUrl,
  addressIsBlocked,
};
