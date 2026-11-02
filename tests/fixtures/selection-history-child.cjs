// Isolated subprocess fixture. The parent supplies an OS-temp filename; this
// script never discovers or reads the real application's userData directory.
const {SelectionHistory,SelectionHistoryStore}=require('../../src/core/selection-history.cjs');
const fs=require('node:fs/promises');
const [mode,filename,match='123456789',hero='103']=process.argv.slice(2);
const catalog=[1,2,3,4].map(id=>({id,name:`强化 ${id}`}));
async function run(){
  const store=new SelectionHistoryStore(filename),history=new SelectionHistory({catalog});
  const context={matchId:match==='unknown'?null:match,championId:Number(hero),gameTime:110};
  if(mode==='write'){
    history.begin(context);history.observe([{id:1,source:'api'},{id:2,source:'visual',slot:'hud:1'}]);history.correct([2,3]);
    await store.save(history.serialize());await store.flush();
  }else if(mode==='restore'){
    history.begin(context,await store.load());
  }else if(mode==='hero-late'){
    const saved=await store.load();history.begin({...context,championId:null},saved);history.begin(context,saved);
  }else if(mode==='flush-exit'){
    history.begin(context);history.observe({id:4,source:'api'});
    // The deliberate exit is safe only after the pending save has settled.
    store.save(history.serialize());await store.flush();
  }else if(mode==='crash-staging'){
    history.begin(context);history.observe({id:4,source:'api'});
    const interrupted=new SelectionHistoryStore(filename,{io:{...fs,writeFile:async(target,encoded,options)=>{
      await fs.writeFile(target,encoded.slice(0,Math.floor(encoded.length/2)),options);
      process.exit(23);
    }}});
    await interrupted.save(history.serialize());
  }else throw new Error('UNKNOWN_FIXTURE_MODE');
  const snapshot=history.snapshot();
  process.stdout.write(JSON.stringify({ids:snapshot.selected.map(a=>a.id),restored:snapshot.restored,complete:snapshot.complete,
    persistent:history.serialize()!==null,confidence:snapshot.selected.map(a=>a.confidence)}),()=>process.exit(0));
}
run().catch(()=>{process.stderr.write('HISTORY_FIXTURE_FAILED');process.exitCode=1;});
