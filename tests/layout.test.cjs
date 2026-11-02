const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cardBounds, companionBounds } = require('../src/core/overlay-layout.cjs');
test('card annotation follows game coordinates on a left monitor', () => {
  const window={x:-1920,y:50,width:1920,height:1080};
  const bounds=cardBounds(window,{rect:{x:.2,y:.2,width:.16,height:.4}});
  assert.ok(bounds.x>=-1920&&bounds.x+bounds.width<=0);
  assert.ok(bounds.y+bounds.height<=50+1080*.2);
});
test('annotations stay in the game bounds and missing geometry is hidden',()=>{
  const window={x:100,y:40,width:1280,height:720};
  const bounds=cardBounds(window,{rect:{x:.8,y:.65,width:.17,height:.3}});
  assert.ok(bounds.x+bounds.width<=1380&&bounds.y+bounds.height<=760);
  assert.equal(cardBounds(window,{}),null);
  const companion=companionBounds(window,'ChampSelect');assert.ok(companion.x>=100&&companion.y+companion.height<=760);
});
