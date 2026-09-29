/** Small process helpers shared by the device drivers (injectable in tests). */
const { spawnSync, spawn } = require('child_process');

/**
 * Run a command synchronously.
 * @returns {{status:number|null, stdout:Buffer|string, stderr:string}}
 */
function run(cmd, args, { binary = false, timeoutMs = 120000, env, cwd, allowFail = false } = {}) {
    const res = spawnSync(cmd, args, {
        encoding: binary ? 'buffer' : 'utf8',
        timeout: timeoutMs,
        maxBuffer: 256 * 1024 * 1024,
        env: env ? { ...process.env, ...env } : process.env,
        cwd,
    });
    let stderr;
    if (binary) {
        stderr = res.stderr ? res.stderr.toString() : '';
    } else {
        stderr = res.stderr || '';
    }
    if (res.error && !allowFail) throw new Error(`${cmd} ${args.join(' ')}: ${res.error.message}`);
    if (res.status !== 0 && !allowFail) {
        throw new Error(`${cmd} ${args.join(' ')} exited ${res.status}: ${stderr.trim().slice(0, 500)}`);
    }
    return { status: res.status, stdout: res.stdout, stderr };
}

/** Start a long-running process in its own process group; kill() stops the whole group. */
function startBackground(cmd, args, { env, cwd, logFile } = {}) {
    const fs = require('fs');
    const out = logFile ? fs.openSync(logFile, 'a') : 'ignore';
    const child = spawn(cmd, args, {
        cwd,
        env: env ? { ...process.env, ...env } : process.env,
        detached: true,
        stdio: ['ignore', out, out],
    });
    return {
        pid: child.pid,
        child,
        kill() {
            try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ }
            setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }, 3000).unref();
        },
    };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { run, startBackground, sleep };
