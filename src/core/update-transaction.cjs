const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {atomicJson,readJson,installDirectory,VERSION,KEY}=require('./app-updates.cjs');
const {verifyDirectory}=require('./update-archive.cjs');
const TOKEN=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function validLaunch(value){
  return value&&VERSION.test(value.version)&&typeof value.exe==='string'&&path.isAbsolute(value.exe)&&typeof value.cwd==='string'&&path.isAbsolute(value.cwd)&&Array.isArray(value.args)&&value.args.length<=4&&
    value.args.every((arg,i)=>typeof arg==='string'&&(['--assist','--paused'].includes(arg)||(i===0&&path.isAbsolute(arg)&&arg===value.cwd)))&&
    /^(?:Hexthon|electron)\.exe$/i.test(path.basename(value.exe));
}
function validPlan(plan,now=Date.now()){
  return plan?.schemaVersion===1&&TOKEN.test(plan.token)&&Number.isSafeInteger(plan.parentPid)&&plan.parentPid>0&&Number.isFinite(plan.createdAt)&&now>=plan.createdAt&&now-plan.createdAt<15*60*1000&&
    KEY.test(plan.target?.key)&&VERSION.test(plan.target?.version)&&plan.target.key.startsWith(plan.target.version+'-')&&/^[a-f0-9]{64}$/.test(plan.target.sha256)&&typeof plan.target.manifestSha256==='string'&&/^[a-f0-9]{64}$/.test(plan.target.manifestSha256)&&plan.target.key.split('-')[1]===plan.target.sha256.slice(0,12)&&validLaunch(plan.previous);
}
function alive(pid){try{process.kill(pid,0);return true;}catch(error){return error.code==='EPERM';}}
function launch(descriptor,extra=[]){
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  return spawn(descriptor.exe,[...descriptor.args,...extra],{cwd:descriptor.cwd,env,windowsHide:true,detached:true,stdio:'ignore'});
}
async function observeStartup(child,healthFile,token,version,{wait=sleep,now=Date.now,timeoutMs=30000}={}){
  let exited=false,healthyAt=null;child.once('exit',()=>{exited=true;});child.once('error',()=>{exited=true;});
  const deadline=now()+timeoutMs;
  while(now()<deadline){
    if(exited||child.exitCode!==null&&child.exitCode!==undefined||child.signalCode)return false;
    const ready=await readJson(healthFile);
    if(ready?.token===token&&ready.pid===child.pid&&ready.version===version&&ready.status==='ready'&&Number.isFinite(ready.at)&&now()>=ready.at&&now()-ready.at<5000){
      healthyAt??=now();if(now()-healthyAt>=1500)return true;
    }else healthyAt=null;
    await wait(200);
  }return false;
}
async function stopOwned(child,{wait=sleep,now=Date.now}={}){
  if(!child||!child.pid||child.exitCode!==null&&child.exitCode!==undefined||child.signalCode)return true;
  let closed=false;child.once('close',()=>{closed=true;});child.once('error',()=>{closed=true;});
  try{child.kill();}catch{return false;}
  const until=now()+5000;while(!closed&&now()<until)await wait(100);
  return closed;
}
async function runUpdateTransaction({root,plan,verify=verifyDirectory,spawnApp=launch,isAlive=alive,wait=sleep,now=Date.now,observe=observeStartup,stop=stopOwned,canApply=async()=>true}={}){
  if(!validPlan(plan,now()))throw new Error('UPDATE_PLAN_INVALID');
  const directory=installDirectory(root,plan.target.key);
  const resultFile=path.join(root,'result.json'),healthFile=path.join(root,`health-${plan.token}.json`);
  const report=async status=>{const result={status,version:plan.target.version,at:now()};await atomicJson(resultFile,result);return result;};
  const deadline=now()+15000;while(isAlive(plan.parentPid)&&now()<deadline)await wait(150);
  if(isAlive(plan.parentPid))return report('parent-still-running');
  const previousState=await readJson(path.join(root,'active.json'));
  const flags=plan.previous.args.filter(arg=>['--assist','--paused'].includes(arg));
  let child,started=false;
  const checkpoint=[];
  try{
    await verify(directory,plan.target.version,{expectedManifestSha256:plan.target.manifestSha256});
    for(const name of ['settings.json','selection-history.json']){
      const file=path.join(root,'..',name);let bytes=null;
      try{if((await fs.stat(file)).size>2*1024*1024)throw new Error('UPDATE_CHECKPOINT_SIZE');bytes=await fs.readFile(file);}catch(error){if(error.code!=='ENOENT')throw error;}
      checkpoint.push({file,bytes});
    }
    if(!await canApply())throw new Error('UPDATE_GAME_ACTIVE');
    child=spawnApp({exe:path.join(directory,'Hexthon.exe'),cwd:directory,args:flags},[`--update-health=${plan.token}`]);
    started=await observe(child,healthFile,plan.token,plan.target.version,{wait,now});
    if(started){
      await atomicJson(path.join(root,'active.json'),{schemaVersion:1,active:plan.target,previous:previousState?.active||null});
      const temporary=path.join(root,`active-path-${plan.token}.tmp`);await fs.writeFile(temporary,plan.target.key,{flag:'wx'});await fs.rename(temporary,path.join(root,'active-path.txt'));
      child.unref?.();return await report('updated');
    }
  }catch{/* A launch/policy/health/write failure must not replace the previous entry point. */}
  if(child&&!await stop(child,{wait,now}))return report('rollback-failed');
  try{for(const row of checkpoint){
    if(row.bytes===null)await fs.unlink(row.file).catch(error=>{if(error.code!=='ENOENT')throw error;});
    else{const temp=row.file+'.update-'+plan.token;await fs.writeFile(temp,row.bytes,{flag:'wx'});await fs.rename(temp,row.file);}
  }
  // Restore an entry point if committing it failed between the two atomic files.
  if(previousState?.active&&KEY.test(previousState.active.key)){
    await atomicJson(path.join(root,'active.json'),previousState);
    await fs.writeFile(path.join(root,'active-path.txt'),previousState.active.key);
  }else{
    await atomicJson(path.join(root,'active.json'),{schemaVersion:1,active:null,previous:null});
    await fs.writeFile(path.join(root,'active-path.txt'),'');
  }
  }catch{return report('rollback-failed');}
  try{
    const fallbackToken=crypto.randomUUID();
    const fallback=spawnApp(plan.previous,[`--update-health=${fallbackToken}`]);
    const ok=await observe(fallback,path.join(root,`health-${fallbackToken}.json`),fallbackToken,plan.previous.version,{wait,now});
    if(!ok){await stop(fallback,{wait,now});return report('rollback-failed');}fallback.unref?.();return report('rolled-back');
  }catch{return report('rollback-failed');}
}
async function writeUpdateHealth({root,token,version,pid=process.pid}){
  if(!TOKEN.test(token)||!VERSION.test(version))throw new Error('UPDATE_HEALTH_INVALID');
  await atomicJson(path.join(root,`health-${token}.json`),{token,version,pid,status:'ready',at:Date.now()});
}
module.exports={TOKEN,validLaunch,validPlan,observeStartup,stopOwned,runUpdateTransaction,writeUpdateHealth};
