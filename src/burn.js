'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');

const MIN_BURN_MS = 1;
const MAX_BURN_MS = 250;

/** Clamp a requested duration to a safe range. */
function clampBurnMs(value) {
  const ms = Math.round(Number(value));
  if (!Number.isFinite(ms)) {
    return 100;
  }
  return Math.min(Math.max(ms, MIN_BURN_MS), MAX_BURN_MS);
}

/** Burns CPU for about `ms` milliseconds on a worker thread. */
function burnCpu(ms) {
  const duration = clampBurnMs(ms);
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'burn-worker.js'), { workerData: { duration } });
    worker.once('message', () => resolve({ burnedMs: duration }));
    worker.once('error', reject);
  });
}

module.exports = { burnCpu, clampBurnMs, MAX_BURN_MS };
