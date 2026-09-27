#!/usr/bin/env node
// A local stand-in for the Scry upload service, for tests and the terminal
// walkthrough. Nothing leaves the machine.
//
//   node test/fixtures/stub-upload-service.js --port 8799 --metadata reject
//
// --metadata ok        metadata archive accepted and queued (build #1)
// --metadata reject    metadata archive rejected with HTTP 500
// --metadata notqueued accepted but not queued
// Every request is printed as one line, so a reader can see whether a
// metadata archive was sent at all.
const http = require('http');

function startStub({ port = 0, metadata = 'ok', log = () => {} } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const entry = { method: req.method, path: req.url.split('?')[0], bytes: body.length };
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
  startStub({ port: Number(arg('--port', '8799')), metadata: arg('--metadata', 'ok'), log: (l) => console.log(l) })
    .then((s) => console.log(`stub upload service on ${s.url} (metadata: ${arg('--metadata', 'ok')})`));
}

module.exports = { startStub };
