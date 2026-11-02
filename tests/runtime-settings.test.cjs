const test=require('node:test');
const assert=require('node:assert/strict');
const {startupSettings,updateSettings}=require('../src/core/runtime-settings.cjs');
test('assistant pause survives API-only session and settings update',()=>{
  const first=startupSettings({},{visual:true,light:true});assert.equal(first.autoScan,true);
  const paused=updateSettings({autoScan:false},first,{visual:true,light:true});
  const api=startupSettings(paused);assert.equal(api.autoScan,false);
  const saved=updateSettings({opacity:.8},api);
  const next=startupSettings(saved,{visual:true,light:true});assert.equal(next.autoScan,false);assert.equal(next.opacity,.8);
});
test('API-only effective disable does not erase enabled assistant preference',()=>{
  const api=startupSettings({schemaVersion:5,assistantAutoScan:true,autoScan:true});
  assert.equal(api.autoScan,false);
  const persisted=updateSettings({autoScan:true},api);assert.equal(persisted.autoScan,false);
  assert.equal(startupSettings(persisted,{visual:true,light:true}).autoScan,true);
});
test('explicit paused startup overrides prior enabled preference',()=>{
  const paused=startupSettings({schemaVersion:5,assistantAutoScan:true},{visual:true,light:true,paused:true});
  assert.equal(paused.autoScan,false);assert.equal(paused.assistantAutoScan,false);
  assert.equal(startupSettings(paused,{visual:true,light:true}).autoScan,false);
});
test('damaged persisted settings recover without enabling a saved paused assistant',()=>{
  for(const invalid of [null,[],false,'bad'])assert.equal(startupSettings(invalid).autoScan,false);
  const recovered=startupSettings({schemaVersion:5,assistantAutoScan:false,ocrRegion:{x:5}},{visual:true,light:true});
  assert.equal(recovered.autoScan,false);assert.ok(recovered.ocrRegion.width>0);
  assert.throws(()=>updateSettings({ocrRegion:{x:5}},recovered,{visual:true,light:true}),/识别区域/);
});
