const axios = require('axios');
const { safeServerError, sanitizeServerText } = require('./apiClient');

/**
 * CI timings recorded with every upload (storybook-preview-ci-runtime, ISSUES.md #54).
 *
 * A dashboard PR preview took 19-21 minutes and nothing measured it: no line
 * said how long story execution took, nothing compared it with a budget, and
 * the build document stored no time at all. The deployer now measures its own
 * phases, judges story execution against a budget scaled to the number of
 * stories, and sends the record to the upload service in two parts (the
 * pre-upload part in the presigned-URL body, the final record on
 * POST /upload/:project/:version/builds/:buildNumber/ci-timings).
 *
 * Rules: a number that could not be measured is left out (never 0); nothing
 * here can fail a deploy; every "could not" is said in the log.
 */

const DEFAULT_BUDGET_BASE_S = 120;
const DEFAULT_BUDGET_PER_STORY_S = 0.5;
const ACTIONS_API_TIMEOUT_MS = 5000;
const MAX_STRING = 100;

/** A monotonic clock in whole milliseconds. */
function monotonicMs() {
  return Number(process.hrtime.bigint() / 1000000n);
}

/**
 * Start a stopwatch. `stop()` returns whole elapsed ms from a monotonic clock.
 * @returns {{stop: () => number}}
 */
function startTimer() {
  const start = monotonicMs();
  return { stop: () => Math.max(0, monotonicMs() - start) };
}

/**
 * Which kind of runner this is, from GitHub's RUNNER_ENVIRONMENT.
 * @param {NodeJS.ProcessEnv} env
 * @returns {'github-hosted'|'self-hosted'|'unknown'}
 */
function detectRunner(env = process.env) {
  const v = String(env.RUNNER_ENVIRONMENT || '').trim().toLowerCase();
  if (v === 'github-hosted') return 'github-hosted';
  if (v === 'self-hosted') return 'self-hosted';
  return 'unknown';
}

function shortString(v) {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t.slice(0, MAX_STRING) : undefined;
}

/**
 * A workflow or job name in the character set the upload service accepts
 * (`[\w .:@+/()-]`). The service rejects a whole record over one bad string,
 * so "Build & Deploy" or "CI, preview" would lose every timing on every run;
 * other characters become "-".
 */
function safeLabel(v) {
  const t = shortString(v);
  if (!t) return undefined;
  const clean = t.replace(/[^\w .:@+/()-]/g, '-').replace(/-{2,}/g, '-').trim();
  return clean && /[\w]/.test(clean) ? clean : undefined;
}

function positiveInt(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * The GitHub Actions run this deploy is part of, or null outside Actions.
 * @param {NodeJS.ProcessEnv} env
 * @returns {null|{provider:'github', runId?:string, runAttempt?:number, workflow?:string, job?:string}}
 */
function readCiContext(env = process.env) {
  if (env.GITHUB_ACTIONS !== 'true' && !env.GITHUB_RUN_ID) return null;
  const ci = { provider: 'github' };
  const runId = /^\d{1,20}$/.test(String(env.GITHUB_RUN_ID || '')) ? String(env.GITHUB_RUN_ID) : undefined;
  if (runId) ci.runId = runId;
  const attempt = positiveInt(env.GITHUB_RUN_ATTEMPT);
  if (attempt) ci.runAttempt = attempt;
  const workflow = safeLabel(env.GITHUB_WORKFLOW);
  if (workflow) ci.workflow = workflow;
  const job = safeLabel(env.GITHUB_JOB);
  if (job) ci.job = job;
  return ci;
}

/**
 * Read a budget setting from the environment. Unset = the default; set but not
 * a number >= 0 = the default plus a warning (a typo must not silently change
 * the budget).
 */
function readBudgetSetting(env, name, dflt, warnings) {
  const raw = env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return dflt;
  const text = String(raw).trim();
  const n = Number(text);
  if (!/^\d+(\.\d+)?$/.test(text) || !Number.isFinite(n) || n < 0) {
    warnings.push(`${name}=${JSON.stringify(text.slice(0, 20))} is not a number of seconds >= 0; using ${dflt}`);
    return dflt;
  }
  return n;
}

/**
 * The execute budget: SCRY_EXECUTE_BUDGET_BASE_S (120) + SCRY_EXECUTE_BUDGET_PER_STORY_S (0.5) × declared stories.
 * `budgetMs` is null when the number of stories is unknown.
 *
 * @param {{declared:number|null|undefined, env?:NodeJS.ProcessEnv}} opts
 * @returns {{budgetMs:number|null, baseS:number, perStoryS:number, warnings:string[]}}
 */
function resolveBudget({ declared, env = process.env }) {
  const warnings = [];
  const baseS = readBudgetSetting(env, 'SCRY_EXECUTE_BUDGET_BASE_S', DEFAULT_BUDGET_BASE_S, warnings);
  const perStoryS = readBudgetSetting(env, 'SCRY_EXECUTE_BUDGET_PER_STORY_S', DEFAULT_BUDGET_PER_STORY_S, warnings);
  const n = typeof declared === 'number' && Number.isFinite(declared) && declared >= 0 ? declared : null;
  const budgetMs = n === null ? null : Math.round((baseS + perStoryS * n) * 1000);
  return { budgetMs, baseS, perStoryS, warnings };
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);

/**
 * How long story execution took, and from where.
 *
 * sbcov 0.7+ writes `execution.durationMs` into its manifest; older sbcov puts
 * the executor's own duration in the report (`execution.summary.duration`).
 * Both are sbcov's measurement. Without either, the whole sbcov run (analysis
 * and execution together) is the only number, and it is labelled as such; the
 * analysis part then cannot be separated and is left out.
 *
 * @param {{sbcovWallMs:number|null, manifestExecution?:any, report?:any, executed:boolean}} o
 * @returns {{analyzeMs?:number, executeMs?:number, executeSource?:'sbcov'|'deployer-wall'}}
 */
function splitSbcovTime({ sbcovWallMs, manifestExecution, report, executed }) {
  const wall = num(sbcovWallMs);
  if (wall === undefined) return {};
  if (!executed) return { analyzeMs: wall };
  const fromSbcov = num(manifestExecution?.durationMs) ?? num(report?.execution?.summary?.duration);
  if (fromSbcov !== undefined && fromSbcov <= wall) {
    return { analyzeMs: wall - fromSbcov, executeMs: fromSbcov, executeSource: 'sbcov' };
  }
  return { executeMs: wall, executeSource: 'deployer-wall' };
}

/**
 * Story counts for the record, from sbcov's manifest `execution` block (0.7+),
 * else from what an older manifest and report hold. Unknown counts are left out.
 *
 * @param {{manifest?:any, manifestExecution?:any, report?:any}} o
 * @returns {{declared?:number, passed?:number, failed?:number, timeouts?:number, notIndexed?:number}|undefined}
 */
function storyCounts({ manifest, manifestExecution, report }) {
  const e = manifestExecution || {};
  const s = report?.execution?.summary || {};
  const dropped = Array.isArray(manifest?.dropped) ? manifest.dropped : null;
  const out = {};
  const set = (k, v) => { const n = num(v); if (n !== undefined) out[k] = Math.round(n); };
  set('declared', e.declared ?? manifest?.declared ?? s.declared ?? s.total);
  set('passed', e.passed ?? s.passed);
  set('failed', e.failed ?? s.failed);
  set('timeouts', e.timeouts ?? (dropped ? dropped.filter((d) => /timeout/.test(String(d?.reason || ''))).length : undefined));
  set('notIndexed', e.notIndexed ?? (dropped ? dropped.length : s.notIndexed));
  return Object.keys(out).length ? out : undefined;
}

/**
 * sbcov's time lost per reason. `{}` when every story passed; undefined when
 * the sbcov is too old to say (never a made-up zero).
 */
function timeLost(manifestExecution) {
  const t = manifestExecution?.timeLostMs;
  if (!t || typeof t !== 'object' || Array.isArray(t)) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(t)) {
    const key = String(k).slice(0, 40);
    const n = num(v);
    if (n !== undefined) out[key] = Math.round(n);
  }
  return out;
}

/** "212 s", "5.8 min" */
function formatDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '?';
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 120) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
  return `${(s / 60).toFixed(1)} min`;
}

/** "timeout 40 s, console_error 3 s" (largest first) */
function describeTimeLost(t) {
  if (!t) return '';
  return Object.entries(t)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k} ${formatDuration(v)}`)
    .join(', ');
}

/**
 * Whole-job elapsed time from the GitHub Actions API: this job's started_at.
 *
 * GitHub exposes no job start time in the environment, so the deployer asks
 * GET /repos/{repo}/actions/runs/{run}/attempts/{n}/jobs (needs GITHUB_TOKEN
 * with `actions: read`), bounded to 5 s. The job is the in-progress one on
 * this runner (RUNNER_NAME), else the one named GITHUB_JOB. Any failure gives
 * `jobTimeSource: "deployer-only"` and the reason; never throws.
 *
 * @param {{env?:NodeJS.ProcessEnv, timeoutMs?:number, now?:() => number, http?:{get:Function}}} [o]
 * @returns {Promise<{jobElapsedMs?:number, jobTimeSource:'actions-api'|'deployer-only', jobTimeReason?:string}>}
 */
async function fetchJobElapsed({ env = process.env, timeoutMs = ACTIONS_API_TIMEOUT_MS, now = Date.now, http = axios } = {}) {
  const only = (reason) => ({ jobTimeSource: 'deployer-only', jobTimeReason: reason });
  if (env.GITHUB_ACTIONS !== 'true') return only('not-github');
  const repo = String(env.GITHUB_REPOSITORY || '');
  const runId = String(env.GITHUB_RUN_ID || '');
  const attempt = positiveInt(env.GITHUB_RUN_ATTEMPT) || 1;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^\d+$/.test(runId)) return only('no-run-id');
  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  if (!token) return only('no-token');

  const base = String(env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  const url = `${base}/repos/${repo}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`;
  let data;
  try {
    const res = await http.get(url, {
      timeout: timeoutMs,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      // Never follow a redirect with the token to another host.
      maxRedirects: 0,
    });
    data = res.data;
  } catch (error) {
    const status = error?.response?.status;
    if (status === 401 || status === 403) return only('forbidden');
    if (status === 404) return only('not-found');
    if (typeof status === 'number') return only(`http-${status}`);
    if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT' || /timeout/i.test(String(error?.message))) return only('timeout');
    return only('network-error');
  }

  const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
  const running = jobs.filter((j) => j && j.status === 'in_progress');
  let job = null;
  if (env.RUNNER_NAME) job = running.find((j) => j.runner_name === env.RUNNER_NAME) || null;
  if (!job && env.GITHUB_JOB) {
    const named = running.filter((j) => j.name === env.GITHUB_JOB);
    if (named.length === 1) job = named[0];
  }
  if (!job && running.length === 1) job = running[0];
  if (!job) return only('job-not-found');

  const started = Date.parse(job.started_at);
  if (!Number.isFinite(started)) return only('job-not-found');
  const elapsed = now() - started;
  if (!(elapsed >= 0 && elapsed < 24 * 3600 * 1000)) return only('clock-skew');
  return { jobElapsedMs: Math.round(elapsed), jobTimeSource: 'actions-api' };
}

/**
 * Send the final record to POST /upload/:project/:version/builds/:buildId/ci-timings.
 * Keyed by the build id the presigned-URL response returned (a build number
 * could name a newer build of the same version by the time this is sent).
 * Never throws: an upload service without the route (404), one that has the
 * route but not the build (404 "Build not found"), one that rejects the record
 * (400) or one that cannot be reached is reported, and the deploy result does
 * not change.
 *
 * @param {import('axios').AxiosInstance} apiClient
 * @param {{project?:string, version?:string}} target
 * @param {string|null|undefined} buildId
 * @param {object} record
 * @returns {Promise<{stored:true, dropped?:string[]}|{stored:false, reason:'no-build-id'|'not-supported'|'build-not-found'|'rejected'|'error', detail?:string}>}
 */
async function sendCiTimings(apiClient, target, buildId, record) {
  if (typeof buildId !== 'string' || !/^[\w-]{1,128}$/.test(buildId)) {
    return { stored: false, reason: 'no-build-id' };
  }
  const project = encodeURIComponent(target.project || 'main');
  const version = encodeURIComponent(target.version || 'latest');
  try {
    const res = await apiClient.post(
      `/upload/${project}/${version}/builds/${encodeURIComponent(buildId)}/ci-timings`,
      { ciTimings: record },
      { headers: { 'Content-Type': 'application/json' }, timeout: 15000 },
    );
    // The service drops a bad field and keeps the rest; it names what it dropped.
    const dropped = Array.isArray(res?.data?.dropped)
      ? res.data.dropped.map((d) => String(typeof d === 'string' ? d : d?.path || d?.field || JSON.stringify(d)).slice(0, 60)).slice(0, 20)
      : [];
    return dropped.length ? { stored: true, dropped } : { stored: true };
  } catch (error) {
    const status = error?.response?.status;
    if (status === 404) {
      // The route exists but has no such build, or the service predates the route.
      const body = error.response.data;
      const text = typeof body === 'string' ? body : String(body?.error || '');
      // The detail is printed: the body's `error` field only, sanitised (F113), never a raw body.
      if (/build not found/i.test(text)) return { stored: false, reason: 'build-not-found', detail: safeServerError(body) || 'Build not found' };
      return { stored: false, reason: 'not-supported' };
    }
    if (status === 400) {
      const body = error.response.data || {};
      const issues = Array.isArray(body.issues) ? body.issues.map((i) => (typeof i === 'string' ? i : (i?.path || []).join?.('.') || JSON.stringify(i))).join(', ') : '';
      return { stored: false, reason: 'rejected', detail: sanitizeServerText(issues || (typeof body.error === 'string' ? body.error : '') || 'HTTP 400') };
    }
    return { stored: false, reason: 'error', detail: status ? `HTTP ${status}` : (error?.code || error?.message || 'unknown error') };
  }
}

/**
 * Drop undefined members so an unmeasured value is absent, not null or 0.
 * @template T
 * @param {T} obj
 * @returns {T}
 */
function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null) out[k] = v;
  return /** @type {T} */ (out);
}

module.exports = {
  DEFAULT_BUDGET_BASE_S,
  DEFAULT_BUDGET_PER_STORY_S,
  ACTIONS_API_TIMEOUT_MS,
  startTimer,
  detectRunner,
  readCiContext,
  resolveBudget,
  splitSbcovTime,
  storyCounts,
  timeLost,
  formatDuration,
  describeTimeLost,
  fetchJobElapsed,
  sendCiTimings,
  compact,
  safeLabel,
};
