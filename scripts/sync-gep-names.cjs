const fs = require('node:fs/promises');
const path = require('node:path');
const {parsePage} = require('../src/core/opgg.cjs');
const urls = ['https://op.gg/lol/modes/aram-mayhem', 'https://op.gg/zh-cn/lol/modes/aram-mayhem'];
async function readPage(url) {
  const response = await fetch(url, {redirect:'error', signal:AbortSignal.timeout(25000),
    headers:{'User-Agent':'Hexthon/0.2.2 (+local desktop companion)', Accept:'text/html'}});
  if (!response.ok) throw new Error(`OP.GG HTTP ${response.status}`);
  const chunks=[];let size=0;
  for await (const chunk of response.body) {
    size+=chunk.length;if(size>12*1024*1024)throw new Error('OP.GG page exceeds size limit');
    chunks.push(chunk);
  }
  return parsePage(Buffer.concat(chunks).toString('utf8'), {url});
}
async function main() {
  const [english,chinese]=await Promise.all(urls.map(readPage));
  if(!english.patch || english.patch!==chinese.patch)throw new Error('Language snapshots must have the same known patch');
  const augments=[];
  for(const en of english.augments) {
    const zh=chinese.augments.filter(a=>a.id===en.id);
    if(zh.length!==1 || en.key!==zh[0].key || en.rarity!==zh[0].rarity)continue;
    if(english.augments.filter(a=>a.id===en.id).length!==1)continue;
    augments.push({id:en.id,key:en.key,name:zh[0].name,englishName:en.name});
  }
  if(augments.length<100)throw new Error('Insufficient verified bilingual ID matches');
  const data={source:'OP.GG',patch:english.patch,fetchedAt:new Date().toISOString(),urls,
    purpose:'Exact GEP display-name resolution; not a compatibility or event-capture result',augments};
  const target=path.resolve(__dirname,'../data/seed/gep-names.json');
  await fs.writeFile(target,JSON.stringify(data,null,2)+'\n');
  console.log(JSON.stringify({patch:data.patch,verifiedNames:augments.length,target}));
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
