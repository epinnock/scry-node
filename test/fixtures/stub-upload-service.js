#!/usr/bin/env node
// A local stand-in for the Scry upload service, for tests and the terminal
// walkthrough. Nothing leaves the machine.
//
//   node test/fixtures/stub-upload-service.js --port 8799 --metadata reject
//
// --metadata ok        metadata archive accepted and queued (build #1)
// --metadata reject    metadata archive rejected with HTTP 500
// --metadata notqueued accepted but not queued
// --ci-timings ok      POST .../builds/:n/ci-timings stored (a service with the route)
// --ci-timings missing that route answers 404 (an upload service older than it)
// --ci-timings reject  that route answers 400 with the issue paths
// --actions-api ok        GET /repos/:o/:r/actions/runs/:id/attempts/:n/jobs lists this
//                         job (runner "stub-runner", started 90 s ago); set GITHUB_API_URL
//                         to the stub's url to use it
// --actions-api forbidden that endpoint answers 403 (token without actions: read)
// JSON request bodies are kept on each entry (`json`) so tests can read what was sent.
// Every request is printed as one line, so a reader can see whether a
// metadata archive was sent at all.
const http = require('http');

function startStub({ port = 0, metadata = 'ok', ciTimings = 'ok', actionsApi = 'ok', log = () => {} } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const entry = { method: req.method, path: req.url.split('?')[0], bytes: body.length };
      if (/json/.test(String(req.headers['content-type'] || ''))) {
        try { entry.json = JSON.parse(body.toString('utf8')); } catch (_) { entry.json = null; }
      }
      requests.push(entry);
      log(`stub: ${entry.method} ${entry.path} (${entry.bytes} bytes)`);
      const send = (status, obj) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      const { port: p } = server.address();
      if (req.method === 'POST' && entry.path.startsWith('/presigned-url/')) {
        return send(200, { url: `http://127.0.0.1:${p}/put${entry.path.slice('/presigned-url'.length)}`, buildId: 'stub-build', buildNumber: 1 });
      }
      if (req.method === 'PUT' && entry.path.startsWith('/put/')) return send(200, {});
      if (req.method === 'POST' && /\/coverage$/.test(entry.path)) return send(200, { success: true, buildId: 'stub-build' });
      if (req.method === 'POST' && /\/metadata$/.test(entry.path)) {
        if (metadata === 'reject') return send(500, { error: 'metadata store unavailable (stub)' });
        if (metadata === 'notqueued') return send(200, { success: true, queued: false, buildNumber: 1 });
        return send(200, { success: true, queued: true, buildNumber: 1, zipKey: 'stub/metadata.zip' });
      }
      if (req.method === 'GET' && /^\/repos\/[^/]+\/[^/]+\/actions\/runs\/\d+\/attempts\/\d+\/jobs$/.test(entry.path)) {
        entry.authorization = req.headers.authorization ? 'present' : 'absent';
        if (actionsApi === 'forbidden') return send(403, { message: 'Resource not accessible by integration' });
        const startedAt = new Date(Date.now() - 90000).toISOString();
        return send(200, {
          total_count: 2,
          jobs: [
            { id: 1, name: 'other', status: 'completed', runner_name: 'another-runner', started_at: new Date(Date.now() - 600000).toISOString() },
            { id: 2, name: 'deploy', status: 'in_progress', runner_name: 'stub-runner', started_at: startedAt },
          ],
        });
      }
      if (req.method === 'POST' && /\/builds\/[^/]+\/ci-timings$/.test(entry.path)) {
        if (ciTimings === 'missing') return send(404, { error: 'not found (stub)' });
        if (ciTimings === 'reject') return send(400, { error: 'invalid ciTimings', issues: ['executeMs'] });
        return send(200, { success: true, stored: true });
      }
      return send(404, { error: 'not found (stub)' });
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({ server, requests, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

if (require.main === module) {
  const arg = (name, dflt) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : dflt;
  };
  startStub({ port: Number(arg('--port', '8799')), metadata: arg('--metadata', 'ok'), ciTimings: arg('--ci-timings', 'ok'), actionsApi: arg('--actions-api', 'ok'), log: (l) => console.log(l) })
    .then((s) => console.log(`stub upload service on ${s.url} (metadata: ${arg('--metadata', 'ok')})`));
}

module.exports = { startStub };
