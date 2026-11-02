const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cardBounds, companionBounds, shopBounds } = require('../src/core/overlay-layout.cjs');
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
