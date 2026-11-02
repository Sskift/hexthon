// Windows-only synthetic shop integration check. No game capture or network.
// Run: node scripts/check-light-shop-offline.cjs
const path = require('node:path');
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  require('node:child_process').execFile(require('electron'), [__filename], { env, windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
    if (stdout) process.stdout.write(stdout);
    if (error) { if (!stdout.trim()) process.stderr.write('Offline shop check could not finish.\n'); process.exitCode = 1; }
  });
} else {
  const { app, BrowserWindow, nativeImage, session } = require('electron');
  const fs = require('node:fs/promises');
  const assert = require('node:assert/strict');
  const light = require('../src/core/light-shop.cjs');
  const { OcrReader } = require('../src/core/ocr.cjs');
  const root = path.resolve(__dirname, '..'), qa = path.join(root, '.qa', 'light-shop-offline');
  app.disableHardwareAcceleration(); app.setPath('userData', path.join(qa, 'profile'));
  globalThis.fetch = async () => { throw new Error('OFFLINE_NETWORK_DISABLED'); };
  let renderer, reader;
  const pixels = image => ({ ...image.getSize(), bgraBuffer: image.toBitmap() });
  function crop(image, region) {
    const size = image.getSize();
    return image.crop({ x: Math.round(region.x * size.width), y: Math.round(region.y * size.height), width: Math.round(region.width * size.width), height: Math.round(region.height * size.height) });
  }
  app.whenReady().then(async () => {
    assert.equal(process.platform, 'win32'); await fs.mkdir(qa, { recursive: true });
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    renderer = new BrowserWindow({ show: false, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    await renderer.loadURL('data:text/html,<meta charset="utf-8"><title>Offline synthetic shop</title>');
    reader = new OcrReader(path.join(qa, 'unused-model-cache'));
    async function render(width, height, footer = true) {
      const png = await renderer.webContents.executeJavaScript(`(async () => {
        const w=${width},h=${height},canvas=new OffscreenCanvas(w,h),ctx=canvas.getContext('2d');
        ctx.fillStyle='#638d9d';ctx.fillRect(0,0,w,h);ctx.fillStyle='#0a1824';ctx.fillRect(w*.14,h*.15,w*.65,h*.66);
        ctx.fillStyle='#e5ddbe';ctx.font='600 '+Math.round(h*.025)+'px "Microsoft YaHei"';ctx.textBaseline='top';
        for(const [text,x] of [['推荐',.2],['所有物品',.33],['物品配置',.47]])ctx.fillText(text,w*x,h*.2);
        if(${footer})for(const [text,x] of [['出售',.22],['撤销',.3],['购买',.68]])ctx.fillText(text,w*x,h*.74);
        const blob=await canvas.convertToBlob({type:'image/png'});return await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.readAsDataURL(blob)});
      })()`);
      return nativeImage.createFromDataURL(png);
    }
    async function inspect(image, maxHeaders = 2, regionsOverride = null) {
      const size = image.getSize(), times = [], gates = [], output = { headerCandidates: 0, headerAccepted: 0, footerCandidates: 0, visible: false };
      for (const region of (regionsOverride || light.headerRegions(size.width, size.height)).slice(0, maxHeaders)) {
        const strip = crop(image, region), started = performance.now(), gated = light.pixelGate(pixels(strip)); gates.push(performance.now() - started);
        if (!gated.candidate) continue; output.headerCandidates++;
        const result = await reader.read(strip, { x: 0, y: 0, width: 1, height: 1 }, [], { allowSmall: true, allowFallback: false }); times.push(result.timings.totalMs);
        const header = light.headerEvidence(result, region); if (!header.candidate) continue; output.headerAccepted++;
        for (const footerRegion of light.footerRegions(header)) {
          const footer = crop(image, footerRegion), start = performance.now(), gate = light.pixelGate(pixels(footer)); gates.push(performance.now() - start);
          if (!gate.candidate) continue; output.footerCandidates++;
          const ocr = await reader.read(footer, { x: 0, y: 0, width: 1, height: 1 }, [], { allowSmall: true, allowFallback: false }); times.push(ocr.timings.totalMs);
          const shop = light.shopFromStrips(header, ocr, footerRegion);
          if (shop.visible) {
            const tightHeader = crop(image, shop.headerRegion), tightFooter = crop(image, shop.footerRegion);
            output.visible = true; output.navWords = shop.evidence.filter(e => e.type === 'nav').length;
            output.controlWords = shop.evidence.filter(e => e.type === 'control').length;
            output.tightHeaderCandidate = light.pixelGate(pixels(tightHeader)).candidate;
            output.tightFooterCandidate = light.pixelGate(pixels(tightFooter)).candidate;
            output.tightPixels = tightHeader.getSize().width * tightHeader.getSize().height + tightFooter.getSize().width * tightFooter.getSize().height;
            break;
          }
        }
        if (output.visible) break;
      }
      return { ...output, gateMs: gates.map(t => Number(t.toFixed(3))), ocrMs: times };
    }
    const cases = [];
    const mergedPrimary = [{ x: .1, y: .13, width: .8, height: .18 }];
    for (const [width, height] of [[1920, 1080], [2560, 1440], [1280, 720]]) {
      const image = await render(width, height), result = await inspect(image);
      await fs.writeFile(path.join(qa, `synthetic-${width}x${height}.png`), image.toPNG());
      cases.push({ size: { width, height }, synthetic: true, font: 'Microsoft YaHei', weight: 600, ...result, mergedPrimary: await inspect(image, 1, mergedPrimary) });
    }
    assert.equal(cases[0].visible, true, 'Known synthetic shop should be found from the first two header stripes.');
    assert.equal(cases[0].mergedPrimary.visible, true, 'Merged primary header should preserve the known synthetic shop.');
    const noFooter = await inspect(await render(1920, 1080, false)); assert.equal(noFooter.visible, false);
    const negatives = [];
    for (const name of ['game-current.png', 'shop.png']) {
      const image = nativeImage.createFromPath(path.join(root, '.qa', name)); if (image.isEmpty()) continue;
      const result = await inspect(image, 6); assert.equal(result.visible, false);
      const merged = image.getSize().width >= 640 ? await inspect(image, 1, mergedPrimary) : null;
      if (merged) assert.equal(merged.visible, false);
      negatives.push({ name, fixtureType: name === 'shop.png' ? 'assistant overlay, not game shop' : 'historical gameplay with shop closed', ...result, mergedPrimary: merged });
    }
    const report = { ok: true, method: 'Hidden synthetic canvas and optional pre-existing historical images; no capture/network. Only narrow strips are OCRed.',
      limitations: 'No real open-shop positive fixture is available. Search geometry, UI scale, localized labels, and actual in-game detection latency remain unverified.',
      cases, missingFooterRejected: !noFooter.visible, negatives, workerStarts: reader.nativeWorker?.starts || 0 };
    await fs.writeFile(path.join(qa, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
    await reader.close(); reader = null; renderer.destroy(); renderer = null; app.exit(0);
  }).catch(async error => {
    await reader?.close(); renderer?.destroy();
    console.log(JSON.stringify({ ok: false, error: error?.name === 'AssertionError' ? error.message.split('\n')[0] : 'Offline shop integration could not complete.' })); app.exit(1);
  });
}
