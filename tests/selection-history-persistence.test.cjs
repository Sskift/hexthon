const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {SelectionHistory,SelectionHistoryStore}=require('../src/core/selection-history.cjs');
const execute=promisify(execFile),fixture=path.join(__dirname,'fixtures/selection-history-child.cjs');
async function child(mode,filename,match='123456789',hero='103'){
  const {stdout,stderr}=await execute(process.execPath,[fixture,mode,filename,match,hero],{windowsHide:true,timeout:5000,maxBuffer:8192});
  assert.equal(stderr,'');return JSON.parse(stdout);
}
async function isolated(run){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'hexthon-history-preflight-'));
  try{return await run(path.join(directory,'history.json'),directory);}
  finally{await fs.rm(directory,{recursive:true,force:true});}
}
function payload(id){
  const h=new SelectionHistory();h.begin({matchId:'123456789',championId:103,gameTime:110});h.observe({id,source:'api'});return h.serialize();
}

test('a fresh process restores only the same reliable match and champion, including a late champion identity',async()=>{
  await isolated(async filename=>{
    const written=await child('write',filename);assert.deepEqual(written.ids,[2,3]);
    const restored=await child('restore',filename);assert.deepEqual(restored.ids,[2,3]);assert.equal(restored.restored,true);
    assert.equal(restored.complete,false);assert.deepEqual(restored.confidence,['confirmed','confirmed']);
    assert.deepEqual((await child('hero-late',filename)).ids,[2,3]);
    assert.deepEqual((await child('restore',filename,'987654321')).ids,[]);
    assert.deepEqual((await child('restore',filename,'123456789','22')).ids,[]);
    const unknown=await child('restore',filename,'unknown');assert.deepEqual(unknown.ids,[]);assert.equal(unknown.persistent,false);
  });
});
test('flush allows an explicit process exit immediately after the final save without losing the last selection',async()=>{
  await isolated(async filename=>{
    await child('write',filename);const final=await child('flush-exit',filename);assert.deepEqual(final.ids,[4]);
    assert.deepEqual((await child('restore',filename)).ids,[4]);
  });
});
test('abrupt process exit during a staging write preserves the last complete checkpoint for the next process',async()=>{
  await isolated(async(filename,directory)=>{
    await child('write',filename);
    await assert.rejects(execute(process.execPath,[fixture,'crash-staging',filename],{windowsHide:true,timeout:5000,maxBuffer:8192}),error=>error.code===23);
    const recovered=await child('restore',filename);assert.deepEqual(recovered.ids,[2,3]);
    const files=await fs.readdir(directory);assert.equal(files.filter(name=>name.endsWith('.tmp')).length,1);
  });
});
test('partial staging-write and rename failures preserve the prior checkpoint and a later save recovers',async()=>{
  for(const phase of ['write','rename'])await isolated(async(filename,directory)=>{
    const first=payload(1);await new SelectionHistoryStore(filename).save(first);
    let fail=true;const io={...fs,
      writeFile:async(...args)=>{if(fail&&phase==='write'){await fs.writeFile(args[0],'{"partial":');throw Object.assign(new Error('SIMULATED_DISK_FULL'),{code:'ENOSPC'});}return fs.writeFile(...args);},
      rename:async(...args)=>{if(fail&&phase==='rename')throw Object.assign(new Error('SIMULATED_ACCESS_DENIED'),{code:'EACCES'});return fs.rename(...args);}};
    const store=new SelectionHistoryStore(filename,{io});
    await assert.rejects(store.save(payload(2)),/SIMULATED/);await assert.rejects(store.flush(),/SIMULATED/);
    assert.deepEqual((await new SelectionHistoryStore(filename).load()).entries.map(a=>a.id),[1]);
    assert.deepEqual(await fs.readdir(directory),['history.json']);
    fail=false;await store.save(payload(2));await store.flush();
    assert.deepEqual((await store.load()).entries.map(a=>a.id),[2]);
  });
});
test('corrupt final JSON and orphaned crash staging files are never accepted as recovered selections',async()=>{
  await isolated(async(filename,directory)=>{
    await fs.writeFile(filename,'{"version":1,');await fs.writeFile(`${filename}.999999.tmp`,JSON.stringify(payload(3)));
    const store=new SelectionHistoryStore(filename);assert.equal(await store.load(),null);
    assert.deepEqual((await child('restore',filename)).ids,[]);
    await store.save(payload(4));await store.flush();assert.deepEqual((await store.load()).entries.map(a=>a.id),[4]);
    assert.ok((await fs.readdir(directory)).includes('history.json.999999.tmp'),'orphan is ignored, not silently adopted');
  });
});
test('flush waits for saves queued while an earlier save is still in flight',async()=>{
  await isolated(async filename=>{
    let release,started;const entered=new Promise(resolve=>{started=resolve;});let calls=0;
    const io={...fs,writeFile:async(...args)=>{if(++calls===1){started();await new Promise(resolve=>{release=resolve;});}return fs.writeFile(...args);}};
    const store=new SelectionHistoryStore(filename,{io});const first=store.save(payload(1));await entered;
    const flushing=store.flush(),last=store.save(payload(2));release();await flushing;await Promise.all([first,last]);
    assert.deepEqual((await store.load()).entries.map(a=>a.id),[2]);
  });
});
