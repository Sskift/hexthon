const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
async function main(){
 const root=path.resolve(__dirname,'../assets'),dir=path.join(root,'opgg');await fs.mkdir(dir,{recursive:true});
 const urls=new Set();
 const walk=v=>{if(!v||typeof v!=='object')return;if(typeof v.image==='string'&&v.image.startsWith('https://opgg-static.akamaized.net/'))urls.add(v.image.split('?')[0]);for(const x of Object.values(v))walk(x);};
 for(const file of await fs.readdir(path.resolve(__dirname,'../data/seed')))if(file.endsWith('.json'))walk(JSON.parse(await fs.readFile(path.resolve(__dirname,'../data/seed',file),'utf8')));
 const manifest={},queue=[...urls];let failed=0;
 async function worker(){while(queue.length){const url=queue.shift(),filename=crypto.createHash('sha256').update(url).digest('hex').slice(0,24)+'.png';try{
  try{await fs.access(path.join(dir,filename));}catch{const r=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!r.ok||!r.headers.get('content-type')?.startsWith('image/'))throw new Error('image unavailable');const b=Buffer.from(await r.arrayBuffer());if(b.length>2000000)throw new Error('too large');await fs.writeFile(path.join(dir,filename),b);}
  manifest[url]=filename;
 }catch{failed++;}}}
 await Promise.all(Array.from({length:4},worker));await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest));
 console.log(`Cached ${Object.keys(manifest).length} OP.GG icons; ${failed} unavailable. Source URLs preserved in manifest.`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
