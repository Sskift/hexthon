const {spawn}=require('node:child_process');
require('node:fs').mkdirSync(require('node:path').resolve(__dirname,'../.qa/profile'),{recursive:true});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require('electron'),['.','--smoke-test',...process.argv.slice(2)],{cwd:require('node:path').resolve(__dirname,'..'),env,windowsHide:true,stdio:'inherit'});
child.on('error',e=>{console.error(e.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
const timeout=setTimeout(()=>{child.kill();process.exitCode=1;console.error('Smoke test timeout');},60000);
child.on('exit',()=>clearTimeout(timeout));
