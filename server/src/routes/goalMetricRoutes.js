const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/asyncHandler');
const { sendError, sendSuccess } = require('../utils/response');
const { HTTP_STATUS } = require('../constants');
const {
  listGoalMetricDefinitions,
  upsertGoalMetricDefinition,
  deleteGoalMetricDefinition,
} = require('../models/goalMetricDefinition');

function isValidUUID(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || '')
  );
}

const ALLOWED_AGGREGATIONS = new Set(['count', 'sum']);
const ALLOWED_DIRECTIONS = new Set(['increase', 'decrease']);
const ALLOWED_ROLES = new Set(['primary', 'secondary', 'guardrail']);
const ALLOWED_TRIGGERS = new Set([
  'custom_event',
  'url_match',
  'css_click',
  'form_start',
  'form_submit',
  'element_visibility',
  'custom_javascript',
]);
const ALLOWED_VISIBILITY_FREQUENCIES = new Set(['once_per_page', 'once_per_element', 'every_time']);

function normalizeEventName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
}

function getShopDomain(req) {
  return String(req.query.domain || req.shopDomain || '')
    .trim()
    .toLowerCase();
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function normalizeDefinition(body = {}) {
  const name = String(body.name || '')
    .trim()
    .slice(0, 120);
  const eventName = normalizeEventName(body.event_name || body.eventName || name);
  const triggerType = ALLOWED_TRIGGERS.has(body.trigger_type) ? body.trigger_type : 'custom_event';
  const rawConfig =
    body.trigger_config && typeof body.trigger_config === 'object' ? body.trigger_config : {};
  const triggerConfig = {
    selector: String(rawConfig.selector || '')
      .trim()
      .slice(0, 200),
    url_pattern: String(rawConfig.url_pattern || '')
      .trim()
      .slice(0, 300),
    parameter_name: String(rawConfig.parameter_name || '')
      .trim()
      .slice(0, 80),
    link_kind: String(rawConfig.link_kind || rawConfig.linkKind || '')
      .trim()
      .slice(0, 40),
    visibility_threshold: clampNumber(rawConfig.visibility_threshold, 50, 1, 100),
    visibility_min_duration_ms: clampNumber(rawConfig.visibility_min_duration_ms, 0, 0, 60000),
    visibility_frequency: ALLOWED_VISIBILITY_FREQUENCIES.has(rawConfig.visibility_frequency)
      ? rawConfig.visibility_frequency
      : 'once_per_page',
    observe_dom_changes: rawConfig.observe_dom_changes !== false,
    custom_javascript: String(rawConfig.custom_javascript || '')
      .trim()
      .slice(0, 2000),
    custom_javascript_interval_ms: clampNumber(
      rawConfig.custom_javascript_interval_ms,
      1000,
      250,
      10000
    ),
    custom_javascript_max_wait_ms: clampNumber(
      rawConfig.custom_javascript_max_wait_ms,
      10000,
      1000,
      120000
    ),
    min_relative_lift:
      rawConfig.min_relative_lift === '' || rawConfig.min_relative_lift === undefined
        ? undefined
        : Number(rawConfig.min_relative_lift),
  };
  return {
    name,
    event_name: eventName,
    description: String(body.description || '')
      .trim()
      .slice(0, 500),
    category: String(body.category || 'custom')
      .trim()
      .toLowerCase()
      .slice(0, 50),
    aggregation: ALLOWED_AGGREGATIONS.has(body.aggregation) ? body.aggregation : 'count',
    direction: ALLOWED_DIRECTIONS.has(body.direction) ? body.direction : 'increase',
    metric_role: ALLOWED_ROLES.has(body.metric_role) ? body.metric_role : 'secondary',
    trigger_type: triggerType,
    trigger_config: triggerConfig,
    tags: Array.isArray(body.tags) ? body.tags : [],
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const shopDomain = getShopDomain(req);
    if (!shopDomain) {
      return sendError(res, HTTP_STATUS.UNAUTHORIZED, 'Shop domain required');
    }

    // Scoped by shop; there is no tenant dimension in this schema.
    const definitions = await listGoalMetricDefinitions(shopDomain);
    return sendSuccess(res, HTTP_STATUS.OK, { definitions });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const shopDomain = getShopDomain(req);
    if (!shopDomain) {
      return sendError(res, HTTP_STATUS.UNAUTHORIZED, 'Shop domain required');
    }

    const definition = normalizeDefinition(req.body);
    if (!definition.name) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Goal name is required');
    }
    if (!definition.event_name) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Event name is required');
    }
    if (definition.trigger_type === 'url_match' && !definition.trigger_config.url_pattern) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'URL pattern is required for URL triggers');
    }
    if (
      (definition.trigger_type === 'css_click' || definition.trigger_type === 'form_submit') &&
      !definition.trigger_config.selector
    ) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'CSS selector is required for DOM triggers');
    }
    if (definition.trigger_type === 'element_visibility' && !definition.trigger_config.selector) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        'CSS selector is required for visibility triggers'
      );
    }
    if (
      definition.trigger_type === 'custom_javascript' &&
      !definition.trigger_config.custom_javascript
    ) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        'Custom JavaScript is required for custom JavaScript triggers'
      );
    }

    const saved = await upsertGoalMetricDefinition(shopDomain, definition);
    return sendSuccess(res, HTTP_STATUS.OK, { definition: saved });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const shopDomain = getShopDomain(req);
    if (!shopDomain) {
      return sendError(res, HTTP_STATUS.UNAUTHORIZED, 'Shop domain required');
    }
    if (!isValidUUID(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid definition ID');
    }

    const deleted = await deleteGoalMetricDefinition(shopDomain, req.params.id);
    if (!deleted) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Goal or metric definition not found');
    }
    return sendSuccess(res, HTTP_STATUS.OK, {});
  })
);

module.exports = router;
