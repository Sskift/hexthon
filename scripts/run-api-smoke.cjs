const {spawn}=require('node:child_process');
const path=require('node:path');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require('electron'),['.','--api-smoke-test'],{cwd:path.resolve(__dirname,'..'),env,windowsHide:true,stdio:'inherit'});
child.on('error',e=>{console.error(e.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;clearTimeout(timeout);});
const timeout=setTimeout(()=>{child.kill();process.exitCode=1;console.error('API smoke test timeout');},30000);
