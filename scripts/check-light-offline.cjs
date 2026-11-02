// Run: node scripts/check-light-offline.cjs
// This Windows-only integration check renders synthetic fixtures in a hidden
// offscreen canvas. It does not open the app, capture windows, or use the network.
const path = require('node:path');

if (!process.versions.electron) {
  const { execFile } = require('node:child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  execFile(require('electron'), [__filename], {
    cwd: path.resolve(__dirname, '..'), env, windowsHide: true,
    timeout: 60000, maxBuffer: 1024 * 1024,
  }, (error, stdout) => {
    if (stdout) process.stdout.write(stdout);
    if (error) {
      // The child reports sanitized check failures on stdout. Do not forward
      // arbitrary Electron/native stderr to logs.
      if (!stdout.trim()) process.stderr.write('Offline light check could not finish.\n');
      process.exitCode = 1;
    }
  });
} else {
  runInElectron();
}

function runInElectron() {
  const { app, BrowserWindow, nativeImage, session } = require('electron');
  const fs = require('node:fs/promises');
  const assert = require('node:assert/strict');
  const { performance } = require('node:perf_hooks');
  const gate = require('../src/core/scene-gate.cjs');
  const { OcrReader } = require('../src/core/ocr.cjs');
  const { titleOffer } = require('../src/core/light-offer.cjs');
  const { readOfferTitles } = require('../src/core/title-reader.cjs');
  const root = path.resolve(__dirname, '..');
  const qaDir = path.join(root, '.qa', 'light-offline');
  app.disableHardwareAcceleration();
  app.setPath('userData', path.join(qaDir, 'electron-profile'));
  globalThis.fetch = async () => { throw new Error('OFFLINE_CHECK_NETWORK_DISABLED'); };

  const pixels = image => ({ ...image.getSize(), bgraBuffer: image.toBitmap() });
  function crop(image, region) {
    const size = image.getSize();
    return image.crop({ x: Math.round(region.x * size.width), y: Math.round(region.y * size.height),
      width: Math.round(region.width * size.width), height: Math.round(region.height * size.height) });
  }
  let decoder, reader;
  app.whenReady().then(async () => {
    assert.equal(process.platform, 'win32', 'This check requires Windows OCR.');
    await fs.mkdir(qaDir, { recursive: true });
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    decoder = new BrowserWindow({ show: false, webPreferences: {
      offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false,
    } });
    await decoder.loadURL('data:text/html,<meta charset="utf-8"><title>Offline synthetic fixture renderer</title>');
    const catalog = JSON.parse(await fs.readFile(path.join(root, 'data/seed/index.json'), 'utf8')).augments;
    const expectedNames = ['珠光护手', '小蜜蜂！！！', '升级：无尽之刃'];
    const expected = expectedNames.map(name => catalog.find(augment => augment.name === name));
    assert.ok(expected.every(Boolean), 'Synthetic names must exist in the local catalog.');
    const templateImages = ['unused', 'spent'].map(name => nativeImage.createFromPath(path.join(root, 'assets/vision', `reroll-${name}.png`)));
    assert.ok(templateImages.every(image => !image.isEmpty()), 'Local button templates must exist.');
    const templates = gate.prepareTemplates(templateImages.map(pixels));
    const templateUrls = templateImages.map(image => image.toDataURL());
    reader = new OcrReader(path.join(qaDir, 'unused-model-cache'),()=>{},(bitmap,size)=>nativeImage.createFromBitmap(bitmap,size));

    async function render(width, height, wrapped, missingMiddle = false, { names = expectedNames, fontWeight = 600 } = {}) {
      const geometry = gate.layout(width, height);
      assert.ok(geometry);
      const payload = { width, height, geometry, wrapped, missingMiddle, expectedNames: names, fontWeight, templateUrls };
      // Canvas is an image generator, not a screenshot or capture surface.
      const png = await decoder.webContents.executeJavaScript(`(async () => {
        const p = ${JSON.stringify(payload)};
        const canvas = new OffscreenCanvas(p.width, p.height), context = canvas.getContext('2d');
        context.fillStyle = '#101b27'; context.fillRect(0, 0, p.width, p.height);
        context.fillStyle = '#f7f1d7'; context.textAlign = 'center'; context.textBaseline = 'middle';
        context.font = p.fontWeight + ' ' + Math.round(p.height * .025) + 'px "Microsoft YaHei"';
        for (let slot = 0; slot < 3; slot++) {
          const title = p.geometry.titles[slot], cx = (title.x + title.width / 2) * p.width;
          const bottom = (title.y + title.height * .8) * p.height;
          if (p.missingMiddle && slot === 1) continue;
          const lines = p.wrapped && slot === 2 ? ['升级：', '无尽之刃'] : [p.expectedNames[slot]];
          lines.forEach((line, index) => context.fillText(line, cx, bottom - (lines.length - 1 - index) * p.height * .027));
        }
        for (let slot = 0; slot < 3; slot++) {
          const button = p.geometry.rerolls[slot], image = new Image();
          image.src = p.templateUrls[slot === 0 ? 1 : 0]; await image.decode();
          context.drawImage(image, Math.round(button.x * p.width), Math.round(button.y * p.height), Math.round(button.width * p.width), Math.round(button.height * p.height));
        }
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        return await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
      })()`);
      return { image: nativeImage.createFromDataURL(png), geometry };
    }

    const cases = [];
    let firstFingerprint;
    for (const [width, height, wrapped] of [[1920, 1080, false], [1280, 1024, true], [3440, 1440, true]]) {
      const { image, geometry } = await render(width, height, wrapped);
      const rerolls = crop(image, geometry.rerollRegion), titleStrip = crop(image, geometry.titleRegion);
      const common = { clientWidth: width, clientHeight: height };
      const started = performance.now();
      const gated = gate.detectRerolls({ ...pixels(rerolls), ...common, region: geometry.rerollRegion }, templates);
      const gateMs = performance.now() - started;
      assert.equal(gated.present, true, 'Synthetic reroll gate should open.');
      const titlePixels = { ...pixels(titleStrip), ...common, region: geometry.titleRegion };
      const fingerprint = gate.fingerprint(titlePixels);
      assert.ok(fingerprint);
      assert.equal(gate.fingerprintChanged(fingerprint, gate.fingerprint(titlePixels)), false);
      if (!firstFingerprint) firstFingerprint = fingerprint;
      await assert.rejects(reader.read(titleStrip, { x: 0, y: 0, width: 1, height: 1 }, catalog, { allowFallback: false }), /尺寸过小/);
      const runs = [];
      for (let i = 0; i < 3; i++) {
        const result = await reader.read(titleStrip, { x: 0, y: 0, width: 1, height: 1 }, catalog, { allowSmall: true, allowFallback: false });
        const offerStart = performance.now();
        const offer = titleOffer(result, geometry.titleRegion, geometry, catalog, result.capturedAt);
        const offerMs = performance.now() - offerStart;
        if (offer.cards.length !== 3) await fs.writeFile(path.join(qaDir, 'synthetic-diagnostic.json'), JSON.stringify({ lines: result.lines, offer, geometry }, null, 2));
        // Do not log raw OCR text. These names came only from this synthetic input.
        assert.deepEqual(offer.cards.map(card => card.id), expected.map(augment => augment.id), `Expected three exact synthetic titles at ${width}x${height}.`);
        assert.ok(offer.cards.every((card, slot) => card.rect === geometry.cards[slot]));
        runs.push({ engine: result.engine, cards: offer.cards.length, offerMs: Number(offerMs.toFixed(2)), ...result.timings });
      }
      await fs.writeFile(path.join(qaDir, `synthetic-${width}x${height}.png`), image.toPNG());
      cases.push({ client: { width, height }, titleStrip: titleStrip.getSize(), font: 'Microsoft YaHei', fontWeight: 600, fontPx: Math.round(height * .025), wrapped, gateScore: gated.score, gateMs: Number(gateMs.toFixed(2)), defaultSmallRejected: true, unchangedFingerprint: true, runs });
    }

    // Keep difficult OCR observations rather than changing matching rules to
    // turn them into successes. Extra enlargement is only a local experiment.
    const boundaryCases = [];
    const boundaryNames = ['会心治疗', '小蜜蜂！！！', '升级：无尽之刃'];
    const boundaryExpected = boundaryNames.map(name => catalog.find(augment => augment.name === name));
    for (const [width, height, wrapped, fontWeight] of [[1920, 1080, false, 400], [1280, 1024, true, 600]]) {
      const { image, geometry } = await render(width, height, wrapped, false, { names: boundaryNames, fontWeight });
      const original = crop(image, geometry.titleRegion), variants = [];
      for (const enlarged of [false, true]) {
        const originalSize = original.getSize();
        const strip = enlarged ? original.resize({ width: 2200, height: Math.round(originalSize.height * 2200 / originalSize.width) }) : original;
        const result = await reader.read(strip, { x: 0, y: 0, width: 1, height: 1 }, catalog, { allowSmall: true, allowFallback: false });
        const offer = titleOffer(result, geometry.titleRegion, geometry, catalog, result.capturedAt);
        assert.ok(offer.cards.length === 0 || offer.cards.length === 3);
        if (offer.cards.length === 3) assert.deepEqual(offer.cards.map(card => card.id), boundaryExpected.map(augment => augment.id));
        variants.push({ enlargedBeforeOcr: enlarged, inputSize: strip.getSize(), healingTitleExact: result.matches.some(match => match.name === boundaryNames[0] && match.exact), acceptedCards: offer.cards.length, ...result.timings });
      }
      const adaptive=await readOfferTitles({ocr:reader,image:original,region:geometry.titleRegion,geometry,augments:catalog,capturedAt:'synthetic-adaptive'});
      assert.ok(adaptive.reads<=4);
      if(adaptive.offer.cards.length)assert.deepEqual(adaptive.offer.cards.map(c=>c.id),boundaryExpected.map(a=>a.id));
      boundaryCases.push({ client: { width, height }, firstTitle: boundaryNames[0], font: 'Microsoft YaHei', fontWeight, fontPx: Math.round(height * .025), wrapped, variants,
        adaptive:{reads:adaptive.reads,acceptedCards:adaptive.offer.cards.length,durationMs:adaptive.durationMs} });
    }

    const { image, geometry } = await render(1920, 1080, false, true);
    const titleStrip = crop(image, geometry.titleRegion);
    const changed = gate.fingerprint({ ...pixels(titleStrip), region: geometry.titleRegion, clientWidth: 1920, clientHeight: 1080 });
    assert.equal(gate.fingerprintChanged(firstFingerprint, changed), true);
    const missingResult = await reader.read(titleStrip, { x: 0, y: 0, width: 1, height: 1 }, catalog, { allowSmall: true, allowFallback: false });
    const missingOffer = titleOffer(missingResult, geometry.titleRegion, geometry, catalog, missingResult.capturedAt);
    assert.equal(missingOffer.cards.length, 0, 'An incomplete offer must stay hidden.');
    const report = { ok: true, method: 'Synthetic Chinese titles and local template pixels only; Windows OCR; hidden offscreen canvas; no capture or network.',
      limitations: 'Synthetic font and flat background do not establish real-match accuracy or game FPS.', expectedNames,
      cases, boundaryCases, incompleteOffer: { changedFingerprint: true, rejected: true }, workerStarts: reader.nativeWorker.starts };
    await fs.writeFile(path.join(qaDir, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    await reader.close(); reader = null;
    decoder.destroy(); decoder = null;
    app.exit(0);
  }).catch(async error => {
    await reader?.close(); decoder?.destroy();
    console.log(JSON.stringify({ ok: false, error: error?.name === 'AssertionError' ? error.message.split('\n')[0] : 'Offline integration could not complete.' }));
    app.exit(1);
  });
}
