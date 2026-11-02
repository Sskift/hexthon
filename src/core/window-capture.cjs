const path = require('node:path');
const { spawn } = require('node:child_process');

const MAX_DIMENSION = 2200;
const MAX_BYTES = MAX_DIMENSION * MAX_DIMENSION * 4;
const MAX_HEADER = 8192;
const ERROR_CODES = new Set(['WINDOW_UNAVAILABLE','NOT_LEAGUE','NOT_FOREGROUND','NOT_VISIBLE','MINIMIZED',
  'WINDOW_CHANGED','OFFSCREEN','DPI_UNAVAILABLE','CAPTURE_LIMIT','REQUEST_INVALID','CAPTURE_FAILED']);
const rectangle = value => ({ x: value.x, y: value.y, width: value.width, height: value.height });

function validateCaptureRequest({ hwnd, region = { x: 0, y: 0, width: 1, height: 1 }, maxWidth = 1600 } = {}) {
  const handle = typeof hwnd === 'number' && Number.isSafeInteger(hwnd) ? String(hwnd) : hwnd;
  if (typeof handle !== 'string' || !/^\d{1,19}$/.test(handle) || BigInt(handle) <= 0n || BigInt(handle) > 9223372036854775807n) throw new Error('WINDOW_CAPTURE_HWND');
  if (!region || !['x','y','width','height'].every(key => typeof region[key] === 'number' && Number.isFinite(region[key])) ||
    region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0 ||
    region.x + region.width > 1 || region.y + region.height > 1) throw new Error('WINDOW_CAPTURE_REGION');
  if (!Number.isInteger(maxWidth) || maxWidth < 1 || maxWidth > MAX_DIMENSION) throw new Error('WINDOW_CAPTURE_SIZE');
  return { hwnd: BigInt(handle).toString(), region: { x: region.x, y: region.y, width: region.width, height: region.height }, maxWidth };
}

// Each frame is [uint32 little-endian JSON length][UTF-8 JSON][BGRA bytes].
// Request frames have no BGRA body. Reply JSON declares byteLength and dimensions.
class ByteQueue {
  constructor() { this.chunks = []; this.length = 0; }
  push(chunk) { this.chunks.push(chunk); this.length += chunk.length; }
  read(size) {
    if (this.length < size) return null;
    if (!size) return Buffer.alloc(0);
    const first = this.chunks[0];
    if (first.length >= size) {
      const value = first.subarray(0, size);
      if (first.length === size) this.chunks.shift(); else this.chunks[0] = first.subarray(size);
      this.length -= size; return value;
    }
    const value = Buffer.allocUnsafe(size); let copied = 0;
    while (copied < size) {
      const part = this.chunks[0], count = Math.min(part.length, size - copied);
      part.copy(value, copied, 0, count); copied += count;
      if (count === part.length) this.chunks.shift(); else this.chunks[0] = part.subarray(count);
    }
    this.length -= size; return value;
  }
}

function validReply(reply, request) {
  if (!reply || !Number.isInteger(reply.id) || reply.id !== request.id || typeof reply.ok !== 'boolean') return false;
  if (!Number.isInteger(reply.byteLength) || reply.byteLength < 0 || reply.byteLength > MAX_BYTES) return false;
  if (!reply.ok) return reply.byteLength === 0;
  if (reply.hwnd !== request.hwnd || !Number.isInteger(reply.pid) || reply.pid <= 0 ||
    !Number.isInteger(reply.width) || !Number.isInteger(reply.height) || reply.width < 1 || reply.height < 1 ||
    reply.width > request.maxWidth || reply.height > MAX_DIMENSION || reply.byteLength !== reply.width * reply.height * 4 ||
    !Number.isInteger(reply.dpi) || reply.dpi < 48 || reply.dpi > 960 ||
    typeof reply.capturedAt !== 'string' || !Number.isFinite(Date.parse(reply.capturedAt))) return false;
  const client = reply.clientRect, pixel = reply.pixelRegion, region = reply.region;
  if (!client || !pixel || !region || !['x','y','width','height'].every(k => Number.isInteger(client[k]) && Number.isInteger(pixel[k]))) return false;
  if (Math.abs(client.x) > 100000 || Math.abs(client.y) > 100000 || client.width < 1 || client.height < 1 || client.width > 16384 || client.height > 16384 ||
    pixel.x < 0 || pixel.y < 0 || pixel.width < 1 || pixel.height < 1 || pixel.x + pixel.width > client.width || pixel.y + pixel.height > client.height ||
    reply.width > pixel.width || reply.height > pixel.height) return false;
  const expected = {
    x: Math.floor(request.region.x * client.width), y: Math.floor(request.region.y * client.height),
    width: Math.min(client.width, Math.ceil((request.region.x + request.region.width) * client.width)) - Math.floor(request.region.x * client.width),
    height: Math.min(client.height, Math.ceil((request.region.y + request.region.height) * client.height)) - Math.floor(request.region.y * client.height),
  };
  if (!Object.keys(expected).every(k => pixel[k] === expected[k])) return false;
  return ['x','y','width','height'].every(k => Number.isFinite(region[k]) && Math.abs(region[k] - pixel[k] / (k === 'x' || k === 'width' ? client.width : client.height)) < 1e-7);
}

class WindowCapture {
  constructor({ timeoutMs = 6000, retryMs = 3000, spawnProcess = spawn, now = Date.now } = {}) {
    this.timeoutMs = Math.max(50, Math.min(15000, timeoutMs)); this.retryMs = Math.max(0, retryMs);
    this.spawnProcess = spawnProcess; this.now = now; this.child = null; this.pending = null;
    this.nextId = 0; this.closed = false; this.retryAt = 0; this.starts = 0;
  }
  fail(child, error) {
    if (this.child !== child) return;
    this.child = null; this.retryAt = this.now() + this.retryMs;
    const pending = this.pending; this.pending = null;
    if (pending) { clearTimeout(pending.timer); pending.reject(error); }
    try { child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.kill(); } catch {}
  }
  launch() {
    if (this.child) return this.child;
    const child = this.spawnProcess('powershell.exe', ['-NoProfile','-NonInteractive','-File',path.resolve(__dirname,'../native/window-capture.ps1')],
      { windowsHide: true, stdio: ['pipe','pipe','pipe'] });
    this.child = child; this.starts++;
    const queue = new ByteQueue(); let headerLength = null, reply = null;
    child.stdout.on('data', chunk => {
      if (this.child !== child) return;
      if (!Buffer.isBuffer(chunk) || queue.length + chunk.length > MAX_BYTES + MAX_HEADER + 4) { this.fail(child, new Error('WINDOW_CAPTURE_OUTPUT_LIMIT')); return; }
      queue.push(chunk);
      while (this.child === child) {
        if (headerLength === null) {
          const prefix = queue.read(4); if (!prefix) break;
          headerLength = prefix.readUInt32LE(0);
          if (headerLength < 2 || headerLength > MAX_HEADER) { this.fail(child, new Error('WINDOW_CAPTURE_PROTOCOL')); break; }
        }
        if (reply === null) {
          const json = queue.read(headerLength); if (!json) break;
          try { reply = JSON.parse(json.toString('utf8')); } catch { this.fail(child, new Error('WINDOW_CAPTURE_PROTOCOL')); break; }
          if (!this.pending || !validReply(reply, this.pending.request)) { this.fail(child, new Error('WINDOW_CAPTURE_PROTOCOL')); break; }
        }
        const bgraBuffer = queue.read(reply.byteLength); if (!bgraBuffer) break;
        const pending = this.pending; this.pending = null; clearTimeout(pending.timer);
        if (reply.ok) {
          // Return only geometry and pixels, never arbitrary helper fields.
          pending.resolve({ width: reply.width, height: reply.height, bgraBuffer,
            hwnd: reply.hwnd, pid: reply.pid, capturedAt: reply.capturedAt, dpi: reply.dpi,
            clientRect: rectangle(reply.clientRect), pixelRegion: rectangle(reply.pixelRegion), region: rectangle(reply.region),
            durationMs: Number.isFinite(reply.durationMs) && reply.durationMs >= 0 ? reply.durationMs : null });
        } else pending.reject(new Error(`WINDOW_CAPTURE_${ERROR_CODES.has(reply.error) ? reply.error : 'CAPTURE_FAILED'}`));
        headerLength = null; reply = null;
        if (!queue.length) break;
      }
    });
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => this.fail(child, new Error('WINDOW_CAPTURE_PIPE')));
    child.on('error', () => this.fail(child, new Error('WINDOW_CAPTURE_START')));
    child.on('close', () => this.fail(child, new Error('WINDOW_CAPTURE_EXIT')));
    return child;
  }
  async capture(options) {
    if (this.closed) throw new Error('WINDOW_CAPTURE_CLOSED');
    if (this.pending) throw new Error('WINDOW_CAPTURE_BUSY');
    const request = { id: ++this.nextId, ...validateCaptureRequest(options) };
    if (this.now() < this.retryAt) throw new Error('WINDOW_CAPTURE_COOLDOWN');
    let child;
    try { child = this.launch(); } catch { this.retryAt = this.now() + this.retryMs; throw new Error('WINDOW_CAPTURE_START'); }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(child, new Error('WINDOW_CAPTURE_TIMEOUT')), this.timeoutMs);
      this.pending = { request, resolve, reject, timer };
      const json = Buffer.from(JSON.stringify(request)); const prefix = Buffer.alloc(4); prefix.writeUInt32LE(json.length);
      try { child.stdin.write(Buffer.concat([prefix, json])); } catch { this.fail(child, new Error('WINDOW_CAPTURE_PIPE')); }
    });
  }
  async close() {
    if (this.closed) return; this.closed = true;
    const child = this.child; if (!child) return;
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 1000);
      child.once('close', () => { clearTimeout(timer); resolve(); });
      this.fail(child, new Error('WINDOW_CAPTURE_CLOSED'));
    });
  }
}

module.exports = { WindowCapture, validateCaptureRequest, MAX_DIMENSION };
