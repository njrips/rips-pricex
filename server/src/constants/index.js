/**
 * Application Constants
 *
 * Centralized constants for the RipX application.
 *
 * Canonical for API: TEST_STATUS and TEST_TYPES are the source of truth for values
 * sent/received by the API. Frontend should use the same string values (e.g. 'stopped',
 * 'price'); UI labels can differ (e.g. "Pricing" for type "price").
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

// Test Status Values (must match DB constraint valid_status and API usage)
const TEST_STATUS = {
  DRAFT: 'draft',
  RUNNING: 'running',
  STOPPED: 'stopped',
  COMPLETED: 'completed',
  ARCHIVED: 'archived',
};

// Test Types
// API/backend canonical for price tests is "price"; UI may label as "Pricing Test". Validators accept both "price" and "pricing".
const TEST_TYPES = {
  PRICE: 'price',
  CONTENT: 'content',
  SHIPPING: 'shipping',
  OFFER: 'offer',
  ONSITE_EDIT: 'onsite-edit',
  SPLIT_URL: 'split-url',
  TEMPLATE: 'template',
  THEME: 'theme',
  CHECKOUT: 'checkout',
  COMBINATION: 'combination',
};

// Target Types
const TARGET_TYPES = {
  PRODUCT: 'product',
  COLLECTION: 'collection',
  HOMEPAGE: 'homepage',
  CART: 'cart',
  CHECKOUT: 'checkout',
  ALL_PRODUCTS: 'all-products',
  PAGE: 'page',
  ALL: 'all',
};

// Statistical Significance Threshold
const STATISTICAL_THRESHOLD = {
  P_VALUE: 0.05,
  CONFIDENCE_LEVEL: 95,
};

// Settings bounds (min sample size, confidence level) – used by settings and admin routes
const SETTINGS_BOUNDS = {
  MIN_SAMPLE_SIZE: 10,
  MAX_SAMPLE_SIZE: 10000,
  CONFIDENCE_LEVEL_MIN: 0.8,
  CONFIDENCE_LEVEL_MAX: 1,
  DEFAULT_CONFIDENCE_LEVEL: 0.95,
  DEFAULT_MIN_SAMPLE_SIZE: 100,
};

// Test health / auto-stop thresholds (min visitors per variant for significance decisions)
const TEST_HEALTH = {
  MIN_VISITORS_PER_VARIANT: 50,
};

// Default Values
const DEFAULTS = {
  TEST_STATUS: TEST_STATUS.DRAFT,
  TRAFFIC_ALLOCATION: 50,
  MIN_VARIANTS: 2,
  MAX_VARIANTS: 10,
};

// User status: allowed for session and /me vs blocked
const USER_STATUS = {
  ALLOWED_FOR_SESSION: ['accepted', 'active'],
  BLOCKED: ['locked', 'suspended'],
};
function isUserStatusAllowedForSession(status) {
  return status && USER_STATUS.ALLOWED_FOR_SESSION.includes(status);
}
function isUserStatusBlocked(status) {
  return status && USER_STATUS.BLOCKED.includes(status);
}

// Platform admin roles (users.role) – who can access /api/admin
const PLATFORM_ROLES = {
  COLLABORATOR: 'collaborator',
  ADMIN: 'admin',
  SUPERADMIN: 'superadmin',
};
const PLATFORM_ROLE_VALUES = Object.values(PLATFORM_ROLES);

function isPlatformAdmin(role) {
  return role && typeof role === 'string' && PLATFORM_ROLE_VALUES.includes(role.toLowerCase());
}

function isSuperadmin(role) {
  return role && String(role).toLowerCase() === PLATFORM_ROLES.SUPERADMIN;
}

// Domain-level roles (user_domain_access.role) – per-tenant access
const DOMAIN_ROLES = ['owner', 'member', 'viewer'];
const DOMAIN_ROLE_WRITE = ['owner', 'member']; // can create/edit/delete tests, settings
const DOMAIN_ROLE_READ_ONLY = ['viewer'];

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

// Success Messages
const SUCCESS_MESSAGES = {
  TEST_CREATED: 'Test created successfully',
  TEST_UPDATED: 'Test updated successfully',
  TEST_DELETED: 'Test deleted successfully',
  TEST_STARTED: 'Test started successfully',
  TEST_STOPPED: 'Test stopped successfully',
  TEST_CLONED: 'Test cloned successfully',
  PROFILE_UPDATED: 'Profile updated successfully',
  ACCOUNT_UPDATED: 'Account settings updated successfully',
  PREFERENCES_UPDATED: 'Preferences updated successfully',
};

// Rate Limiting (env overrides for production tuning)
// Default 400/15min so app load does not hit 429; development uses a higher ceiling.
const isDevelopment = String(process.env.NODE_ENV || '').trim() !== 'production';
const RATE_LIMIT = {
  WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000, // 15 min default
  MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || (isDevelopment ? 20000 : 400),
  /** Health family: /live, /ready, /health, /api/* (separate bucket from general /api/) */
  HEALTH_WINDOW_MS: parseInt(process.env.RATE_LIMIT_HEALTH_WINDOW_MS, 10) || 60 * 1000,
  HEALTH_MAX: parseInt(process.env.RATE_LIMIT_HEALTH_MAX, 10) || 300,
};

// Pagination
const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
  /** Admin list endpoints: default and max limit per page */
  ADMIN_DEFAULT_LIMIT: 50,
  ADMIN_MAX_LIMIT: 500,
  /** Analytics list/events: default and max limit per page */
  ANALYTICS_DEFAULT_LIMIT: 50,
  ANALYTICS_MAX_LIMIT: 200,
};

// Key-value store keys (config, health, legal)
const KV_KEYS = {
  ANNOUNCEMENT_BANNER: 'config.announcement_banner',
  MAINTENANCE_MESSAGE: 'config.maintenance_message',
  TERMS_URL: 'config.terms_url',
  PRIVACY_URL: 'config.privacy_url',
};

// Track/heatmap limits (DoS protection)
const HEATMAP_EVENTS_BATCH_MAX = parseInt(process.env.HEATMAP_EVENTS_BATCH_MAX, 10) || 500;

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

/** Key-value store: max value size in bytes (512KB) to prevent abuse */
const KV_VALUE_MAX_BYTES = 512 * 1024;

module.exports = {
  HTTP_STATUS,
  USER_STATUS,
  isUserStatusAllowedForSession,
  isUserStatusBlocked,
  PLATFORM_ROLES,
  PLATFORM_ROLE_VALUES,
  isPlatformAdmin,
  isSuperadmin,
  DOMAIN_ROLES,
  DOMAIN_ROLE_WRITE,
  DOMAIN_ROLE_READ_ONLY,
  TEST_STATUS,
  TEST_TYPES,
  TARGET_TYPES,
  STATISTICAL_THRESHOLD,
  SETTINGS_BOUNDS,
  TEST_HEALTH,
  DEFAULTS,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  RATE_LIMIT,
  PAGINATION,
  KV_KEYS,
  HEATMAP_EVENTS_BATCH_MAX,
  PRICE_RESOLVE_BATCH_MAX,
  PRICE_RESOLVE_BATCH_RESPONSE_MAX_BYTES,
  PRICE_BATCH_SLOW_LOG_MS,
  MAX_TEST_NAME_LENGTH,
  KV_VALUE_MAX_BYTES,
};
