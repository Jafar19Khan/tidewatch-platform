'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Metrics } = require('../src/metrics');

test('requests are counted per method, route and status', () => {
  const metrics = new Metrics({ pod: 'pod-a', build: '7', commit: 'abc1234' });
  metrics.observeRequest({ method: 'GET', route: '/health', status: 200, seconds: 0.002 });
  metrics.observeRequest({ method: 'GET', route: '/health', status: 200, seconds: 0.003 });
  metrics.observeRequest({ method: 'GET', route: '/api/work', status: 429, seconds: 0.001 });
  const text = metrics.render();
  assert.match(text, /http_requests_total\{method="GET",route="\/health",status="200"\} 2/);
  assert.match(text, /http_requests_total\{method="GET",route="\/api\/work",status="429"\} 1/);
});

test('histogram buckets are cumulative and end with +Inf', () => {
  const metrics = new Metrics();
  metrics.observeRequest({ method: 'GET', route: '/x', status: 200, seconds: 0.004 });
  metrics.observeRequest({ method: 'GET', route: '/x', status: 200, seconds: 0.2 });
  const text = metrics.render();
  assert.match(text, /http_request_duration_seconds_bucket\{le="0.005",method="GET",route="\/x"\} 1/);
  assert.match(text, /http_request_duration_seconds_bucket\{le="0.25",method="GET",route="\/x"\} 2/);
  assert.match(text, /http_request_duration_seconds_bucket\{le="\+Inf",method="GET",route="\/x"\} 2/);
  assert.match(text, /http_request_duration_seconds_count\{method="GET",route="\/x"\} 2/);
});

test('work gauges and counters are exposed', () => {
  const metrics = new Metrics();
  metrics.workStarted();
  metrics.workStarted();
  metrics.workFinished();
  metrics.workWasRejected();
  const text = metrics.render();
  assert.match(text, /app_work_in_progress 1/);
  assert.match(text, /app_work_rejected_total 1/);
});

test('build info and process metrics are present', () => {
  const metrics = new Metrics({ pod: 'tidewatch-abc-12345', build: '9', commit: 'deadbee' });
  const text = metrics.render();
  assert.match(text, /app_build_info\{build="9",commit="deadbee",pod="tidewatch-abc-12345"\} 1/);
  assert.match(text, /process_cpu_seconds_total \d/);
  assert.match(text, /process_start_time_seconds \d/);
  assert.ok(text.endsWith('\n'));
});

test('label values are escaped', () => {
  const metrics = new Metrics();
  metrics.observeRequest({ method: 'GET', route: 'a"b', status: 200, seconds: 0.001 });
  assert.match(metrics.render(), /route="a\\"b"/);
});
