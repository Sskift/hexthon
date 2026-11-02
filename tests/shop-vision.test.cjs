const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectShop, ShopTracker } = require('../src/core/shop-vision.cjs');
const line = (text, x, y, width = .08) => ({ text, x, y, width, height: .024 });
const shopLines = () => [line('推荐', .2, .2, .04), line('所有物品', .33, .2), line('物品配置', .47, .2), line('购买', .68, .74, .04), line('出售', .22, .74, .04), line('撤销', .3, .74, .04)];
const sample = stamp => detectShop({ lines: shopLines(), capturedAt: String(stamp) });

test('shop needs a same-row navigation pair and independent lower purchase control', () => {
  const result = sample(1);
  assert.equal(result.visible, true); assert.equal(result.estimated, true);
  assert.ok(result.evidence.filter(a => a.type === 'nav').length >= 2);
  assert.ok(result.evidence.some(a => a.type === 'control'));
  assert.ok(result.rect.x >= 0 && result.rect.y >= 0 && result.rect.x + result.rect.width <= 1 && result.rect.y + result.rect.height <= 1);
  assert.equal(detectShop({ lines: shopLines().slice(0, 3) }).visible, false);
  assert.equal(detectShop({ lines: [shopLines()[0], ...shopLines().slice(3)] }).visible, false);
});

test('English shop labels and segmented Chinese tab words are supported', () => {
  const english = [line('Recommended', .18, .2, .11), line('All Items', .36, .2, .1), line('BUY', .65, .73, .04)];
  assert.equal(detectShop({ lines: english }).visible, true);
  const words = shopLines().slice(0, 3);
  const merged = { text: '推荐 所有物品 物品配置', x: .2, y: .2, width: .35, height: .024, words };
  assert.equal(detectShop({ lines: [merged, ...shopLines().slice(3)] }).visible, true);
});

test('chat, tooltips, combat text, duplicate labels and invalid boxes cannot open shop', () => {
  assert.equal(detectShop({ lines: [line('推荐购买所有物品', .2, .6, .2)] }).visible, false);
  assert.equal(detectShop({ lines: [line('推荐', .2, .6), line('所有物品', .33, .6), line('购买', .3, .8)] }).visible, false);
  assert.equal(detectShop({ lines: [line('推荐', .2, .2), line('推荐', .33, .2), line('购买', .3, .7)] }).visible, false);
  assert.equal(detectShop({ lines: [line('推荐', .2, .2), line('所有物品', .2, .3), line('购买', .3, .7)] }).visible, false);
  assert.equal(detectShop({ lines: shopLines().map(x => ({ ...x, width: NaN })) }).visible, false);
  assert.equal(detectShop({ lines: [] }).visible, false);
});

test('purchase-like text on the header row does not count as lower shop controls', () => {
  assert.equal(detectShop({ lines: shopLines().map(x => ({ ...x, y: .2 })) }).visible, false);
});

test('shop tracker requires two distinct positives and closes on one negative', () => {
  const tracker = new ShopTracker();
  const first = sample(1);
  assert.equal(tracker.observe(first).visible, false);
  assert.equal(tracker.observe(first).visible, false);
  assert.equal(tracker.observe(sample(2)).visible, true);
  assert.equal(tracker.observe({ visible: false, observedAt: '3' }).visible, false);
  assert.equal(tracker.observe(sample(4)).visible, false);
});

test('stale OCR cannot keep a shop open or revive after expiry and focus invalidation', () => {
  let now = 0; const tracker = new ShopTracker({ now: () => now });
  tracker.observe(sample(1)); const latest = sample(2); tracker.observe(latest);
  now = 3600; assert.equal(tracker.expire().visible, false);
  assert.equal(tracker.observe(latest).visible, false);
  assert.equal(tracker.observe(sample(3)).visible, false);
  assert.equal(tracker.observe(sample(4)).visible, true);
  tracker.invalidate(); assert.equal(tracker.observe(sample(4)).visible, false);
});

test('expired candidates and a shifted panel cannot complete earlier stability evidence', () => {
  let now = 0; const tracker = new ShopTracker({ now: () => now });
  tracker.observe(sample(1)); now = 3600;
  assert.equal(tracker.observe(sample(2)).visible, false);
  const shifted = sample(3); shifted.rect = { ...shifted.rect, x: shifted.rect.x + .12 };
  assert.equal(tracker.observe(shifted).visible, false);
});
