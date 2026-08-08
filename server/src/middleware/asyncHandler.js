/**
 * Async Handler Middleware
 *
 * Wraps async route handlers to automatically catch errors and pass to next().
 * Eliminates repetitive try/catch blocks in route handlers.
 *
 * @example
 * router.get('/items', asyncHandler(async (req, res) => {
 *   const items = await getItems();
 *   res.json({ items });
 * }));
 */

/**
 * Wrap async route handler - catches rejections and forwards to error middleware
 *
 * @param {Function} fn - Async route handler (req, res, next) => Promise
 * @returns {Function} Express middleware
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
