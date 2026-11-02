const { test } = require('node:test');
const assert = require('node:assert/strict');
const { headerRegions, pixelGate, remapOcr, headerEvidence, footerRegions, shopFromStrips, fingerprintDistance, ShopStripCache } = require('../src/core/light-shop.cjs');
const NOW = Date.parse('2026-11-03T01:00:00Z');
const stamp = delta => new Date(NOW + delta).toISOString();
const headerRegion = { x: .1, y: .13, width: .8, height: .1 };
const footerRegion = { x: .1, y: .69, width: .8, height: .12 };
const line = (text, x, y, width = .08, height = .024) => ({ text, x, y, width, height });
const tabs = () => [line('推荐', .2, .2, .04), line('所有物品', .33, .2), line('物品配置', .47, .2)];
const controls = () => [line('出售', .22, .74, .04), line('撤销', .3, .74, .04), line('购买', .68, .74, .04)];
function local(lines, region, time = stamp(0)) {
  return { capturedAt: time, lines: lines.map(w => ({ ...w, x: (w.x - region.x) / region.width, y: (w.y - region.y) / region.height, width: w.width / region.width, height: w.height / region.height })) };
}
const header = () => headerEvidence(local(tabs(), headerRegion), headerRegion);
function image(kind = 'text') {
  const width = 480, height = 80, bgraBuffer = Buffer.alloc(width * height * 4);
  let random = 13;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const text = y >= 27 && y <= 49 && ((x >= 60 && x <= 110) || (x >= 220 && x <= 290)) && (x % 9 < 4 || y % 8 < 2);
    const value = kind === 'noise' ? random % 256 : kind === 'white' ? 255 : kind === 'black' ? 0 : text && kind === 'text' ? 225 : 24;
    const p = (y * width + x) * 4; bgraBuffer[p] = bgraBuffer[p + 1] = bgraBuffer[p + 2] = value; bgraBuffer[p + 3] = 255;
  }
  return { width, height, bgraBuffer };
}

test('header search is six bounded narrow regions in priority order, with a fixed per-strip budget', () => {
  for (const [width, height] of [[1280, 720], [1920, 1080], [3440, 1440], [3840, 2160]]) {
    const regions = headerRegions(width, height); assert.equal(regions.length, 6);
    assert.deepEqual(regions.slice(0, 2).map(r => r.y), [.13, .21]);
    for (const r of regions) { assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= 1 && r.y + r.height <= 1); assert.ok(r.width * r.height <= .081); }
  }
  assert.deepEqual(headerRegions(NaN, 1080), []); assert.deepEqual(headerRegions(400, 300), []);
});

test('cheap pixels only allow OCR candidates; blank, black, noise and malformed pixels stay out', () => {
  const positive = pixelGate(image()); assert.equal(positive.candidate, true); assert.equal(positive.fingerprint.length, 2304);
  for (const kind of ['black', 'white', 'flat', 'noise']) assert.equal(pixelGate(image(kind)).candidate, false, kind);
  assert.equal(pixelGate({ ...image(), bgraBuffer: Buffer.alloc(4) }).candidate, false);
  assert.equal(pixelGate({ ...image(), height: 0 }).candidate, false);
  assert.equal(headerEvidence({ lines: [line('出装参考', .2, .2)] }, headerRegion).candidate, false);
});

test('strip OCR coordinates and child words map back to client without accepting outside boxes', () => {
  const result = local(tabs(), headerRegion);
  result.lines[0].words = [{ ...result.lines[0] }];
  result.lines.push({ text: 'bad', x: NaN, y: 0, width: .1, height: .1 });
  const mapped = remapOcr(result, headerRegion);
  assert.equal(mapped.capturedAt, result.capturedAt); assert.equal(mapped.lines.length, 3);
  assert.ok(Math.abs(mapped.lines[0].x - .2) < 1e-9); assert.equal(mapped.lines[0].words.length, 1);
  assert.equal(remapOcr(result, { ...headerRegion, x: -1 }).lines.length, 0);
});

test('header requires distinct complete same-row navigation words and rejects ambiguity', () => {
  const found = header(); assert.equal(found.candidate, true); assert.equal(found.lines.length, 3);
  assert.ok(found.headerRegion.height < headerRegion.height);
  for (const lines of [[tabs()[0]], [tabs()[0], { ...tabs()[1], text: '推荐' }], [tabs()[0], { ...tabs()[1], text: '所有物吕' }], [tabs()[0], { ...tabs()[1], y: .28 }]]) {
    assert.equal(headerEvidence(local(lines, headerRegion), headerRegion).candidate, false);
  }
  const broad = { x: .1, y: .1, width: .8, height: .4 };
  assert.equal(headerEvidence(local([...tabs(), ...tabs().map(w => ({ ...w, y: .35 }))], broad), broad).candidate, false);
});

test('footer search is at most three independent strips; estimates alone never establish a shop', () => {
  const regions = footerRegions(header()); assert.ok(regions.length > 0 && regions.length <= 3);
  for (const r of regions) { assert.ok(r.y > .34); assert.ok(r.y + r.height <= .95); assert.equal(r.height, .12); }
  assert.deepEqual(footerRegions({ candidate: false }), []);
  assert.equal(shopFromStrips(header(), { capturedAt: stamp(0), lines: [] }, footerRegion, { now: NOW }).visible, false);
});

test('fresh independent header and footer words yield estimated geometry and smaller tracked strips', () => {
  const result = shopFromStrips(header(), local(controls(), footerRegion), footerRegion, { now: NOW });
  assert.equal(result.visible, true); assert.equal(result.estimated, true);
  assert.equal(result.geometrySource, 'ocr-shop-independent-strips');
  assert.ok(result.evidence.filter(e => e.type === 'nav').length >= 2);
  assert.ok(result.evidence.some(e => e.type === 'control'));
  assert.ok(result.footerRegion.height < footerRegion.height);
  assert.equal(result.observedAt, stamp(0));
});

test('same-row, stale, future, missing and unrelated evidence never opens the shop', () => {
  const h = header(), footer = local(controls(), footerRegion);
  assert.equal(shopFromStrips(h, footer, footerRegion, { now: NOW + 5001 }).visible, false);
  assert.equal(shopFromStrips(h, { ...footer, capturedAt: stamp(1000) }, footerRegion, { now: NOW }).visible, false);
  assert.equal(shopFromStrips({ ...h, observedAt: null }, footer, footerRegion, { now: NOW }).visible, false);
  assert.equal(shopFromStrips(h, local(tabs(), headerRegion), headerRegion, { now: NOW }).visible, false);
  assert.equal(shopFromStrips(h, local([line('推荐购买所有物品', .3, .74, .2)], footerRegion), footerRegion, { now: NOW }).visible, false);
  assert.equal(shopFromStrips({ candidate: false }, footer, footerRegion, { now: NOW }).visible, false);
});

test('cache preserves capture identity, copies fingerprints and expires without extending visibility', () => {
  let now = 0; const cache = new ShopStripCache({ now: () => now, ttlMs: 1200 });
  const gated = pixelGate(image()), original = Uint8Array.from(gated.fingerprint), result = local(tabs(), headerRegion);
  assert.equal(cache.write('header', gated, result, { scope: '1:1920x1080' }), true);
  gated.fingerprint.fill(0);
  const current = { ...gated, fingerprint: original };
  assert.equal(cache.read('header', current, { scope: '1:1920x1080' }), result);
  now = 1201; assert.equal(cache.read('header', current, { scope: '1:1920x1080' }), null);
  assert.equal(cache.write('header', current, result, { scope: '1:1920x1080' }), true);
  assert.equal(cache.read('header', current, { scope: '2:1920x1080' }), null);
  assert.equal(cache.write('header', current, result), true); cache.invalidate(); assert.equal(cache.read('header', current), null);
});

test('changed stripe, negative gate or malformed fingerprint invalidates cached OCR', () => {
  const cache = new ShopStripCache(), gate = pixelGate(image()), result = local(tabs(), headerRegion);
  const changed = Uint8Array.from(gate.fingerprint); changed.fill(255, 0, 96);
  assert.ok(fingerprintDistance(gate.fingerprint, changed) > 1.5);
  cache.write('h', gate, result); assert.equal(cache.read('h', { ...gate, fingerprint: changed }), null);
  cache.write('h', gate, result); assert.equal(cache.read('h', { ...gate, candidate: false }), null);
  cache.write('h', gate, result); assert.equal(cache.read('h', { ...gate, fingerprint: [] }), null);
  assert.equal(cache.write('h', { ...gate, fingerprint: [] }, result), false);
});
