/**
 * Logger Utility
 *
 * Centralized logging with different levels
 */

class Logger {
  constructor() {
    this.logLevel = process.env.LOG_LEVEL || 'info';
    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
    };
  }

  /**
   * Check if should log at this level
   *
   * @param {string} level - Log level
   * @returns {boolean} Should log
   */
  shouldLog(level) {
    return this.levels[level] <= this.levels[this.logLevel];
  }

  /**
   * Format log message
   *
   * @param {string} level - Log level
   * @param {string} message - Message
   * @param {Object} meta - Additional metadata
   * @returns {string} Formatted message
   */
  formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
  }

  /**
   * Log error
   *
   * @param {string} message - Error message
   * @param {Error|Object} error - Error object or metadata
   */
  error(message, error = {}) {
    if (!this.shouldLog('error')) {
      return;
    }

    const meta =
      error instanceof Error ? { error: error.message, stack: error.stack, ...error } : error;

    console.error(this.formatMessage('error', message, meta));
  }

  /**
   * Log warning
   *
   * @param {string} message - Warning message
   * @param {Object} meta - Additional metadata
   */
  warn(message, meta = {}) {
    if (!this.shouldLog('warn')) {
      return;
    }
    console.warn(this.formatMessage('warn', message, meta));
  }

  /**
   * Log info
   *
   * @param {string} message - Info message
   * @param {Object} meta - Additional metadata
   */
  info(message, meta = {}) {
    if (!this.shouldLog('info')) {
      return;
    }
    console.log(this.formatMessage('info', message, meta));
  }

  /**
   * Log debug
   *
   * @param {string} message - Debug message
   * @param {Object} meta - Additional metadata
   */
  debug(message, meta = {}) {
    if (!this.shouldLog('debug')) {
      return;
    }
    console.debug(this.formatMessage('debug', message, meta));
  }
}

module.exports = new Logger();
