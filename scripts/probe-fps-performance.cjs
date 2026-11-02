// Bounded, target-PID-only PresentMon console probe. No screenshot, injection,
// input tracking, installer/service/driver, elevation, or assistant startup.
// Prepare once: node scripts/prepare-presentmon.cjs
// Live: node scripts/probe-fps-performance.cjs --seconds=10
// No rendering target: node scripts/probe-fps-performance.cjs --isolation
const path = require('node:path');
const fs = require('node:fs/promises');
const { WindowMonitor } = require('../src/core/window-monitor.cjs');
const { visualContext, isCurrentVisualContext } = require('../src/core/visual-context.cjs');
const { buildArgs, runPresentMon } = require('../src/core/presentmon-probe.cjs');
const { VERSION, EXECUTABLE, verifyTool } = require('./prepare-presentmon.cjs');

function options(args) {
  if (args.some(arg => !['--dry-run', '--isolation'].includes(arg) && !/^--seconds=\d+$/.test(arg))) throw new Error('PRESENTMON_ARGUMENT');
  const isolation = args.includes('--isolation');
  const seconds = Number(args.find(arg => arg.startsWith('--seconds='))?.split('=')[1] || (isolation ? 1 : 10));
  buildArgs({ pid: isolation ? process.pid : 1, durationSeconds: seconds, isolation, sessionName: 'HexthonFPS-00000000-0000-0000-0000-000000000000' });
  return { isolation, seconds, dryRun: args.includes('--dry-run') };
}
async function readForeground(monitor) {
  return new Promise(resolve => {
    const finish = snapshot => { clearTimeout(timer); monitor.removeListener('update', listener); resolve(snapshot); };
    const listener = snapshot => { if (snapshot?.observedAt) finish(snapshot); };
    const timer = setTimeout(() => finish(null), 2500);
    monitor.on('update', listener); monitor.start();
  });
}
async function closeMonitor(monitor) {
  if (!monitor) return;
  const child = monitor.child;
  const closed = child ? new Promise(resolve => {
    const timer = setTimeout(resolve, 1000); child.once('close', () => { clearTimeout(timer); resolve(); });
  }) : Promise.resolve();
  monitor.stop(); await closed;
  child?.stdout?.destroy(); child?.stderr?.destroy();
}
function targetIsCurrent(context, snapshot, now = Date.now()) {
  const observedAt = Date.parse(snapshot?.observedAt);
  return Number.isFinite(observedAt) && observedAt <= now + 250 && now - observedAt <= 1000 &&
    isCurrentVisualContext(context, snapshot?.game);
}
async function main(args = process.argv.slice(2)) {
  const parsed = options(args);
  if (parsed.dryRun) return { status: 'dry-run', version: VERSION, helpersStarted: 0, traceStarted: false, filesWritten: 0,
    durationSeconds: parsed.seconds, target: parsed.isolation ? 'owned-non-rendering-process' : 'foreground-league-process', noRawFiles: true };
  let monitor;
  let report = { status: 'unavailable', reason: 'WINDOWS_REQUIRED', collectorStarted: false, frames: null };
  try {
    if (process.platform !== 'win32') return report;
    if (!await verifyTool()) return { ...report, reason: 'PRESENTMON_NOT_PREPARED_OR_HASH_MISMATCH' };
    let context = null;
    if (!parsed.isolation) {
      monitor = new WindowMonitor({ intervalMs: 200, restartMs: 60000 });
      const snapshot = await readForeground(monitor); context = visualContext(snapshot?.game, true);
      if (!context?.foreground || !context.visible || context.minimized) return { ...report, reason: snapshot ? 'NO_FOREGROUND_LEAGUE' : 'WINDOW_MONITOR_UNAVAILABLE' };
    }
    report = await runPresentMon({ executable: EXECUTABLE, pid: parsed.isolation ? process.pid : context.pid,
      durationSeconds: parsed.seconds, isolation: parsed.isolation,
      isCurrent: parsed.isolation ? () => true : () => targetIsCurrent(context, monitor.latest) });
    return { ...report, collectorVersion: VERSION, officialHashVerified: true };
  } finally { await closeMonitor(monitor); }
}
if (require.main === module) main().then(async report => {
  if (report.status !== 'dry-run') {
    const out = path.resolve(__dirname, '../.qa', process.argv.includes('--isolation') ? 'fps-isolation.json' : 'fps-performance.json');
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify(report));
  // Unavailable measurements are valid diagnostics, never a passing FPS result.
}).catch(error => { console.error(/^PRESENTMON_/.test(error.message) ? error.message : 'FPS_PROBE_FAILED'); process.exitCode = 1; });
module.exports = { options, main, targetIsCurrent };
