import { describe, expect, it } from 'vitest';
import {
  classicAudienceToSegments,
  normalizeAudienceSegments,
} from '../../targeting/smartPricingAudienceHelpers';

describe('device targeting segments', () => {
  it('launches Tablet as its own device', () => {
    const segments = classicAudienceToSegments({ devices: ['Tablet'], deviceMode: 'include' });
    expect(segments.device).toBe('tablet');
    expect(segments.tablet_separate).toBe(true);
  });

  it('restricts Desktop + Mobile to those two, now that tablets are separate', () => {
    const segments = classicAudienceToSegments({
      devices: ['Desktop', 'Mobile'],
      deviceMode: 'include',
    });
    expect(segments.device).toBe('all');
    expect(segments.device_rules).toEqual([
      { type: 'include', value: 'desktop' },
      { type: 'include', value: 'mobile' },
    ]);
  });

  it('treats all three devices as no restriction', () => {
    const segments = classicAudienceToSegments({
      devices: ['Desktop', 'Mobile', 'Tablet'],
      deviceMode: 'include',
    });
    expect(segments.device).toBe('all');
    expect(segments.device_rules).toBeUndefined();
  });

  it('keeps tablet rules and the tablet-aware flag through normalization', () => {
    const normalized = normalizeAudienceSegments({
      device: 'all',
      tablet_separate: true,
      device_rules: [{ type: 'exclude', value: 'tablet' }],
    });
    expect(normalized.tablet_separate).toBe(true);
    expect(normalized.device_rules).toEqual([{ type: 'exclude', value: 'tablet' }]);
    expect(normalizeAudienceSegments({ device: 'mobile' }).tablet_separate).toBeUndefined();
  });
});
