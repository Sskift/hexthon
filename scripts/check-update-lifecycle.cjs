const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const {runUpdateTransaction,observeStartup,stopOwned}=require('../src/core/update-transaction.cjs');
const root=path.resolve(__dirname,'../.qa/update-lifecycle',crypto.randomUUID()),reports=[];
async function scenario(name,modes){
  const directory=path.join(root,name),updates=path.join(directory,'updates');await fs.mkdir(updates,{recursive:true});
  const original=JSON.stringify({paused:true,unchanged:'旧版配置'});await fs.writeFile(path.join(directory,'settings.json'),original);
  const sha='a'.repeat(64),plan={schemaVersion:1,token:crypto.randomUUID(),createdAt:Date.now(),parentPid:process.pid,
    target:{key:`0.4.2-${sha.slice(0,12)}-1234abcd`,version:'0.4.2',sha256:sha,manifestSha256:'f'.repeat(64)},
    previous:{version:'0.4.1',exe:path.join(directory,'previous','Hexthon.exe'),cwd:path.join(directory,'previous'),args:['--assist','--paused']}};
  const children=[];
  try{
    const result=await runUpdateTransaction({root:updates,plan,isAlive:()=>false,verify:async()=>({manifestSha256:'f'.repeat(64)}),
      spawnApp:(descriptor,args)=>{
        const index=children.length,token=args.find(a=>a.startsWith('--update-health=')).split('=')[1];
        const child=spawn(process.execPath,[path.resolve(__dirname,'../tests/fixtures/update-child.cjs'),updates,token,index===0?'0.4.2':'0.4.1',modes[index]],{windowsHide:true,stdio:'ignore'});
        children.push(child);return child;
      },observe:(child,file,token,version,options)=>observeStartup(child,file,token,version,{...options,timeoutMs:5000})});
    const expected=modes[0]==='ready'?'updated':modes[1]==='ready'?'rolled-back':'rollback-failed';
    assert.equal(result.status,expected);
    assert.equal(children.length,modes.length);
    if(expected!=='rollback-failed')assert.equal(await fs.readFile(path.join(directory,'settings.json'),'utf8'),original);
    reports.push({scenario:name,status:result.status,processesStarted:children.length,actualPackageExecutable:false});
  }finally{
    for(const child of children)assert.equal(await stopOwned(child),true,'Every owned process must close');
  }
}
(async()=>{
  await scenario('healthy',['ready']);await scenario('failed-new-restores-old',['fail','ready']);await scenario('early-crash-restores-old',['brief','ready']);await scenario('both-fail',['fail','fail']);
  const report={passed:true,actualChildProcesses:true,actualPackageExecutable:false,actualGameAccess:false,externalNetwork:false,visibleUi:false,scenarios:reports};
  await fs.writeFile(path.resolve(__dirname,'../.qa/update-lifecycle.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
