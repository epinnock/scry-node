/**
 * Swap Sentry's network transport for one that records every envelope the CLI
 * would have sent. Nothing leaves the machine, and a test can read exactly what
 * Sentry would have received.
 *
 * Must be required before lib/telemetry.js calls Sentry.init().
 */
const Sentry = require('@sentry/node');

const sent = [];
const realInit = Sentry.init;

Sentry.init = (options) =>
  realInit({
    ...options,
    transport: (transportOptions) =>
      Sentry.createTransport(transportOptions, async (request) => {
        sent.push(
          typeof request.body === 'string' ? request.body : Buffer.from(request.body).toString('utf8')
        );
        return { statusCode: 200 };
      }),
  });

/** Every envelope body sent so far, as one string. */
function sentText() {
  return sent.join('\n');
}

/** The error events among the sent envelopes, parsed. */
function sentEvents() {
  return sent
    .flatMap((body) => body.split('\n'))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((obj) => obj && obj.exception);
}

module.exports = { sentText, sentEvents };
