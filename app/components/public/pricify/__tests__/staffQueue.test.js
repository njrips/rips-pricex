import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  STAFF_QUEUE_FILTERS_KEY,
  clipPreview,
  countNeedsYou,
  emptyQueueMessage,
  expandShopFilter,
  formatRelativeTicketTime,
  latestAuthorLabel,
  normalizeQueueSort,
  queueHref,
  shopHandle,
  sortStaffTickets,
  staffNeedsYou,
  staffQueueBackHref,
  staffRowTone,
  ticketHref,
  writeStaffQueueFilters,
} from '../staffQueue.js';

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

describe('staffQueue', () => {
  it('shortens shop domains and ticket hrefs', () => {
    assert.equal(shopHandle('ripx-plus.myshopify.com'), 'ripx-plus');
    assert.equal(ticketHref('PX-7K2M'), '/staff/support/PX-7K2M');
    assert.equal(clipPreview('  one   two  '.repeat(20), 24).endsWith('…'), true);
  });

  it('marks tickets that need staff and ages them', () => {
    assert.equal(staffNeedsYou('waiting_staff'), true);
    assert.equal(staffNeedsYou('open'), true);
    assert.equal(staffNeedsYou('waiting_merchant'), false);
    const now = Date.parse('2026-08-27T12:00:00.000Z');
    assert.equal(staffRowTone('waiting_staff', '2026-08-27T11:00:00.000Z', now), 'need');
    assert.equal(staffRowTone('waiting_staff', '2026-08-26T10:00:00.000Z', now), 'stale');
    assert.equal(staffRowTone('resolved', '2026-08-26T10:00:00.000Z', now), 'calm');
  });

  it('formats relative times and sorts needs-you first', () => {
    const now = Date.parse('2026-08-27T12:00:00.000Z');
    assert.equal(formatRelativeTicketTime('2026-08-27T11:50:00.000Z', now), '10m ago');
    assert.equal(formatRelativeTicketTime('2026-08-27T09:00:00.000Z', now), '3h ago');
    const sorted = sortStaffTickets(
      [
        { public_id: 'PX-AAAA', status: 'resolved', shop_domain: 'z.myshopify.com', updated_at: '2026-08-27T11:00:00.000Z' },
        { public_id: 'PX-BBBB', status: 'waiting_staff', shop_domain: 'a.myshopify.com', updated_at: '2026-08-26T10:00:00.000Z' },
        { public_id: 'PX-CCCC', status: 'open', shop_domain: 'b.myshopify.com', updated_at: '2026-08-27T11:30:00.000Z' },
      ],
      'need',
      now,
    );
    assert.deepEqual(
      sorted.map((ticket) => ticket.public_id),
      ['PX-BBBB', 'PX-CCCC', 'PX-AAAA'],
    );
    assert.equal(countNeedsYou(sorted), 2);
  });

  it('keeps queue filter hrefs on the staff path', () => {
    assert.equal(queueHref({}), '/staff/support');
    assert.equal(queueHref({ status: '' }), '/staff/support?status=');
    assert.equal(
      queueHref({ status: 'closed', shop: 'ripx-plus.myshopify.com', sort: 'need' }),
      '/staff/support?status=closed&shop=ripx-plus.myshopify.com&sort=need',
    );
    assert.equal(queueHref({ sort: 'nope' }), '/staff/support');
  });

  it('expands shop handles and restores the last queue view', () => {
    assert.equal(expandShopFilter('ripx-plus'), 'ripx-plus.myshopify.com');
    assert.equal(expandShopFilter('https://Ripx-Plus.myshopify.com/admin'), 'ripx-plus.myshopify.com');
    assert.equal(normalizeQueueSort('need'), 'need');
    assert.equal(normalizeQueueSort('nope'), 'updated');
    assert.equal(latestAuthorLabel('staff'), 'You');
    assert.equal(latestAuthorLabel(''), '');
    assert.equal(emptyQueueMessage({ status: '' }), 'No tickets yet.');
    assert.equal(emptyQueueMessage({ status: 'open,waiting_staff' }), 'No tickets need attention.');
    assert.equal(
      emptyQueueMessage({ status: 'open,waiting_staff', shop: 'ripx-plus' }),
      'No tickets need attention for this search. Try All.',
    );
    const storage = memoryStorage();
    writeStaffQueueFilters({ status: '', shop: 'ripx-plus', sort: 'need' }, storage);
    assert.equal(storage.getItem(STAFF_QUEUE_FILTERS_KEY).includes('"status":""'), true);
    assert.equal(staffQueueBackHref(storage), '/staff/support?status=&shop=ripx-plus&sort=need');
  });
});
