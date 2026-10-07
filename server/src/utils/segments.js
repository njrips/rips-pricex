/**
 * Allowed values for targeting segments on AB tests.
 */

/** Values the wizard + storefront can persist on `segments.traffic_source` (keep aligned with TestWizard AUDIENCE_SOURCE_OPTIONS + legacy buckets). */
const AUDIENCE_TRAFFIC_SOURCE_VALUES = new Set([
  'all',
  'direct',
  'email',
  'referral',
  'organic_social',
  'paid_social',
  'organic_search',
  'paid_search',
  'paid_shopping',
  'sms',
  'google',
  'facebook',
  'instagram',
  'tiktok',
  'twitter',
  'youtube',
  'organic',
  'paid',
  'social',
]);

const AUDIENCE_OPERATING_SYSTEM_VALUES = new Set([
  'all',
  'windows',
  'macos',
  'ios',
  'android',
  'linux',
  'other',
]);

module.exports = {
  AUDIENCE_TRAFFIC_SOURCE_VALUES,
  AUDIENCE_OPERATING_SYSTEM_VALUES,
};
