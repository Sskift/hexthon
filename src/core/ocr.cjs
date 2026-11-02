const path = require('node:path');
const fs = require('node:fs/promises');
const { gunzipSync } = require('node:zlib');
const { spawn } = require('node:child_process');
const { createWorker } = require('tesseract.js');
const { matchAugments } = require('./matching.cjs');

// Threshold the original title pixels before interpolation. Thick small glyphs
// can lose their counters during resizing; a second, lower threshold preserves
// weaker strokes. Percentiles adapt to brightness without changing source data.
function brightTextBitmap(bitmap, strength=.86){
  if(!Buffer.isBuffer(bitmap)||bitmap.length<64||bitmap.length%4)return null;
  const histogram=new Uint32Array(256),pixels=bitmap.length/4;
  for(let i=0;i<bitmap.length;i+=4)histogram[Math.round(.114*bitmap[i]+.587*bitmap[i+1]+.299*bitmap[i+2])]++;
  const percentile=fraction=>{let sum=0;for(let value=0;value<256;value++){sum+=histogram[value];if(sum>=Math.ceil(pixels*fraction))return value;}return 255;};
  const background=percentile(.5),foreground=percentile(.995);
  if(foreground<150||foreground-background<80)return null;
  const threshold=background+(foreground-background)*(Number.isFinite(strength)?Math.max(.7,Math.min(.95,strength)):.86);
  const output=Buffer.from(bitmap);
  for(let i=0;i<output.length;i+=4){const luma=.114*bitmap[i]+.587*bitmap[i+1]+.299*bitmap[i+2];output[i]=output[i+1]=output[i+2]=luma>=threshold?0:255;output[i+3]=255;}
  return output;
}

function normalizeOcrLines(lines, cropRect, croppedSize, originalSize) {
  const convert = value => {
    const box = value.bbox ? { x:value.bbox.x0, y:value.bbox.y0, width:value.bbox.x1-value.bbox.x0, height:value.bbox.y1-value.bbox.y0 } : value;
    if (![box.x,box.y,box.width,box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0) return null;
    return { text:String(value.text || ''), x:(cropRect.x + box.x * cropRect.width / croppedSize.width) / originalSize.width,
      y:(cropRect.y + box.y * cropRect.height / croppedSize.height) / originalSize.height,
      width:box.width * cropRect.width / croppedSize.width / originalSize.width,
      height:box.height * cropRect.height / croppedSize.height / originalSize.height };
  };
  return (lines || []).map(line => {
    const out=convert(line); if (!out) return null;
    if (Array.isArray(line.words)) out.words=line.words.map(convert).filter(Boolean);
    return out;
  }).filter(Boolean);
}

// One lazy Windows process owns its WinRT engine. The pipe transports a short
// JSON header followed by exactly width*height*4 BGRA bytes, so the hot path
// does not encode PNGs, write screenshots to disk, or start PowerShell per read.
class WindowsOcrWorker {
  constructor({ spawnProcess = spawn, timeoutMs = 15000, retryMs = 30000, now = Date.now } = {}) {
    this.spawnProcess=spawnProcess;this.timeoutMs=timeoutMs;this.retryMs=retryMs;this.now=now;
    this.child=null;this.pending=null;this.nextId=0;this.retryAt=0;this.closed=false;this.starts=0;
  }
  fail(child,error) {
    if(this.child!==child)return;
    this.child=null;this.retryAt=this.now()+this.retryMs;
    const pending=this.pending;this.pending=null;
    if(pending){clearTimeout(pending.timer);pending.reject(error);}
    try{child.stdin.destroy();child.kill();}catch{}
  }
  launch() {
    if(this.child)return this.child;
    const child=this.spawnProcess('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve(__dirname,'../native/ocr.ps1'),'-Worker'],
      {windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.child=child;this.starts++;let buffer='';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk=>{
      if(this.child!==child)return;
      buffer+=chunk;
      if(buffer.length>512000){this.fail(child,new Error('NATIVE_OCR_OUTPUT_LIMIT'));return;}
      let newline;
      while((newline=buffer.indexOf('\n'))!==-1){
        const line=buffer.slice(0,newline).trim().replace(/^\uFEFF/,'');buffer=buffer.slice(newline+1);
        if(!line)continue;
        let reply;try{reply=JSON.parse(line);}catch{this.fail(child,new Error('NATIVE_OCR_PROTOCOL'));return;}
        if(reply.ready===true)continue;
        const pending=this.pending;
        if(!pending||reply.id!==pending.id)continue;
        if(reply.ok!==true||typeof reply.text!=='string'||!Array.isArray(reply.lines)){
          this.fail(child,new Error('NATIVE_OCR_FAILED'));return;
        }
        clearTimeout(pending.timer);this.pending=null;pending.resolve(reply);
      }
    });
    // Drain stderr but do not forward image text, filesystem paths or arbitrary
    // native exceptions to the UI/logs. Exit/error still reject the active read.
    child.stderr.on('data',()=>{});
    child.stdin.on('error',()=>this.fail(child,new Error('NATIVE_OCR_PIPE')));
    child.on('error',()=>this.fail(child,new Error('NATIVE_OCR_START')));
    child.on('close',()=>this.fail(child,new Error('NATIVE_OCR_EXIT')));
    return child;
  }
  async recognize(bitmap,size) {
    if(this.closed)throw new Error('NATIVE_OCR_CLOSED');
    if(this.pending)throw new Error('NATIVE_OCR_BUSY');
    if(!Buffer.isBuffer(bitmap)||![size?.width,size?.height].every(n=>Number.isInteger(n)&&n>0&&n<=2200)||bitmap.length!==size.width*size.height*4)throw new Error('NATIVE_OCR_BITMAP');
    if(this.now()<this.retryAt)throw new Error('NATIVE_OCR_COOLDOWN');
    let child;try{child=this.launch();}catch{this.retryAt=this.now()+this.retryMs;throw new Error('NATIVE_OCR_START');}
    const id=++this.nextId;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>this.fail(child,new Error('NATIVE_OCR_TIMEOUT')),this.timeoutMs);
      this.pending={id,resolve,reject,timer};
      const header=JSON.stringify({id,width:size.width,height:size.height,byteLength:bitmap.length})+'\n';
      try{child.stdin.write(header);child.stdin.write(bitmap);}catch{this.fail(child,new Error('NATIVE_OCR_PIPE'));}
    });
  }
  async close() {
    if(this.closed)return;
    this.closed=true;
    if(this.child){
      const child=this.child;
      await new Promise(resolve=>{
        const timer=setTimeout(resolve,1000);
        child.once('close',()=>{clearTimeout(timer);resolve();});
        this.fail(child,new Error('NATIVE_OCR_CLOSED'));
      });
    }
  }
}

class OcrReader {
  constructor(cacheDir, onProgress = () => {}, bitmapFactory = null, options = {}) {
    this.cacheDir = cacheDir; this.onProgress = onProgress; this.bitmapFactory = bitmapFactory;
    this.worker = null; this.nativeWorker = options.nativeWorker || null; this.busy = false;this.closed=false;
    this.abortController=new AbortController();
  }
  async init() {
    if(this.closed)throw new Error('识别已关闭');
    if (!this.worker) {
      const models = path.join(this.cacheDir, 'lstm-v1');
      await fs.mkdir(models, { recursive: true });
      for (const language of ['chi_sim']) {
        const filename = path.join(models, language + '.traineddata');
        try { if ((await fs.stat(filename)).size > 100000) continue; } catch { /* First use. */ }
        this.onProgress(`首次使用：下载${language === 'chi_sim' ? '中文' : '英文'}识别模型…`);
        const url = `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${language}/4.0.0_best_int/${language}.traineddata.gz`;
        const response = await fetch(url, { signal: AbortSignal.any([AbortSignal.timeout(30000),this.abortController.signal]) });
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
      if(this.closed){await this.worker.terminate();this.worker=null;throw new Error('识别已关闭');}
      await this.worker.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1' });
    }
    return this.worker;
  }
  async read(image, region, augments, {allowSmall=false,allowFallback=true,scale=1.5,invert=false,brightText=false}={}) {
    if(this.closed)throw new Error('识别已关闭');
    if (this.busy) throw new Error('识别正在进行，请稍候');
    this.busy = true;const started=performance.now(),capturedAt=new Date().toISOString();
    try {
      const size = image.getSize();
      if (size.width < (allowSmall?32:400) || size.height < (allowSmall?16:250)) throw new Error('识别区域尺寸过小');
      const rect = { x: Math.floor(size.width * region.x), y: Math.floor(size.height * region.y),
        width: Math.floor(size.width * region.width), height: Math.floor(size.height * region.height) };
      let cropped = image.crop(rect);
      const cropSize = cropped.getSize();
      if(brightText&&this.bitmapFactory){
        const bitmap=brightTextBitmap(cropped.toBitmap(),typeof brightText==='number'?brightText:.86);
        if(bitmap)cropped=this.bitmapFactory(bitmap,cropSize);
      }
      // Small Chinese title strokes can be split into radicals by Windows OCR.
      // Enlarge the actual card crop before recognition, with the same cap used
      // for large captures. normalizeOcrLines maps the scaled boxes back.
      const ratio = Math.min(Number.isFinite(scale)?Math.max(1,Math.min(4,scale)):1.5, 2200 / Math.max(cropSize.width, cropSize.height));
      if (ratio !== 1) {
        cropped = cropped.resize({ width: Math.round(cropSize.width * ratio), height: Math.round(cropSize.height * ratio) });
      }
      if(invert&&this.bitmapFactory){
        const bitmap=Buffer.from(cropped.toBitmap());
        for(let i=0;i<bitmap.length;i+=4){bitmap[i]=255-bitmap[i];bitmap[i+1]=255-bitmap[i+1];bitmap[i+2]=255-bitmap[i+2];}
        cropped=this.bitmapFactory(bitmap,cropped.getSize());
      }
      const cropMs=performance.now()-started;
      if (process.platform === 'win32') {
        this.onProgress('正在使用 Windows 中文识别…');
        try {
          this.nativeWorker??=new WindowsOcrWorker();
          const nativeStart=performance.now();
          const data=await this.nativeWorker.recognize(cropped.toBitmap(),cropped.getSize());
          return { text: data.text.slice(0, 5000), matches: matchAugments(data.text, augments), engine: 'windows',
            lines: normalizeOcrLines(data.lines, rect, cropped.getSize(), size), sourceSize: size,
            engineConfidence: null, capturedAt,
            timings:{cropMs:Math.round(cropMs),nativeMs:Math.round(performance.now()-nativeStart),engineMs:data.recognitionMs??null,totalMs:Math.round(performance.now()-started),workerStarts:this.nativeWorker.starts??null} };
        } catch {
          if(this.closed)throw new Error('识别已关闭');
          if(!allowFallback)throw new Error('Windows 中文识别暂不可用；轻量模式等待恢复');
          this.onProgress('Windows 中文识别不可用，尝试备用识别模型…');
        }
      }
      if(!allowFallback)throw new Error('轻量模式需要 Windows 中文识别');
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
      const { data } = await worker.recognize(cropped.toPNG(), {}, { text: true, blocks: true });
      const lines = (data.blocks || []).flatMap(block => (block.paragraphs || []).flatMap(paragraph => paragraph.lines || []));
      return { text: data.text.slice(0, 5000), matches: matchAugments(data.text, augments),
        lines: normalizeOcrLines(lines, rect, cropped.getSize(), size), sourceSize: size,
        engine: 'tesseract', engineConfidence: Math.round(data.confidence), capturedAt,
        timings:{cropMs:Math.round(cropMs),totalMs:Math.round(performance.now()-started)} };
    } finally { this.busy = false; }
  }
  async close() { this.closed=true;this.abortController.abort();await this.nativeWorker?.close();if (this.worker) await this.worker.terminate(); this.worker = null; }
}
module.exports = { OcrReader, WindowsOcrWorker, normalizeOcrLines, brightTextBitmap };
