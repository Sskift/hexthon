const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const {AppUpdates,API,REPO,releaseCandidate,compareVersions,request,idleForUpdate,installDirectory}=require('../src/core/app-updates.cjs');
const {validPlan,validLaunch,runUpdateTransaction,observeStartup}=require('../src/core/update-transaction.cjs');
const CURRENT='0.4.0',NEXT='0.4.1',MANIFEST='c'.repeat(64);
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function release(bytes=Buffer.alloc(24,7),patch={}){
  const name=`Hexthon-${NEXT}-win32-x64.zip`;
  return {tag_name:`v${NEXT}`,draft:false,prerelease:false,assets:[{name,state:'uploaded',size:bytes.length,digest:'sha256:'+digest(bytes),browser_download_url:`https://github.com/${REPO}/releases/download/v${NEXT}/${name}`}],...patch};
}
async function isolated(run){
  const tempRoot=path.resolve(os.tmpdir()),directory=await fs.mkdtemp(path.join(tempRoot,'hexthon-update-test-'));
  try{return await run(directory);}finally{
    assert.equal(path.dirname(path.resolve(directory)),tempRoot);assert.ok(path.basename(directory).startsWith('hexthon-update-test-'));
    await fs.rm(directory,{recursive:true,force:true});
  }
}
function manager(root,{data=Buffer.alloc(24,7),published=release(data),download=data,extract=async(_archive,destination)=>path.join(destination,'Hexthon-win32-x64'),verify=async()=>({manifestSha256:MANIFEST})}={}){
  const calls=[],updates=new AppUpdates({root,currentVersion:CURRENT,extract,verify,fetcher:async(url,options)=>{
    calls.push({url,redirect:options.redirect});return url===API?new Response(JSON.stringify(published)):new Response(download);
  }});return {updates,calls};
}
test('update candidates require a newer canonical stable release and exact publisher asset digest',()=>{
  const r=release();assert.equal(releaseCandidate(r,CURRENT).version,NEXT);assert.equal(compareVersions('1.10.0','1.9.9'),1);
  assert.equal(releaseCandidate(r,NEXT),null);assert.equal(releaseCandidate(r,'1.0.0'),null);
  for(const altered of [{...r,draft:true},{...r,prerelease:true},{...r,tag_name:'0.4.1'}, {...r,tag_name:'v00.4.1'},
    {...r,assets:[...r.assets,...r.assets]}, {...r,assets:[{...r.assets[0],digest:null}]},
    {...r,assets:[{...r.assets[0],browser_download_url:'https://example.com/Hexthon.zip'}]}])assert.throws(()=>releaseCandidate(altered,CURRENT),/UPDATE_/);
});
test('update redirects never follow external, downgraded, credentialed or looping destinations',async()=>{
  for(const location of ['https://example.com/file','http://github.com/file','https://user@github.com/file','https://github.com:444/file']){
    let calls=0;await assert.rejects(request(API,{fetcher:async()=>{calls++;return new Response(null,{status:302,headers:{location}});}}),/UPDATE_REDIRECT_REJECTED/);assert.equal(calls,1);
  }
  let calls=0;await assert.rejects(request(API,{fetcher:async()=>{calls++;return new Response(null,{status:302,headers:{location:API}});}}),/UPDATE_REDIRECT_LIMIT/);assert.equal(calls,6);
  const seen=[];const ok=await request(API,{fetcher:async(url,options)=>{seen.push(url);assert.equal(options.redirect,'manual');return seen.length===1?new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/release-assets/file'}}):new Response('ok');}});
  assert.equal(await ok.text(),'ok');assert.equal(seen.length,2);
});
test('only idle lifecycle states permit update staging and applying',()=>{
  for(const phase of ['Disconnected','None','Lobby','EndOfGame'])assert.equal(idleForUpdate({phase,liveConnected:false}),true);
  for(const phase of ['InProgress','ChampSelect','Reconnect','GameStart','WaitingForStats',undefined])assert.equal(idleForUpdate({phase,liveConnected:false}),false);
  assert.equal(idleForUpdate({phase:'EndOfGame',liveConnected:true}),false);
});
test('staging verifies downloaded bytes before extraction and writes a bounded prepared plan',async()=>isolated(async root=>{
  const events=[],{updates}=manager(root,{extract:async(archive,destination)=>{events.push('extract');assert.equal((await fs.readFile(archive)).length,24);return path.join(destination,'Hexthon-win32-x64');},verify:async(_directory,_version,options)=>{if(events.includes('verify'))assert.equal(options.expectedManifestSha256,MANIFEST);events.push('verify');return {manifestSha256:MANIFEST};}});
  assert.equal((await updates.check()).status,'available');assert.equal((await updates.stage()).status,'ready');assert.deepEqual(events,['extract','verify']);
  const prepared=await updates.prepare({parentPid:100,previous:{version:CURRENT,exe:path.join(root,'old','Hexthon.exe'),cwd:path.join(root,'old'),args:['--assist','--paused']}});
  const plan=JSON.parse(await fs.readFile(prepared.filename,'utf8'));assert.equal(validPlan(plan),true);assert.equal(plan.token,prepared.token);assert.equal(plan.target.manifestSha256,MANIFEST);assert.deepEqual(events,['extract','verify','verify']);
  assert.ok(installDirectory(root,plan.target.key).startsWith(path.join(root,'packages')));
}));
test('wrong digest or length fails staging without calling extraction or leaving a ready update',async()=>isolated(async root=>{
  for(const download of [Buffer.alloc(24,8),Buffer.alloc(23,7),Buffer.alloc(25,7)]){
    let extraction=0;const {updates}=manager(root,{download,extract:async()=>{extraction++;}});await updates.check();
    const result=await updates.stage();assert.equal(result.status,'error');assert.match(result.error,/UPDATE_DOWNLOAD_(?:HASH|SIZE)/);assert.equal(updates.staged,null);assert.equal(extraction,0);
    await assert.rejects(updates.prepare({}),/UPDATE_NOT_READY/);
  }
}));
test('game entry during verification invalidates the staged result and never permits prepare',async()=>isolated(async root=>{
  let idle=true;const {updates}=manager(root,{verify:async()=>{idle=false;}});await updates.check();
  const result=await updates.stage({isCurrent:()=>idle});assert.equal(result.status,'error');assert.equal(result.error,'UPDATE_GAME_ACTIVE');
  await assert.rejects(updates.prepare({}),/UPDATE_NOT_READY/);assert.equal(updates.staged,null);
}));
test('missing manifest proof or failing to persist it cannot leave an installable staged update',async()=>isolated(async root=>{
  const missing=manager(root,{verify:async()=>({})}).updates;await missing.check();assert.equal((await missing.stage()).error,'UPDATE_MANIFEST_HASH');assert.equal(missing.staged,null);
  const blocked=manager(root).updates;await blocked.check();const originalRename=fs.rename;
  fs.rename=async(from,to)=>{if(to===path.join(root,'staged.json'))throw Object.assign(new Error('fixture disk error'),{code:'EACCES'});return originalRename(from,to);};
  try{assert.equal((await blocked.stage()).status,'error');assert.equal(blocked.staged,null);await assert.rejects(blocked.prepare({}),/UPDATE_NOT_READY/);}
  finally{fs.rename=originalRename;}
}));
test('release absence and server faults clear actionable update candidates and sanitize errors',async()=>isolated(async root=>{
  const updates=new AppUpdates({root,currentVersion:CURRENT,fetcher:async()=>new Response(null,{status:404})});
  assert.equal((await updates.check()).status,'unpublished');await assert.rejects(updates.stage(),/UPDATE_CHECK_REQUIRED/);
  updates.fetcher=async()=>{throw new Error('secret token and private path');};const result=await updates.check();
  assert.equal(result.error,'UPDATE_NETWORK_OR_DISK');assert.doesNotMatch(JSON.stringify(result),/secret|private path/);
}));
test('restart can recover newer staged metadata but applying must reverify its actual files',async()=>isolated(async root=>{
  const sha='a'.repeat(64),staged={version:NEXT,key:`${NEXT}-${sha.slice(0,12)}-1234abcd`,sha256:sha,manifestSha256:MANIFEST};await fs.writeFile(path.join(root,'staged.json'),JSON.stringify(staged));
  let verifies=0;const updates=new AppUpdates({root,currentVersion:CURRENT,fetcher:async()=>{throw new Error('must stay offline');},verify:async()=>{verifies++;throw new Error('UPDATE_FILE_HASH');}});
  assert.equal((await updates.init()).status,'ready');assert.equal(verifies,0);
  await assert.rejects(updates.prepare({parentPid:100,previous:{version:CURRENT,exe:path.join(root,'Hexthon.exe'),cwd:root,args:[]}}),/UPDATE_FILE_HASH/);assert.equal(verifies,1);
  const current=new AppUpdates({root,currentVersion:NEXT});assert.equal((await current.init()).status,'idle');assert.equal(current.staged,null);
  await fs.writeFile(path.join(root,'staged.json'),JSON.stringify({...staged,key:'../escape'}));const unsafe=new AppUpdates({root,currentVersion:CURRENT});assert.equal((await unsafe.init()).status,'idle');
  await fs.writeFile(path.join(root,'staged.json'),JSON.stringify({...staged,manifestSha256:undefined}));const legacy=new AppUpdates({root,currentVersion:CURRENT});assert.equal((await legacy.init()).status,'idle');
}));

function plan(root){
  const sha='a'.repeat(64);return{schemaVersion:1,token:crypto.randomUUID(),createdAt:Date.now(),parentPid:100,
    target:{version:NEXT,key:`${NEXT}-${sha.slice(0,12)}-1234abcd`,sha256:sha,manifestSha256:MANIFEST},previous:{version:CURRENT,exe:path.join(root,'old','Hexthon.exe'),cwd:path.join(root,'old'),args:['--assist','--paused']}};
}
function child(pid){const value=new EventEmitter();value.pid=pid;value.exitCode=null;value.signalCode=null;value.unref=()=>{};return value;}
test('update plans reject stale, traversing and arbitrary executable launch instructions',()=>{
  const p=plan(path.resolve('test-workspace'));assert.equal(validPlan(p),true);
  for(const altered of [{...p,createdAt:Date.now()-16*60*1000},{...p,target:{...p.target,key:'../outside'}},{...p,target:{...p.target,manifestSha256:undefined}},{...p,target:{...p.target,manifestSha256:'invalid'}},{...p,token:'../../x'},{...p,parentPid:-1},
    {...p,previous:{...p.previous,exe:path.join(p.previous.cwd,'cmd.exe')}},{...p,previous:{...p.previous,args:['--eval','process.exit()']}}])assert.equal(Boolean(validPlan(altered)),false);
  assert.equal(Boolean(validLaunch({...p.previous,args:['--inspect']})),false);
});
test('healthy replacement commits its own entry point without changing user files',async()=>isolated(async directory=>{
  const root=path.join(directory,'updates'),p=plan(directory);await fs.mkdir(root);await fs.writeFile(path.join(directory,'settings.json'),'original');
  const launches=[];const result=await runUpdateTransaction({root,plan:p,isAlive:()=>false,verify:async(_directory,_version,options)=>{assert.equal(options.expectedManifestSha256,MANIFEST);},spawnApp:(descriptor,args)=>{launches.push({descriptor,args});return child(101);},observe:async()=>true});
  assert.equal(result.status,'updated');assert.equal(launches.length,1);assert.equal(launches[0].descriptor.exe,path.join(installDirectory(root,p.target.key),'Hexthon.exe'));
  assert.deepEqual(launches[0].descriptor.args,['--assist','--paused']);assert.equal(await fs.readFile(path.join(root,'active-path.txt'),'utf8'),p.target.key);assert.equal(await fs.readFile(path.join(directory,'settings.json'),'utf8'),'original');
}));
test('failed target startup stops only its child and restores configuration before relaunching previous version',async()=>isolated(async directory=>{
  const root=path.join(directory,'updates'),p=plan(directory);await fs.mkdir(root);await fs.writeFile(path.join(directory,'settings.json'),'original');
  const previous={schemaVersion:1,active:{key:`0.3.1-${'b'.repeat(12)}-1234abcd`},previous:null};await fs.writeFile(path.join(root,'active.json'),JSON.stringify(previous));
  const children=[],stopped=[];let observations=0;
  const result=await runUpdateTransaction({root,plan:p,isAlive:()=>false,verify:async()=>{},spawnApp:(descriptor)=>{const c=child(101+children.length);children.push({c,descriptor});return c;},
    observe:async()=>{if(++observations===1){await fs.writeFile(path.join(directory,'settings.json'),'new schema');await fs.writeFile(path.join(directory,'selection-history.json'),'new history');return false;}
      assert.equal(await fs.readFile(path.join(directory,'settings.json'),'utf8'),'original');await assert.rejects(fs.stat(path.join(directory,'selection-history.json')),error=>error.code==='ENOENT');return true;},
    stop:async c=>{stopped.push(c.pid);return true;}});
  assert.equal(result.status,'rolled-back');assert.deepEqual(stopped,[101]);assert.equal(children[1].descriptor.exe,p.previous.exe);
  assert.equal(await fs.readFile(path.join(root,'active-path.txt'),'utf8'),previous.active.key);
}));
test('if the target cannot be stopped rollback does not start another application',async()=>isolated(async directory=>{
  const root=path.join(directory,'updates');let launches=0;
  const result=await runUpdateTransaction({root,plan:plan(directory),isAlive:()=>false,verify:async()=>{},spawnApp:()=>{launches++;return child(101);},observe:async()=>false,stop:async()=>false});
  assert.equal(result.status,'rollback-failed');assert.equal(launches,1);
}));
test('unhealthy fallback is stopped as an owned child before rollback failure is recorded',async()=>isolated(async directory=>{
  const root=path.join(directory,'updates'),stopped=[];let launches=0;
  const result=await runUpdateTransaction({root,plan:plan(directory),isAlive:()=>false,verify:async()=>{},spawnApp:()=>child(101+launches++),observe:async()=>false,
    stop:async c=>{stopped.push(c.pid);return true;}});
  assert.equal(result.status,'rollback-failed');assert.equal(launches,2);assert.deepEqual(stopped,[101,102]);
}));
test('checkpoint restore failure reports rollback failure and does not launch against partially restored settings',async()=>isolated(async directory=>{
  const root=path.join(directory,'updates');await fs.writeFile(path.join(directory,'settings.json'),'original');let launches=0;
  const originalRename=fs.rename;
  fs.rename=async(from,to)=>{if(String(from).includes('settings.json.update-'))throw Object.assign(new Error('fixture failure'),{code:'EACCES'});return originalRename(from,to);};
  try{
    const result=await runUpdateTransaction({root,plan:plan(directory),isAlive:()=>false,verify:async()=>{},spawnApp:()=>{launches++;return child(101);},observe:async()=>false,stop:async()=>true});
    assert.equal(result.status,'rollback-failed');assert.equal(launches,1);
    assert.equal(JSON.parse(await fs.readFile(path.join(root,'result.json'),'utf8')).status,'rollback-failed');
  }finally{fs.rename=originalRename;}
}));
test('a parent that stays alive blocks update launches within the bounded wait',async()=>isolated(async directory=>{
  const root=path.join(directory,'updates'),p=plan(directory);let time=p.createdAt,launches=0;
  const result=await runUpdateTransaction({root,plan:p,isAlive:()=>true,now:()=>time,wait:async ms=>{time+=ms;},verify:async()=>{},spawnApp:()=>{launches++;return child(101);}});
  assert.equal(result.status,'parent-still-running');assert.equal(launches,0);assert.ok(time-p.createdAt>=15000&&time-p.createdAt<15200);
}));
test('a game detected after parent exit prevents target launch and resumes the previous version',async()=>isolated(async directory=>{
  const root=path.join(directory,'updates'),p=plan(directory),events=[],launches=[];
  const result=await runUpdateTransaction({root,plan:p,isAlive:()=>false,verify:async()=>{events.push('verify');},canApply:async()=>{events.push('game-check');return false;},
    spawnApp:descriptor=>{launches.push(descriptor);return child(201);},observe:async()=>true});
  assert.equal(result.status,'rolled-back');assert.deepEqual(events,['verify','game-check']);assert.equal(launches.length,1);assert.equal(launches[0].exe,p.previous.exe);
  assert.equal(await fs.readFile(path.join(root,'active-path.txt'),'utf8'),'');
}));
test('startup health requires the current token, child PID, version and fresh observation',async()=>isolated(async directory=>{
  const file=path.join(directory,'health.json'),c=child(201),token=crypto.randomUUID();let time=Date.now();
  const data={token,pid:201,version:NEXT,status:'ready',at:time};
  for(const altered of [{...data,pid:202},{...data,version:CURRENT},{...data,token:crypto.randomUUID()},{...data,at:time-10000}]){
    await fs.writeFile(file,JSON.stringify(altered));const start=time;
    assert.equal(await observeStartup(c,file,token,NEXT,{now:()=>time,wait:async ms=>{time+=ms;},timeoutMs:400}),false);assert.equal(time-start,400);
  }
  await fs.writeFile(file,JSON.stringify({...data,at:time}));assert.equal(await observeStartup(c,file,token,NEXT,{now:()=>time,wait:async ms=>{time+=ms;}}),true);
}));

test('a ready marker cannot commit an update that crashes during the startup stability interval',async()=>isolated(async directory=>{
  const file=path.join(directory,'health.json'),c=child(201),token=crypto.randomUUID();let time=Date.now();
  await fs.writeFile(file,JSON.stringify({token,pid:c.pid,version:NEXT,status:'ready',at:time}));const start=time;
  const ready=await observeStartup(c,file,token,NEXT,{now:()=>time,wait:async ms=>{time+=ms;if(time-start>=400)c.emit('exit',9);}});
  assert.equal(ready,false);assert.ok(time-start<1500);
}));
