'use strict';

const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 3000;
const server = createApp();

server.listen(PORT, () => {
  console.log(`Tidewatch listening on port ${PORT}`);
});

// Kubernetes sends SIGTERM when it stops a pod. Report "not ready" first so the Service
// stops sending traffic, then close open connections and exit.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.setReady(false);
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), 10000).unref();
  });
}
