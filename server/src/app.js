require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const express = require('express');
const cors = require('cors');
const { initDatabase } = require('./utils/database');
const { requireShop } = require('./middleware/shopContext');
const { requireEntitlement } = require('./services/billing/entitlementService');
const coreRoutes = require('./routes/coreRoutes');
const logger = require('./utils/logger');

const app = express();
const PORT = Number(process.env.RIPSPRICEX_API_PORT || process.env.PORT || 3456);

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));

initDatabase();

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'ripspricex-api' });
});

app.use('/api', coreRoutes);

try {
  const settingsRoutes = require('./routes/settingsRoutes');
  app.use('/api/settings', requireShop, settingsRoutes);
  logger.info('Settings routes mounted (installation, cart-transform, price-surfaces)');
} catch (err) {
  logger.warn('settingsRoutes not available', { message: err.message });
}

// Mount Smart Pricing routes when dependencies resolve
let smartPricingRoutes = null;
try {
  smartPricingRoutes = require('./routes/smartPricingRoutes');
  app.use('/api/smart-pricing', requireShop, (req, res, next) => {
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
  app.use('/api/smart-pricing', requireShop, smartPricingRoutes);
  logger.info('Smart Pricing routes mounted');
} catch (err) {
  logger.error('Failed to mount smartPricingRoutes — using inbox fallback', {
    message: err.message,
    stack: err.stack,
  });
  const fallback = require('./routes/smartPricingFallbackRoutes');
  app.use('/api/smart-pricing', requireShop, fallback);
}

// Slim price-test lifecycle
try {
  const testRoutes = require('./routes/testLifecycleRoutes');
  app.use('/api/tests', requireShop, testRoutes);
} catch (err) {
  logger.warn('testLifecycleRoutes not available', { message: err.message });
}

try {
  const shopifySlimRoutes = require('./routes/shopifySlimRoutes');
  app.use('/api/shopify', shopifySlimRoutes);
} catch (err) {
  logger.warn('shopifySlimRoutes not available', { message: err.message });
}

try {
  const qaStubRoutes = require('./routes/qaStubRoutes');
  app.use('/api/qa', qaStubRoutes);
} catch (err) {
  logger.warn('qaStubRoutes not available', { message: err.message });
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
    logger.info(`RipsPriceX API listening on :${PORT}`);
  });
}

module.exports = app;
