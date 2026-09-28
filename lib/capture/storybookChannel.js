/**
 * Talks to React Native Storybook's channel server (v10, `websockets: 'auto'`, default :7007):
 *   GET  /index.json   the story index (id, title, name, importPath), built from the story files
 *   WS   /             every message is broadcast to every client; the app renders a story on
 *                      {type:'setCurrentStory', args:[{viewMode:'story', storyId}]} and answers
 *                      with {type:'storyRendered', args:[storyId]}
 * plus the optional dev-only Scry probe in the app, which answers
 *   {type:'scry:requestTree', args:[{requestId, storyId}]} with
 *   {type:'scry:tree', args:[{requestId, storyId, scale, rootBounds, tree}]}.
 */
const http = require('http');
const WebSocket = require('ws');

function getJson(url, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, { timeout: timeoutMs }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (d) => { body += d; });
            res.on('end', () => {
                if (res.statusCode !== 200) return reject(new Error(`GET ${url} -> HTTP ${res.statusCode}`));
                try { resolve(JSON.parse(body)); } catch (e) { reject(new Error(`GET ${url}: not JSON (${e.message})`)); }
            });
        });
        req.on('timeout', () => req.destroy(new Error(`GET ${url} timed out`)));
        req.on('error', reject);
    });
}

/** Stories (not docs entries) from a Storybook index.json, in index order. */
function storiesFromIndex(index) {
    const entries = Object.values((index && (index.entries || index.stories)) || {});
    return entries
        .filter((e) => e && typeof e.id === 'string' && (e.type === undefined || e.type === 'story'))
        .map((e) => ({ id: e.id, title: e.title, name: e.name, importPath: e.importPath, exportName: e.exportName }));
}

function renderedStoryId(message) {
    if (!message || message.type !== 'storyRendered' || !Array.isArray(message.args)) return null;
    const [first] = message.args;
    if (typeof first === 'string') return first;
    if (first && typeof first.storyId === 'string') return first.storyId;
    return null;
}

class StorybookChannel {
    constructor({ host = '127.0.0.1', port = 7007 } = {}) {
        this.host = host;
        this.port = port;
        this.ws = null;
        this.lastRendered = null;
        this.listeners = new Set();
    }

    async fetchIndex() {
        return getJson(`http://${this.host}:${this.port}/index.json`, 60000);
    }

    /** Wait until the channel server answers /index.json (Metro can take a while to boot). */
    async waitForServer(timeoutMs = 120000) {
        const deadline = Date.now() + timeoutMs;
        let lastError = null;
        while (Date.now() < deadline) {
            try {
                return await this.fetchIndex();
            } catch (e) {
                lastError = e;
                await new Promise((r) => setTimeout(r, 1000));
            }
        }
        throw new Error(`Storybook channel server not reachable on ${this.host}:${this.port} (${lastError && lastError.message})`);
    }

    connect() {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(`ws://${this.host}:${this.port}`);
            ws.once('open', () => { this.ws = ws; resolve(); });
            ws.once('error', reject);
            ws.on('message', (raw) => {
                let msg;
                try { msg = JSON.parse(raw.toString()); } catch { return; }
                const rendered = renderedStoryId(msg);
                if (rendered) this.lastRendered = rendered;
                for (const l of [...this.listeners]) l(msg);
            });
        });
    }

    send(message) {
        this.ws.send(JSON.stringify(message));
    }

    /** Resolve with the first message matching predicate, or null after timeoutMs. */
    waitFor(predicate, timeoutMs) {
        return new Promise((resolve) => {
            const listener = (msg) => {
                if (predicate(msg)) { cleanup(); resolve(msg); }
            };
            const timer = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
            const cleanup = () => { clearTimeout(timer); this.listeners.delete(listener); };
            this.listeners.add(listener);
        });
    }

    /**
     * Select a story and wait for the app to report it rendered.
     * @returns {Promise<boolean>} true once rendered (or already on screen), false on timeout
     */
    async selectStory(storyId, timeoutMs) {
        const alreadyShown = this.lastRendered === storyId;
        const wait = this.waitFor((m) => renderedStoryId(m) === storyId, timeoutMs);
        this.send({ type: 'setCurrentStory', args: [{ viewMode: 'story', storyId }] });
        if (alreadyShown) {
            // Re-selecting the visible story may not re-render; accept it after a short grace.
            const quick = await Promise.race([wait, new Promise((r) => setTimeout(() => r('shown'), 1500))]);
            return quick !== null;
        }
        return (await wait) !== null;
    }

    /** Ask the app's dev-only Scry probe for the story's UI tree; null when the app has none. */
    async requestTree(storyId, timeoutMs = 3000) {
        const requestId = `${storyId}#${Date.now()}#${Math.random().toString(36).slice(2, 8)}`;
        const wait = this.waitFor(
            (m) => m && m.type === 'scry:tree' && Array.isArray(m.args) && m.args[0] && m.args[0].requestId === requestId,
            timeoutMs
        );
        this.send({ type: 'scry:requestTree', args: [{ requestId, storyId }] });
        const msg = await wait;
        return msg ? msg.args[0] : null;
    }

    close() {
        if (this.ws) {
            try { this.ws.close(); } catch { /* already closed */ }
        }
        this.ws = null;
    }
}

module.exports = { StorybookChannel, storiesFromIndex, renderedStoryId, getJson };
