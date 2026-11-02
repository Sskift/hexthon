const { normalize } = require('./matching.cjs');
const { splitLine } = require('./vision.cjs');
const { detectShop } = require('./shop-vision.cjs');

// Search hints, not a claim that a shop is open. Shop scale is configurable;
// only two independent text regions may produce a visible detection.
const NAV = new Map([
  ['推荐', 'recommended'], ['推荐装备', 'recommended'], ['推荐物品', 'recommended'], ['recommended', 'recommended'],
  ['所有物品', 'all'], ['全部物品', 'all'], ['所有装备', 'all'], ['allitems', 'all'],
  ['物品配置', 'sets'], ['配装方案', 'sets'], ['装备方案', 'sets'], ['物品套装', 'sets'], ['itemsets', 'sets'],
]);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const validRect = r => r && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0 && r.x + r.width <= 1.000001 && r.y + r.height <= 1.000001;
const union = boxes => {
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  return { x, y, width: Math.max(...boxes.map(b => b.x + b.width)) - x, height: Math.max(...boxes.map(b => b.y + b.height)) - y };
};
function padded(rect, dx, dy) {
  const x = Math.max(.025, rect.x - dx), y = Math.max(.025, rect.y - dy);
  return { x, y, width: Math.min(.975, rect.x + rect.width + dx) - x, height: Math.min(.95, rect.y + rect.height + dy) - y };
}

function headerRegions(clientWidth, clientHeight) {
  if (![clientWidth, clientHeight].every(n => Number.isInteger(n) && n > 0 && n <= 16384) || clientWidth < 640 || clientHeight < 400) return [];
  // The first pair is prioritized. Scan at most two per tick; do not OCR a
  // union of all six. Overlap avoids cutting words at stripe boundaries.
  return [.13, .21, .05, .29, .37, .45].map(y => ({ x: .10, y, width: .80, height: .10 }));
}

function pixelGate(image) {
  const none = { candidate: false, score: 0, fingerprint: null };
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 32 || image.height < 16 || image.width > 16384 || image.height > 16384 || !(Buffer.isBuffer(image.bgraBuffer) || image.bgraBuffer instanceof Uint8Array) || image.bgraBuffer.length !== image.width * image.height * 4) return none;
  const cols = 96, rows = 24, values = new Uint8Array(cols * rows);
  let dark = 0, bright = 0, flat = 0, edges = 0, pairs = 0;
  const brightColumns = new Uint8Array(cols);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const sx = Math.min(image.width - 1, Math.floor((x + .5) * image.width / cols));
    const sy = Math.min(image.height - 1, Math.floor((y + .5) * image.height / rows));
    const p = (sy * image.width + sx) * 4, b = image.bgraBuffer[p], g = image.bgraBuffer[p + 1], r = image.bgraBuffer[p + 2];
    const gray = Math.round(.114 * b + .587 * g + .299 * r);
    values[y * cols + x] = gray;
    if (gray < 100 && g >= r * .65 && b >= r * .4) dark++;
    if (gray > 145 && Math.max(r, g, b) - Math.min(r, g, b) < 145) { bright++; brightColumns[x]++; }
    if (x) {
      const delta = Math.abs(gray - values[y * cols + x - 1]);
      if (delta < 18) flat++;
      if (delta > 38) edges++;
      pairs++;
    }
  }
  const n = values.length, darkRatio = dark / n, brightRatio = bright / n, flatRatio = flat / pairs, edgeRatio = edges / pairs;
  const activeColumns = brightColumns.reduce((sum, count) => sum + (count > 0), 0);
  // This rejects black/blank frames, bright game scenery and independent
  // noise. A dark tooltip can still pass; exact header/footer words must follow.
  const candidate = darkRatio >= .45 && brightRatio >= .004 && brightRatio <= .30 && flatRatio >= .60 && edgeRatio >= .006 && edgeRatio <= .35 && activeColumns >= 3;
  const score = Math.min(1, darkRatio * .55 + flatRatio * .35 + Math.min(1, brightRatio / .03) * .1);
  return { candidate, score: Number(score.toFixed(3)), fingerprint: values,
    metrics: { darkRatio, brightRatio, flatRatio, edgeRatio, samples: n } };
}

function remapOcr(result, region) {
  if (!validRect(region)) return { ...result, lines: [] };
  const convert = value => {
    if (!value || typeof value.text !== 'string' || !validRect(value)) return null;
    return { text: value.text, x: region.x + value.x * region.width, y: region.y + value.y * region.height,
      width: value.width * region.width, height: value.height * region.height };
  };
  const lines = (result?.lines || []).map(line => {
    const mapped = convert(line); if (!mapped) return null;
    if (Array.isArray(line.words)) mapped.words = line.words.map(convert).filter(Boolean);
    return mapped;
  }).filter(Boolean);
  return { ...result, lines };
}

function headerEvidence(result, region) {
  const none = { candidate: false, lines: [], headerRegion: null, observedAt: result?.capturedAt || result?.observedAt || null };
  if (!validRect(region)) return none;
  const mapped = remapOcr(result, region);
  const anchors = mapped.lines.flatMap(splitLine).map(line => ({ ...line, key: NAV.get(normalize(line.text)) })).filter(line =>
    line.key && validRect(line) && line.x >= .1 && line.x + line.width <= .91 && line.y >= .08 && line.y <= .52 && line.height >= .008 && line.height <= .055 && line.width >= .008 && line.width < .3);
  const pairs = [];
  for (let i = 0; i < anchors.length; i++) for (let j = i + 1; j < anchors.length; j++) {
    const [a, b] = [anchors[i], anchors[j]].sort((left, right) => left.x - right.x);
    if (a.key !== b.key && b.x - a.x >= .055 && b.x - a.x <= .5 && Math.abs(a.y + a.height / 2 - b.y - b.height / 2) <= .028 && Math.max(a.height, b.height) / Math.min(a.height, b.height) <= 2) pairs.push([a, b]);
  }
  if (!pairs.length || pairs.some(pair => Math.abs(pair[0].y - pairs[0][0].y) > .035)) return none;
  const selected = anchors.filter(a => Math.abs(a.y - pairs[0][0].y) < .035);
  const rect = union(selected);
  return { candidate: true, lines: selected.map(({ key, ...line }) => line), headerRegion: padded(rect, .035, .02),
    anchorRect: rect, textHeight: selected.map(a => a.height).sort((a, b) => a - b)[Math.floor(selected.length / 2)], observedAt: none.observedAt };
}

function footerRegions(header) {
  if (!header?.candidate || !validRect(header.anchorRect) || !Number.isFinite(header.textHeight)) return [];
  const rect = header.anchorRect;
  const x = Math.max(.025, rect.x - .14), right = Math.min(.975, rect.x + rect.width + .38);
  // Scale is only a search hint. Validate all positions through independent
  // control words; never turn this estimate directly into shop geometry.
  const center = clamp(rect.y + clamp(header.textHeight * 24, .28, .64), .42, .86);
  const ys = [center - .06, center - .15, center + .03].map(y => clamp(y, Math.max(.34, rect.y + .16), .83));
  return [...new Set(ys)].map(y => ({ x, y, width: right - x, height: .12 }));
}

function shopFromStrips(header, footerResult, footerRegion, { now = Date.now(), maxAgeMs = 5000 } = {}) {
  const observedAt = footerResult?.capturedAt || footerResult?.observedAt || null;
  const none = reason => ({ visible: false, rect: null, evidence: [], reason, observedAt });
  if (!header?.candidate || !validRect(header.headerRegion) || !validRect(footerRegion)) return none('等待独立商店标题与底部控件');
  const headerAt = Date.parse(header.observedAt), footerAt = Date.parse(observedAt);
  if (![headerAt, footerAt, now].every(Number.isFinite) || headerAt > now + 250 || footerAt > now + 250 || now - headerAt > maxAgeMs || now - footerAt > maxAgeMs || Math.abs(footerAt - headerAt) > maxAgeMs) return none('商店文字证据已过期');
  if (footerRegion.y < header.headerRegion.y + header.headerRegion.height + .08) return none('商店底部控件未独立验证');
  const footer = remapOcr(footerResult, footerRegion);
  const detection = detectShop({ lines: [...header.lines, ...footer.lines], capturedAt: observedAt });
  if (!detection.visible) return detection;
  const controls = detection.evidence.filter(e => e.type === 'control').map(e => e.rect);
  return { ...detection, geometrySource: 'ocr-shop-independent-strips', headerRegion: header.headerRegion,
    footerRegion: padded(union(controls), .04, .02), estimated: true };
}

function fingerprintDistance(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== 2304 || b.length !== 2304) return Infinity;
  let maximum = 0;
  // Local stripes keep a small changed word from disappearing into a full
  // header average. Cache equality is deliberately stricter than scene gating.
  for (let start = 0; start < a.length; start += 96) {
    let sum = 0; for (let i = start; i < start + 96; i++) sum += Math.abs(a[i] - b[i]);
    maximum = Math.max(maximum, sum / 96);
  }
  return maximum;
}

class ShopStripCache {
  constructor({ ttlMs = 1200, now = Date.now } = {}) { this.ttlMs = ttlMs; this.now = now; this.scope = null; this.entries = new Map(); }
  invalidate() { this.entries.clear(); this.scope = null; }
  setScope(scope) { if (scope !== this.scope) { this.entries.clear(); this.scope = scope; } }
  read(key, gateResult, { scope = '' } = {}) {
    this.setScope(scope);
    const entry = this.entries.get(key);
    if (!gateResult?.candidate || !entry || this.now() - entry.storedAt > this.ttlMs || fingerprintDistance(entry.fingerprint, gateResult.fingerprint) > 1.5) { this.entries.delete(key); return null; }
    // Preserve capturedAt: cached OCR must not refresh ShopTracker visibility.
    return entry.result;
  }
  write(key, gateResult, result, { scope = '' } = {}) {
    this.setScope(scope);
    if (!gateResult?.candidate || !(gateResult.fingerprint instanceof Uint8Array) || gateResult.fingerprint.length !== 2304 || !result?.capturedAt) return false;
    if (this.entries.size >= 8 && !this.entries.has(key)) this.entries.delete(this.entries.keys().next().value);
    this.entries.set(key, { fingerprint: Uint8Array.from(gateResult.fingerprint), result, storedAt: this.now() });
    return true;
  }
}

module.exports = { headerRegions, pixelGate, remapOcr, headerEvidence, footerRegions, shopFromStrips, fingerprintDistance, ShopStripCache };
