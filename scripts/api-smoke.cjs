const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
async function runApiSmoke({panel,state,snapshot,publish,recalculate,windows,setNativeSync,setUpdates}){
  assert.equal(windows.length,1,'API mode creates only the control panel');
  assert.equal(panel.isVisible(),false);
  assert.equal(state.captureEnabled,false);
  assert.equal(state.recognitionMode,'api');
  assert.equal(snapshot().settings.autoScan,false);
  assert.equal(state.selectionHistoryComplete,false);
  const run=code=>panel.webContents.executeJavaScript(code);
  assert.equal(await run('typeof window.require'),'undefined');
  assert.equal(await run('window.hexthon.scan().then(()=>false,()=>true)'),true,'Capture cannot be manually invoked in API mode');
  await run('window.hexthon.toggleOverlay()');
  assert.equal(state.overlayVisible,false);
  assert.equal(await run('document.getElementById("overlay-toggle").hidden'),true);
  assert.equal(await run('document.getElementById("scan").hidden'),true);
  assert.match(await run('document.querySelector(".auto-banner strong").textContent'),/无画面采集/);
  let updateChecks=0,updateDownloads=0;
  setUpdates({check:async()=>{updateChecks++;state.updates={status:'current',currentVersion:state.version};publish();return state.updates;},stage:async()=>{updateDownloads++;return {};}});
  assert.equal((await run('window.hexthon.checkUpdates()')).status,'current');assert.equal(updateChecks,1);
  assert.match(await run('document.getElementById("updates-status").textContent'),/最新版本/);
  assert.equal(await run('window.hexthon.applyUpdate().then(()=>false,()=>true)'),true,'Test mode cannot install updates');
  state.selectedChampion=state.catalog.champions.find(c=>c.id===103);
  state.game={...state.game,phase:'InProgress',liveConnected:true,championId:103,
    ownItems:[{id:1058,name:'无用大棒'}],team:[{championId:103,isSelf:true,items:[{id:1058}]}],
    opponents:[{championId:57,items:[{id:3065,name:'振奋盔甲'}]}]};
  recalculate();publish();
  assert.equal(await run('window.hexthon.downloadUpdate().then(()=>false,()=>true)'),true,'In-game state blocks downloads before any process query');assert.equal(updateDownloads,0);
  assert.ok(state.matchup.recommendations.some(r=>/法穿/.test(r.reason)),'Observed magic-resist equipment drives a contextual item suggestion');
  const markup=await run('window.hexthon.getState().then(value=>{state=value;render();return document.getElementById("matchup-list").textContent})');
  assert.match(markup,/法穿/);assert.match(markup,/海克斯记录不完整/);
  const revision=state.recommendationRevision;
  state.game.checkedAt=new Date().toISOString();state.game.gameTime=250;recalculate();
  assert.equal(state.recommendationRevision,revision,'Identical gameplay context reuses recommendations');
  let imports=0,restores=0;
  setNativeSync({probe:async()=>({status:'available',readable:true}),importPreview:async({itemSet,isCurrent})=>{
    imports++;assert.equal(isCurrent(),true);assert.deepEqual(itemSet.associatedChampions,[103]);assert.ok(itemSet.blocks.length);
    return {status:'written',writeVerified:true,hotReloadVerified:false};
  },flush:async()=>{throw new Error('simulated earlier disk failure');},restore:async()=>{restores++;return {status:'restored',restored:1};}});
  await run('window.hexthon.probeNativeItemSets()');await run('window.hexthon.importNativeItemSet()');assert.equal(imports,1);
  state.game.gameVersion='99.99.1';recalculate();publish();
  assert.equal(state.compatibility.staticRulesEnabled,false);
  assert.equal(await run('window.hexthon.importNativeItemSet().then(()=>false,()=>true)'),true);assert.equal(imports,1);
  state.game.gameVersion=null;recalculate();
  await run('window.hexthon.restoreNativeItemSets()');assert.equal(restores,1);assert.equal(snapshot().settings.nativeItemSets,false);
  const exported=await run('window.hexthon.exportDiagnostics()');
  const diagnostics=JSON.parse(await fs.readFile(exported.filename,'utf8'));
  assert.equal(diagnostics.coverage.completeSelectedAugments,false);assert.equal('monitor' in diagnostics,false);
  state.selectedChampion=state.catalog.champions.find(c=>c.id===22);recalculate();publish();
  assert.equal(state.matchup,null,'Browsing another hero must not apply the current player inventory');
  assert.ok(state.buildSuggestions.every(g=>g.rows.every(r=>r.items.every(i=>i.owned===null))));
  assert.equal(panel.isVisible(),false);assert.equal(state.captureEnabled,false);
  const report={passed:true,captureEnabled:false,windowCount:1,imagesCreated:0,checks:['API default','one hidden panel','capture IPC blocked','no overlay','clear capability status','equipment context renders','other champion context isolated','unchanged context reuse','manual native itemset IPC with fake transport','patch mismatch blocks native import','restore retries after earlier disk failure','redacted diagnostic export','update check through panel IPC','in-game download blocked','test-mode install blocked']};
  await fs.mkdir(path.resolve(__dirname,'../.qa'),{recursive:true});
  await fs.writeFile(path.resolve(__dirname,'../.qa/api-smoke.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}
module.exports={runApiSmoke};
