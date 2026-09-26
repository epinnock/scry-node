const axios = require('axios');

const PACKAGE_NAME = '@scrymore/scry-deployer';
const REGISTRY_LATEST_URL = 'https://registry.npmjs.org/@scrymore%2fscry-deployer/latest';
const DEFAULT_TIMEOUT_MS = 2000;

/**
 * Parse "x.y.z" (optionally with a -prerelease / +build suffix) into numbers.
 * @param {string} v
 * @returns {{core:number[], pre:boolean}|null}
 */
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.exec(String(v || '').trim());
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: Boolean(m[4]) };
}

/**
 * True when `running` is older than `latest`. A prerelease of the same core
 * version (0.7.0-next.x against 0.7.0) counts as older; a prerelease of a
 * newer core (0.7.0-next.x against 0.6.1) does not.
 */
function isOlder(running, latest) {
  const a = parseVersion(running);
  const b = parseVersion(latest);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] < b.core[i];
  }
  return a.pre && !b.pre;
}

/**
 * Compare the running deployer with npm `latest` and warn when it is behind.
 *
 * Advisory only: it never throws and never changes the exit code. 0.2.2 ran
 * for seven weeks after the "NOTHING WILL BE INDEXED" guard shipped, printing
 * "Deployment successful" over empty builds, because nothing told it it was
 * stale (ISSUES.md #50).
 *
 * Skipped with SCRY_NO_UPDATE_CHECK=1. A registry that does not answer within
 * the timeout, or answers something unreadable, is reported in one info line
 * and the deploy continues.
 *
 * @param {{currentVersion:string, logger:{warn:Function,info:Function,debug:Function}, env?:object, timeoutMs?:number, fetchLatest?:Function}} opts
 * @returns {Promise<{status:'behind'|'current'|'skipped'|'unknown', latest?:string, reason?:string}>}
 */
async function checkForNewerVersion(opts) {
  const {
    currentVersion,
    logger,
    env = process.env,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchLatest = defaultFetchLatest,
  } = opts;

  if (env.SCRY_NO_UPDATE_CHECK === '1' || env.SCRY_NO_UPDATE_CHECK === 'true') {
    logger.debug('Version check skipped (SCRY_NO_UPDATE_CHECK)');
    return { status: 'skipped', reason: 'SCRY_NO_UPDATE_CHECK' };
  }

  let latest;
  try {
    latest = await withTimeout(fetchLatest(timeoutMs), timeoutMs);
  } catch (err) {
    const reason = err && err.message ? err.message : String(err);
    logger.info(`ℹ️  Could not check for a newer scry-deployer (${reason}); continuing.`);
    return { status: 'unknown', reason };
  }

  if (!parseVersion(latest)) {
    logger.info(`ℹ️  Could not check for a newer scry-deployer (registry answered ${JSON.stringify(latest)}); continuing.`);
    return { status: 'unknown', reason: 'unreadable registry answer' };
  }

  if (isOlder(currentVersion, latest)) {
    logger.warn(
      `⚠️  scry-deployer ${currentVersion} is running; ${latest} is current. ` +
      'Older versions can report success while indexing nothing.'
    );
    return { status: 'behind', latest };
  }
  logger.debug(`scry-deployer ${currentVersion} is current (npm latest ${latest})`);
  return { status: 'current', latest };
}

async function defaultFetchLatest(timeoutMs) {
  const res = await axios.get(REGISTRY_LATEST_URL, {
    timeout: timeoutMs,
    headers: { Accept: 'application/json' },
    // No credentials, no proxy config from the project: this is a public read.
    validateStatus: (s) => s === 200,
  });
  return res.data && res.data.version;
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer from npm in ${ms} ms`)), ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

module.exports = {
  checkForNewerVersion,
  isOlder,
  parseVersion,
  PACKAGE_NAME,
  REGISTRY_LATEST_URL,
};
