'use strict';

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Metrics } = require('./metrics');
const { burnCpu, clampBurnMs } = require('./burn');

const DEFAULT_PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DEFAULT_MAX_CONCURRENT_WORK = 6;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
};

/** Who am I? In Kubernetes these come from the Downward API (see k8s/app/deployment.yaml). */
function readIdentity(env = process.env) {
  return {
    pod: env.POD_NAME || os.hostname(),
    node: env.NODE_NAME || 'local',
    namespace: env.POD_NAMESPACE || 'local',
  };
}

/** Build details, injected by the Docker build (see Dockerfile). */
function readVersionInfo(env = process.env) {
  return {
    build: env.BUILD_NUMBER || 'local',
    commit: env.GIT_COMMIT || 'dev',
    builtAt: env.BUILD_TIME || null,
    node: process.version,
  };
}

function writeHeaders(res, status, headers, identity) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'X-Served-By': identity.pod, ...headers });
}

function sendJson(res, identity, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  writeHeaders(
    res,
    status,
    {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
    identity
  );
  res.end(payload);
}

/** Serves a file from publicDir. Returns false when there is nothing to serve. */
function serveStatic(res, identity, publicDir, pathname) {
  try {
    let relative = decodeURIComponent(pathname);
    if (relative === '/') {
      relative = '/index.html';
    }
    const fullPath = path.join(publicDir, path.normalize(relative));
    if (!fullPath.startsWith(publicDir + path.sep)) {
      return false;
    }
    const stats = fs.statSync(fullPath);
    if (!stats.isFile()) {
      return false;
    }
    const ext = path.extname(fullPath);
    writeHeaders(
      res,
      200,
      {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Content-Length': stats.size,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
      },
      identity
    );
    fs.createReadStream(fullPath).pipe(res);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Creates the HTTP server.
 * Routes: /health, /ready, /metrics, /api/whoami, /api/work, /api/version and the website.
 * The returned server has setReady(boolean), used for graceful shutdown.
 */
function createApp(options = {}) {
  const identity = options.identity || readIdentity();
  const version = options.version || readVersionInfo();
  const publicDir = path.resolve(options.publicDir || DEFAULT_PUBLIC_DIR);
  const maxConcurrentWork =
    options.maxConcurrentWork || Number(process.env.MAX_CONCURRENT_WORK) || DEFAULT_MAX_CONCURRENT_WORK;
  const startedAt = Date.now();
  const metrics = new Metrics({ pod: identity.pod, build: version.build, commit: version.commit });
  let ready = true;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    const startedNs = process.hrtime.bigint();
    let route = 'other';

    res.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - startedNs) / 1e9;
      metrics.observeRequest({ method: req.method, route, status: res.statusCode, seconds });
    });

    try {
      if (req.method === 'GET' && pathname === '/health') {
        route = '/health';
        return sendJson(res, identity, 200, { status: 'healthy' });
      }

      if (req.method === 'GET' && pathname === '/ready') {
        route = '/ready';
        return ready
          ? sendJson(res, identity, 200, { status: 'ready' })
          : sendJson(res, identity, 503, { status: 'shutting down' });
      }

      if (req.method === 'GET' && pathname === '/metrics') {
        route = '/metrics';
        const body = metrics.render();
        writeHeaders(
          res,
          200,
          {
            'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
            'Content-Length': Buffer.byteLength(body),
            'Cache-Control': 'no-store',
          },
          identity
        );
        return res.end(body);
      }

      if (req.method === 'GET' && pathname === '/api/whoami') {
        route = '/api/whoami';
        return sendJson(res, identity, 200, {
          ...identity,
          build: version.build,
          commit: version.commit,
          builtAt: version.builtAt,
          node_version: version.node,
          uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        });
      }

      if (req.method === 'GET' && pathname === '/api/version') {
        route = '/api/version';
        return sendJson(res, identity, 200, { ...version, ...identity });
      }

      if (req.method === 'GET' && pathname === '/api/work') {
        route = '/api/work';
        if (metrics.workInProgress >= maxConcurrentWork) {
          metrics.workWasRejected();
          return sendJson(
            res,
            identity,
            429,
            { error: 'This pod is busy. Try again.', pod: identity.pod },
            { 'Retry-After': '1' }
          );
        }
        const requestedMs = clampBurnMs(url.searchParams.get('ms'));
        const begun = Date.now();
        metrics.workStarted();
        try {
          const result = await burnCpu(requestedMs);
          return sendJson(res, identity, 200, {
            pod: identity.pod,
            burnedMs: result.burnedMs,
            tookMs: Date.now() - begun,
          });
        } finally {
          metrics.workFinished();
        }
      }

      if (req.method === 'GET' && !pathname.startsWith('/api/')) {
        if (serveStatic(res, identity, publicDir, pathname)) {
          route = 'static';
          return undefined;
        }
      }

      return sendJson(res, identity, 404, { error: 'Route not found' });
    } catch (err) {
      return sendJson(res, identity, 500, { error: 'Internal server error' });
    }
  });

  server.setReady = (value) => {
    ready = Boolean(value);
  };
  server.metrics = metrics;
  return server;
}

module.exports = { createApp, readIdentity, readVersionInfo };
