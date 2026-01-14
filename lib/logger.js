const chalk = require('chalk');

/**
 * Creates a logger instance.
 * The logger's behavior is controlled by the arguments passed to the CLI.
 * @param {object} argv The arguments object from yargs.
 * @param {boolean} argv.verbose Whether to enable verbose (debug) logging.
 * @returns {{info: Function, error: Function, debug: Function, success: Function}}
 */
function createLogger({ verbose = false }) {
  const Sentry = require('@sentry/node');
  return {
    /**
     * Logs an informational message.
     * @param {string} message The message to log.
     */
    info: (message) => {
      console.log(message);
      Sentry.addBreadcrumb({
        category: 'log',
        message: message,
        level: 'info',
      });
    },

    /**
     * Logs a success message, typically at the end of a process.
     * @param {string} message The message to log.
     */
    success: (message) => {
      console.log(chalk.green(message));
    },

    /**
     * Logs an error message.
     * @param {string} message The message to log.
     */
    error: (message) => {
      console.error(chalk.red(message));
      Sentry.addBreadcrumb({
        category: 'log',
        message: message,
        level: 'error',
      });
    },

    /**
     * Logs a debug message. Only logs if verbose mode is enabled.
     * @param {string} message The message to log.
     */
    debug: (message) => {
      if (verbose) {
        console.log(chalk.dim(`[debug] ${message}`));
      }
      Sentry.addBreadcrumb({
        category: 'log',
        message: message,
        level: 'debug',
      });
    },
  };
}

module.exports = { createLogger };
