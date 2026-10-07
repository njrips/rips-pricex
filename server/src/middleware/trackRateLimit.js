/**
 * A ceiling on how fast one address can write storefront events.
 *
 * The event endpoints are open by design, so this is not a defence against a
 * determined forger; it stops one script flooding a shop's results or the
 * database. The ceiling is far above a shopper: a busy page sends a handful of
 * events a minute, and one address can be a whole office or a mobile carrier's
 * shared exit. Counts are per process, which is enough for that purpose.
 */

const WINDOW_MS = 60 * 1000;
const DEFAULT_LIMIT = 600;
const MAX_TRACKED_KEYS = 50000;

function createTrackRateLimit({ limit = DEFAULT_LIMIT, windowMs = WINDOW_MS, now = Date.now } = {}) {
  let windowStart = now();
  let counts = new Map();

  return function trackRateLimit(req, res, next) {
    const at = now();
    if (at - windowStart >= windowMs || counts.size > MAX_TRACKED_KEYS) {
      windowStart = at;
      counts = new Map();
    }
    const key = String(req.ip || req.socket?.remoteAddress || 'unknown');
    const used = (counts.get(key) || 0) + 1;
    counts.set(key, used);
    if (used > limit) {
      res.set('Retry-After', String(Math.ceil((windowStart + windowMs - at) / 1000)));
      return res.status(429).json({ error: 'Too many events' });
    }
    return next();
  };
}

module.exports = { createTrackRateLimit };
