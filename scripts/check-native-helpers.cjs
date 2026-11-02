// Background lifecycle preflight. Capture requests use only an HWND first
// proved invalid through IsWindow; OCR receives only a generated blank bitmap.
// No actual capture, foreground activation, mouse/keyboard input or image files.
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { WindowCapture } = require('../src/core/window-capture.cjs');
const { WindowsOcrWorker } = require('../src/core/ocr.cjs');
const { WindowMonitor } = require('../src/core/window-monitor.cjs');

const root = path.resolve(__dirname, '..'), INVALID_HWND = '9223372036854775807';
const owned = [], cases = [];
const bounded = (promise, ms = 4000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('CHECK_TIMEOUT')), ms);
  Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
});
function track(child) {
  if (owned.includes(child)) return child;
  owned.push(child); child.preflightClosed = false;
  child.preflightDone = new Promise(resolve => child.once('close', () => { child.preflightClosed = true; resolve(); }));
  child.on('error', () => {}); child.stdin?.on('error', () => {});
  return child;
}
function ownSpawn(...args) { return track(spawn(...args)); }
function native(name, args = []) {
  const child = ownSpawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'src/native', name), ...args], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.on('data', () => {}); return child;
}
async function close(child, ms = 4000) { await bounded(child.preflightDone, ms); }
async function stop(child) {
  if (!child || child.preflightClosed) return;
  try { child.stdin?.destroy(); } catch {}
  try { child.kill(); } catch {}
  try { await close(child, 1500); } catch {}
}
function bytes(child, max = 65536) {
  const chunks = []; let length = 0;
  child.stdout.on('data', chunk => { length += chunk.length; if (length <= max) chunks.push(chunk); });
  return () => { assert.ok(length <= max, 'bounded helper output'); return Buffer.concat(chunks); };
}
async function firstLine(child) {
  return bounded(new Promise((resolve, reject) => {
    let buffer = '';
    const onData = chunk => {
      buffer += chunk.toString();
      if (buffer.length > 32768) { child.stdout.removeListener('data', onData); reject(new Error('LINE_LIMIT')); return; }
      if (buffer.includes('\n')) { child.stdout.removeListener('data', onData); resolve(true); }
    };
    child.stdout.on('data', onData);
  }));
}
async function check(name, action) {
  const before = owned.length, started = performance.now();
  try { const detail = await action(); cases.push({ name, ok: true, elapsedMs: Math.round(performance.now() - started), ...detail }); }
  catch (error) { cases.push({ name, ok: false, elapsedMs: Math.round(performance.now() - started), failure: error?.name === 'AssertionError' ? 'ASSERTION_FAILED' : 'HELPER_CHECK_FAILED' }); }
  finally { for (const child of owned.slice(before)) await stop(child); }
}
function onlyEmptyCaptureReplies(buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    assert.ok(offset + 4 <= buffer.length); const size = buffer.readUInt32LE(offset); offset += 4;
    assert.ok(size >= 2 && size <= 8192 && offset + size <= buffer.length);
    const reply = JSON.parse(buffer.subarray(offset, offset + size).toString()); offset += size;
    assert.equal(reply.ok, false); assert.equal(reply.byteLength, 0);
  }
}

async function main() {
  if (process.platform !== 'win32') { console.log(JSON.stringify({ ok: false, unavailable: 'WINDOWS_REQUIRED' })); return; }
  let invalidConfirmed = false;
  await check('invalid-hwnd-confirmed-before-any-capture-request', async () => {
    const code = "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class PreflightWindow { [DllImport(\"user32.dll\")] public static extern bool IsWindow(IntPtr h); }'; [Console]::Write([PreflightWindow]::IsWindow([IntPtr]::new([long]::MaxValue)))";
    const child = ownSpawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stderr.on('data', () => {}); const output = bytes(child); child.stdin.end(); await close(child);
    assert.equal(output().toString().trim().toLowerCase(), 'false'); invalidConfirmed = true;
    return { invalidConfirmed: true };
  });
  if (!invalidConfirmed) throw new Error('INVALID_HANDLE_CHECK_REQUIRED');

  await check('native-capture-invalid-hwnd-reuse-and-close', async () => {
    const reader = new WindowCapture({ spawnProcess: ownSpawn, timeoutMs: 4000 });
    try {
      for (let i = 0; i < 2; i++) await assert.rejects(reader.capture({ hwnd: INVALID_HWND, region: { x: .2, y: .2, width: .05, height: .05 }, maxWidth: 64 }), /WINDOW_CAPTURE_WINDOW_UNAVAILABLE/);
      assert.equal(reader.starts, 1); const child = reader.child;
      await reader.close(); await close(child); await assert.rejects(reader.capture({ hwnd: INVALID_HWND }), /CLOSED/);
      return { requestsRejected: 2, helperStarts: 1, imageBytes: 0, closed: true };
    } finally { await reader.close(); }
  });

  await check('capture-eof-truncated-frame-and-oversize-frame', async () => {
    for (const input of [Buffer.alloc(0), Buffer.from([2, 0]), Buffer.from([0xff, 0xff, 0xff, 0x7f])]) {
      const child = native('window-capture.ps1'), output = bytes(child); child.stdin.end(input); await close(child); onlyEmptyCaptureReplies(output());
    }
    return { eofCases: 3, imageBytes: 0 };
  });

  await check('capture-timeout-owned-stall-cooldown-and-retry', async () => {
    let now = 100, launches = 0;
    const spawnProcess = (...args) => ++launches === 1 ? ownSpawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 30'], args[2]) : ownSpawn(...args);
    const reader = new WindowCapture({ spawnProcess, timeoutMs: 50, retryMs: 100, now: () => now });
    try {
      await assert.rejects(reader.capture({ hwnd: INVALID_HWND }), /TIMEOUT/);
      await assert.rejects(reader.capture({ hwnd: INVALID_HWND }), /COOLDOWN/);
      now = 201; reader.timeoutMs = 4000;
      await assert.rejects(reader.capture({ hwnd: INVALID_HWND }), /WINDOW_CAPTURE_WINDOW_UNAVAILABLE/);
      assert.equal(reader.starts, 2); await reader.close();
      return { timeoutFault: 'owned-stalled-process', cooldown: true, retryHelperStarts: 2, imageBytes: 0 };
    } finally { await reader.close(); }
  });

  const bitmapSize = { width: 64, height: 32 }, blank = Buffer.alloc(64 * 32 * 4, 255);
  await check('native-winrt-ocr-synthetic-bgra-reuse-and-close', async () => {
    const reader = new WindowsOcrWorker({ spawnProcess: ownSpawn, timeoutMs: 4000 });
    try {
      const timings = [];
      for (let i = 0; i < 3; i++) { const started = performance.now(), result = await reader.recognize(blank, bitmapSize); timings.push(Math.round(performance.now() - started)); assert.equal(result.text, ''); assert.deepEqual(result.lines, []); }
      assert.equal(reader.starts, 1); const child = reader.child;
      await reader.close(); await close(child); await assert.rejects(reader.recognize(blank, bitmapSize), /CLOSED/);
      return { syntheticPixels: 2048, reads: 3, helperStarts: 1, elapsedReadsMs: timings, closed: true };
    } finally { await reader.close(); }
  });

  await check('ocr-eof-truncated-bgra-and-invalid-frame', async () => {
    const header = Buffer.from(JSON.stringify({ id: 1, width: 64, height: 32, byteLength: blank.length }) + '\n');
    const invalid = Buffer.from(JSON.stringify({ id: 1, width: 0, height: 32, byteLength: 0 }) + '\n');
    for (const input of [Buffer.alloc(0), Buffer.concat([header, blank.subarray(0, 7)]), invalid]) {
      const child = native('ocr.ps1', ['-Worker']), output = bytes(child); child.stdin.end(input); await close(child);
      const rows = output().toString().split(/\r?\n/).filter(Boolean).map(text => JSON.parse(text.replace(/^\uFEFF/, '')));
      assert.ok(rows.every(row => row.ready === true));
    }
    return { eofCases: 3, recognizedFrames: 0 };
  });

  await check('ocr-timeout-owned-stall-cooldown-and-retry', async () => {
    let now = 100, launches = 0;
    const spawnProcess = (...args) => ++launches === 1 ? ownSpawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 30'], args[2]) : ownSpawn(...args);
    const reader = new WindowsOcrWorker({ spawnProcess, timeoutMs: 20, retryMs: 100, now: () => now });
    try {
      await assert.rejects(reader.recognize(blank, bitmapSize), /TIMEOUT/);
      await assert.rejects(reader.recognize(blank, bitmapSize), /COOLDOWN/);
      now = 201; reader.timeoutMs = 4000; const result = await reader.recognize(blank, bitmapSize);
      assert.equal(result.text, ''); assert.equal(reader.starts, 2); await reader.close();
      return { timeoutFault: 'owned-stalled-process', cooldown: true, retryHelperStarts: 2 };
    } finally { await reader.close(); }
  });

  await check('monitor-readonly-kill-restart-stop', async () => {
    const monitor = new WindowMonitor({ intervalMs: 120, restartMs: 100 });
    const launch = monitor.launch.bind(monitor);
    monitor.launch = () => { const result = launch(); if (monitor.child) track(monitor.child); return result; };
    const update = (predicate = () => true) => bounded(new Promise(resolve => {
      const listener = snapshot => { if (snapshot.observedAt && predicate()) { monitor.removeListener('update', listener); resolve(); } };
      monitor.on('update', listener);
    }));
    try {
      const first = update(); monitor.start(); const old = track(monitor.child); await first;
      const next = update(() => monitor.child && monitor.child !== old); old.kill(); await next; const replacement = track(monitor.child);
      assert.notEqual(old, replacement); monitor.stop(); await close(old); await close(replacement);
      await new Promise(resolve => setTimeout(resolve, 180)); assert.equal(monitor.child, null); assert.equal(monitor.running, false);
      return { freshSnapshots: 2, restarted: true, stoppedWithoutRestart: true };
    } finally { monitor.stop(); monitor.removeAllListeners('update'); }
  });

  await check('monitor-exits-after-supplied-parent-process-exits', async () => {
    const parent = ownSpawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
    const child = native('window-monitor.ps1', ['-IntervalMs', '100', '-ParentProcessId', String(parent.pid)]);
    await firstLine(child); child.stdout.on('data', () => {});
    const began = performance.now(); parent.kill(); await close(parent); await close(child, 6500);
    return { parentExitObserved: true, exitDelayMs: Math.round(performance.now() - began) };
  });

  blank.fill(0);
  for (const child of owned) await stop(child);
  const residual = owned.filter(child => !child.preflightClosed).length;
  const report = { ok: cases.every(c => c.ok) && residual === 0,
    method: 'Invalid HWND checked by IsWindow; generated blank BGRA only; read-only window monitor; no screenshot, OCR of a real window, foreground activation or input.',
    cases, ownedProcesses: owned.length, ownedHelpersStillRunning: residual,
    lifecycle: 'Capture/OCR end on stdin EOF. Monitor receives a dedicated parent PID; its parent-death path is tested while stdout stays open.' };
  await fs.mkdir(path.join(root, '.qa'), { recursive: true });
  await fs.writeFile(path.join(root, '.qa/native-helper-preflight.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); if (!report.ok) process.exitCode = 1;
}

main().catch(async () => {
  for (const child of owned) await stop(child);
  console.log(JSON.stringify({ ok: false, failure: 'PREFLIGHT_FAILED', ownedHelpersStillRunning: owned.filter(child => !child.preflightClosed).length })); process.exitCode = 1;
});
