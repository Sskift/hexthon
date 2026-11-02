const path = require('node:path');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');

const emptySnapshot = () => ({ game: null, client: null, cursor: { x: 0, y: 0, active: false, leftDown: false, leftPressed: false, pressId: 0 }, observedAt: null });

// This helper reads window geometry and physical mouse-button state only. It
// never activates a window, installs a hook, or sends input to any process.
class WindowMonitor extends EventEmitter {
  constructor({ intervalMs = 60, restartMs = 3000 } = {}) {
    super(); this.intervalMs = Math.max(40, Math.min(1000, intervalMs)); this.restartMs = restartMs;
    this.latest = emptySnapshot(); this.child = null; this.running = false; this.restartTimer = null;
  }
  start() {
    if (this.running) return this;
    this.running = true; this.launch(); return this;
  }
  launch() {
    if (!this.running || process.platform !== 'win32') return;
    const script = path.resolve(__dirname, '../native/window-monitor.ps1');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-IntervalMs', String(this.intervalMs), '-ParentProcessId', String(process.pid)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child; let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (!this.running || this.child !== child) return;
      buffer += chunk;
      if (buffer.length > 1024 * 1024) { buffer = ''; return; }
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim().replace(/^\uFEFF/, ''); buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try {
          const next = JSON.parse(line);
          if (!next.cursor || typeof next.observedAt !== 'string') continue;
          const old = this.latest;
          this.latest = next;
          this.emit('update', next);
          if (next.cursor.leftPressed || next.cursor.leftDown !== old.cursor.leftDown || next.cursor.active !== old.cursor.active ||
              next.cursor.x !== old.cursor.x || next.cursor.y !== old.cursor.y) this.emit('pointer', next.cursor, next);
        } catch { /* Ignore malformed helper output; never evaluate it. */ }
      }
    });
    // Avoid surfacing arbitrary process paths in diagnostic text.
    child.stderr.on('data', () => this.emit('status', { connected: false, message: '窗口监控暂不可用，将自动重试' }));
    child.on('error', () => this.emit('status', { connected: false, message: '无法启动后台窗口监控' }));
    child.on('close', () => {
      // A stopped helper may finish after a new start. Ignore its late close.
      if (this.child !== child) return;
      this.child = null;
      this.latest = emptySnapshot(); this.emit('update', this.latest);
      if (this.running) { this.restartTimer = setTimeout(() => this.launch(), this.restartMs); this.restartTimer.unref(); }
    });
  }
  stop() {
    this.running = false; clearTimeout(this.restartTimer);
    if (this.child) this.child.kill(); this.child = null;
    this.latest = emptySnapshot();
  }
}
module.exports = { WindowMonitor, emptySnapshot };
