const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
async function runApiSmoke({panel,state,snapshot,publish,recalculate,windows}){
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
  state.selectedChampion=state.catalog.champions.find(c=>c.id===103);
  state.game={...state.game,phase:'InProgress',liveConnected:true,championId:103,
    ownItems:[{id:1058,name:'无用大棒'}],team:[{championId:103,isSelf:true,items:[{id:1058}]}],
    opponents:[{championId:57,items:[{id:3065,name:'振奋盔甲'}]}]};
  recalculate();publish();
  assert.ok(state.matchup.recommendations.some(r=>/法穿/.test(r.reason)),'Observed magic-resist equipment drives a contextual item suggestion');
  const markup=await run('window.hexthon.getState().then(value=>{state=value;render();return document.getElementById("matchup-list").textContent})');
  assert.match(markup,/法穿/);assert.match(markup,/海克斯记录不完整/);
  state.selectedChampion=state.catalog.champions.find(c=>c.id===22);recalculate();publish();
  assert.equal(state.matchup,null,'Browsing another hero must not apply the current player inventory');
  assert.ok(state.buildSuggestions.every(g=>g.rows.every(r=>r.items.every(i=>i.owned===null))));
  assert.equal(panel.isVisible(),false);assert.equal(state.captureEnabled,false);
  const report={passed:true,captureEnabled:false,windowCount:1,imagesCreated:0,checks:['API default','one hidden panel','capture IPC blocked','no overlay','clear capability status','equipment context renders','other champion context isolated']};
  await fs.mkdir(path.resolve(__dirname,'../.qa'),{recursive:true});
  await fs.writeFile(path.resolve(__dirname,'../.qa/api-smoke.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}
module.exports={runApiSmoke};
