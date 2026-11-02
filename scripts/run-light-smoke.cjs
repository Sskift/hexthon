const {spawn}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
async function run(file,args){
  await new Promise((resolve,reject)=>{
    const child=spawn(file,args,{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';
    child.stdout.on('data',data=>{output+=data;if(output.length>16000)output=output.slice(-16000);});
    child.stderr.on('data',data=>{output+=data;if(output.length>16000)output=output.slice(-16000);});const timer=setTimeout(()=>{child.kill();reject(new Error('Offline smoke timed out'));},45000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('close',code=>{clearTimeout(timer);if(code===0)resolve();else reject(new Error(output.slice(-2200)||`Offline smoke exited ${code}`));});
  });
}
(async()=>{
  await run(process.execPath,['scripts/check-light-offline.cjs']);
  await run(process.execPath,['scripts/check-light-shop-offline.cjs']);
  await run(require('electron'),['.','--light-smoke-test']);
  console.log(require('node:fs').readFileSync(path.join(root,'.qa/light-smoke.json'),'utf8'));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
