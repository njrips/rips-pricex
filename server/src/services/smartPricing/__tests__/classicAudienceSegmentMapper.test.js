const {
  classicAudienceToSegments,
  normalizePrimaryMetric,
} = require('../classicAudienceSegmentMapper');

describe('classicAudienceSegmentMapper', () => {
  it('aliases paid_conversion_rate', () => {
    expect(normalizePrimaryMetric('paid_conversion_rate')).toBe('conversion_rate');
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
});
