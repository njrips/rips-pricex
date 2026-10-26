const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  safeConsoleNext,
  consoleNextTicketId,
  consolePathForStaffPath,
} = require('../consoleNextPath');

describe('consoleNextPath', () => {
  it('keeps console ticket, store and team paths only', () => {
    assert.equal(safeConsoleNext(''), '/console/tickets');
    assert.equal(safeConsoleNext('/console/tickets/PX-8BVE'), '/console/tickets/PX-8BVE');
    assert.equal(safeConsoleNext('/console/tickets/PX-8BVE?sent=1'), '/console/tickets/PX-8BVE?sent=1');
    assert.equal(safeConsoleNext('/console/tickets?status='), '/console/tickets?status=');
    assert.equal(
      safeConsoleNext('/console/tickets?sort=need&status=open'),
      '/console/tickets?status=open&sort=need'
    );
    assert.equal(safeConsoleNext('/console/stores?filter=locked'), '/console/stores?filter=locked');
    assert.equal(
      safeConsoleNext('/console/stores/ripx-plus.myshopify.com'),
      '/console/stores/ripx-plus.myshopify.com'
    );
    assert.equal(safeConsoleNext('/console/team'), '/console/team');
  });

  it('sends anything else home', () => {
    assert.equal(safeConsoleNext('https://evil.example/console/tickets/PX-8BVE'), '/console/tickets');
    assert.equal(safeConsoleNext('//evil.example'), '/console/tickets');
    assert.equal(safeConsoleNext('/console/tickets/../sign-in'), '/console/tickets');
    assert.equal(safeConsoleNext('/console/sign-in'), '/console/tickets');
    assert.equal(safeConsoleNext('/app/help'), '/console/tickets');
    assert.equal(safeConsoleNext('/staff/support'), '/console/tickets');
  });

  it('reads the ticket id out of a ticket path', () => {
    assert.equal(consoleNextTicketId('/console/tickets/px-8bve?sent=1'), 'PX-8BVE');
    assert.equal(consoleNextTicketId('/console/tickets'), '');
    assert.equal(consoleNextTicketId('/console/stores'), '');
  });

  it('maps old /staff links to the console', () => {
    assert.equal(consolePathForStaffPath('/staff'), '/console/tickets');
    assert.equal(consolePathForStaffPath('/staff/support'), '/console/tickets');
    assert.equal(consolePathForStaffPath('/staff/support', '?status=open'), '/console/tickets?status=open');
    assert.equal(consolePathForStaffPath('/staff/support/PX-8BVE'), '/console/tickets/PX-8BVE');
    assert.equal(consolePathForStaffPath('/staff/login'), '/console/sign-in');
    assert.equal(
      consolePathForStaffPath('/staff/login', '?next=%2Fstaff%2Fsupport%2FPX-8BVE'),
      '/console/sign-in?next=%2Fconsole%2Ftickets%2FPX-8BVE'
    );
    assert.equal(consolePathForStaffPath('/staff/anything-else'), '/console/tickets');
    assert.equal(consolePathForStaffPath('/staff/support/tickets'), '/console/tickets');
    assert.equal(consolePathForStaffPath('/staff/support/px-8bve'), '/console/tickets/PX-8BVE');
  });
});
