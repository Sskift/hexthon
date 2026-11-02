const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { LIMITS, buildPlan, statistics, runProbe, readOwnedProcessCpu } = require('../scripts/probe-roi-performance.cjs');

function harness({ foreground = true, onCapture = null, noSnapshot = false } = {}) {
  const state = { starts: 0, captures: [], frames: [], stopped: false, closed: false, captureInstances: 0 };
  const game = { hwnd: '1234', pid: 42, dpi: 96, foreground, visible: true, minimized: false,
    x: 0, y: 0, width: 1920, height: 1080, clientRect: { x: 0, y: 0, width: 1920, height: 1080 } };
  class Monitor extends EventEmitter {
    constructor() { super(); this.latest = { game, observedAt: new Date().toISOString() }; state.monitor = this; this.child = null; }
    start() { state.starts++; if (!noSnapshot) queueMicrotask(() => this.emit('update', this.latest)); return this; }
    stop() { state.stopped = true; }
  }
  class Capture {
    constructor() { state.captureInstances++; this.starts = 1; this.child = null; }
    async capture(request) {
      state.captures.push(request);
      if (onCapture) await onCapture(state);
      const frame = { width: 64, height: 16, bgraBuffer: Buffer.alloc(64 * 16 * 4, 37),
        hwnd: game.hwnd, pid: game.pid, dpi: game.dpi, clientRect: { ...game.clientRect },
        pixelRegion: { x: 10, y: 10, width: 100, height: 20 }, region: request.region,
        capturedAt: new Date().toISOString(), durationMs: 2 };
      state.frames.push(frame); return frame;
    }
    async close() { state.closed = true; }
  }
  return { state, options: { Monitor, Capture, platform: 'win32', readCpu: async () => ({ queried: false, monitorMs: null, captureMs: null }) } };
}

test('probe plan is fixed to three reroll, one title and one HUD ROI, with bounded widths', () => {
  assert.equal(LIMITS.totalWaitMs, 12000); assert.equal(LIMITS.maxCaptures, 5);
  for (const [w, h] of [[1920, 1080], [3440, 1440], [3840, 2160]]) {
    const plan = buildPlan(w, h); assert.equal(plan.length, 5);
    assert.deepEqual(plan.map(p => p.kind), ['reroll', 'reroll', 'reroll', 'title', 'hud']);
    assert.ok(plan.every(p => p.region.width * p.region.height < .08 && p.maxWidth <= 2200));
  }
  assert.equal(buildPlan(200, 200), null);
  assert.deepEqual(statistics([3, 1, 2]), { count: 3, meanMs: 2, p95Ms: 3 });
});

test('owned probe executes exactly five fake captures, erases buffers and reports only metadata', async () => {
  const h = harness(), result = await runProbe(h.options);
  assert.equal(result.status, 'complete'); assert.equal(result.samples.length, 5); assert.equal(h.state.captures.length, 5);
  assert.equal(result.summary.reroll.count, 3); assert.equal(result.summary.rerollWarm.count, 2);
  assert.equal(result.summary.totalOutputPixels, 5 * 64 * 16);
  assert.ok(h.state.frames.every(frame => frame.bgraBuffer.every(byte => byte === 0)));
  assert.equal(h.state.stopped, true); assert.equal(h.state.closed, true);
  assert.doesNotMatch(JSON.stringify(result), /"(?:hwnd|pid|clientRect|pixelRegion|region|bgraBuffer|titleText)"/);
});

test('a first snapshot without foreground LoL exits unavailable without constructing capture', async () => {
  const h = harness({ foreground: false }), result = await runProbe(h.options);
  assert.equal(result.status, 'unavailable'); assert.equal(result.reason, 'NO_FOREGROUND_LEAGUE');
  assert.equal(h.state.captureInstances, 0); assert.equal(h.state.captures.length, 0); assert.equal(h.state.stopped, true);
});

test('context loss after a capture discards its pixels and stops all further work', async () => {
  const h = harness({ onCapture: async state => { state.monitor.latest = { ...state.monitor.latest, game: { ...state.monitor.latest.game, foreground: false } }; } });
  const result = await runProbe(h.options);
  assert.equal(result.status, 'unavailable'); assert.equal(result.reason, 'FOREGROUND_GAME_CHANGED');
  assert.equal(result.samples.length, 0); assert.equal(h.state.captures.length, 1);
  assert.ok(h.state.frames[0].bgraBuffer.every(byte => byte === 0)); assert.equal(h.state.closed, true);
});

test('capture failure is sanitized and retains only successful timing samples before cleanup', async () => {
  const h = harness({ onCapture: async state => { if (state.captures.length === 3) throw new Error('private path or arbitrary helper text'); } });
  const result = await runProbe(h.options);
  assert.equal(result.status, 'partial'); assert.equal(result.samples.length, 2);
  assert.equal(result.reason, 'PROBE_UNAVAILABLE'); assert.doesNotMatch(JSON.stringify(result), /private path/);
  assert.equal(h.state.stopped, true); assert.equal(h.state.closed, true);
});

test('global budget interrupts stalled fake capture and still closes both owned helpers', async () => {
  const h = harness({ onCapture: () => new Promise(() => {}) });
  const result = await runProbe({ ...h.options, totalWaitMs: 40 });
  assert.equal(result.status, 'timeout'); assert.ok(result.elapsedMs < 500);
  assert.equal(h.state.captures.length, 1); assert.equal(h.state.stopped, true); assert.equal(h.state.closed, true);
});

test('a stalled monitor is bounded without ever creating a capture helper', async () => {
  const h = harness({ noSnapshot: true }), result = await runProbe({ ...h.options, totalWaitMs: 40 });
  assert.equal(result.status, 'timeout'); assert.equal(h.state.captureInstances, 0); assert.equal(h.state.stopped, true);
});

test('CPU query timeout stays unknown, reports a sanitized reason, and preserves its caller budget', async () => {
  const records = [{ role: 'monitor', child: { pid: 42, exitCode: null, signalCode: null, killed: false } }];
  let invoked = false;
  const result = await readOwnedProcessCpu(records, 31, { execute: (exe, args, settings, callback) => {
    invoked = true; assert.equal(exe, 'powershell.exe'); assert.equal(settings.timeout, 31); assert.equal(settings.windowsHide, true);
    assert.ok(args.includes('-NoProfile')); assert.ok(args.includes('-NonInteractive'));
    callback(Object.assign(new Error('private helper path'), { killed: true, signal: 'SIGTERM' }), '');
  } });
  assert.equal(invoked, true); assert.equal(result.reason, 'CPU_QUERY_TIMEOUT');
  assert.equal(result.monitorMs, null); assert.equal(result.captureMs, null);
  assert.doesNotMatch(JSON.stringify(result), /private|SIGTERM/);
});

test('CPU query reports failures, malformed output and exited targets without inventing CPU values', async () => {
  const child = { pid: 42, exitCode: null, signalCode: null, killed: false }, records = [{ role: 'monitor', child }];
  for (const [error, stdout, reason] of [[new Error('native detail'), '', 'CPU_QUERY_FAILED'], [null, '{}', 'CPU_QUERY_INVALID_OUTPUT'], [null, '[]', 'CPU_QUERY_TARGET_UNAVAILABLE']]) {
    const result = await readOwnedProcessCpu(records, 50, { execute: (_exe, _args, _settings, callback) => callback(error, stdout) });
    assert.equal(result.reason, reason); assert.equal(result.monitorMs, null);
  }
  const closed = await readOwnedProcessCpu(records, 50, { execute: (_exe, _args, _settings, callback) => {
    child.killed = true; callback(null, '[{"role":"monitor","cpuMs":2}]');
  } });
  assert.equal(closed.reason, 'CPU_QUERY_TARGET_UNAVAILABLE'); assert.equal(closed.monitorMs, null);
});

test('Windows CPU query compiles and reads only the owned test process, without capture helpers', { skip: process.platform !== 'win32', timeout: 12000 }, async () => {
  // Windows CI starts many Node test files concurrently. Its previous failure
  // took about 2 s but discarded the cause. Keep a real query with a bounded 10 s
  // integration allowance; production still uses its <=700 ms optional budget.
  const result = await readOwnedProcessCpu([{ role: 'monitor', child: { pid: process.pid, exitCode: null, signalCode: null, killed: false } }], 10000);
  assert.equal(result.queried, true); assert.equal(result.reason, null, `CPU query unavailable: ${result.reason}`);
  assert.ok(Number.isFinite(result.monitorMs) && result.monitorMs >= 0);
  assert.equal(result.captureMs, null);
});
