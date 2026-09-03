require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const express = require('express');
const cors = require('cors');
const { initDatabase } = require('./utils/database');
const { requireShop } = require('./middleware/shopContext');
const { requireShopifySession } = require('./middleware/shopifySessionContext');
const { requireEntitlement } = require('./services/billing/entitlementService');
const coreRoutes = require('./routes/coreRoutes');
const logger = require('./utils/logger');

const app = express();
const PORT = Number(process.env.RIPSPRICEX_API_PORT || process.env.PORT || 3456);

// Shopify CLI / Cloudflare tunnels set X-Forwarded-* (storefront apiUrl + proxy)
app.set('trust proxy', 1);

// Storefront traffic arrives from arbitrary merchant domains, so tracking has to
// accept any origin. The admin API does not: it is same-origin behind the app's
// own host, and reflecting every origin there let any page make credentialed
// calls on a merchant's behalf.
const storefrontCors = cors({ origin: true, credentials: true });
const adminCors = cors({
  origin(origin, callback) {
    callback(null, !origin || isAllowedAdminOrigin(origin));
  },
  credentials: true,
});

function appOrigins() {
  const configured = [
    process.env.SHOPIFY_APP_URL,
    process.env.APP_URL,
    process.env.RIPSPRICEX_PUBLIC_API_BASE,
    process.env.RIPSPRICEX_API_URL,
  ];
  const origins = new Set();
  for (const value of configured) {
    const raw = String(value || '').trim();
    if (!raw) continue;
    try {
      origins.add(new URL(raw).origin.toLowerCase());
    } catch {
      /* ignore malformed config */
    }
  }
  return origins;
}

function isAllowedAdminOrigin(origin) {
  const candidate = String(origin || '')
    .trim()
    .toLowerCase();
  if (!candidate) return false;
  if (appOrigins().has(candidate)) return true;
  let hostname;
  try {
    hostname = new URL(candidate).hostname;
  } catch {
    return false;
  }
  // Embedded App Home is framed by the Shopify admin, and merchants reach it on
  // their own myshopify domain.
  return (
    hostname === 'admin.shopify.com' ||
    hostname.endsWith('.shopify.com') ||
    hostname.endsWith('.myshopify.com')
  );
}

app.use('/api/track', storefrontCors);
app.use('/api/proxy', storefrontCors);
app.use(adminCors);
app.use(express.json({ limit: '2mb' }));

initDatabase();

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'ripspricex-api' });
});

app.use('/api', coreRoutes);

// Browser-facing admin surfaces authenticate the caller with a verified App
// Bridge ID token. Storefront (`/api/track`), install/billing (called by our own
// React Router server) and support (shared secret) keep their own schemes.
try {
  const settingsRoutes = require('./routes/settingsRoutes');
  app.use('/api/settings', requireShopifySession, settingsRoutes);
  logger.info('Settings routes mounted (installation, cart-transform, price-surfaces)');
} catch (err) {
  logger.warn('settingsRoutes not available', { message: err.message });
}

// Mount Smart Pricing routes when dependencies resolve
let smartPricingRoutes = null;
try {
  smartPricingRoutes = require('./routes/smartPricingRoutes');
  app.use('/api/smart-pricing', requireShopifySession, (req, res, next) => {
    // Read endpoints allowed without entitlement; mutations gated below
    const openGet =
      req.method === 'GET' &&
      (req.path === '/status' ||
        req.path === '/inbox/plans' ||
        req.path === '/inbox/summary' ||
        req.path === '/checkout-readiness' ||
        req.path === '/guardrails' ||
        req.path.startsWith('/tests/'));
    if (openGet) return next();
    if (req.method === 'GET') return next();
    return requireEntitlement('create')(req, res, next);
  });
  app.use('/api/smart-pricing', requireShopifySession, smartPricingRoutes);
  logger.info('Smart Pricing routes mounted');
} catch (err) {
  logger.error('Failed to mount smartPricingRoutes — using inbox fallback', {
    message: err.message,
    stack: err.stack,
  });
  // Pilot / production must not silently run without launch. Set
  // RIPSPRICEX_ALLOW_SP_FALLBACK=true only for emergency inbox-only mode.
  if (String(process.env.RIPSPRICEX_ALLOW_SP_FALLBACK || '').toLowerCase() !== 'true') {
    throw err;
  }
  const fallback = require('./routes/smartPricingFallbackRoutes');
  app.use('/api/smart-pricing', requireShopifySession, fallback);
}

// Slim price-test lifecycle
try {
  const testRoutes = require('./routes/testLifecycleRoutes');
  app.use('/api/tests', requireShopifySession, testRoutes);
} catch (err) {
  logger.warn('testLifecycleRoutes not available', { message: err.message });
}

try {
  const shopifySlimRoutes = require('./routes/shopifySlimRoutes');
  // Reads a merchant's catalog using the access token we hold for them, so it
  // needs the same proof of identity as the rest of the admin API.
  app.use('/api/shopify', requireShopifySession, shopifySlimRoutes);
} catch (err) {
  logger.warn('shopifySlimRoutes not available', { message: err.message });
}

try {
  const qaStubRoutes = require('./routes/qaStubRoutes');
  app.use('/api/qa', requireShopifySession, qaStubRoutes);
} catch (err) {
  logger.warn('qaStubRoutes not available', { message: err.message });
}

try {
  const goalMetricRoutes = require('./routes/goalMetricRoutes');
  app.use('/api/goal-metrics', requireShopifySession, goalMetricRoutes);
  logger.info('Goal metrics routes mounted (Classic Goals picker)');
} catch (err) {
  logger.warn('goalMetricRoutes not available', { message: err.message });
}

try {
  const supportTicketRoutes = require('./routes/supportTicketRoutes');
  const staffSupportRoutes = require('./routes/staffSupportRoutes');
  const { requireStaff } = require('./middleware/staffContext');
  const { requireSupportInternal } = require('./middleware/supportInternalContext');
  app.use('/api/support/tickets', requireShop, requireSupportInternal, supportTicketRoutes);
  app.use('/api/staff/support/tickets', requireStaff, staffSupportRoutes);
  logger.info('Support ticket routes mounted');
} catch (err) {
  logger.warn('support ticket routes not available', { message: err.message });
}

// Track + proxy aliases
try {
  const trackRoutes = require('./routes/trackSlimRoutes');
  app.use('/api/track', trackRoutes);
  app.use('/api/proxy', trackRoutes);
} catch (err) {
  logger.warn('trackSlimRoutes not available', { message: err.message });
}

app.use((err, _req, res, _next) => {
  logger.error('API error', { message: err.message, stack: err.stack });
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: err.message || 'Internal error',
    details: err.errors || undefined,
  });
});

if (require.main === module) {
  const { startBackgroundJobs } = require('./jobs/backgroundJobs');
  startBackgroundJobs();
  app.listen(PORT, () => {
    logger.info(`Pricify API listening on :${PORT}`);
  });
}

module.exports = app;
