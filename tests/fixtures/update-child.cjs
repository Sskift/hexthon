// Isolated process fixture: no Electron, game access, network, or visible UI.
const fs=require('node:fs/promises'),path=require('node:path');
const {writeUpdateHealth}=require('../../src/core/update-transaction.cjs');
const [root,token,version,mode]=process.argv.slice(2);
(async()=>{
  if(mode==='fail'){await fs.writeFile(path.join(root,'..','settings.json'),'unhealthy new version settings');process.exit(7);}
  await writeUpdateHealth({root,token,version});
  if(mode==='brief'){setTimeout(()=>process.exit(9),400);return;}
  setInterval(()=>{},1000);
})().catch(()=>process.exit(8));
