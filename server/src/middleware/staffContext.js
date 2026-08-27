const { sendError } = require('../utils/response');
const { HTTP_STATUS } = require('../constants');
const { isValidStaffRequest, staffToken } = require('../services/support/staffAuth');

function requireStaff(req, res, next) {
  if (!staffToken()) {
    return sendError(res, HTTP_STATUS.UNAUTHORIZED, 'Staff support is not configured');
  }
  if (!isValidStaffRequest(req)) {
    return sendError(res, HTTP_STATUS.UNAUTHORIZED, 'Staff authorization required');
  }
  next();
}

module.exports = { requireStaff };
