// Runs with the already installed Electron's Node runtime after the UI requests an update.
const path=require('node:path'),fs=require('node:fs/promises');
const {readJson,atomicJson}=require('../src/core/app-updates.cjs');
const {runUpdateTransaction,TOKEN,validPlan}=require('../src/core/update-transaction.cjs');
const {gameIsClosed}=require('../src/core/update-game-guard.cjs');
(async()=>{
  const root=path.join(process.env.APPDATA||'','Hexthon','updates'),filename=path.resolve(process.argv[2]||'');
  const token=path.basename(filename).replace(/^plan-/,'').replace(/\.json$/,'');
  if(!process.env.APPDATA||path.dirname(filename).toLowerCase()!==path.resolve(root).toLowerCase()||!TOKEN.test(token)||path.basename(filename)!==`plan-${token}.json`)throw new Error('UPDATE_PLAN_PATH');
  const lock=await fs.open(path.join(root,`transaction-${token}.lock`),'wx');await lock.close();
  const plan=await readJson(filename);if(plan?.token!==token||!validPlan(plan))throw new Error('UPDATE_PLAN_INVALID');
  await atomicJson(path.join(root,`prepared-${token}.json`),{token,pid:process.pid,at:Date.now()});
  await runUpdateTransaction({root,plan,canApply:gameIsClosed});
})().catch(async()=>{
  const root=path.join(process.env.APPDATA||'','Hexthon','updates');
  if(process.env.APPDATA)await atomicJson(path.join(root,'result.json'),{status:'rollback-failed',at:Date.now()}).catch(()=>{});
  process.exitCode=1;
});
