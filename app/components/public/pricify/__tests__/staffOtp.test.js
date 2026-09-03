import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  OTP_LENGTH,
  STAFF_OTP_DRAFT_KEY,
  clearStaffOtpDraft,
  formatOtpCountdown,
  maskStaffEmail,
  normalizeOtpDigits,
  otpDigitList,
  readStaffOtpDraft,
  secondsLeftFromIssued,
  staffOtpDraftFromValues,
  writeStaffOtpDraft,
} from '../staffOtp.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => {
      data.set(key, String(value));
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

describe('staffOtp', () => {
  it('keeps only six digits', () => {
    assert.equal(OTP_LENGTH, 6);
    assert.equal(normalizeOtpDigits('12a34-56b78'), '123456');
    assert.deepEqual(otpDigitList('39'), ['3', '9', '', '', '', '']);
  });

  it('formats the one-minute countdown', () => {
    assert.equal(formatOtpCountdown(60), '1:00');
    assert.equal(formatOtpCountdown(59), '0:59');
    assert.equal(formatOtpCountdown(9), '0:09');
    assert.equal(formatOtpCountdown(0), '0:00');
  });

  it('counts remaining seconds from the send timestamp', () => {
    assert.equal(secondsLeftFromIssued('1000000', 1_000_000 + 15_000), 45);
    assert.equal(secondsLeftFromIssued('1000000', 1_000_000 + 60_000), 0);
    assert.equal(secondsLeftFromIssued('', 1_000_000), 60);
  });

  it('masks a staff email for the confirm-code step', () => {
    assert.equal(maskStaffEmail('ops.lead@echologyx.com'), 'o•••@echologyx.com');
    assert.equal(maskStaffEmail('  A@echologyx.com  '), 'a•••@echologyx.com');
    assert.equal(maskStaffEmail('not-an-email'), '');
  });

  it('keeps an unexpired confirm-code draft and drops an expired one', () => {
    const now = 2_000_000;
    const live = staffOtpDraftFromValues(
      { email: 'ops@echologyx.com', issued: String(now - 15_000), message: 'sent' },
      now,
    );
    assert.equal(live.email, 'ops@echologyx.com');
    assert.equal(
      staffOtpDraftFromValues({ email: 'ops@echologyx.com', issued: String(now - 61_000) }, now),
      null,
    );

    const storage = memoryStorage();
    writeStaffOtpDraft(live, storage, now);
    assert.equal(readStaffOtpDraft(storage, now).email, 'ops@echologyx.com');
    assert.equal(readStaffOtpDraft(storage, now + 60_000), null);
    writeStaffOtpDraft(live, storage, now);
    clearStaffOtpDraft(storage);
    assert.equal(storage.getItem(STAFF_OTP_DRAFT_KEY), null);
  });
});
