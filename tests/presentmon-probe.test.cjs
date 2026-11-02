const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { PresentMonMetrics, csvLine, intervalStats } = require('../src/core/presentmon-metrics.cjs');
const { buildArgs, classifyDiagnostic, runPresentMon } = require('../src/core/presentmon-probe.cjs');
const { options, main, targetIsCurrent } = require('../scripts/probe-fps-performance.cjs');
const { visualContext } = require('../src/core/visual-context.cjs');
const SESSION = 'HexthonFPS-00000000-0000-0000-0000-000000000000';
const HEADER = 'Application,ProcessID,SwapChainAddress,Dropped,TimeInSeconds,MsBetweenPresents,MsBetweenDisplayChange\n';
const row = (pid = 42, swap = '0xabc', interval = 16, dropped = 0) => `"private,name.exe",${pid},${swap},${dropped},1,${interval},${interval}\n`;

test('CSV parser handles quoted commas and escapes without storing process identifiers', () => {
  assert.deepEqual(csvLine('"a,b","c""d",3'), ['a,b', 'c"d', '3']); assert.equal(csvLine('"bad'), null);
  const metrics = new PresentMonMetrics(42); const csv = HEADER + row(900) + row().repeat(60);
  for (let i = 0; i < csv.length; i += 17) metrics.push(Buffer.from(csv.slice(i, i + 17)));
  const report = metrics.finish(); assert.equal(report.available, true); assert.equal(report.targetFrames, 60);
  assert.equal(report.foreignRowsDiscarded, 1); assert.equal(report.presentIntervals.meanFps, 62.5);
  assert.doesNotMatch(JSON.stringify(report), /private|0xabc|ProcessID|SwapChainAddress/);
});

test('dominant swapchain prevents inflated FPS when a process has several presenting surfaces', () => {
  const metrics = new PresentMonMetrics(42); metrics.push(HEADER + row(42, '0xaaa', 10).repeat(60) + row(42, '0xbbb', 30).repeat(40));
  const report = metrics.finish(); assert.equal(report.swapchainsSeen, 2); assert.equal(report.selectedSwapchainFrames, 60);
  assert.equal(report.selectedSwapchainShare, .6); assert.equal(report.presentIntervals.meanFps, 100);
});

test('dropped frames remain in presented intervals but do not become displayed samples', () => {
  const metrics = new PresentMonMetrics(42); metrics.push(HEADER + row().repeat(30) + row(42, '0xabc', 40, 1));
  const report = metrics.finish(); assert.equal(report.droppedFrames, 1); assert.equal(report.presentIntervals.samples, 31);
  assert.equal(report.displayIntervals.samples, 30); assert.equal(report.presentIntervals.p99Ms, 40);
  assert.deepEqual(intervalStats([0, -1, NaN]), { samples: 0, meanMs: null, p50Ms: null, p95Ms: null, p99Ms: null, maxMs: null, meanFps: null });
});

test('discarded target rows cannot dilute swapchain share and unknown drop status cannot become displayed FPS', () => {
  const metrics = new PresentMonMetrics(42);
  metrics.push(HEADER + row().repeat(30) + row(42, 'invalid-swap') + row(42, '0xabc', 0) + row(42, '0xabc', 16, 'unknown'));
  const report = metrics.finish();
  assert.equal(report.targetRowsSeen, 33); assert.equal(report.targetRowsDiscarded, 1); assert.equal(report.targetFrames, 32);
  assert.equal(report.selectedSwapchainShare, 1); assert.equal(report.presentIntervals.samples, 31);
  assert.equal(report.displayIntervals.samples, 30); assert.equal(report.unknownDropStatusFrames, 1);
  assert.equal(report.presentIntervalsDiscarded, 1); assert.equal(report.displayIntervalsDiscarded, 2);
});

test('empty, incomplete, foreign-only or unsupported data cannot report measured FPS', () => {
  const empty = new PresentMonMetrics(42); assert.equal(empty.finish().available, false);
  const foreign = new PresentMonMetrics(42); foreign.push(HEADER + row(900).repeat(100)); assert.equal(foreign.finish().reason, 'NO_TARGET_FRAMES');
  const few = new PresentMonMetrics(42); few.push(HEADER + row().repeat(2)); assert.equal(few.finish().reason, 'INSUFFICIENT_TARGET_FRAMES');
  const unknown = new PresentMonMetrics(42); unknown.push('Application,ProcessID,Other\na,42,1\n'); assert.equal(unknown.finish().reason, 'UNSUPPORTED_CSV_SCHEMA');
});

test('output and row limits bound retained numeric samples', () => {
  const bytes = new PresentMonMetrics(42, { maxBytes: 20 }); bytes.push(HEADER); assert.equal(bytes.finish().reason, 'OUTPUT_LIMIT');
  const rows = new PresentMonMetrics(42, { maxRows: 2 }); rows.push(HEADER + row().repeat(3)); assert.equal(rows.finish().reason, 'OUTPUT_LIMIT');
});

test('CLI arguments require one PID and bounded duration; no activation, elevation or global stop flags', () => {
  const args = buildArgs({ pid: 42, durationSeconds: 10, sessionName: SESSION });
  assert.equal(args[args.indexOf('--process_id') + 1], '42'); assert.ok(args.includes('--output_stdout'));
  for (const forbidden of ['--captureall', '--restart_as_admin', '--stop_existing_session', '--hotkey', '--scroll_indicator', '--track_app_timing']) assert.equal(args.includes(forbidden), false);
  for (const pid of [0, -1, NaN, 0x100000000]) assert.throws(() => buildArgs({ pid, sessionName: SESSION }));
  for (const durationSeconds of [1, 9, 21, NaN]) assert.throws(() => buildArgs({ pid: 42, durationSeconds, sessionName: SESSION }));
  assert.throws(() => buildArgs({ pid: 42, sessionName: 'PresentMon' }));
  assert.equal(options(['--isolation']).seconds, 1); assert.throws(() => options(['--seconds=30'])); assert.throws(() => options(['--pid=42']));
});

function fakeCollector({ csv = HEADER + row().repeat(60), stderr = '', exitCode = 0, hold = false, ignoreKill = false } = {}) {
  const launches = [], cleanups = [], lifecycle = [];
  const spawnProcess = (...args) => {
    launches.push(args); const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.exitCode = null; child.signalCode = null; child.killed = false;
    child.kill = () => { lifecycle.push('kill'); child.killed = true; child.signalCode = 'SIGTERM'; if (!ignoreKill) queueMicrotask(() => child.emit('close', null)); };
    child.unref = () => {};
    child.on('close', () => lifecycle.push('close'));
    if (!hold) queueMicrotask(() => { child.stdout.write(csv); child.stderr.write(stderr); child.exitCode = exitCode; child.emit('close', exitCode); });
    return child;
  };
  const cleanupSession = async (_executable, name) => { lifecycle.push('cleanup'); cleanups.push(name); return { attempted: true, confirmed: true, reason: null }; };
  return { launches, cleanups, lifecycle, options: { executable: 'unused-test.exe', pid: 42, spawnProcess, cleanupSession } };
}

test('runner uses hidden owned process, reports real numeric data only, and cleans exactly its unique session', async () => {
  const h = fakeCollector(), report = await runPresentMon(h.options);
  assert.equal(report.status, 'measured'); assert.equal(report.frames.targetFrames, 60); assert.equal(report.etwCleanup.confirmed, true);
  assert.equal(h.launches[0][2].windowsHide, true); assert.equal(h.cleanups.length, 1);
  assert.equal(h.cleanups[0], h.launches[0][1][h.launches[0][1].indexOf('--session_name') + 1]);
  assert.doesNotMatch(JSON.stringify(report), /private|0xabc|"pid"|HexthonFPS-/);
});

test('loss of target cancels the owned session and cannot be called a measured run', async () => {
  const h = fakeCollector({ hold: true }), abort = new AbortController();
  setTimeout(() => abort.abort(), 5); const report = await runPresentMon({ ...h.options, signal: abort.signal });
  assert.equal(report.status, 'unavailable'); assert.equal(report.reason, 'TARGET_CHANGED'); assert.equal(h.cleanups.length, 1);
  assert.deepEqual(h.lifecycle, ['kill', 'close', 'cleanup']); assert.equal(report.collectorExitConfirmed, true);
  const absent = fakeCollector(); const skipped = await runPresentMon({ ...absent.options, isCurrent: () => false });
  assert.equal(skipped.collectorStarted, false); assert.equal(absent.launches.length, 0);
});

test('watchdog termination without observed process exit cannot certify ETW cleanup', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const h = fakeCollector({ hold: true, ignoreKill: true });
  const pending = runPresentMon(h.options); t.mock.timers.tick(13800);
  const report = await pending;
  assert.equal(report.reason, 'TIME_BUDGET_REACHED'); assert.equal(report.collectorExitConfirmed, false);
  assert.equal(report.etwCleanup.confirmed, false); assert.equal(report.etwCleanup.reason, 'COLLECTOR_EXIT_UNVERIFIED');
});

test('foreground evidence must be fresh and dry run returns before starting any monitor', async t => {
  const { WindowMonitor } = require('../src/core/window-monitor.cjs');
  t.mock.method(WindowMonitor.prototype, 'start', () => { throw new Error('DRY_RUN_MUST_NOT_START_MONITOR'); });
  const dry = await main(['--dry-run']);
  assert.equal(dry.helpersStarted, 0); assert.equal(dry.traceStarted, false); assert.equal(dry.filesWritten, 0);
  const now = Date.now(), game = { hwnd: '5', pid: 42, dpi: 96, foreground: true, visible: true, minimized: false,
    clientRect: { x: 0, y: 0, width: 1920, height: 1080 } }, context = visualContext(game);
  assert.equal(targetIsCurrent(context, { game, observedAt: new Date(now).toISOString() }, now), true);
  assert.equal(targetIsCurrent(context, { game, observedAt: new Date(now - 1001).toISOString() }, now), false);
  assert.equal(targetIsCurrent(context, { game: { ...game, foreground: false }, observedAt: new Date(now).toISOString() }, now), false);
});

test('ETW permission failures and empty successful exits remain explicit unavailable results', async () => {
  const denied = fakeCollector({ csv: '', stderr: 'error: failed to start trace session: access denied.', exitCode: 6 });
  assert.equal((await runPresentMon(denied.options)).reason, 'ETW_ACCESS_DENIED');
  const empty = fakeCollector({ csv: '' }); assert.equal((await runPresentMon(empty.options)).reason, 'NO_TARGET_FRAMES');
  const unsupported = fakeCollector({ csv: 'Application,ProcessID,Other\na,42,1\n' });
  assert.equal((await runPresentMon(unsupported.options)).reason, 'UNSUPPORTED_CSV_SCHEMA');
  assert.equal(classifyDiagnostic('Lost 0 events'), null); assert.equal(classifyDiagnostic('Lost 17 events'), 'ETW_EVENTS_LOST');
});
