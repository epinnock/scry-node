const Sentry = require('@sentry/node');

/**
 * Error reporting for a CLI that runs on other people's machines.
 *
 * This is not a server. Everything it sends left a customer's laptop or CI
 * runner, so the default has to be "send the minimum that makes a crash
 * diagnosable", not "send the context and sort it out later".
 *
 * Three things were being sent that should not have been:
 *
 *   1. `scope.setExtra('argv', argv)` shipped the whole parsed argv — which
 *      contains `--api-key` under both `apiKey` and `api-key`. Every customer
 *      error carried their project credential to a third party.
 *   2. Upload failures embed the presigned URL in the message, query string and
 *      all: `...storybook.zip?X-Amz-Signature=645e57...`. That signature is a
 *      time-limited write credential for the bucket.
 *   3. Absolute paths (`/home/alice/work/app`) leak usernames and, often,
 *      unreleased product names.
 *
 * None of that is needed to know that an upload failed with EAI_AGAIN.
 */

const DSN =
  'https://c66ce229a1db2289f145eebd02436d9c@o4507889391828992.ingest.us.sentry.io/4510699330732032';

/**
 * argv fields safe to attach to an error.
 *
 * An allowlist, not a denylist: a new option should be invisible to telemetry
 * until someone deliberately adds it here. The reverse — remembering to exclude
 * each new secret — is the failure mode that put an API key in Sentry.
 */
const SAFE_ARGV_FIELDS = ['project', 'deployVersion', 'withAnalysis', 'verbose', 'branch'];

/** Anything that looks like a credential, wherever it appears in a string. */
const SECRET_PATTERNS = [
  // Presigned URL query strings. Keep the path so the failing operation is
  // still identifiable; drop the signature and everything with it.
  [/(https?:\/\/[^\s?]+)\?[^\s]*/g, '$1?<redacted>'],
  [/scry_proj_[A-Za-z0-9_\-]+/g, 'scry_proj_<redacted>'],
  [/(X-Amz-Signature=)[^&\s]+/gi, '$1<redacted>'],
  [/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1<redacted>'],
];

function scrub(value) {
  if (typeof value !== 'string') return value;
  return SECRET_PATTERNS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), value);
}

/**
 * Whether the user has asked not to be tracked.
 *
 * DO_NOT_TRACK is honoured as well as our own flag — it is the cross-tool
 * convention (consoledonottrack.com), and a developer who has set it globally
 * should not have to discover a Scry-specific variable to be heard.
 */
function telemetryDisabled() {
  const off = (v) => v === '1' || v === 'true' || v === 'yes';
  return off(process.env.DO_NOT_TRACK) || process.env.SCRY_TELEMETRY === '0' ||
    process.env.SCRY_TELEMETRY === 'false';
}

/** Only the fields on the allowlist, and scrubbed even then. */
function sanitizeArgv(argv) {
  if (!argv) return {};
  const safe = {};
  for (const field of SAFE_ARGV_FIELDS) {
    if (argv[field] !== undefined) safe[field] = scrub(argv[field]);
  }
  return safe;
}

function initTelemetry() {
  if (telemetryDisabled()) return false;

  Sentry.init({
    dsn: DSN,
    environment: process.env.NODE_ENV || 'production',

    // Errors only. Traces from a CLI describe the customer's build pipeline,
    // which is more than is needed to fix a crash.
    tracesSampleRate: 0,

    // No usernames, IPs, or machine hostnames.
    sendDefaultPii: false,
    serverName: false,

    beforeSend(event) {
      if (event.message) event.message = scrub(event.message);

      for (const entry of event.exception?.values ?? []) {
        if (entry.value) entry.value = scrub(entry.value);
        // Stack frames carry absolute paths from the customer's disk. The
        // filename is what makes a trace useful, so keep the basename only.
        for (const frame of entry.stacktrace?.frames ?? []) {
          if (frame.filename) frame.filename = frame.filename.replace(/^.*[\\/]/, '');
          delete frame.abs_path;
        }
      }

      // Belt and braces: whatever else ends up in extra, scrub its strings.
      if (event.extra) {
        for (const [k, v] of Object.entries(event.extra)) event.extra[k] = scrub(v);
      }

      return event;
    },
  });

  return true;
}

/** Report an error with only the context that is safe to leave the machine. */
function captureCliError(error, argv) {
  if (telemetryDisabled()) return;

  Sentry.withScope((scope) => {
    const safe = sanitizeArgv(argv);
    if (safe.project) scope.setTag('project', safe.project);
    if (argv && argv._) scope.setTag('command', argv._[0] || 'deploy');
    scope.setExtra('options', safe);
    Sentry.captureException(error);
  });
}

async function flushTelemetry(ms = 2000) {
  if (telemetryDisabled()) return;
  await Sentry.close(ms);
}

module.exports = {
  initTelemetry,
  captureCliError,
  flushTelemetry,
  telemetryDisabled,
  sanitizeArgv,
  scrub,
  SAFE_ARGV_FIELDS,
};
