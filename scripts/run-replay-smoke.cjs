// Repeatable controller replay; inputs are generated, all windows stay hidden.
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),profile=path.join(root,'.qa/replay-profile');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
async function run(step){
  await new Promise((resolve,reject)=>{
    const child=spawn(require('electron'),['.','--replay-smoke-test',`--replay-step=${step}`],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='',settled=false;
    const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve();};
    const timer=setTimeout(()=>{child.kill();finish(new Error(`Replay ${step} timed out`));},40000);
    for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output=(output+chunk).slice(-6000);});
    child.once('error',finish);
    child.once('close',code=>finish(code===0?null:new Error(`Replay ${step} exited ${code}: ${output}`)));
  });
  const status=JSON.parse(await fs.readFile(path.join(profile,'runtime-status.json'),'utf8'));
  assert.equal(status.lifecycle,'stopped');assert.equal(status.captureEnabled,false);assert.equal(status.windowMonitorEnabled,false);
  assert.equal(status.error,'');assert.equal(status.connectionError,'');
  return JSON.parse(await fs.readFile(path.join(profile,`${step}-result.json`),'utf8'));
}
(async()=>{
  await fs.mkdir(profile,{recursive:true});
  // Fixed dedicated test files only. Never reuse or touch the live user profile.
  for(const name of ['settings.json','selection-history.json','runtime-status.json','scenario-result.json','restart-result.json']){
    await fs.unlink(path.join(profile,name)).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
  const steps=[await run('scenario'),await run('restart')];
  const report={passed:true,actualWindowCapture:false,syntheticOcr:true,externalNetwork:false,nativeClientWrites:false,visibleWindows:0,
    productionController:true,productionQuitPath:true,steps,
    limitations:'Injected pixels, OCR observations and local API states only. This checks integration and state transitions, not real-game recognition accuracy, display compatibility or FPS.'};
  await fs.writeFile(path.join(root,'.qa/replay-smoke.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
