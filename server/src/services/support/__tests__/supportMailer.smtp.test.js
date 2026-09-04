const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { formatFromAddress, isSupportMailerConfigured, smtpConfig } = require('../supportMailer');

describe('supportMailer SMTP', () => {
  const keys = [
    'SMTP_HOST',
    'SMTP_USER',
    'SMTP_PASS',
    'SMTP_PORT',
    'SMTP_FROM',
    'MAIL_HOST',
    'MAIL_USER',
    'MAIL_PASS',
    'RIPSPRICEX_SUPPORT_SMTP_HOST',
    'RIPSPRICEX_SUPPORT_SMTP_USER',
    'RIPSPRICEX_SUPPORT_SMTP_PASS',
    'RIPSPRICEX_SUPPORT_SMTP_FROM',
    'RESEND_API_KEY',
    'RESEND_FROM',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  after(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });

  function clearMailEnv() {
    for (const key of keys) delete process.env[key];
  }

  it('reads the same SMTP_* names as RipX', () => {
    clearMailEnv();
    process.env.SMTP_HOST = 'email-smtp.eu-west-2.amazonaws.com';
    process.env.SMTP_USER = 'smtp-user';
    process.env.SMTP_PASS = 'smtp-pass';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_FROM = 'abtesting-noreply@echologyx.com';
    const smtp = smtpConfig();
    assert.equal(smtp.host, 'email-smtp.eu-west-2.amazonaws.com');
    assert.equal(smtp.port, 587);
    assert.equal(smtp.secure, false);
    assert.equal(smtp.requireTLS, true);
    assert.equal(smtp.user, 'smtp-user');
    assert.equal(smtp.from, 'Priceify <abtesting-noreply@echologyx.com>');
    assert.equal(isSupportMailerConfigured(), true);
  });

  it('is not configured without host, user, and pass', () => {
    clearMailEnv();
    process.env.SMTP_HOST = 'email-smtp.eu-west-2.amazonaws.com';
    assert.equal(smtpConfig(), null);
    assert.equal(isSupportMailerConfigured(), false);
  });

  it('keeps an explicit From display name', () => {
    assert.equal(formatFromAddress('Priceify <ops@echologyx.com>'), 'Priceify <ops@echologyx.com>');
  });
});
