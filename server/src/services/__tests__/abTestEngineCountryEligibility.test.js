const engine = require('../abTestEngine');

function test(segments) {
  return { type: 'price', target_type: 'all', segments };
}

describe('abTestEngine country eligibility', () => {
  it('admits only visitors known to be in an include list', () => {
    const usOnly = test({ countries: ['US', 'AF'] });
    expect(engine.isUserEligible(usOnly, { country: 'US' })).toBe(true);
    expect(engine.isUserEligible(usOnly, { country: 'bd' })).toBe(false);
    expect(engine.isUserEligible(usOnly, { country: '' })).toBe(false);
  });

  it('keeps everyone outside an exclude list, including unknown countries', () => {
    const notBd = test({
      countries: [],
      audience_rules: [{ type: 'exclude', field: 'country', value: ['BD'] }],
    });
    expect(engine.isUserEligible(notBd, { country: 'BD' })).toBe(false);
    expect(engine.isUserEligible(notBd, { country: 'US' })).toBe(true);
    expect(engine.isUserEligible(notBd, { country: '' })).toBe(true);
  });

  it('still applies the new/returning segment when countries are excluded', () => {
    const newOutsideBd = test({
      customer: 'new',
      audience_rules: [{ type: 'exclude', field: 'country', value: ['BD'] }],
    });
    expect(engine.isUserEligible(newOutsideBd, { customer: 'new', country: 'US' })).toBe(true);
    expect(engine.isUserEligible(newOutsideBd, { customer: 'returning', country: 'US' })).toBe(
      false
    );
  });
});
