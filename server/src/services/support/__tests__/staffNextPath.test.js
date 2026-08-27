const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { safeStaffNext, staffNextTicketId } = require('../staffNextPath');

describe('staffNextPath', () => {
  it('keeps staff ticket and queue paths only', () => {
    assert.equal(safeStaffNext('/staff/support/PX-8BVE'), '/staff/support/PX-8BVE');
    assert.equal(safeStaffNext('/staff/support?shop=ripx-plus.myshopify.com'), '/staff/support?shop=ripx-plus.myshopify.com');
    assert.equal(safeStaffNext('/staff/support?status='), '/staff/support?status=');
    assert.equal(
      safeStaffNext('/staff/support?sort=need&status=open'),
      '/staff/support?status=open&sort=need',
    );
    assert.equal(safeStaffNext('https://evil.example/staff/support/PX-8BVE'), '/staff/support');
    assert.equal(safeStaffNext('/staff/login'), '/staff/support');
    assert.equal(staffNextTicketId('/staff/support/px-8bve?sent=1'), 'PX-8BVE');
  });
});
