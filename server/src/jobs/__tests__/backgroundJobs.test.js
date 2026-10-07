jest.mock('../../utils/database', () => ({ query: jest.fn(), getClient: jest.fn() }));

const { nextInboxSyncWindow } = require('../backgroundJobs');

describe('nextInboxSyncWindow', () => {
  const ids = Array.from({ length: 120 }, (_, i) => `t-${String(i).padStart(3, '0')}`);

  it('syncs a small inbox whole, every pass', () => {
    expect(nextInboxSyncWindow('small.myshopify.com', ['b', 'a', 'a', ''])).toEqual(['a', 'b']);
    expect(nextInboxSyncWindow('small.myshopify.com', ['b', 'a'])).toEqual(['a', 'b']);
  });

  it('walks a large inbox 50 at a time and reaches every test', () => {
    const shop = 'large.myshopify.com';
    const seen = new Set();
    for (let pass = 0; pass < 3; pass += 1) {
      const window = nextInboxSyncWindow(shop, [...ids].reverse());
      expect(window).toHaveLength(50);
      window.forEach(id => seen.add(id));
    }
    expect(seen.size).toBe(ids.length);
  });

  it('keeps a cursor per shop', () => {
    const first = nextInboxSyncWindow('one.myshopify.com', ids);
    const other = nextInboxSyncWindow('two.myshopify.com', ids);
    expect(other).toEqual(first);
    expect(nextInboxSyncWindow('one.myshopify.com', ids)[0]).toBe('t-050');
  });
});
