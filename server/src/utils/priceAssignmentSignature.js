const crypto = require('crypto');

function getSignatureSecret() {
  return (
    (process.env.RIPX_PRICE_ASSIGNMENT_SIGNATURE_SECRET || '').trim() ||
    (process.env.RIPX_CHECKOUT_PRICE_SECRET || '').trim()
  );
}

function getSignatureTtlSeconds() {
  const raw = Number.parseInt(process.env.RIPX_PRICE_ASSIGNMENT_SIGNATURE_TTL_SEC || '86400', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 86400;
}

function shouldRequireSignedAssignment() {
  const raw = String(process.env.RIPX_CHECKOUT_REQUIRE_SIGNED_ASSIGNMENT || '')
    .trim()
    .toLowerCase();
  if (raw === 'true' || raw === '1' || raw === 'yes') {
    return true;
  }
  if (raw === 'false' || raw === '0' || raw === 'no') {
    return false;
  }
  return String(process.env.NODE_ENV || '').toLowerCase() === 'production';
}

function normalizeSignaturePayload({ testId, variantId, userId, shopDomain, issuedAtMs }) {
  return {
    testId: String(testId || '').trim(),
    variantId: String(variantId || '').trim(),
    userId: String(userId || '').trim(),
    shopDomain: String(shopDomain || '')
      .trim()
      .toLowerCase(),
    issuedAtMs: Number.parseInt(String(issuedAtMs || ''), 10),
  };
}

function canonicalize(payload) {
  return [
    payload.testId,
    payload.variantId,
    payload.userId,
    payload.shopDomain,
    String(payload.issuedAtMs),
  ].join('|');
}

function signPriceAssignment(input) {
  const secret = getSignatureSecret();
  const p = normalizeSignaturePayload(input || {});
  if (
    !secret ||
    !p.testId ||
    !p.variantId ||
    !p.userId ||
    !p.shopDomain ||
    !Number.isFinite(p.issuedAtMs) ||
    p.issuedAtMs <= 0
  ) {
    return null;
  }
  return crypto.createHmac('sha256', secret).update(canonicalize(p)).digest('hex');
}

function getPriceAssignmentSigningBlocker(input) {
  const secret = getSignatureSecret();
  const p = normalizeSignaturePayload(input || {});
  if (!secret) {
    return 'assignment_signature_secret_missing';
  }
  if (!p.testId) {
    return 'test_id_missing';
  }
  if (!p.variantId) {
    return 'variant_id_missing';
  }
  if (!p.userId) {
    return 'user_id_missing';
  }
  if (!p.shopDomain) {
    return 'shop_domain_missing';
  }
  if (!Number.isFinite(p.issuedAtMs) || p.issuedAtMs <= 0) {
    return 'issued_at_invalid';
  }
  return null;
}

function timingSafeEqualsHex(a, b) {
  if (!a || !b) {
    return false;
  }
  const left = String(a).trim().toLowerCase();
  const right = String(b).trim().toLowerCase();
  if (left.length !== right.length || left.length < 16) {
    return false;
  }
  try {
    return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
  } catch {
    return false;
  }
}

function verifyPriceAssignmentSignature(input, opts = {}) {
  const secret = getSignatureSecret();
  const strict = shouldRequireSignedAssignment();
  const providedSig = String(input?.signature || '').trim();
  const providedUser = String(input?.userId || '').trim();
  const providedTs = Number.parseInt(String(input?.issuedAtMs || ''), 10);

  if (!secret) {
    if (strict) {
      return { ok: false, reason: 'assignment_signature_not_configured', enabled: false };
    }
    return { ok: true, reason: null, enabled: false };
  }

  if (!providedSig || !providedUser || !Number.isFinite(providedTs) || providedTs <= 0) {
    if (strict) {
      return { ok: false, reason: 'missing_assignment_signature', enabled: true };
    }
    return { ok: true, reason: null, enabled: true };
  }

  const ttlMs = getSignatureTtlSeconds() * 1000;
  const nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  if (providedTs + ttlMs < nowMs) {
    return { ok: false, reason: 'assignment_signature_expired', enabled: true };
  }

  const expected = signPriceAssignment({
    testId: input?.testId,
    variantId: input?.variantId,
    userId: providedUser,
    shopDomain: input?.shopDomain,
    issuedAtMs: providedTs,
  });
  if (!expected || !timingSafeEqualsHex(expected, providedSig)) {
    return { ok: false, reason: 'invalid_assignment_signature', enabled: true };
  }
  return { ok: true, reason: null, enabled: true };
}

module.exports = {
  signPriceAssignment,
  verifyPriceAssignmentSignature,
  getSignatureSecret,
  getSignatureTtlSeconds,
  shouldRequireSignedAssignment,
  getPriceAssignmentSigningBlocker,
};
