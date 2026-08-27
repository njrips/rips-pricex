import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  HELP_FAQ_ITEMS,
  formatTicketTime,
  isPublicIdFormat,
  attentionTicketToPrompt,
  pickAttentionTicket,
  shouldAutoOpenAttention,
  ticketCategoryLabel,
  merchantTicketLookupError,
  ticketMerchantHint,
  ticketStatusLabel,
} from '../helpFaq.js';

describe('helpFaq', () => {
  it('uses Admin-accurate FAQ copy (theme embed is required)', () => {
    assert.match(HELP_FAQ_ITEMS[0].a, /theme app embed/i);
    assert.equal(
      HELP_FAQ_ITEMS.some((item) => /no theme changes/i.test(item.a)),
      false
    );
    assert.equal(
      HELP_FAQ_ITEMS.some((item) => /under the product price/i.test(item.q)),
      true
    );
    assert.match(
      HELP_FAQ_ITEMS.find((item) => /under the product price/i.test(item.q))?.a || '',
      /live and Preview/i
    );
    assert.match(
      HELP_FAQ_ITEMS.find((item) => /Preview, QR/i.test(item.q))?.a || '',
      /under the product price/i
    );
  });

  it('accepts public ticket ids case-insensitively', () => {
    assert.equal(isPublicIdFormat('PX-7K2M'), true);
    assert.equal(isPublicIdFormat('px-7k2m'), true);
    assert.equal(isPublicIdFormat('PX-O111'), false);
    assert.equal(isPublicIdFormat('not-an-id'), false);
  });

  it('labels ticket statuses', () => {
    assert.equal(ticketStatusLabel('waiting_merchant'), 'Waiting on you');
    assert.equal(ticketStatusLabel('waiting_staff'), 'Waiting on support');
    assert.equal(ticketStatusLabel('waiting_merchant', { staff: true }), 'Waiting on merchant');
    assert.equal(ticketStatusLabel('waiting_staff', { staff: true }), 'Waiting on you');
    assert.match(ticketMerchantHint('waiting_merchant'), /Support replied/);
    assert.equal(merchantTicketLookupError(404), 'That ticket is not on this shop.');
    assert.equal(merchantTicketLookupError(400), 'Invalid ticket id');
  });

  it('keeps Admin FAQ free of env internals and covers uninstall', () => {
    assert.equal(
      HELP_FAQ_ITEMS.some((item) => /RIPSPRICEX_/i.test(`${item.q} ${item.a}`)),
      false
    );
    assert.equal(
      HELP_FAQ_ITEMS.some((item) => /uninstall/i.test(item.q)),
      true
    );
    assert.equal(ticketCategoryLabel('setup'), 'Setup / checkout');
    assert.match(formatTicketTime('2026-08-24T12:00:00.000Z'), /2026/);
    assert.match(
      HELP_FAQ_ITEMS.find((item) => /contact support/i.test(item.q))?.a || '',
      /Only this shop/,
    );
    assert.equal(
      pickAttentionTicket([
        { public_id: 'PX-AAAA', status: 'open' },
        { public_id: 'PX-8BVE', status: 'waiting_merchant' },
      ]),
      'PX-8BVE',
    );
    assert.equal(pickAttentionTicket([{ public_id: 'PX-AAAA', status: 'open' }]), null);
    assert.equal(shouldAutoOpenAttention({}), true);
    assert.equal(shouldAutoOpenAttention({ view: 'all' }), false);
    assert.equal(shouldAutoOpenAttention({ ticketId: 'PX-8BVE' }), false);
    assert.equal(
      attentionTicketToPrompt(
        [
          { public_id: 'PX-AAAA', status: 'open' },
          { public_id: 'PX-8BVE', status: 'waiting_merchant' },
        ],
        '',
      ),
      'PX-8BVE',
    );
    assert.equal(
      attentionTicketToPrompt(
        [{ public_id: 'PX-8BVE', status: 'waiting_merchant' }],
        'px-8bve',
      ),
      null,
    );
  });
});
