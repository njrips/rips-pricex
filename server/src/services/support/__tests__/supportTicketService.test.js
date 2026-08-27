const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  CREATE_LIMIT_PER_HOUR,
  REPLY_LIMIT_PER_HOUR,
  isPublicIdFormat,
  normalizeBody,
  normalizeCategory,
  normalizeReplyEmail,
  normalizeStatus,
  normalizeSubject,
  isCreateRateLimited,
  validateCreateInput,
} = require('../supportTicketValidation');
const {
  buildTicketLookup,
  escapeLikePattern,
  generatePublicId,
  expandStaffShopFilter,
  normalizeShopDomain,
  normalizeStaffStatusFilter,
} = require('../../../models/supportTicket');
const { presentMerchantTicket, presentStaffTicket } = require('../supportTicketPresenters');
const { staffTicketUrl } = require('../supportMailer');

describe('supportTicketService validators', () => {
  it('normalizes shop, category, status, and reply email', () => {
    assert.equal(normalizeShopDomain('Demo.myshopify.com'), 'demo.myshopify.com');
    assert.equal(normalizeShopDomain('https://Demo.myshopify.com/admin'), 'demo.myshopify.com');
    assert.equal(expandStaffShopFilter('ripx-plus'), 'ripx-plus.myshopify.com');
    assert.equal(expandStaffShopFilter('https://Ripx-Plus.myshopify.com/admin'), 'ripx-plus.myshopify.com');
    assert.equal(normalizeCategory('Setup'), 'setup');
    assert.equal(normalizeCategory('nope'), '');
    assert.equal(normalizeStatus('waiting_staff'), 'waiting_staff');
    assert.equal(normalizeStatus('done'), '');
    assert.equal(normalizeReplyEmail('a@b.com'), 'a@b.com');
    assert.equal(normalizeReplyEmail('not-an-email'), null);
    assert.throws(
      () =>
        validateCreateInput('demo.myshopify.com', {
          category: 'setup',
          subject: 'Need help',
          body: 'Checkout is blocked',
          reply_email: 'not-an-email',
        }),
      (err) => err.status === 400 && /email/i.test(err.message)
    );
    assert.equal(CREATE_LIMIT_PER_HOUR, 5);
    assert.equal(REPLY_LIMIT_PER_HOUR, 20);
  });

  it('caps subject and body', () => {
    assert.equal(normalizeSubject('  Hello  '), 'Hello');
    assert.equal(normalizeBody('x'.repeat(9000)).length, 8000);
  });

  it('generates and validates public ids without 0/O/1/I', () => {
    const id = generatePublicId();
    assert.equal(isPublicIdFormat(id), true);
    assert.equal(isPublicIdFormat(id.toLowerCase()), true);
    assert.equal(isPublicIdFormat('PX-O111'), false);
  });

  it('rejects create without a shop before touching the database', () => {
    assert.throws(
      () => validateCreateInput('', { category: 'setup', subject: 'X', body: 'Y' }),
      (err) => err.status === 401
    );
  });

  it('rejects invalid category or empty subject before touching the database', () => {
    assert.throws(
      () => validateCreateInput('demo.myshopify.com', { category: 'nope', subject: 'X', body: 'Y' }),
      (err) => err.status === 400 && /category/i.test(err.message)
    );
    assert.throws(
      () => validateCreateInput('demo.myshopify.com', { category: 'setup', subject: '  ', body: 'Y' }),
      (err) => err.status === 400 && /Subject/i.test(err.message)
    );
  });

  it('rate-limits the sixth create in an hour', () => {
    assert.equal(isCreateRateLimited(4), false);
    assert.equal(isCreateRateLimited(5), true);
    assert.equal(isCreateRateLimited(6), true);
  });

  it('scopes merchant ticket lookup to the requesting shop', () => {
    const scoped = buildTicketLookup('px-7k2m', 'Other.myshopify.com');
    assert.match(scoped.sql, /shop_domain/);
    assert.deepEqual(scoped.params, ['PX-7K2M', 'other.myshopify.com']);
    const staff = buildTicketLookup('PX-7K2M');
    assert.equal(staff.sql.includes('shop_domain'), false);
    assert.deepEqual(staff.params, ['PX-7K2M']);
  });

  it('hides internal ids and secrets from merchant ticket payloads', () => {
    const merchant = presentMerchantTicket(
      {
        id: 'uuid-internal',
        public_id: 'PX-7K2M',
        shop_domain: 'ripx-plus.myshopify.com',
        category: 'setup',
        subject: 'Checkout blocked',
        status: 'waiting_merchant',
        reply_email: 'njrips@gmail.com',
        diagnostics: { access_token: 'secret', shop: 'ripx-plus.myshopify.com' },
        created_at: '2026-08-26T00:00:00.000Z',
        updated_at: '2026-08-26T00:00:00.000Z',
        messages: [
          {
            id: 'm1',
            ticket_id: 'uuid-internal',
            author: 'staff',
            body: 'Please enable the theme embed.',
            created_at: '2026-08-26T00:01:00.000Z',
          },
        ],
      },
      { includeMessages: true }
    );
    assert.equal(merchant.id, undefined);
    assert.equal(merchant.diagnostics, undefined);
    assert.equal(merchant.shop_domain, undefined);
    assert.equal(merchant.public_id, 'PX-7K2M');
    assert.equal(merchant.messages[0].ticket_id, undefined);
    assert.equal(merchant.messages[0].body, 'Please enable the theme embed.');

    const staff = presentStaffTicket({
      id: 'uuid-internal',
      public_id: 'PX-7K2M',
      shop_domain: 'ripx-plus.myshopify.com',
      category: 'setup',
      subject: 'Checkout blocked',
      status: 'waiting_merchant',
      diagnostics: { access_token: 'secret', shop: 'ripx-plus.myshopify.com' },
      created_at: '2026-08-26T00:00:00.000Z',
      updated_at: '2026-08-26T00:00:00.000Z',
    });
    assert.equal(staff.id, undefined);
    assert.equal(staff.shop_domain, 'ripx-plus.myshopify.com');
    assert.equal(staff.diagnostics.access_token, undefined);
    assert.equal(staff.diagnostics.shop, 'ripx-plus.myshopify.com');
    const queued = presentStaffTicket(
      {
        id: 'uuid-internal',
        public_id: 'PX-7K2M',
        shop_domain: 'ripx-plus.myshopify.com',
        category: 'setup',
        subject: 'Checkout blocked',
        status: 'open',
        diagnostics: { access_token: 'secret' },
        created_at: '2026-08-26T00:00:00.000Z',
        updated_at: '2026-08-26T00:00:00.000Z',
      },
      { includeDiagnostics: false }
    );
    assert.equal(queued.diagnostics, undefined);
    assert.equal(queued.public_id, 'PX-7K2M');
  });

  it('escapes LIKE wildcards in staff search text', () => {
    assert.equal(escapeLikePattern('px%_x'), 'px\\%\\_x');
    assert.equal(escapeLikePattern('a\\b'), 'a\\\\b');
  });

  it('accepts comma-separated staff status filters and drops invalid values', () => {
    assert.deepEqual(normalizeStaffStatusFilter('open,waiting_staff'), ['open', 'waiting_staff']);
    assert.deepEqual(normalizeStaffStatusFilter("open'; drop"), []);
    assert.deepEqual(normalizeStaffStatusFilter(''), []);
  });

  it('builds an absolute staff ticket url when the app host is set', () => {
    const previous = process.env.SHOPIFY_APP_URL;
    process.env.SHOPIFY_APP_URL = 'https://example.com/';
    try {
      assert.equal(staffTicketUrl('PX-8BVE'), 'https://example.com/staff/support/PX-8BVE');
    } finally {
      if (previous === undefined) delete process.env.SHOPIFY_APP_URL;
      else process.env.SHOPIFY_APP_URL = previous;
    }
  });
});
