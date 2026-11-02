// Explicit optional write/restore preflight; ordinary invocation is read-only.
const fs=require('node:fs/promises'),path=require('node:path');
const {LeagueReader}=require('../src/core/league.cjs');
const {NativeItemSetSync}=require('../src/core/native-itemsets-sync.cjs');
const {buildItemSet}=require('../src/core/native-itemsets.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{
  const profile=path.join(process.env.APPDATA,'Hexthon'),catalog=require('../data/seed/index.json');
  let settings={};try{settings=JSON.parse(await fs.readFile(path.join(profile,'settings.json'),'utf8'));}catch{}
  const reader=new LeagueReader();await reader.poll(settings,catalog.champions,catalog.augments);
  const sync=new NativeItemSetSync({client:reader.itemSetsClient(),journalPath:path.join(profile,'native-itemsets.json')});
  const before=await sync.probe(),report={before,writeRequested:process.argv.includes('--write-restore'),write:null,restore:null,after:null,hotReloadVerified:false};
  if(report.writeRequested&&before.readable){
    const champion=catalog.champions.find(row=>row.key==='ahri');
    const itemSet=buildItemSet({championId:champion.id,championName:champion.name,buildSuggestions:require('../data/seed/ahri-build.json').builds});
    try{report.write=await sync.importPreview({itemSet});}
    finally{report.restore=await sync.restore({championId:champion.id});await sync.flush();report.after=await sync.probe();}
  }
  report.passed=report.writeRequested?report.write?.writeVerified===true&&report.restore?.status==='restored'&&report.after?.itemSetCount===before.itemSetCount:before.readable;
  await fs.mkdir(path.join(root,'.qa'),{recursive:true});await fs.writeFile(path.join(root,'.qa/native-itemsets-client.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
})().catch(()=>{console.error('Native item-set preflight could not complete; inspect the local rollback journal before retrying.');process.exitCode=1;});
