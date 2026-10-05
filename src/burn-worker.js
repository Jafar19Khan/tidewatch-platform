'use strict';

// Runs in a worker thread: keeps one CPU core busy for the requested time.
// Doing this off the main thread keeps /health and /metrics responsive under load.

const { parentPort, workerData } = require('node:worker_threads');

const end = Date.now() + workerData.duration;
let iterations = 0;
while (Date.now() < end) {
  iterations += Math.sqrt(iterations + 1);
}
parentPort.postMessage(Math.round(iterations));
