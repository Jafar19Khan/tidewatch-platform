'use strict';

// Simple load generator for the autoscaling demo. No dependencies.
// Usage: node scripts/loadtest.js <base-url> [seconds=60] [concurrency=16] [burnMs=150]
// Example: node scripts/loadtest.js http://13.233.10.20 90 16

const [baseUrl, secondsArg, concurrencyArg, burnArg] = process.argv.slice(2);

if (!baseUrl) {
  console.error('Usage: node scripts/loadtest.js <base-url> [seconds=60] [concurrency=16] [burnMs=150]');
  process.exit(1);
}

const seconds = Number(secondsArg) || 60;
const concurrency = Number(concurrencyArg) || 16;
const burnMs = Number(burnArg) || 150;
const deadline = Date.now() + seconds * 1000;

const stats = { ok: 0, shed: 0, failed: 0, latencyTotal: 0 };
const pods = new Map();

async function worker() {
  while (Date.now() < deadline) {
    const started = Date.now();
    try {
      const res = await fetch(`${baseUrl}/api/work?ms=${burnMs}`);
      const pod = res.headers.get('x-served-by') || 'unknown';
      pods.set(pod, (pods.get(pod) || 0) + 1);
      if (res.status === 200) {
        stats.ok += 1;
        stats.latencyTotal += Date.now() - started;
      } else if (res.status === 429) {
        stats.shed += 1;
        await new Promise((resolve) => setTimeout(resolve, 200));
      } else {
        stats.failed += 1;
      }
      await res.arrayBuffer();
    } catch (err) {
      stats.failed += 1;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

const reporter = setInterval(() => {
  const avg = stats.ok ? Math.round(stats.latencyTotal / stats.ok) : 0;
  console.log(
    `ok=${stats.ok} shed=${stats.shed} failed=${stats.failed} avg=${avg}ms pods=${pods.size}`
  );
}, 5000);

console.log(`Sending load to ${baseUrl} for ${seconds}s with ${concurrency} workers...`);

Promise.all(Array.from({ length: concurrency }, worker)).then(() => {
  clearInterval(reporter);
  console.log('\nDone. Requests answered per pod:');
  for (const [pod, count] of [...pods.entries()].sort()) {
    console.log(`  ${pod}: ${count}`);
  }
});
