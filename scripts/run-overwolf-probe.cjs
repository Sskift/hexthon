const {spawn} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {createSdkDiagnostics} = require('../experiments/overwolf-probe/diagnostics.cjs');
const root=path.resolve(__dirname,'..'),probe=path.join(root,'experiments/overwolf-probe');
const out=path.join(root,'.qa/overwolf-probe');
fs.mkdirSync(out,{recursive:true});
// Remove this probe's legacy raw log; current runs persist only fixed diagnostics.
fs.rmSync(path.join(out,'runtime.log'),{force:true});
const sdkDir=path.join(probe,'node_modules/@overwolf/ow-electron');
if(process.platform!=='win32'){
  console.error('Overwolf GEP 开发探针需要 Windows。');process.exitCode=1;
} else if(!fs.existsSync(path.join(sdkDir,'path.txt'))){
  console.error('先执行 npm.cmd ci --prefix experiments/overwolf-probe，再执行 node experiments/overwolf-probe/node_modules/@overwolf/ow-electron/install.js');
  process.exitCode=1;
} else {
  const executable=path.join(sdkDir,'dist',fs.readFileSync(path.join(sdkDir,'path.txt'),'utf8').trim());
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const requested=Number(process.argv.find(a=>a.startsWith('--duration-ms='))?.split('=')[1]);
  const durationMs=Number.isFinite(requested)?Math.max(10000,Math.min(300000,requested)):45000;
  const diagnostics=createSdkDiagnostics(),startedAt=new Date().toISOString();
  const child=spawn(executable,[probe,`--duration-ms=${durationMs}`],{cwd:probe,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let launchError=null,timedOut=false,finished=false,cleaning=false,exitCode=null;
  let deadline,cleanupTimer;
  const cleanup={attempted:false,method:null,result:'not-needed'};
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>diagnostics.observe(chunk.toString()));
  function finish(code) {
    if(finished)return;finished=true;clearTimeout(deadline);clearTimeout(cleanupTimer);
    // Destroy inherited pipes so an unresponsive descendant cannot keep this
    // diagnostic launcher waiting forever after the bounded cleanup attempt.
    child.stdout.destroy();child.stderr.destroy();child.unref();
    const launch={startedAt,finishedAt:new Date().toISOString(),pid:child.pid??null,exitCode:code,
      launchError,timedOut,cleanup,authorizationSignals:diagnostics.snapshot()};
    fs.writeFileSync(path.join(out,'launch.json'),JSON.stringify(launch,null,2)+'\n');
    let status=null;
    try{const s=JSON.parse(fs.readFileSync(path.join(out,'status.json'),'utf8'));if(s.startedAt>=startedAt&&s.pid===child.pid)status=s;}catch{}
    console.log(JSON.stringify({launch,outcome:status?.outcome||'runtime-did-not-complete',stages:status?.stages,report:path.join(out,'status.json')}));
    process.exitCode=launchError||timedOut||code!==0||cleanup.attempted?1:0;
  }
  function stopOwnedTree(reason) {
    if(finished||cleaning)return;cleaning=true;cleanup.attempted=true;cleanup.reason=reason;
    if(reason==='deadline')timedOut=true;
    // A still-running ChildProcess is the ownership proof. Never target a
    // process name, an arbitrary PID or a parent PID after it has exited.
    if(!Number.isSafeInteger(child.pid)||child.pid<=0||child.exitCode!==null||child.signalCode!==null){
      cleanup.result='root-already-exited-descendants-unverified';cleaning=false;finish(exitCode);return;
    }
    cleanup.method='taskkill-owned-process-tree';
    const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
    const settle=(result,code=null)=>{
      if(finished||!cleaning)return;cleaning=false;clearTimeout(cleanupTimer);
      cleanup.result=result;cleanup.taskkillExitCode=code;finish(exitCode??child.exitCode);
    };
    killer.once('error',()=>settle('tree-termination-unconfirmed'));
    killer.once('exit',code=>settle(code===0?'tree-termination-succeeded':'tree-termination-unconfirmed',code));
    cleanupTimer=setTimeout(()=>{
      killer.kill();killer.unref();settle('tree-termination-timeout');
    },8000);
  }
  deadline=setTimeout(()=>stopOwnedTree('deadline'),durationMs+30000);
  child.once('error',e=>{launchError={code:/^[A-Z_0-9]+$/.test(e.code||'')?e.code:'SPAWN_ERROR'};});
  child.once('exit',code=>{exitCode=code;});
  child.once('close',code=>{exitCode=code;if(!cleaning)finish(code);});
  process.once('SIGINT',()=>stopOwnedTree('interrupted'));
  process.once('SIGTERM',()=>stopOwnedTree('terminated'));
}
