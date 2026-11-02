const path = require('node:path');
const fs = require('node:fs/promises');
const { gunzipSync } = require('node:zlib');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const { createWorker } = require('tesseract.js');
const { matchAugments } = require('./matching.cjs');

class OcrReader {
  constructor(cacheDir, onProgress = () => {}, bitmapFactory = null) { this.cacheDir = cacheDir; this.onProgress = onProgress; this.bitmapFactory = bitmapFactory; this.worker = null; this.busy = false; }
  async init() {
    if (!this.worker) {
      const models = path.join(this.cacheDir, 'lstm-v1');
      await fs.mkdir(models, { recursive: true });
      for (const language of ['chi_sim']) {
        const filename = path.join(models, language + '.traineddata');
        try { if ((await fs.stat(filename)).size > 100000) continue; } catch { /* First use. */ }
        this.onProgress(`首次使用：下载${language === 'chi_sim' ? '中文' : '英文'}识别模型…`);
        const url = `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${language}/4.0.0_best_int/${language}.traineddata.gz`;
        const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error('识别模型暂不可用，请稍后重试');
        const compressed = Buffer.from(await response.arrayBuffer());
        if (compressed.length > 10 * 1024 * 1024) throw new Error('识别模型超过大小限制');
        const model = gunzipSync(compressed, { maxOutputLength: 32 * 1024 * 1024 });
        await fs.writeFile(filename + '.tmp', model);
        await fs.rename(filename + '.tmp', filename);
      }
      this.worker = await createWorker('chi_sim', 1, {
        cachePath: models, langPath: models, gzip: false, cacheMethod: 'readOnly',
        // Models are local before the worker starts. Captured images are never uploaded.
        logger: m => this.onProgress(m.status === 'recognizing text' ? '正在识别符文名称…' : '正在初始化本地文字识别…'),
        errorHandler: () => {},
      });
      await this.worker.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1' });
    }
    return this.worker;
  }
  async read(image, region, augments) {
    if (this.busy) throw new Error('识别正在进行，请稍候');
    this.busy = true;
    try {
      const size = image.getSize();
      if (size.width < 400 || size.height < 250) throw new Error('游戏画面尺寸过小，请使用无边框或窗口模式');
      const rect = { x: Math.floor(size.width * region.x), y: Math.floor(size.height * region.y),
        width: Math.floor(size.width * region.width), height: Math.floor(size.height * region.height) };
      let cropped = image.crop(rect);
      const cropSize = cropped.getSize();
      if (Math.max(cropSize.width, cropSize.height) > 2200) {
        const ratio = 2200 / Math.max(cropSize.width, cropSize.height);
        cropped = cropped.resize({ width: Math.round(cropSize.width * ratio), height: Math.round(cropSize.height * ratio) });
      }
      if (process.platform === 'win32') {
        this.onProgress('正在使用 Windows 中文识别…');
        const filename = path.join(this.cacheDir, randomUUID() + '.png');
        try {
          await fs.mkdir(this.cacheDir, { recursive: true });
          await fs.writeFile(filename, cropped.toPNG());
          const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve(__dirname, '../native/ocr.ps1'), '-ImagePath', filename], { windowsHide: true, timeout: 15000, maxBuffer: 256000 });
          const data = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
          return { text: data.text.slice(0, 5000), matches: matchAugments(data.text, augments), engine: 'windows',
            engineConfidence: null, capturedAt: new Date().toISOString() };
        } catch {
          this.onProgress('Windows 中文识别不可用，尝试备用识别模型…');
        } finally { await fs.unlink(filename).catch(() => {}); }
      }
      // Game cards usually have light text on dark backgrounds. Normalize polarity
      // and contrast before OCR; nativeImage uses BGRA on this Windows target.
      if (this.bitmapFactory) {
        const bitmap = Buffer.from(cropped.toBitmap());
        let total = 0, count = 0;
        for (let i = 0; i < bitmap.length; i += 64) { total += (bitmap[i] + bitmap[i + 1] + bitmap[i + 2]) / 3; count++; }
        const invert = total / count < 128;
        for (let i = 0; i < bitmap.length; i += 4) {
          let gray = Math.round(.114 * bitmap[i] + .587 * bitmap[i + 1] + .299 * bitmap[i + 2]);
          if (invert) gray = 255 - gray;
          gray = Math.max(0, Math.min(255, (gray - 128) * 1.5 + 128));
          bitmap[i] = bitmap[i + 1] = bitmap[i + 2] = gray; bitmap[i + 3] = 255;
        }
        cropped = this.bitmapFactory(bitmap, cropped.getSize());
      }
      const worker = await this.init();
      const { data } = await worker.recognize(cropped.toPNG());
      return { text: data.text.slice(0, 5000), matches: matchAugments(data.text, augments),
        engine: 'tesseract', engineConfidence: Math.round(data.confidence), capturedAt: new Date().toISOString() };
    } finally { this.busy = false; }
  }
  async close() { if (this.worker) await this.worker.terminate(); this.worker = null; }
}
module.exports = { OcrReader };
