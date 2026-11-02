const { spawn, execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { PresentMonMetrics } = require('./presentmon-metrics.cjs');

function buildArgs({ pid, durationSeconds = 10, sessionName, isolation = false }) {
  if (!Number.isSafeInteger(pid) || pid < 1 || pid > 0xffffffff) throw new Error('PRESENTMON_TARGET_PID');
  if (!Number.isInteger(durationSeconds) || durationSeconds < (isolation && pid === process.pid ? 1 : 10) || durationSeconds > 20) throw new Error('PRESENTMON_DURATION');
  if (!/^HexthonFPS-[a-f0-9-]{36}$/i.test(sessionName || '')) throw new Error('PRESENTMON_SESSION');
  return ['--process_id', String(pid), '--timed', String(durationSeconds), '--terminate_after_timed', '--terminate_on_proc_exit',
    '--session_name', sessionName, '--output_stdout', '--no_console_stats', '--v1_metrics', '--no_track_input', '--no_track_gpu'];
}

function classifyDiagnostic(text) {
  if (/failed to start trace session:.*access denied|error code 5\b/i.test(text)) return 'ETW_ACCESS_DENIED';
  if (/session.*already (?:exists|running)/i.test(text)) return 'ETW_SESSION_CONFLICT';
  if (/unrecognized|unknown (?:argument|option)|invalid command/i.test(text)) return 'CLI_UNSUPPORTED';
  if (/lost [1-9]\d* (?:events|buffers)|events were lost|buffers were lost/i.test(text)) return 'ETW_EVENTS_LOST';
  return null;
}

function stopOwnSession(executable, sessionName) {
  // A unique name is generated for this one run; never terminate the default
  // session or use --stop_existing_session against another collector.
  return new Promise(resolve => execFile(executable, ['--session_name', sessionName, '--terminate_existing_session', '--no_csv', '--no_console_stats'],
    { windowsHide: true, timeout: 1200, maxBuffer: 8192 }, (error, stdout, stderr) => {
      const text = stdout + stderr;
      const alreadyAbsent = /no existing sessions found/i.test(text);
      resolve({ attempted: true, confirmed: !error || alreadyAbsent, reason: !error || alreadyAbsent ? null : 'OWN_SESSION_CLEANUP_UNVERIFIED' });
    }));
}

async function runPresentMon({ executable, pid, durationSeconds = 10, isolation = false, isCurrent = () => true,
  spawnProcess = spawn, cleanupSession = stopOwnSession, signal } = {}) {
  const sessionName = `HexthonFPS-${randomUUID()}`, args = buildArgs({ pid, durationSeconds, sessionName, isolation });
  const current = () => { try { return isCurrent() === true; } catch { return false; } };
  if (!current() || signal?.aborted) return { status: 'unavailable', reason: 'TARGET_NOT_CURRENT', frames: null, collectorStarted: false };
  const began = performance.now(), cpuBefore = process.cpuUsage(), metrics = new PresentMonMetrics(pid);
  let child, diagnostic = '', stopReason = null, forced = false, spawned = false, cleanupPromise = null;
  let tick, deadline, failsafe, abortListener, code = null, spawnFailure = false, exitConfirmed = false, cleanupAfterExit = false;
  let finishClose;
  const closed = new Promise(resolve => { finishClose = resolve; });
  const cleanup = () => cleanupPromise ||= new Promise(resolve => {
    const failure = { attempted: true, confirmed: false, reason: 'OWN_SESSION_CLEANUP_UNVERIFIED' };
    const timer = setTimeout(() => resolve(failure), 1500);
    Promise.resolve().then(() => cleanupSession(executable, sessionName)).then(result => { clearTimeout(timer); resolve(result); }, () => { clearTimeout(timer); resolve(failure); });
  });
  const killOwned = () => {
    if (!child) return;
    if (child.exitCode === null && child.signalCode === null && !child.killed) { forced = true; try { child.kill(); } catch {} }
  };
  const stop = reason => {
    if (stopReason) return; stopReason = reason;
    // Stop the owned collector before final session cleanup. Cleaning while it
    // is still starting can observe "absent", then race with a late ETW start.
    killOwned();
  };
  try {
    child = spawnProcess(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); spawned = true;
    child.stdout.on('data', chunk => {
      metrics.push(chunk);
      if (metrics.reason === 'OUTPUT_LIMIT' || metrics.reason === 'SWAPCHAIN_LIMIT') stop(metrics.reason);
    });
    child.stderr.on('data', chunk => {
      diagnostic = (diagnostic + chunk.toString()).slice(-32768);
      if (Buffer.byteLength(chunk) > 32768) stop('DIAGNOSTIC_LIMIT');
    });
    child.on('error', () => {
      if (!child.pid) { spawnFailure = true; finishClose(); }
      else stop('COLLECTOR_EXIT_FAILED');
    });
    child.on('close', exitCode => { code = exitCode; exitConfirmed = true; finishClose(); });
    abortListener = () => stop('TARGET_CHANGED'); signal?.addEventListener('abort', abortListener, { once: true });
    if (signal?.aborted) stop('TARGET_CHANGED');
    tick = setInterval(() => { if (!current()) stop('TARGET_CHANGED'); }, 200);
    deadline = setTimeout(() => stop('TIME_BUDGET_REACHED'), durationSeconds * 1000 + 1800);
    failsafe = setTimeout(() => { stop('TIME_BUDGET_REACHED'); killOwned(); child.stdout.destroy(); child.stderr.destroy(); child.unref?.(); finishClose(); }, durationSeconds * 1000 + 3800);
    await closed;
  } catch { spawnFailure = true; }
  finally {
    clearInterval(tick); clearTimeout(deadline); clearTimeout(failsafe);
    signal?.removeEventListener('abort', abortListener);
    if (spawned && !spawnFailure && classifyDiagnostic(diagnostic) !== 'ETW_SESSION_CONFLICT') {
      cleanupAfterExit = exitConfirmed;
      await cleanup();
    }
    killOwned();
    child?.stdout?.destroy(); child?.stderr?.destroy();
  }
  const frames = metrics.finish(), diagnosticReason = classifyDiagnostic(diagnostic), cpu = process.cpuUsage(cpuBefore);
  let cleanupResult = cleanupPromise ? await cleanupPromise : { attempted: false, confirmed: !spawned || spawnFailure, reason: null };
  // A timeout releases the caller but is not evidence that the collector died.
  // Without that proof a successful stop-session response can still race startup.
  if (spawned && !spawnFailure && !cleanupAfterExit) cleanupResult = { ...cleanupResult, confirmed: false,
    reason: exitConfirmed ? 'OWN_SESSION_CLEANUP_UNVERIFIED' : 'COLLECTOR_EXIT_UNVERIFIED' };
  const frameReason = frames.reason === 'NO_CSV_HEADER' ? 'NO_TARGET_FRAMES' : frames.reason;
  const reason = spawnFailure ? 'COLLECTOR_START_FAILED' : stopReason || diagnosticReason || (code !== 0 ? 'COLLECTOR_EXIT_FAILED' : frameReason) || (!cleanupResult.confirmed ? 'OWN_SESSION_CLEANUP_UNVERIFIED' : null);
  return { status: reason ? 'unavailable' : 'measured', reason: reason || null, durationRequestedSeconds: durationSeconds,
    elapsedMs: Math.round(performance.now() - began), collectorStarted: spawned, collectorExitCode: code,
    collectorExitConfirmed: exitConfirmed, forcedTermination: forced, etwCleanup: cleanupResult, frames,
    probeCpuMs: { user: Math.round(cpu.user / 1000), system: Math.round(cpu.system / 1000) },
    scope: isolation ? 'owned-non-rendering-process' : 'foreground-league-process',
    privacy: { rawCsvSaved: false, etlSaved: false, imagesCaptured: false, inputTracking: false, targetIdentifiersSaved: false } };
}
module.exports = { buildArgs, classifyDiagnostic, runPresentMon };
