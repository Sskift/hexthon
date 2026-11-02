// Explicit, bounded performance probe. This never launches Hexthon, activates a
// window, runs OCR, or persists image contents. Only --dry-run was run at authoring.
// Run: node scripts/probe-roi-performance.cjs [--dry-run]
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { WindowMonitor } = require('../src/core/window-monitor.cjs');
const { WindowCapture, validateCaptureRequest } = require('../src/core/window-capture.cjs');
const { layout } = require('../src/core/scene-gate.cjs');
const { HUD_REGION } = require('../src/core/augment-icons.cjs');
const { visualContext, isCurrentVisualContext, captureMatchesContext } = require('../src/core/visual-context.cjs');

const LIMITS = Object.freeze({ totalWaitMs: 12000, activeWaitMs: 10000, monitorWaitMs: 2500, captureWaitMs: 3500, maxCaptures: 5 });
const round = value => Math.round(value * 1000) / 1000;

function buildPlan(width, height) {
  const geometry = layout(width, height); if (!geometry) return null;
  const plan = [
    ...Array.from({ length: 3 }, (_, index) => ({ kind: 'reroll', index: index + 1, region: geometry.rerollRegion, maxWidth: 1800 })),
    { kind: 'title', index: 1, region: geometry.titleRegion, maxWidth: 2200 },
    { kind: 'hud', index: 1, region: HUD_REGION, maxWidth: 1200 },
  ];
  for (const sample of plan) validateCaptureRequest({ hwnd: '1', ...sample });
  return plan;
}

function statistics(values) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, meanMs: null, p95Ms: null };
  return { count: sorted.length, meanMs: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
    p95Ms: round(sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)]) };
}

function bounded(promise, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); callback(value); };
    const abort = () => finish(reject, new Error('PROBE_BUDGET'));
    const timer = setTimeout(abort, Math.max(1, timeoutMs));
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error));
  });
}

async function readOwnedProcessCpu(records, timeoutMs = 700) {
  // Query only currently owned ChildProcess handles. No name-based lookup,
  // process enumeration, raw command-line capture, or cross-shell killing.
  const live = records.filter(r => ['monitor', 'capture'].includes(r.role) && Number.isSafeInteger(r.child?.pid) && r.child.pid > 0 && r.child.exitCode === null && r.child.signalCode === null && !r.child.killed);
  if (!live.length) return { queried: false, monitorMs: null, captureMs: null };
  const specs = live.map(r => `@{role='${r.role}';processId=${r.child.pid}}`).join(',');
  const code = `$ErrorActionPreference='Stop';$rows=@();foreach($entry in @(${specs})){$taskProcess=Get-Process -Id ([int]$entry.processId) -ErrorAction SilentlyContinue;if($null -ne $taskProcess){$rows+=@{role=[string]$entry.role;cpuMs=[math]::Round($taskProcess.TotalProcessorTime.TotalMilliseconds,3)}}};ConvertTo-Json -InputObject @($rows) -Compress`;
  const encoded = Buffer.from(code, 'utf16le').toString('base64');
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true, timeout: Math.max(1, timeoutMs), maxBuffer: 4096 }, (error, stdout) => {
      const result = { queried: true, monitorMs: null, captureMs: null };
      if (!error) try {
        const rows = JSON.parse(stdout.replace(/^\uFEFF/, ''));
        for (const row of Array.isArray(rows) ? rows : []) {
          const owned = live.find(r => r.role === row.role && r.child.exitCode === null && r.child.signalCode === null);
          if (owned && Number.isFinite(row.cpuMs) && row.cpuMs >= 0) result[`${row.role}Ms`] = round(row.cpuMs);
        }
      } catch { /* Optional CPU telemetry must not expose native errors. */ }
      resolve(result);
    });
  });
}

function releaseOwnedChild(child) {
  if (!child) return;
  try { if (child.exitCode === null && child.signalCode === null && !child.killed) child.kill(); } catch {}
  for (const stream of [child.stdin, child.stdout, child.stderr]) try { stream?.destroy(); } catch {}
  try { child.unref(); } catch {}
}

function waitForOwnedClose(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); child.removeListener('close', finish); resolve(); };
    const timer = setTimeout(finish, Math.max(1, timeoutMs));
    child.once('close', finish);
  });
}

async function runProbe({ Monitor = WindowMonitor, Capture = WindowCapture, readCpu = readOwnedProcessCpu,
  platform = process.platform, totalWaitMs = LIMITS.totalWaitMs } = {}) {
  // Dependency/time injection exists for tests, never for CLI capture expansion.
  const budgetMs = Math.min(LIMITS.totalWaitMs, Math.max(20, totalWaitMs));
  const started = performance.now(), deadline = started + budgetMs, cpuStart = process.cpuUsage();
  const reserve = Math.min(1500, budgetMs / 4), activeMs = Math.min(LIMITS.activeWaitMs, budgetMs - reserve);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), activeMs);
  const report = { status: 'unavailable', reason: 'NO_FOREGROUND_LEAGUE', limits: LIMITS, samples: [],
    helperStarts: { monitor: 0, capture: 0, cpuQuery: 0 }, helperLifetimeCpuMs: { monitor: null, capture: null },
    mechanism: 'Independent foreground-client CopyFromScreen ROI helper; elapsed time and CPU only, not game FPS.' };
  let monitor, capture, firstListener;
  try {
    if (platform !== 'win32') { report.reason = 'WINDOWS_REQUIRED'; return report; }
    monitor = new Monitor({ intervalMs: 120, restartMs: 60000 });
    const first = new Promise(resolve => {
      firstListener = snapshot => { if (snapshot?.observedAt) resolve(snapshot); };
      monitor.on('update', firstListener);
    });
    monitor.start(); report.helperStarts.monitor = monitor.child ? 1 : 0;
    const snapshot = await bounded(first, Math.min(LIMITS.monitorWaitMs, activeMs), controller.signal);
    monitor.removeListener('update', firstListener); firstListener = null;
    const context = visualContext(snapshot.game, true);
    if (!context?.foreground || !context.visible || context.minimized) return report;
    const plan = buildPlan(context.rect.width, context.rect.height);
    if (!plan) { report.reason = 'CLIENT_GEOMETRY_UNAVAILABLE'; return report; }
    capture = new Capture({ timeoutMs: LIMITS.captureWaitMs, retryMs: 60000 });
    for (const item of plan) {
      if (controller.signal.aborted) throw new Error('PROBE_BUDGET');
      if (!isCurrentVisualContext(context, monitor.latest.game)) throw new Error('PROBE_CONTEXT_CHANGED');
      const began = performance.now(); let frame;
      try {
        frame = await bounded(capture.capture({ hwnd: context.hwnd, region: item.region, maxWidth: item.maxWidth }), Math.min(LIMITS.captureWaitMs, deadline - reserve - began), controller.signal);
        if (!isCurrentVisualContext(context, monitor.latest.game) || !captureMatchesContext(frame, context)) throw new Error('PROBE_CONTEXT_CHANGED');
        report.samples.push({ kind: item.kind, index: item.index, elapsedMs: round(performance.now() - began),
          nativeMs: Number.isFinite(frame.durationMs) ? round(frame.durationMs) : null,
          outputPixels: frame.width * frame.height,
          sourcePixels: frame.pixelRegion.width * frame.pixelRegion.height });
      } finally {
        // Erase the probe's disposable frame. No references enter the report.
        frame?.bgraBuffer?.fill(0);
      }
    }
    report.status = 'complete'; report.reason = null;
  } catch (error) {
    const code = String(error?.message || '');
    if (code === 'PROBE_BUDGET' || code === 'WINDOW_CAPTURE_TIMEOUT') { report.status = 'timeout'; report.reason = 'WAIT_BUDGET_REACHED'; }
    else if (code === 'PROBE_CONTEXT_CHANGED' || /WINDOW_CAPTURE_(NOT_FOREGROUND|MINIMIZED|NOT_VISIBLE|WINDOW_CHANGED|WINDOW_UNAVAILABLE|NOT_LEAGUE)/.test(code)) {
      report.status = report.samples.length ? 'partial' : 'unavailable'; report.reason = 'FOREGROUND_GAME_CHANGED';
    } else { report.status = report.samples.length ? 'partial' : 'failed'; report.reason = 'PROBE_UNAVAILABLE'; }
  } finally {
    clearTimeout(timer);
    if (firstListener) monitor?.removeListener('update', firstListener);
    report.helperStarts.capture = capture?.starts || 0;
    const monitorChild = monitor?.child, captureChild = capture?.child;
    const remaining = () => Math.max(1, deadline - performance.now());
    try {
      if (remaining() > 300) {
        const cpu = await bounded(readCpu([{ role: 'monitor', child: monitorChild }, { role: 'capture', child: captureChild }], Math.min(700, remaining() - 200)), Math.min(800, remaining()));
        report.helperStarts.cpuQuery = cpu?.queried ? 1 : 0;
        report.helperLifetimeCpuMs = { monitor: Number.isFinite(cpu?.monitorMs) ? cpu.monitorMs : null, capture: Number.isFinite(cpu?.captureMs) ? cpu.captureMs : null };
      }
    } catch { /* Cleanup and metadata remain bounded if CPU querying fails. */ }
    const monitorClosed = waitForOwnedClose(monitorChild, Math.min(1000, remaining()));
    try { monitor?.stop(); } catch {}
    try { await bounded(Promise.allSettled([monitorClosed, Promise.resolve(capture?.close())]), Math.min(1000, remaining())); } catch {}
    releaseOwnedChild(monitorChild); releaseOwnedChild(captureChild);
    const used = process.cpuUsage(cpuStart);
    report.probeCpuMs = { user: round(used.user / 1000), system: round(used.system / 1000), total: round((used.user + used.system) / 1000) };
    report.elapsedMs = round(performance.now() - started);
    report.summary = { all: statistics(report.samples.map(s => s.elapsedMs)),
      reroll: statistics(report.samples.filter(s => s.kind === 'reroll').map(s => s.elapsedMs)),
      rerollWarm: statistics(report.samples.filter(s => s.kind === 'reroll' && s.index > 1).map(s => s.elapsedMs)),
      title: statistics(report.samples.filter(s => s.kind === 'title').map(s => s.elapsedMs)),
      hud: statistics(report.samples.filter(s => s.kind === 'hud').map(s => s.elapsedMs)),
      totalOutputPixels: report.samples.reduce((sum, s) => sum + s.outputPixels, 0) };
  }
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--dry-run')) throw new Error('Only --dry-run is supported.');
  if (args.includes('--dry-run')) {
    const checks = [[1920, 1080], [3440, 1440], [3840, 2160]].map(([width, height]) => {
      const plan = buildPlan(width, height);
      if (!plan || plan.length !== LIMITS.maxCaptures) throw new Error('ROI_PLAN_INVALID');
      return { clientPixels: width * height, kinds: plan.map(p => p.kind), maxWidths: plan.map(p => p.maxWidth), roiAreas: plan.map(p => round(p.region.width * p.region.height)) };
    });
    console.log(JSON.stringify({ status: 'dry-run', helpersStarted: 0, captures: 0, writes: 0, limits: LIMITS, checks })); return;
  }
  const report = await runProbe();
  const out = path.resolve(__dirname, '../.qa/roi-performance.json');
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  if (report.status === 'failed' || report.status === 'timeout') process.exitCode = 1;
}

if (require.main === module) main().catch(() => { console.error('ROI_PROBE_FAILED'); process.exitCode = 1; });
module.exports = { LIMITS, buildPlan, statistics, runProbe, readOwnedProcessCpu };
