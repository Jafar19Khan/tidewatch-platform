'use strict';

// A tiny Prometheus metrics registry with no dependencies.
// It exposes the text format that Prometheus scrapes from /metrics.

const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

function escapeLabelValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function formatLabels(labels) {
  const keys = Object.keys(labels);
  if (keys.length === 0) {
    return '';
  }
  return `{${keys.map((key) => `${key}="${escapeLabelValue(labels[key])}"`).join(',')}}`;
}

class Metrics {
  constructor({ pod = 'local', build = 'local', commit = 'dev' } = {}) {
    this.pod = pod;
    this.build = build;
    this.commit = commit;
    this.startTimeSeconds = Date.now() / 1000;
    this.requests = new Map(); // "method|route|status" -> count
    this.durations = new Map(); // "method|route" -> { buckets, sum, count }
    this.workInProgress = 0;
    this.workRejected = 0;
  }

  observeRequest({ method, route, status, seconds }) {
    const requestKey = `${method}|${route}|${status}`;
    this.requests.set(requestKey, (this.requests.get(requestKey) || 0) + 1);

    const durationKey = `${method}|${route}`;
    let histogram = this.durations.get(durationKey);
    if (!histogram) {
      histogram = { buckets: new Array(BUCKETS.length).fill(0), sum: 0, count: 0 };
      this.durations.set(durationKey, histogram);
    }
    const index = BUCKETS.findIndex((upperBound) => seconds <= upperBound);
    if (index !== -1) {
      histogram.buckets[index] += 1;
    }
    histogram.sum += seconds;
    histogram.count += 1;
  }

  workStarted() {
    this.workInProgress += 1;
  }

  workFinished() {
    this.workInProgress -= 1;
  }

  workWasRejected() {
    this.workRejected += 1;
  }

  render() {
    const lines = [];

    lines.push('# HELP http_requests_total Total HTTP requests handled.');
    lines.push('# TYPE http_requests_total counter');
    for (const [key, count] of this.requests) {
      const [method, route, status] = key.split('|');
      lines.push(`http_requests_total${formatLabels({ method, route, status })} ${count}`);
    }

    lines.push('# HELP http_request_duration_seconds HTTP request duration in seconds.');
    lines.push('# TYPE http_request_duration_seconds histogram');
    for (const [key, histogram] of this.durations) {
      const [method, route] = key.split('|');
      let cumulative = 0;
      BUCKETS.forEach((upperBound, index) => {
        cumulative += histogram.buckets[index];
        lines.push(
          `http_request_duration_seconds_bucket${formatLabels({ le: upperBound, method, route })} ${cumulative}`
        );
      });
      lines.push(
        `http_request_duration_seconds_bucket${formatLabels({ le: '+Inf', method, route })} ${histogram.count}`
      );
      lines.push(`http_request_duration_seconds_sum${formatLabels({ method, route })} ${histogram.sum}`);
      lines.push(`http_request_duration_seconds_count${formatLabels({ method, route })} ${histogram.count}`);
    }

    lines.push('# HELP app_work_in_progress CPU work requests running right now.');
    lines.push('# TYPE app_work_in_progress gauge');
    lines.push(`app_work_in_progress ${this.workInProgress}`);

    lines.push('# HELP app_work_rejected_total CPU work requests refused because the pod was busy.');
    lines.push('# TYPE app_work_rejected_total counter');
    lines.push(`app_work_rejected_total ${this.workRejected}`);

    lines.push('# HELP app_build_info Build details of the running image.');
    lines.push('# TYPE app_build_info gauge');
    lines.push(
      `app_build_info${formatLabels({ build: this.build, commit: this.commit, pod: this.pod })} 1`
    );

    const cpu = process.cpuUsage();
    lines.push('# HELP process_cpu_seconds_total CPU time used by the process.');
    lines.push('# TYPE process_cpu_seconds_total counter');
    lines.push(`process_cpu_seconds_total ${(cpu.user + cpu.system) / 1e6}`);

    lines.push('# HELP process_resident_memory_bytes Resident memory size in bytes.');
    lines.push('# TYPE process_resident_memory_bytes gauge');
    lines.push(`process_resident_memory_bytes ${process.memoryUsage().rss}`);

    lines.push('# HELP process_start_time_seconds Start time of the process (unix seconds).');
    lines.push('# TYPE process_start_time_seconds gauge');
    lines.push(`process_start_time_seconds ${this.startTimeSeconds}`);

    return `${lines.join('\n')}\n`;
  }
}

module.exports = { Metrics, BUCKETS };
