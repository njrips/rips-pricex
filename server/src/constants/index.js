/**
 * Application Constants
 *
 * Centralized constants for the RipX application.
 */

// HTTP Status Codes
const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

// Statistical Significance Threshold
const STATISTICAL_THRESHOLD = {
  P_VALUE: 0.05,
  CONFIDENCE_LEVEL: 95,
};

// Legacy analytics fallback, for a test that stamped no confidence level of its
// own. Smart Pricing tests never reach it: resolveAnalysisConfidence reads the
// level stamped at launch and falls back to the Smart Pricing default of 0.90.
//
// The sample-size and confidence bounds that used to sit here were never read by
// settings or any route, and had drifted to describe limits the app does not
// enforce — a 10,000 ceiling against a real cap of 1,000,000, and a default of
// 100 against a real default of 5,000. smartPricingGuardrailsService owns those
// ranges; a second, wrong copy of them was only ever going to mislead.
const SETTINGS_BOUNDS = {
  DEFAULT_CONFIDENCE_LEVEL: 0.95,
};

// Error Messages
const ERROR_MESSAGES = {
  TEST_NOT_FOUND: 'Test not found',
  VALIDATION_FAILED: 'Validation failed',
  UNAUTHORIZED: 'Unauthorized',
  FORBIDDEN: 'Forbidden',
  INTERNAL_ERROR: 'Internal server error',
  INVALID_INPUT: 'Invalid input',
  DATABASE_ERROR: 'Database error',
  SHOPIFY_ERROR: 'Shopify API error',
  MAINTENANCE: 'Maintenance mode. Please try again later.',
};

/** Max cart lines per POST /api/track/price-resolve-batch (Discount Function batch resolver) */
const PRICE_RESOLVE_BATCH_MAX = parseInt(process.env.PRICE_RESOLVE_BATCH_MAX, 10) || 80;

/**
 * Max UTF-8 bytes for JSON body of price-resolve-batch success response (Shopify ~100KB total limit).
 * Default 95KB margin for headers / framing. Override with PRICE_RESOLVE_BATCH_RESPONSE_MAX_BYTES.
 */
const PRICE_RESOLVE_BATCH_RESPONSE_MAX_BYTES =
  parseInt(process.env.PRICE_RESOLVE_BATCH_RESPONSE_MAX_BYTES, 10) || 95 * 1024;

/** Log warn when price-resolve-batch handler exceeds this duration (ms); default 800 (Shopify fetch budget 2000ms). */
const PRICE_BATCH_SLOW_LOG_MS = parseInt(process.env.PRICE_BATCH_SLOW_LOG_MS, 10) || 800;

// Validation limits (test name, etc.)
const MAX_TEST_NAME_LENGTH = 255;

module.exports = {
  HTTP_STATUS,
  STATISTICAL_THRESHOLD,
  SETTINGS_BOUNDS,
  ERROR_MESSAGES,
  PRICE_RESOLVE_BATCH_MAX,
  PRICE_RESOLVE_BATCH_RESPONSE_MAX_BYTES,
  PRICE_BATCH_SLOW_LOG_MS,
  MAX_TEST_NAME_LENGTH,
};
