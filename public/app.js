(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);

  const els = {
    health: $('#health'),
    grafana: $('#grafana-link'),
    prometheus: $('#prometheus-link'),
    currentPod: $('#current-pod'),
    node: $('#node'),
    namespace: $('#namespace'),
    uptime: $('#uptime'),
    podGrid: $('#pod-grid'),
    podsEmpty: $('#pods-empty'),
    podsSummary: $('#pods-summary'),
    concurrency: $('#concurrency'),
    concurrencyOut: $('#concurrency-out'),
    burn: $('#burn'),
    burnOut: $('#burn-out'),
    start: $('#start'),
    stop: $('#stop'),
    note: $('#lab-note'),
    rps: $('#stat-rps'),
    latency: $('#stat-latency'),
    ok: $('#stat-ok'),
    shed: $('#stat-shed'),
    spark: $('#spark'),
    build: $('#build'),
    commit: $('#commit'),
    built: $('#built'),
    runtime: $('#runtime'),
  };

  const MAX_LOAD_SECONDS = 120;
  const IDLE_AFTER_MS = 15000;
  const FORGET_AFTER_MS = 60000;
  const RECENT_WINDOW = 60;

  const pods = new Map(); // pod name -> { count, firstSeen, lastSeen }
  const recent = []; // names of the most recent responders
  const sparkValues = [];
  let load = { running: false, stopAt: 0, burnMs: 150 };
  const second = { done: 0, latencyTotal: 0 };
  const totals = { ok: 0, shed: 0 };

  function podSuffix(name) {
    const parts = name.split('-');
    return parts.length > 1 ? parts[parts.length - 1] : name.slice(-5);
  }

  function recordPod(name) {
    if (!name) return;
    const now = Date.now();
    const known = pods.get(name);
    if (known) {
      known.count += 1;
      known.lastSeen = now;
    } else {
      pods.set(name, { count: 1, firstSeen: now, lastSeen: now });
    }
    recent.push(name);
    if (recent.length > RECENT_WINDOW) recent.shift();
  }

  function renderPods() {
    const now = Date.now();
    for (const [name, info] of pods) {
      if (now - info.lastSeen > FORGET_AFTER_MS) pods.delete(name);
    }

    const names = [...pods.keys()].sort();
    els.podsEmpty.hidden = names.length > 0;

    const shareOf = (name) => {
      if (recent.length === 0) return 0;
      return recent.filter((item) => item === name).length / recent.length;
    };

    const tiles = names.map((name) => {
      const info = pods.get(name);
      const li = document.createElement('li');
      li.className = 'pod';
      if (now - info.lastSeen < 2500) li.classList.add('is-active');
      if (now - info.lastSeen > IDLE_AFTER_MS) li.classList.add('is-idle');

      const id = document.createElement('span');
      id.className = 'pod-id';
      id.textContent = podSuffix(name);
      id.title = name;

      const meta = document.createElement('span');
      meta.className = 'pod-meta';
      meta.textContent = `${info.count} responses`;

      const bar = document.createElement('div');
      bar.className = 'pod-bar';
      const fill = document.createElement('span');
      fill.style.width = `${Math.round(shareOf(name) * 100)}%`;
      bar.append(fill);

      li.append(id, meta, bar);

      if (now - info.firstSeen < 20000 && pods.size > 1) {
        const badge = document.createElement('span');
        badge.className = 'pod-new';
        badge.textContent = 'new';
        li.append(badge);
      }
      return li;
    });
    els.podGrid.replaceChildren(...tiles);

    const live = names.filter((name) => now - pods.get(name).lastSeen <= IDLE_AFTER_MS).length;
    els.podsSummary.textContent = names.length ? `${live} active, ${names.length} seen` : '';
  }

  function duration(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours > 0) return `${hours} h ${minutes} min`;
    if (minutes > 0) return `${minutes} min`;
    return `${totalSeconds} s`;
  }

  async function pollWhoami() {
    try {
      const response = await fetch('/api/whoami', { cache: 'no-store' });
      const info = await response.json();
      recordPod(info.pod);
      els.currentPod.textContent = info.pod;
      els.node.textContent = info.node;
      els.namespace.textContent = info.namespace;
      els.uptime.textContent = duration(info.uptimeSeconds);
      els.build.textContent = info.build === 'local' ? 'local' : `#${info.build}`;
      els.commit.textContent = info.commit;
      els.built.textContent = info.builtAt
        ? new Date(info.builtAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
        : 'not built in CI';
      els.runtime.textContent = `Node ${String(info.node_version).replace(/^v/, '')}`;
      els.health.textContent = 'Cluster reachable';
      els.health.dataset.state = 'up';
    } catch (err) {
      els.health.textContent = 'Cluster unreachable';
      els.health.dataset.state = 'down';
    }
  }

  function drawSpark() {
    const width = 300;
    const height = 70;
    if (sparkValues.length < 2) {
      els.spark.replaceChildren();
      return;
    }
    const max = Math.max(200, ...sparkValues);
    const step = width / (RECENT_WINDOW - 1);
    const points = sparkValues
      .map((value, index) => `${(index * step).toFixed(1)},${(height - (value / max) * (height - 6) - 3).toFixed(1)}`)
      .join(' ');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('points', points);
    els.spark.replaceChildren(line);
  }

  function tickStats() {
    const average = second.done ? Math.round(second.latencyTotal / second.done) : 0;
    els.rps.textContent = String(second.done);
    els.latency.textContent = `${average} ms`;
    els.ok.textContent = String(totals.ok);
    els.shed.textContent = String(totals.shed);
    if (load.running || sparkValues.length) {
      sparkValues.push(average);
      if (sparkValues.length > RECENT_WINDOW) sparkValues.shift();
    }
    second.done = 0;
    second.latencyTotal = 0;
    drawSpark();

    if (load.running && Date.now() > load.stopAt) {
      stopLoad('Load stopped automatically after two minutes.');
    }
  }

  async function loadWorker() {
    while (load.running) {
      const started = performance.now();
      try {
        const response = await fetch(`/api/work?ms=${load.burnMs}`, { cache: 'no-store' });
        recordPod(response.headers.get('X-Served-By'));
        if (response.status === 200) {
          totals.ok += 1;
          second.done += 1;
          second.latencyTotal += performance.now() - started;
        } else if (response.status === 429) {
          totals.shed += 1;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        await response.arrayBuffer();
      } catch (err) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  function startLoad() {
    if (load.running) return;
    load = {
      running: true,
      stopAt: Date.now() + MAX_LOAD_SECONDS * 1000,
      burnMs: Number(els.burn.value),
    };
    totals.ok = 0;
    totals.shed = 0;
    els.start.disabled = true;
    els.stop.disabled = false;
    els.note.textContent = 'Load is running. Watch new pods appear on the left, or open Grafana.';
    for (let i = 0; i < Number(els.concurrency.value); i += 1) loadWorker();
  }

  function stopLoad(message) {
    load.running = false;
    els.start.disabled = false;
    els.stop.disabled = true;
    els.note.textContent = message || 'Load stopped.';
  }

  function setupLinks() {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return;
    els.grafana.href = `http://${host}:30300`;
    els.prometheus.href = `http://${host}:30090`;
    els.grafana.hidden = false;
    els.prometheus.hidden = false;
  }

  els.concurrency.addEventListener('input', () => {
    els.concurrencyOut.textContent = els.concurrency.value;
  });
  els.burn.addEventListener('input', () => {
    els.burnOut.textContent = `${els.burn.value} ms`;
  });
  els.start.addEventListener('click', startLoad);
  els.stop.addEventListener('click', () => stopLoad('Load stopped.'));

  setupLinks();
  pollWhoami();
  setInterval(pollWhoami, 1000);
  setInterval(tickStats, 1000);
  setInterval(renderPods, 1000);
  renderPods();
})();
