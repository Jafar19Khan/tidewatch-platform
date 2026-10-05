'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/app');

const IDENTITY = { pod: 'tidewatch-test-abcde', node: 'node-1', namespace: 'tidewatch' };
const VERSION = { build: '42', commit: 'abc1234', builtAt: '2026-10-03T10:00:00Z', node: 'v22.0.0' };

async function withServer(fn, options = {}) {
  const server = createApp({ identity: IDENTITY, version: VERSION, ...options });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`, port, server);
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
}

function rawGet(port, rawPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: rawPath }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      })
      .on('error', reject);
  });
}

test('GET /health returns healthy', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'healthy' });
  });
});

test('GET /ready follows setReady() for graceful shutdown', async () => {
  await withServer(async (base, port, server) => {
    assert.equal((await fetch(`${base}/ready`)).status, 200);
    server.setReady(false);
    assert.equal((await fetch(`${base}/ready`)).status, 503);
    assert.equal((await fetch(`${base}/health`)).status, 200);
  });
});

test('GET /api/whoami identifies the pod and build', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/whoami`);
    const body = await res.json();
    assert.equal(body.pod, IDENTITY.pod);
    assert.equal(body.node, IDENTITY.node);
    assert.equal(body.build, '42');
    assert.equal(res.headers.get('x-served-by'), IDENTITY.pod);
  });
});

test('GET /api/version reports build details', async () => {
  await withServer(async (base) => {
    const body = await (await fetch(`${base}/api/version`)).json();
    assert.equal(body.build, '42');
    assert.equal(body.commit, 'abc1234');
  });
});

test('GET /api/work burns CPU and reports the pod', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/work?ms=60`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.pod, IDENTITY.pod);
    assert.equal(body.burnedMs, 60);
    assert.ok(body.tookMs >= 50);
  });
});

test('GET /api/work clamps the requested duration', async () => {
  await withServer(async (base) => {
    const body = await (await fetch(`${base}/api/work?ms=99999`)).json();
    assert.equal(body.burnedMs, 250);
  });
});

test('a busy pod turns extra work away with 429', async () => {
  await withServer(
    async (base) => {
      const responses = await Promise.all(
        Array.from({ length: 4 }, () => fetch(`${base}/api/work?ms=200`))
      );
      const statuses = responses.map((res) => res.status).sort();
      assert.equal(statuses.filter((status) => status === 200).length, 1);
      assert.equal(statuses.filter((status) => status === 429).length, 3);
      assert.equal(responses.find((res) => res.status === 429).headers.get('retry-after'), '1');
      const metrics = await (await fetch(`${base}/metrics`)).text();
      assert.match(metrics, /app_work_rejected_total 3/);
    },
    { maxConcurrentWork: 1 }
  );
});

test('GET /metrics exposes Prometheus metrics for earlier requests', async () => {
  await withServer(async (base) => {
    await fetch(`${base}/health`);
    await fetch(`${base}/api/whoami`);
    const res = await fetch(`${base}/metrics`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/plain/);
    const text = await res.text();
    assert.match(text, /http_requests_total\{method="GET",route="\/health",status="200"\} 1/);
    assert.match(text, /http_request_duration_seconds_bucket/);
    assert.match(text, /app_build_info\{build="42",commit="abc1234",pod="tidewatch-test-abcde"\} 1/);
  });
});

test('the website is served with security headers', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(await res.text(), /Tidewatch/);
  });
});

test('static assets are served with the right content type', async () => {
  await withServer(async (base) => {
    assert.match((await fetch(`${base}/style.css`)).headers.get('content-type'), /text\/css/);
    assert.match((await fetch(`${base}/app.js`)).headers.get('content-type'), /javascript/);
  });
});

test('paths outside the public folder are not served', async () => {
  await withServer(async (base, port) => {
    assert.equal(await rawGet(port, '/%2e%2e/package.json'), 404);
    assert.equal(await rawGet(port, '/../../etc/passwd'), 404);
    assert.equal((await fetch(`${base}/src/app.js`)).status, 404);
  });
});

test('unknown routes return 404', async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/nope`)).status, 404);
    assert.equal((await fetch(`${base}/api/nope`)).status, 404);
  });
});
