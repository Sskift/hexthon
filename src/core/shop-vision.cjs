const { normalize } = require('./matching.cjs');
const { splitLine } = require('./vision.cjs');
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const NAV = new Map([
  ['推荐', 'recommended'], ['推荐装备', 'recommended'], ['推荐物品', 'recommended'], ['recommended', 'recommended'],
  ['所有物品', 'all'], ['全部物品', 'all'], ['所有装备', 'all'], ['allitems', 'all'],
  ['物品配置', 'sets'], ['配装方案', 'sets'], ['装备方案', 'sets'], ['物品套装', 'sets'], ['itemsets', 'sets'],
]);
const CONTROL = new Map([
  ['购买', 'buy'], ['buy', 'buy'], ['purchase', 'buy'],
  ['出售', 'sell'], ['卖出', 'sell'], ['sell', 'sell'],
  ['撤销', 'undo'], ['撤消', 'undo'], ['undo', 'undo'],
]);
function boxValid(line) {
  return [line.x, line.y, line.width, line.height].every(Number.isFinite) &&
    line.x >= 0 && line.y >= 0 && line.width > .008 && line.width < .3 &&
    line.height >= .008 && line.height <= .055 && line.x + line.width <= 1.001 && line.y + line.height <= 1.001;
}
function detectShop(result) {
  const observedAt = result?.capturedAt || result?.observedAt || new Date().toISOString();
  const none = reason => ({ visible: false, rect: null, reason, evidence: [], observedAt });
  const anchors = [];
  for (const line of (result?.lines || []).flatMap(splitLine)) {
    if (!boxValid(line)) continue;
    const text = normalize(line.text), nav = NAV.get(text), control = CONTROL.get(text);
    if (!nav && !control) continue;
    const type = nav ? 'nav' : 'control', key = nav || control;
    if (anchors.some(a => a.type === type && a.key === key && Math.abs(a.rect.x - line.x) < .015 && Math.abs(a.rect.y - line.y) < .015)) continue;
    anchors.push({ type, key, text: line.text, rect: { x: line.x, y: line.y, width: line.width, height: line.height } });
  }
  const tabs = anchors.filter(a => a.type === 'nav' && a.rect.y >= .08 && a.rect.y <= .52 && a.rect.x >= .1 && a.rect.x + a.rect.width <= .91);
  const controls = anchors.filter(a => a.type === 'control' && a.rect.y >= .34 && a.rect.y <= .91);
  const matches = [];
  for (let i = 0; i < tabs.length; i++) for (let j = i + 1; j < tabs.length; j++) {
    const pair = [tabs[i], tabs[j]].sort((a, b) => a.rect.x - b.rect.x);
    const [a, b] = pair.map(x => x.rect);
    if (pair[0].key === pair[1].key || b.x - a.x < .055 || b.x - a.x > .5) continue;
    if (Math.abs(a.y + a.height / 2 - b.y - b.height / 2) > .028 || Math.max(a.height, b.height) / Math.min(a.height, b.height) > 2) continue;
    const top = Math.min(a.y, b.y), right = Math.max(a.x + a.width, b.x + b.width);
    const bottom = controls.filter(c => c.rect.y - top >= .18 && c.rect.y - top <= .72 && c.rect.x >= a.x - .14 && c.rect.x + c.rect.width <= Math.min(.96, right + .38));
    if (!bottom.length) continue;
    matches.push({ pair, bottom, top, left: a.x, right });
  }
  if (!matches.length) return none('未同时识别到同排商店标签与下方购买控件');
  // Multiple tab pairs from a three-tab header are expected. Two different
  // header rows are ambiguous and should not create an overlay.
  if (matches.some(m => Math.abs(m.top - matches[0].top) > .035)) return none('商店区域存在歧义');
  matches.sort((a, b) => b.bottom.length - a.bottom.length || (b.right - b.left) - (a.right - a.left));
  const chosen = matches[0];
  const left = clamp(chosen.left - .055, .025, .7), top = clamp(chosen.top - .05, .025, .65);
  const bottom = clamp(Math.max(...chosen.bottom.map(a => a.rect.y + a.rect.height)) + .045, top + .3, .97);
  const right = clamp(Math.max(chosen.right + .23, ...chosen.bottom.map(a => a.rect.x + a.rect.width + .08)), left + .4, .975);
  return { visible: true, rect: { x: left, y: top, width: right - left, height: bottom - top },
    estimated: true, geometrySource: 'ocr-shop-controls', reason: '同排商店标签与下方购买控件均匹配',
    evidence: [...chosen.pair, ...chosen.bottom], observedAt };
}

class ShopTracker {
  constructor({ stableReads = 2, observationTtlMs = 3500, now = () => Date.now() } = {}) {
    this.stableReads = stableReads; this.observationTtlMs = observationTtlMs; this.now = now;
    this.lastSample = null; this.lastSeenAt = null; this.count = 0; this.current = null;
  }
  snapshot() {
    return this.current && this.count >= this.stableReads ? { ...this.current, visible: true } :
      { visible: false, rect: null, evidence: [], reason: '等待稳定商店画面', observedAt: this.lastSample };
  }
  invalidate() {
    // Retain sample identity: reusing the old OCR object after blur cannot
    // revive a shop that has closed or expired.
    this.current = null; this.count = 0; this.lastSeenAt = null;
    return this.snapshot();
  }
  expire(at = this.now()) {
    if (this.lastSeenAt !== null && at - this.lastSeenAt > this.observationTtlMs) return this.invalidate();
    return this.snapshot();
  }
  observe(detection) {
    const now = this.now(); this.expire(now);
    const sample = detection?.observedAt ?? detection;
    if (sample === this.lastSample) return this.snapshot();
    this.lastSample = sample;
    if (!detection?.visible || !detection.rect) return this.invalidate();
    const r = detection.rect;
    if (![r.x, r.y, r.width, r.height].every(Number.isFinite) || r.width <= 0 || r.height <= 0) return this.invalidate();
    // Different panel locations require fresh stability evidence.
    const previous = this.current?.rect;
    if (previous && (Math.abs(previous.x - r.x) > .08 || Math.abs(previous.y - r.y) > .08)) this.count = 0;
    this.current = detection; this.lastSeenAt = now; this.count++;
    return this.snapshot();
  }
}
module.exports = { detectShop, ShopTracker };
