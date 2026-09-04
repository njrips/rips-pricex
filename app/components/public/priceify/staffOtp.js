export const OTP_LENGTH = 6;
export const OTP_EXPIRY_SECONDS = 60;

export function normalizeOtpDigits(value) {
  return String(value || '')
    .replace(/\D/g, '')
    .slice(0, OTP_LENGTH);
}

export function otpDigitList(value) {
  const digits = normalizeOtpDigits(value).split('');
  while (digits.length < OTP_LENGTH) digits.push('');
  return digits;
}

export function formatOtpCountdown(secondsLeft) {
  const total = Math.max(0, Number(secondsLeft) || 0);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function secondsLeftFromIssued(issued, now = Date.now(), expirySeconds = OTP_EXPIRY_SECONDS) {
  const started = Number(issued) || 0;
  if (!started) return expirySeconds;
  const elapsed = Math.floor((Number(now) - started) / 1000);
  return Math.max(0, expirySeconds - elapsed);
}

export function maskStaffEmail(email) {
  const value = String(email || '')
    .trim()
    .toLowerCase();
  const at = value.indexOf('@');
  if (at < 1 || at === value.length - 1) return '';
  return `${value.slice(0, 1)}•••@${value.slice(at + 1)}`;
}

export const STAFF_OTP_DRAFT_KEY = 'rpx_staff_otp_draft';

function sessionStore(storage) {
  if (storage) return storage;
  if (typeof sessionStorage === 'undefined') return null;
  return sessionStorage;
}

export function staffOtpDraftFromValues({ email, issued, message } = {}, now = Date.now()) {
  const nextEmail = String(email || '')
    .trim()
    .toLowerCase();
  const nextIssued = String(issued || '');
  if (!nextEmail || !nextIssued || secondsLeftFromIssued(nextIssued, now) <= 0) return null;
  return { email: nextEmail, issued: nextIssued, message: String(message || '') };
}

export function writeStaffOtpDraft(values, storage, now = Date.now()) {
  const store = sessionStore(storage);
  const draft = staffOtpDraftFromValues(values, now);
  if (!store) return draft;
  if (!draft) {
    store.removeItem(STAFF_OTP_DRAFT_KEY);
    return null;
  }
  store.setItem(STAFF_OTP_DRAFT_KEY, JSON.stringify(draft));
  return draft;
}

export function readStaffOtpDraft(storage, now = Date.now()) {
  const store = sessionStore(storage);
  if (!store) return null;
  try {
    const raw = store.getItem(STAFF_OTP_DRAFT_KEY);
    if (!raw) return null;
    const draft = staffOtpDraftFromValues(JSON.parse(raw), now);
    if (!draft) {
      store.removeItem(STAFF_OTP_DRAFT_KEY);
      return null;
    }
    return draft;
  } catch {
    store.removeItem(STAFF_OTP_DRAFT_KEY);
    return null;
  }
}

export function clearStaffOtpDraft(storage) {
  sessionStore(storage)?.removeItem(STAFF_OTP_DRAFT_KEY);
}
