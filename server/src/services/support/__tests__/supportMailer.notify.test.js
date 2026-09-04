const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_STAFF_NOTIFY_EMAIL,
  notifyStatusChange,
  notifyTicketEvent,
  supportNotifyAddressing,
  supportNotifyRecipients,
  ticketNotifyEmail,
} = require('../supportMailer');

describe('supportMailer ticket notify', () => {
  it('always notifies ripon@echologyx.com and keeps extra inboxes as BCC', () => {
    assert.equal(DEFAULT_STAFF_NOTIFY_EMAIL, 'ripon@echologyx.com');
    const previous = process.env.RIPSPRICEX_SUPPORT_EMAIL;
    try {
      delete process.env.RIPSPRICEX_SUPPORT_EMAIL;
      assert.deepEqual(supportNotifyAddressing(), { to: 'ripon@echologyx.com', bcc: [] });
      assert.deepEqual(supportNotifyRecipients(), ['ripon@echologyx.com']);
      process.env.RIPSPRICEX_SUPPORT_EMAIL = 'ops@echologyx.com, not-an-email';
      assert.deepEqual(supportNotifyAddressing(), {
        to: 'ripon@echologyx.com',
        bcc: ['ops@echologyx.com'],
      });
    } finally {
      if (previous === undefined) delete process.env.RIPSPRICEX_SUPPORT_EMAIL;
      else process.env.RIPSPRICEX_SUPPORT_EMAIL = previous;
    }
  });

  it('builds a Priceify staff email with ticket details', () => {
    const previous = process.env.SHOPIFY_APP_URL;
    process.env.SHOPIFY_APP_URL = 'https://example.com/';
    try {
      const created = ticketNotifyEmail({
        kind: 'created',
        ticket: {
          public_id: 'PX-8BVE',
          shop_domain: 'ripx-plus.myshopify.com',
          category: 'setup',
          subject: 'Checkout <blocked>',
          status: 'open',
          reply_email: 'merchant@example.com',
          diagnostics: { plan_handle: 'smart_pricing', entitled: true, checkout_ready: false },
        },
        body: 'Theme embed is off.\nPlease help.',
      });
      assert.equal(created.subject, '[PX-8BVE] New ticket: Checkout <blocked>');
      assert.equal(created.replyTo, 'merchant@example.com');
      assert.equal(created.messageId, '<priceify-ticket-PX-8BVE@echologyx.com>');
      assert.match(created.text, /Shop: ripx-plus\.myshopify\.com/);
      assert.match(created.text, /Category: Setup \/ checkout/);
      assert.match(created.text, /Theme embed is off\./);
      assert.match(created.text, /Plan: smart_pricing/);
      assert.match(created.text, /https:\/\/example.com\/staff\/support\/PX-8BVE/);
      assert.match(created.html, /Checkout &lt;blocked&gt;/);
      assert.match(created.html, /Open ticket/);

      const status = ticketNotifyEmail({
        kind: 'status',
        ticket: {
          public_id: 'PX-8BVE',
          shop_domain: 'ripx-plus.myshopify.com',
          category: 'setup',
          subject: 'Checkout blocked',
          status: 'resolved',
        },
        previousStatus: 'waiting_staff',
      });
      assert.equal(status.subject, '[PX-8BVE] Status updated: Checkout blocked');
      assert.match(status.text, /Status: Waiting on you → Resolved/);
      assert.equal(status.inReplyTo, '<priceify-ticket-PX-8BVE@echologyx.com>');
      assert.equal(status.text.includes('Plan:'), false);
    } finally {
      if (previous === undefined) delete process.env.SHOPIFY_APP_URL;
      else process.env.SHOPIFY_APP_URL = previous;
    }

    const previousApp = process.env.SHOPIFY_APP_URL;
    const previousAlias = process.env.APP_URL;
    delete process.env.SHOPIFY_APP_URL;
    delete process.env.APP_URL;
    try {
      const relative = ticketNotifyEmail({
        kind: 'merchant_reply',
        ticket: { public_id: 'PX-8BVE', subject: 'Checkout blocked', status: 'waiting_staff' },
        body: 'Still blocked',
      });
      assert.equal(relative.html.includes('href="/staff/support/'), false);
    } finally {
      if (previousApp === undefined) delete process.env.SHOPIFY_APP_URL;
      else process.env.SHOPIFY_APP_URL = previousApp;
      if (previousAlias === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = previousAlias;
    }
  });

  it('skips unchanged status and respects the mail stub', async () => {
    const same = await notifyStatusChange({ public_id: 'PX-8BVE', status: 'open' }, 'open');
    assert.equal(same.reason, 'unchanged');
    const previous = process.env.RIPSPRICEX_SUPPORT_MAIL_STUB;
    process.env.RIPSPRICEX_SUPPORT_MAIL_STUB = 'true';
    try {
      const skipped = await notifyTicketEvent({
        kind: 'created',
        ticket: { public_id: 'PX-8BVE', subject: 'Stubbed' },
        body: 'Should not send',
      });
      assert.equal(skipped.reason, 'suppressed');
    } finally {
      if (previous === undefined) delete process.env.RIPSPRICEX_SUPPORT_MAIL_STUB;
      else process.env.RIPSPRICEX_SUPPORT_MAIL_STUB = previous;
    }
  });
});
