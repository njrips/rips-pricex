/**
 * Production responses must not echo SQL, file paths, or upstream messages.
 * The full error stays in the server log.
 */

function publicErrorMessage(error, fallback = 'Internal error') {
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    return fallback;
  }
  const message = error && error.message ? String(error.message) : '';
  return message || fallback;
}

module.exports = {
  publicErrorMessage,
};
