const engine = require('../abTestEngine');

function test(segments) {
  return { type: 'price', target_type: 'all', segments };
}

describe('abTestEngine device eligibility', () => {
  it('treats tablet as its own device on tablet-aware segments', () => {
    const mobileOnly = test({ device: 'mobile', tablet_separate: true });
    expect(engine.isUserEligible(mobileOnly, { device: 'tablet' })).toBe(false);
    expect(engine.isUserEligible(mobileOnly, { device: 'mobile' })).toBe(true);

    const tabletRules = test({
      device: 'all',
      tablet_separate: true,
      device_rules: [
        { type: 'include', value: 'desktop' },
        { type: 'include', value: 'tablet' },
      ],
    });
    expect(engine.isUserEligible(tabletRules, { device: 'tablet' })).toBe(true);
    expect(engine.isUserEligible(tabletRules, { device: 'mobile' })).toBe(false);
  });

  it('keeps counting tablets as mobile for tests launched before the split', () => {
    const legacyMobile = test({ device: 'mobile' });
    expect(engine.isUserEligible(legacyMobile, { device: 'tablet' })).toBe(true);

    const legacyDesktop = test({ device: 'desktop' });
    expect(engine.isUserEligible(legacyDesktop, { device: 'tablet' })).toBe(false);
  });

  it('accepts tablet as a segment device', () => {
    const { errors } = engine.validateTest({ type: 'price', segments: { device: 'tablet' } });
    expect(errors.join(' ')).not.toMatch(/Segment device/);
    const bad = engine.validateTest({ type: 'price', segments: { device: 'watch' } });
    expect(bad.errors.join(' ')).toMatch(/Segment device/);
  });
});
