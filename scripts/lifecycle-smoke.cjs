const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function runLifecycleSmoke(t){
  const step=process.argv.find(arg=>arg.startsWith('--lifecycle-step='))?.split('=')[1];
  const ids=t.state.catalog.augments.slice(0,2).map(row=>row.id);
  const {app,state}=t,profile=app.getPath('userData'),checks=[];
  const hidden=()=>t.getWindows().every(win=>!win.isVisible());
  assert.equal(t.snapshot().settings.autoScan,false);assert.ok(hidden());
  assert.equal(t.getWindows().length,1);
  checks.push('paused startup stays hidden');
  if(step==='blocked-exit'){
    const originalWrite=fs.writeFile.bind(fs);
    fs.writeFile=(file,...args)=>String(file)===path.join(profile,'runtime-status.json.tmp')?new Promise(()=>{}):originalWrite(file,...args);
    app.once('before-quit',()=>{
      t.saveSettings({autoScan:true}).then(()=>{throw new Error('Exit accepted a settings change');},async error=>{
        assert.match(error.message,/退出/);
        await originalWrite(path.join(profile,'blocked-exit-result.json'),JSON.stringify({step,lateSettingsRejected:true,visibleWindows:0}));
      }).catch(error=>{console.error(error.stack);process.exitCode=1;});
    });
    return;
  }
  const game={phase:'InProgress',liveConnected:true,lcuConnected:true,isMayhem:true,gameId:777000111,championId:103,gameTime:210,ownItems:[],team:[],opponents:[]};
  if(step==='write'){
    await assert.rejects(t.scanGame(),/已暂停/);
    await Promise.all([t.saveSettings({opacity:.81}),t.saveSettings({autoOverlay:false})]);
    const disk=JSON.parse(await fs.readFile(path.join(profile,'settings.json'),'utf8'));
    assert.equal(disk.opacity,.81);assert.equal(disk.autoOverlay,false);
    checks.push('concurrent settings writes retain both changes');
    await t.saveSettings({autoScan:true,autoOverlay:true});
    Object.assign(state.game,game);
    const w={hwnd:'12345',pid:4242,dpi:96,x:0,y:0,width:1920,height:1080,clientRect:{x:0,y:0,width:1920,height:1080},foreground:true,visible:true,minimized:false};
    t.onWindowUpdate({game:w,client:null,cursor:{active:false},observedAt:new Date().toISOString()});
    let finishCapture,markStarted;
    const started=new Promise(resolve=>{markStarted=resolve;});
    t.setCapture({capture:()=>{markStarted();return new Promise(resolve=>{finishCapture=resolve;});},close:async()=>{}});
    const inFlight=t.scanGame();await started;
    await t.saveSettings({autoScan:false});finishCapture({});await inFlight;
    assert.equal(state.overlayVisible,false);assert.equal(state.offeredIds.length,0);
    assert.equal(t.snapshot().settings.autoScan,false);await assert.rejects(t.scanGame(),/已暂停/);
    checks.push('pause discards in-flight frame and refuses manual capture');
    await t.saveSettings({autoScan:true});
    t.onWindowUpdate({game:w,client:null,cursor:{active:false},observedAt:new Date().toISOString()});
    state.shop={visible:true,rect:{x:.1,y:.15,width:.5,height:.7}};t.layout();
    assert.equal(t.getWindows().length,2,'Only the shop scene should create a window');
    await t.loadedWindows();assert.equal(state.overlayMode,'shop');assert.ok(hidden());
    const prompt=t.getWindows().find(win=>win!==t.panel);assert.equal(prompt.isFocusable(),false);
    await t.saveSettings({autoScan:false});assert.equal(t.getWindows().length,1);
    checks.push('scene windows created on demand and destroyed on pause');
    t.applyHistory(t.history.begin({matchId:game.gameId,championId:game.championId,gameTime:210}));
    t.applyHistory(t.history.observe([{id:ids[0],source:'api'}]));
  }else if(step==='restore'||step==='api'){
    let current={...game,championId:null};
    t.setReader({poll:async()=>current,reset:()=>{}});
    await t.pollGame();assert.equal(state.selectedAugments.length,0);
    current={...game};await t.pollGame();
    assert.equal(state.selectionRecovery.restored,true);
    assert.deepEqual(state.selectedAugments.map(row=>row.id),[ids[1]]);
    assert.equal(state.selectedAugments[0].confidence,'confirmed');
    assert.equal(state.selectionHistoryComplete,false);
    assert.equal(t.snapshot().settings.autoScan,false);
    await t.saveSettings({});
    assert.equal(JSON.parse(await fs.readFile(path.join(profile,'settings.json'),'utf8')).assistantAutoScan,false);
    checks.push('controller restores after delayed champion identity','API mode preserves assistant pause preference');
  }else throw new Error('Unknown lifecycle step');
  if(step==='restore'){
    const showRequests=t.panelShowRequests();
    await t.writeStatus();
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
    await new Promise((resolve,reject)=>{
      const duplicate=spawn(process.execPath,[path.resolve(__dirname,'..'),'--lifecycle-smoke-test'],{env,windowsHide:true,stdio:'ignore'});
      const timer=setTimeout(()=>{duplicate.kill();reject(new Error('Duplicate launch did not exit'));},8000);
      duplicate.once('error',error=>{clearTimeout(timer);reject(error);});
      duplicate.once('close',code=>{clearTimeout(timer);code===0?resolve():reject(new Error(`Duplicate exited ${code}`));});
    });
    await delay(100);assert.ok(hidden());assert.equal(t.panelShowRequests(),showRequests);
    const unchanged=JSON.parse(await fs.readFile(path.join(profile,'runtime-status.json'),'utf8'));
    assert.equal(unchanged.pid,process.pid);assert.equal(unchanged.lifecycle,'running');
    checks.push('duplicate background launch never requests panel display');
  }
  await delay(500);const baseline=app.getAppMetrics(),sampleStart=performance.now();await delay(2000);
  const metrics=app.getAppMetrics();
  const sampleMs=performance.now()-sampleStart;
  const deltas=metrics.map(row=>{const before=baseline.find(old=>old.pid===row.pid&&old.creationTime===row.creationTime);return before?row.cpu.cumulativeCPUUsage-before.cpu.cumulativeCPUUsage:NaN;});
  const cpuSeconds=deltas.every(value=>Number.isFinite(value)&&value>=0)?deltas.reduce((sum,value)=>sum+value,0):null;
  const resource={sampleMs:Math.round(sampleMs),processes:metrics.length,cpuSeconds,
    summedCpuPercentOneCore:cpuSeconds===null?null:Number((cpuSeconds*100000/sampleMs).toFixed(3)),
    privateMiB:Number((metrics.reduce((sum,row)=>sum+(row.memory.privateBytes||0),0)/1024).toFixed(1)),
    workingSetMiB:Number((metrics.reduce((sum,row)=>sum+row.memory.workingSetSize,0)/1024).toFixed(1)),
    byProcess:metrics.map(row=>({type:row.type,privateMiB:Number(((row.memory.privateBytes||0)/1024).toFixed(1))}))};
  assert.ok(hidden());
  await fs.writeFile(path.join(profile,`${step}-result.json`),JSON.stringify({step,checks,visibleWindows:0,resource},null,2));
  if(step==='write'){
    const originalWrite=fs.writeFile.bind(fs);
    fs.writeFile=async(file,...args)=>{if(String(file)===path.join(profile,'runtime-status.json.tmp')){fs.writeFile=originalWrite;await delay(150);}return originalWrite(file,...args);};
    // Queue a slow running-state write immediately before the final stopped
    // write. The parent must still see stopped after production shutdown.
    t.writeStatus().catch(()=>{});
    // Deliberately do not wait for either write: production before-quit must
    // flush both final mutations before the next process reads the profile.
    t.applyHistory(t.history.correct([ids[1]]));
    t.saveSettings({opacity:.82}).catch(()=>{});
  }
}
module.exports={runLifecycleSmoke};
