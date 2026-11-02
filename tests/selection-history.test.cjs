const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {SelectionHistory,SelectionHistoryStore,sanitizeHistory}=require('../src/core/selection-history.cjs');
const catalog=Array.from({length:30},(_,i)=>({id:i+1,name:`强化 ${i+1}`}));
let time=100000;
const history=()=>new SelectionHistory({catalog,now:()=>time});
const context={matchId:'123456789',championId:103,gameTime:100};

test('same reliable match and champion restore partial evidence; other matches, heroes and time rollback do not',()=>{
  const old=history();old.begin(context);old.observe([{id:1,source:'api'},{id:2,source:'visual',slot:'hud:1'}]);
  const payload=old.serialize(),fresh=history();
  assert.deepEqual(fresh.begin({...context,gameTime:110},payload).selected.map(a=>a.id),[1,2]);
  assert.equal(fresh.snapshot().restored,true);assert.equal(fresh.snapshot().complete,false);
  for(const changed of [{...context,matchId:'987654321'},{...context,championId:22},{...context,gameTime:1}]){
    assert.equal(history().begin(changed,payload).selected.length,0);
  }
  assert.equal(fresh.begin({...context,matchId:'987654321'}).selected.length,0);
});
test('unknown game IDs never persist or restore across restart; temporary loss during one process preserves known state',()=>{
  const old=history();old.begin(context);old.observe({id:1,source:'api'});
  assert.equal(old.begin({...context,matchId:null}).selected.length,1);
  assert.equal(history().begin({...context,matchId:null},old.serialize()).selected.length,0);
  const anonymous=history();anonymous.begin({championId:103,gameTime:100});anonymous.observe({id:1,source:'visual'});
  assert.equal(anonymous.serialize(),null);
  assert.equal(anonymous.begin({championId:103,gameTime:0}).selected.length,0);
});
test('late reliable game ID merges saved records with newer partial observations without losing slot evidence',()=>{
  const old=history();old.begin(context);old.observe([{id:1,source:'visual',slot:'hud:0'},{id:2,source:'visual',slot:'hud:1'}]);
  const payload=old.serialize();time+=100;
  const current=history();current.begin({championId:103,gameTime:110});current.observe([{id:1,source:'api'},{id:3,source:'api'}]);
  const restored=current.begin({...context,gameTime:111},payload);
  assert.deepEqual(restored.selected.map(a=>a.id),[1,2,3]);assert.equal(restored.selected[0].slot,'hud:0');assert.equal(restored.selected[0].confidence,'api');
});
test('match ID arriving before champion identity does not consume the recovery opportunity',()=>{
  const old=history();old.begin(context);old.observe({id:1,source:'api'});
  const payload=old.serialize(),current=history();
  assert.equal(current.begin({...context,championId:null},payload).selected.length,0);
  const restored=current.begin(context,payload);
  assert.deepEqual(restored.selected.map(a=>a.id),[1]);assert.equal(restored.restored,true);
});
test('late recovery cannot resurrect a saved manual inclusion replaced by newer slot evidence',()=>{
  const old=history();old.begin(context);old.observe({id:1,source:'visual',slot:'hud:0'});old.confirm(1);
  const payload=old.serialize();time+=100;
  const current=history();current.begin({championId:103,gameTime:110});current.observe({id:2,source:'visual',slot:'hud:0'});
  assert.deepEqual(current.begin({...context,gameTime:110},payload).selected.map(a=>a.id),[2]);
  const reloaded=history();assert.deepEqual(reloaded.begin({...context,gameTime:111},current.serialize()).selected.map(a=>a.id),[2]);
});
test('evidence upgrades without downgrade; stable slot replacement retires stale partial API observations',()=>{
  const h=history();h.begin(context);
  h.observe({id:1,source:'inferred',slot:'hud:0'});assert.equal(h.snapshot().selected[0].slot,null);
  h.observe({id:1,source:'visual',slot:'hud:0'});assert.equal(h.snapshot().selected[0].confidence,'visual');
  h.observe({id:1,source:'api'});h.observe({id:1,source:'inferred'});
  assert.equal(h.snapshot().selected[0].confidence,'api');
  h.observe({id:2,source:'visual',slot:'hud:1'});
  time+=100;h.observe({id:3,source:'visual',slot:'hud:0'});
  time+=100;h.observe({id:1,source:'api'});
  assert.deepEqual(h.snapshot().selected.map(a=>a.id),[2,3]);
  const restarted=history();restarted.begin(context,h.serialize());restarted.observe({id:1,source:'api'});
  assert.deepEqual(restarted.snapshot().selected.map(a=>a.id),[2,3]);
  time+=100;restarted.observe({id:1,source:'visual',slot:'hud:2'});
  assert.deepEqual(restarted.snapshot().selected.map(a=>a.id).sort(),[1,2,3]);
});
test('conflicting slots, unknown IDs, empty observations and older updates cannot invent or remove records',()=>{
  const h=history();h.begin(context);h.observe({id:1,source:'visual',slot:'hud:0'});
  h.observe([{id:2,source:'visual',slot:'hud:0'},{id:3,source:'visual',slot:'hud:0'}]);
  h.observe([{id:2,source:'visual',slot:'hud:1'},{id:2,source:'visual',slot:'hud:2'}]);
  h.observe([{id:9999,source:'api'},{id:4,source:'constructor'},{id:5,source:'visual',slot:'hud:0',observedAt:time-10}]);
  h.observe([]);assert.deepEqual(h.snapshot().selected.map(a=>a.id),[1]);
  assert.equal(h.snapshot().complete,false);
});
test('manual correction can be undone without discarding automatic observations received later',()=>{
  const h=history();h.begin(context);h.observe([{id:1,source:'api'},{id:2,source:'inferred'}]);
  h.correct([2,3]);h.observe({id:1,source:'api'});h.observe({id:4,source:'api'});
  assert.deepEqual(h.snapshot().selected.map(a=>a.id),[2,4,3]);assert.equal(h.snapshot().canUndo,true);
  assert.equal(h.snapshot().selected.find(a=>a.id===2).confidence,'confirmed');
  h.undoCorrection();assert.deepEqual(h.snapshot().selected.map(a=>a.id),[1,2,4]);
  assert.equal(h.snapshot().selected.find(a=>a.id===2).confidence,'inferred');
  h.confirm(2);assert.equal(h.snapshot().selected.find(a=>a.id===2).confidence,'confirmed');
  h.undoCorrection();assert.equal(h.snapshot().selected.find(a=>a.id===2).confidence,'inferred');
});
test('manual exclusions persist as IDs but cannot mark the whole loadout complete',()=>{
  const h=history();h.begin(context);h.observe([{id:1,source:'api'},{id:2,source:'visual',slot:'hud:1'}]);h.correct([2]);
  const copy=history();copy.begin(context,h.serialize());copy.observe({id:1,source:'api'});
  assert.deepEqual(copy.snapshot().selected.map(a=>a.id),[2]);assert.equal(copy.snapshot().complete,false);
  assert.equal(copy.snapshot().canUndo,true);copy.undoCorrection();assert.deepEqual(copy.snapshot().selected.map(a=>a.id),[1,2]);
});
test('storage schema strips arbitrary identity/text fields and rejects oversized, stale or ambiguous records',()=>{
  const h=history();h.begin(context);h.observe({id:1,source:'api',name:'private',evidence:'token',account:'secret'});
  const valid=h.serialize(),safe=sanitizeHistory({...valid,credential:'secret',entries:valid.entries.map(a=>({...a,playerName:'private'}))},time);
  assert.equal(JSON.stringify(safe).includes('secret'),false);assert.equal(JSON.stringify(safe).includes('private'),false);
  assert.equal(sanitizeHistory({...valid,complete:true},time).complete,undefined);
  assert.equal(sanitizeHistory({...valid,savedAt:time-21600001},time),null);
  assert.equal(sanitizeHistory({...valid,entries:Array(61).fill(valid.entries[0])},time),null);
  assert.equal(sanitizeHistory({...valid,entries:[{...valid.entries[0],source:'toString'}]},time),null);
  h.observe(catalog.map(a=>({id:a.id,source:'api'})));assert.equal(h.snapshot().selected.length,20);
  assert.throws(()=>h.correct(Array.from({length:21},(_,i)=>i+1)),/INVALID/);
});
test('store serializes atomic writes, loads only valid bounded JSON and clears anonymous history',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'hexthon-history-')),filename=path.join(directory,'state.json');
  try{
    const store=new SelectionHistoryStore(filename,{now:()=>time}),h=history();h.begin(context);h.observe({id:1,source:'api'});
    const first=store.save(h.serialize());h.observe({id:2,source:'visual',slot:'hud:1'});const second=store.save(h.serialize());
    await Promise.all([first,second]);assert.equal((await store.load()).entries.length,2);
    assert.deepEqual(await fs.readdir(directory),['state.json']);
    await fs.writeFile(filename,'x'.repeat(32769));assert.equal(await store.load(),null);
    await store.save(null);assert.equal(await store.load(),null);assert.deepEqual(await fs.readdir(directory),[]);
    await assert.rejects(store.save({credentials:'secret'}),/INVALID_HISTORY/);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
