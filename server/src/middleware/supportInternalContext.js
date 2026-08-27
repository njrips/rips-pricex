const { sendError } = require('../utils/response');
const { HTTP_STATUS } = require('../constants');
const {
  SUPPORT_INTERNAL_HEADER,
  supportInternalSecret,
  isValidSupportInternalToken,
} = require('../services/support/supportInternalAuth');

function requireSupportInternal(req, res, next) {
  if (!supportInternalSecret()) {
    return sendError(res, HTTP_STATUS.SERVICE_UNAVAILABLE, 'Support is not configured');
  }
  const provided = req.get(SUPPORT_INTERNAL_HEADER) || '';
  if (!isValidSupportInternalToken(req.shopDomain, provided)) {
    return sendError(res, HTTP_STATUS.UNAUTHORIZED, 'Support authorization required');
  }
  next();
}

module.exports = { requireSupportInternal };
