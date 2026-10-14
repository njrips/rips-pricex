const {
  classicAudienceToSegments,
  normalizePrimaryMetric,
} = require('../classicAudienceSegmentMapper');

describe('classicAudienceSegmentMapper', () => {
  it('aliases paid_conversion_rate', () => {
    expect(normalizePrimaryMetric('paid_conversion_rate')).toBe('conversion_rate');
  });

  it('omits traffic_source_rules when every Classic source pill is selected', () => {
    const segs = classicAudienceToSegments({
      sources: ['Direct', 'Search', 'Social', 'Email', 'Paid ads', 'Referral'],
      sourceMode: 'include',
    });
    expect(segs.traffic_source_rules).toBeUndefined();
  });

  it('keeps tablet as its own device and marks the segments tablet-aware', () => {
    const tabletOnly = classicAudienceToSegments({ devices: ['Tablet'], deviceMode: 'include' });
    expect(tabletOnly.device).toBe('tablet');
    expect(tabletOnly.tablet_separate).toBe(true);

    const phonesAndDesktops = classicAudienceToSegments({
      devices: ['Desktop', 'Mobile'],
      deviceMode: 'include',
    });
    expect(phonesAndDesktops.device).toBe('all');
    expect(phonesAndDesktops.device_rules).toEqual([
      { type: 'include', value: 'desktop' },
      { type: 'include', value: 'mobile' },
    ]);

    const everything = classicAudienceToSegments({
      devices: ['Desktop', 'Mobile', 'Tablet'],
      deviceMode: 'include',
    });
    expect(everything.device).toBe('all');
    expect(everything.device_rules).toBeUndefined();
  });

  it('maps exclude sources and traffic ramp', () => {
    const segs = classicAudienceToSegments({
      segment: 'new_visitors',
      trafficAllocation: 35,
      devices: ['Desktop'],
      deviceMode: 'include',
      sources: ['Search'],
      sourceMode: 'exclude',
      countries: ['US'],
      countryMode: 'include',
    });
    expect(segs.customer).toBe('new');
    expect(segs.device).toBe('desktop');
    expect(segs.traffic_ramp_percent).toBe(35);
    expect(segs.traffic_source_rules).toEqual([
      { type: 'exclude', value: 'organic_search' },
      { type: 'exclude', value: 'paid_search' },
    ]);
    expect(segs.countries).toEqual(['US']);
  });

  it('maps empty include countries to worldwide (no country filter)', () => {
    const segs = classicAudienceToSegments({
      countries: [],
      countryMode: 'include',
    });
    expect(segs.countries).toEqual([]);
    expect(segs.audience_rules).toBeUndefined();
  });

  it('treats All-countries sentinels and huge include dumps as worldwide', () => {
    expect(classicAudienceToSegments({ countries: ['*'], countryMode: 'include' }).countries).toEqual(
      []
    );
    const dump = Array.from({ length: 200 }, (_, i) =>
      String.fromCharCode(65 + (i % 26), 65 + Math.floor(i / 26) % 26)
    );
    expect(
      classicAudienceToSegments({ countries: dump, countryMode: 'include' }).countries
    ).toEqual([]);
  });

  it('maps exclude-only countries to audience rules without wiping include lists', () => {
    const segs = classicAudienceToSegments({
      countries: ['GB'],
      countryMode: 'exclude',
    });
    expect(segs.countries).toEqual([]);
    expect(segs.audience_rules).toEqual([
      { type: 'exclude', field: 'country', value: ['GB'] },
    ]);
  });

  it('keeps include and exclude lists independent', () => {
    const segs = classicAudienceToSegments({
      includeCountries: ['US', 'CA'],
      excludeCountries: ['GB'],
      countryMode: 'exclude',
    });
    expect(segs.countries).toEqual(['US', 'CA']);
    expect(segs.audience_rules).toEqual([
      { type: 'exclude', field: 'country', value: ['GB'] },
    ]);
  });
});
