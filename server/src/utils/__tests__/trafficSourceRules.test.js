const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  matchesTrafficSourceRules,
  matchesLegacyTrafficSource,
  expandTrafficSourceValue,
} = require('../trafficSourceRules');

const storefrontSrc = fs.readFileSync(
  path.resolve(__dirname, '../../../../storefront/storefront-script.js'),
  'utf8'
);

describe('traffic source rules', () => {
  it('treats storefront google organic as Classic Search (organic_search)', () => {
    assert.match(storefrontSrc, /return 'google'/);
    assert.deepEqual(expandTrafficSourceValue('organic_search'), ['organic_search', 'google']);
    assert.equal(
      matchesTrafficSourceRules([{ type: 'include', value: 'organic_search' }], 'google'),
      true
    );
    assert.equal(
      matchesTrafficSourceRules([{ type: 'include', value: 'organic_search' }], 'organic_search'),
      true
    );
    assert.equal(matchesLegacyTrafficSource('organic_search', 'google'), true);
  });

  it('does not let google organic satisfy paid_search or social', () => {
    assert.equal(
      matchesTrafficSourceRules([{ type: 'include', value: 'paid_search' }], 'google'),
      false
    );
    assert.equal(matchesTrafficSourceRules([{ type: 'include', value: 'social' }], 'google'), false);
  });

  it('still excludes google when organic_search is excluded', () => {
    assert.equal(
      matchesTrafficSourceRules(
        [
          { type: 'include', value: 'direct' },
          { type: 'exclude', value: 'organic_search' },
        ],
        'google'
      ),
      false
    );
  });
});
