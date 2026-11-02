const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),profile=path.join(root,'.qa/lifecycle-profile');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
async function run(step,args=[]){
  const started=Date.now();
  await new Promise((resolve,reject)=>{
    const child=spawn(require('electron'),['.','--lifecycle-smoke-test',`--lifecycle-step=${step}`,...args],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output=(output+chunk).slice(-5000);});
    const timer=setTimeout(()=>{child.kill();reject(new Error(`Lifecycle ${step} timed out: ${output}`));},20000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('close',code=>{clearTimeout(timer);code===0?resolve():reject(new Error(`Lifecycle ${step} exited ${code}: ${output}`));});
  });
  if(step==='blocked-exit'){
    const result=JSON.parse(await fs.readFile(path.join(profile,`${step}-result.json`),'utf8'));
    assert.equal(result.lateSettingsRejected,true);assert.ok(Date.now()-started<10000);
    return {...result,totalProcessMs:Date.now()-started,checks:['blocked final diagnostic write cannot hold process open','exit rejects late settings mutations']};
  }
  const status=JSON.parse(await fs.readFile(path.join(profile,'runtime-status.json'),'utf8'));
  assert.equal(status.lifecycle,'stopped');assert.equal(status.captureEnabled,false);assert.equal(status.error,'');
  assert.equal(status.windowMonitorEnabled,false);
  if(step==='early-exit'){
    assert.equal(status.windowCount,0);
    return {step,visibleWindows:0,checks:['quit during startup creates no windows or helper','pending history load cannot clear the last checkpoint']};
  }
  return JSON.parse(await fs.readFile(path.join(profile,`${step}-result.json`),'utf8'));
}
(async()=>{
  await fs.mkdir(profile,{recursive:true});
  // Only these fixed, dedicated test files are reset. Never touch real userData.
  for(const name of ['selection-history.json','settings.json','runtime-status.json'])await fs.unlink(path.join(profile,name)).catch(error=>{if(error.code!=='ENOENT')throw error;});
  await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify({schemaVersion:5,assistantAutoScan:true}));
  const write=await run('write',['--paused']);
  assert.equal(JSON.parse(await fs.readFile(path.join(profile,'settings.json'),'utf8')).opacity,.82);
  const api=await run('api',['--api-only']);
  const restore=await run('restore');
  const savedHistory=await fs.readFile(path.join(profile,'selection-history.json'),'utf8');
  const early=await run('early-exit');
  assert.equal(await fs.readFile(path.join(profile,'selection-history.json'),'utf8'),savedHistory);
  const blocked=await run('blocked-exit');
  const report={passed:true,actualWindowCapture:false,externalNetwork:false,productionQuitPath:true,steps:[write,api,restore,early,blocked],
    limitations:'Synthetic game state and hidden renderers only; idle samples exclude window monitor, actual screen acquisition, gameplay and FPS.'};
  await fs.writeFile(path.join(root,'.qa/lifecycle-smoke.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
