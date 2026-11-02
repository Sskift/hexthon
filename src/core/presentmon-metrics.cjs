// Consumes the official PresentMon v1 CSV schema from a pipe. Raw CSV,
// application names, PIDs and swap-chain addresses never enter the report.
const round = value => Math.round(value * 1000) / 1000;
function csvLine(text) {
  const result = []; let field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { result.push(field); field = ''; }
    else field += c;
  }
  if (quoted) return null;
  result.push(field); return result;
}
function intervalStats(values) {
  const sorted = values.filter(v => Number.isFinite(v) && v > 0 && v <= 60000).slice().sort((a, b) => a - b);
  if (!sorted.length) return { samples: 0, meanMs: null, p50Ms: null, p95Ms: null, p99Ms: null, maxMs: null, meanFps: null };
  const mean = sorted.reduce((sum, n) => sum + n, 0) / sorted.length;
  const percentile = p => round(sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]);
  return { samples: sorted.length, meanMs: round(mean), p50Ms: percentile(.5), p95Ms: percentile(.95),
    p99Ms: percentile(.99), maxMs: round(sorted.at(-1)), meanFps: round(1000 / mean) };
}
class PresentMonMetrics {
  constructor(pid, { maxRows = 50000, maxBytes = 16 * 1024 * 1024 } = {}) {
    if (!Number.isSafeInteger(pid) || pid < 1 || pid > 0xffffffff) throw new Error('PRESENTMON_TARGET_PID');
    this.pid = pid; this.maxRows = maxRows; this.maxBytes = maxBytes;
    this.buffer = ''; this.bytes = 0; this.columns = null; this.groups = new Map();
    this.targetRows = 0; this.foreignRows = 0; this.invalidRows = 0; this.reason = null;
  }
  push(chunk) {
    if (this.reason === 'OUTPUT_LIMIT') return;
    this.bytes += Buffer.byteLength(chunk);
    if (this.bytes > this.maxBytes) { this.reason = 'OUTPUT_LIMIT'; this.buffer = ''; return; }
    this.buffer += chunk.toString();
    let newline;
    while ((newline = this.buffer.indexOf('\n')) >= 0) { this.line(this.buffer.slice(0, newline).replace(/\r$/, '').replace(/^\uFEFF/, '')); this.buffer = this.buffer.slice(newline + 1); }
    if (this.buffer.length > 8192) { this.reason = 'OUTPUT_LIMIT'; this.buffer = ''; }
  }
  line(text) {
    if (!text.trim()) return;
    const values = csvLine(text);
    if (!values) { this.invalidRows++; return; }
    if (values.includes('ProcessID') && values.includes('Application')) {
      this.columns = new Map(values.map((value, index) => [value, index]));
      if (!this.columns.has('MsBetweenPresents') || !this.columns.has('SwapChainAddress')) this.reason = 'UNSUPPORTED_CSV_SCHEMA';
      return;
    }
    if (!this.columns || this.reason) return;
    const get = key => values[this.columns.get(key)], rawPid = get('ProcessID');
    if (!/^\d+$/.test(rawPid || '')) { this.invalidRows++; return; }
    if (Number(rawPid) !== this.pid) { this.foreignRows++; return; }
    if (this.targetRows >= this.maxRows) { this.reason = 'OUTPUT_LIMIT'; return; }
    this.targetRows++;
    const swap = get('SwapChainAddress');
    if (!/^(?:0x)?[0-9a-f]{1,32}$/i.test(swap || '')) { this.invalidRows++; return; }
    if (!this.groups.has(swap)) {
      if (this.groups.size >= 32) { this.reason = 'SWAPCHAIN_LIMIT'; return; }
      this.groups.set(swap, { frames: 0, dropped: 0, unknownDropStatus: 0, present: [], display: [] });
    }
    const group = this.groups.get(swap); group.frames++;
    const dropStatus = get('Dropped') || '';
    const dropped = /^(?:1|true)$/i.test(dropStatus), displayed = /^(?:0|false)$/i.test(dropStatus);
    if (dropped) group.dropped++;
    if (!dropped && !displayed) group.unknownDropStatus++;
    const present = Number(get('MsBetweenPresents')), display = Number(get('MsBetweenDisplayChange'));
    if (Number.isFinite(present) && present > 0 && present <= 60000) group.present.push(present);
    if (displayed && Number.isFinite(display) && display > 0 && display <= 60000) group.display.push(display);
  }
  finish() {
    if (this.buffer) this.line(this.buffer.replace(/\r$/, '')); this.buffer = '';
    const groups = [...this.groups.values()].sort((a, b) => b.present.length - a.present.length || b.frames - a.frames);
    const primary = groups[0], targetFrames = groups.reduce((sum, group) => sum + group.frames, 0);
    const reason = this.reason || (!this.columns ? 'NO_CSV_HEADER' : !this.targetRows ? 'NO_TARGET_FRAMES' : !primary || primary.present.length < 30 ? 'INSUFFICIENT_TARGET_FRAMES' : null);
    return { available: !reason, reason, targetFrames, targetRowsSeen: this.targetRows, targetRowsDiscarded: this.targetRows - targetFrames, foreignRowsDiscarded: this.foreignRows,
      invalidRows: this.invalidRows, swapchainsSeen: groups.length, selectedSwapchainFrames: primary?.frames || 0,
      selectedSwapchainShare: targetFrames ? round((primary?.frames || 0) / targetFrames) : 0,
      droppedFrames: primary?.dropped || 0, unknownDropStatusFrames: primary?.unknownDropStatus || 0,
      presentIntervalsDiscarded: (primary?.frames || 0) - (primary?.present.length || 0),
      displayIntervalsDiscarded: (primary?.frames || 0) - (primary?.display.length || 0),
      presentIntervals: intervalStats(primary?.present || []), displayIntervals: intervalStats(primary?.display || []),
      interpretation: 'FPS is 1000 divided by mean interval for the dominant target swapchain; this is a short observation, not an assistant on/off comparison.' };
  }
}
module.exports = { PresentMonMetrics, csvLine, intervalStats };
