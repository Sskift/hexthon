const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cardBounds, companionBounds, shopBounds, draftBounds } = require('../src/core/overlay-layout.cjs');
test('card annotation follows game coordinates on a left monitor', () => {
  const window={x:-1920,y:50,width:1920,height:1080};
  const bounds=cardBounds(window,{rect:{x:.2,y:.2,width:.16,height:.4}});
  assert.ok(bounds.x>=-1920&&bounds.x+bounds.width<=0);
  assert.ok(bounds.y+bounds.height<=50+1080*.2);
});
test('shop recommendations use adjacent free space rather than a screen corner',()=>{
  const window={x:-2200,y:30,width:2200,height:1230};
  const shop={rect:{x:.2,y:.13,width:.58,height:.64}};
  const b=shopBounds(window,shop);
  assert.ok(b);assert.equal(b.x,Math.round(window.x+(.2+.58)*window.width+14));
  assert.ok(b.y>window.y+100);assert.ok(b.y+b.height<=window.y+window.height*.89);
  assert.equal(shopBounds(window,{rect:{x:.01,y:.01,width:.98,height:.98}}),null);
  assert.equal(shopBounds(window,null),null);
});
test('annotations stay in the game bounds and missing geometry is hidden',()=>{
  const window={x:100,y:40,width:1280,height:720};
  const bounds=cardBounds(window,{rect:{x:.8,y:.65,width:.17,height:.3}});
  assert.ok(bounds.x+bounds.width<=1380&&bounds.y+bounds.height<=760);
  assert.equal(cardBounds(window,{}),null);
  const companion=companionBounds(window,'ChampSelect');assert.ok(companion.x>=100&&companion.y+companion.height<=760);
});
test('draft suggestions use free desktop space adjacent to the client without covering selection controls',()=>{
  const area={x:-1920,y:0,width:1920,height:1080};
  const client={x:-1600,y:150,width:1280,height:720};
  const b=draftBounds(client,area);assert.ok(b);assert.ok(b.x>=client.x+client.width||b.x+b.width<=client.x);
  assert.equal(draftBounds(area,area),null);
});
test('high DPI game bounds select a narrower shop-side layout when a 300px panel cannot fit',()=>{
  const window={x:0,y:0,width:1098,height:618};
  const shop={rect:{x:.145,y:.1485,width:.6432,height:.6599}};
  const b=shopBounds(window,shop);assert.ok(b);assert.ok(b.width>=190&&b.width<230);
  assert.ok(b.x>=(shop.rect.x+shop.rect.width)*window.width);assert.ok(b.x+b.width<=window.width-10);
});
