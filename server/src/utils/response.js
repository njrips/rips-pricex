/**
 * Response Utility
 *
 * Standardized API response helpers
 */

const { HTTP_STATUS, ERROR_MESSAGES } = require('../constants');
const logger = require('./logger');

/**
 * Send success response
 *
 * @param {Object} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {Object} data - Response data
 * @param {string} message - Optional success message
 */
function sendSuccess(res, statusCode = HTTP_STATUS.OK, data = {}, message = null) {
  const response = {
    success: true,
    ...data,
  };

  if (message) {
    response.message = message;
  }

  return res.status(statusCode).json(response);
}

/**
 * Send error response
 *
 * @param {Object} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {Array} details - Optional error details
 * @param {Error} error - Optional error object for logging
 */
function sendError(
  res,
  statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR,
  message = ERROR_MESSAGES.INTERNAL_ERROR,
  details = null,
  error = null
) {
  if (error) {
    logger.error(message, { statusCode, details, error });
  }

  const response = {
    success: false,
    error: message,
  };

  if (details) {
    response.details = details;
  }

  if (process.env.NODE_ENV === 'development' && error) {
    response.stack = error.stack;
  }

  return res.status(statusCode).json(response);
}

/**
 * Send validation error response
 *
 * @param {Object} res - Express response object
 * @param {Array} errors - Validation errors
 */
function sendValidationError(res, errors) {
  return sendError(res, HTTP_STATUS.BAD_REQUEST, ERROR_MESSAGES.VALIDATION_FAILED, errors);
}

/**
 * Send not found error response
 *
 * @param {Object} res - Express response object
 * @param {string} resource - Resource name (e.g., 'Test')
 */
function sendNotFound(res, resource = 'Resource') {
  return sendError(res, HTTP_STATUS.NOT_FOUND, `${resource} not found`);
}

/**
 * Send unauthorized error response
 *
 * @param {Object} res - Express response object
 * @param {string} message - Optional custom message
 */
function sendUnauthorized(res, message = ERROR_MESSAGES.UNAUTHORIZED) {
  return sendError(res, HTTP_STATUS.UNAUTHORIZED, message);
}

module.exports = {
  sendSuccess,
  sendError,
  sendValidationError,
  sendNotFound,
  sendUnauthorized,
};
