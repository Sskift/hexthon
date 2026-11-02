const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {locateOffer,OfferTracker}=require('../src/core/vision.cjs');
const {DEFAULTS}=require('../src/core/settings.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function runSmoke({panel, overlay, cardWindows, state, ocr, recalculate, layout, publish}) {
  const dir = path.resolve(__dirname, '../.qa'); await fs.mkdir(dir, { recursive: true });
  assert.equal(panel.isVisible(), false, 'Control panel must remain hidden');
  assert.equal(overlay.isVisible(), false, 'Overlay must remain hidden');
  assert.equal(overlay.isFocusable(), false, 'Overlay must not accept focus');
  assert.equal(overlay.isAlwaysOnTop(), true);
  for(const w of cardWindows){assert.equal(w.isVisible(),false);assert.equal(w.isFocusable(),false);assert.equal(w.isAlwaysOnTop(),true);}
  const run = script => panel.webContents.executeJavaScript(script);
  await wait(900);
  assert.equal(await run('typeof window.require'), 'undefined', 'Renderer must not have Node access');
  assert.equal(await run('document.querySelectorAll("select").length'),0,'Custom dropdown controls');
  assert.equal(await run('document.querySelectorAll(".augment-card").length'), 209);
  assert.equal(await run('document.querySelector(".champion-summary h2").textContent'), '九尾妖狐');
  await fs.writeFile(path.join(dir,'control-panel.png'), (await panel.webContents.capturePage()).toPNG());
  await run('document.querySelector("[data-rarity=\\"4\\"]").click()');
  const goldCount=await run('document.querySelectorAll(".augment-card").length');
  assert.ok(goldCount>20&&goldCount<209);
  await run('document.getElementById("augment-search").value="魔法飞弹";document.getElementById("augment-search").dispatchEvent(new Event("input"))');
  assert.equal(await run('document.querySelectorAll(".augment-card").length'),1);
  await run('document.querySelector("[data-offer]").click()'); await wait(100);
  assert.equal(state.offeredIds.length,1);
  await run('document.getElementById("clear-offers").click()');await wait(100);
  assert.equal(state.offeredIds.length,0);
  await run('document.querySelector("[data-tab=\\"builds\\"]").click()');
  await wait(250);
  assert.equal(await run('document.getElementById("tab-builds").hidden'),false);
  assert.ok(await run('document.querySelectorAll(".item").length')>10);
  await fs.writeFile(path.join(dir,'builds.png'),(await panel.webContents.capturePage()).toPNG());
  await run('document.querySelector("[data-tab=\\"settings\\"]").click()');
  await wait(250);
  assert.equal(await run('document.querySelector("input[name=autoScan]").checked'),true);
  assert.equal(await run('window.hexthon.setOffers([999999999]).then(()=>false,()=>true)'),true);
  assert.equal(await run('window.hexthon.scan().then(()=>false,()=>true)'),true);
  await fs.writeFile(path.join(dir,'settings.png'),(await panel.webContents.capturePage()).toPNG());
  await run(`window.hexthon.setOffers(${JSON.stringify(state.augments.slice(0,3).map(a=>a.id))})`);
  await wait(100);
  await fs.writeFile(path.join(dir,'overlay.png'),(await overlay.webContents.capturePage()).toPNG());
  assert.equal(await overlay.webContents.executeJavaScript('document.querySelectorAll(".row").length'),3);
  const names=['术士果汁盒','魔法飞弹','循环往复'];
  let offer=locateOffer({capturedAt:'sample-1',lines:names.map((text,i)=>({text,x:.2+i*.25,y:.4,width:.1,height:.035}))},state.catalog.augments);
  if (process.argv.includes('--with-ocr')) {
    const dataUrl = await run(`(() => {const c=document.createElement('canvas');c.width=1920;c.height=1080;const x=c.getContext('2d');x.fillStyle='#101a25';x.fillRect(0,0,1920,1080);x.fillStyle='#ffffff';x.font='36px Microsoft YaHei';x.textAlign='center';['术士果汁盒','魔法飞弹','循环往复'].forEach((s,i)=>x.fillText(s,480+i*480,440));return c.toDataURL('image/png');})()`);
    const img=require('electron').nativeImage.createFromDataURL(dataUrl);
    await fs.writeFile(path.join(dir,'ocr-synthetic.png'),img.toPNG());
    const result=await ocr.read(img,DEFAULTS.ocrRegion,state.catalog.augments);
    await fs.writeFile(path.join(dir,'ocr-synthetic.json'),JSON.stringify(result,null,2));
    assert.deepEqual(result.matches.filter(x=>x.exact).map(x=>x.name).sort(),['术士果汁盒','魔法飞弹','循环往复'].sort());
    offer=locateOffer(result,state.catalog.augments);assert.equal(offer.cards.length,3,'OCR title geometry locates three cards');
    console.log('Local Chinese OCR: 3/3 synthetic names recognized (not an in-game test)');
    await ocr.close();
  }
  // Hidden fixtures exercise the automatic pipeline without sending system input.
  let now=1000;const tracker=new OfferTracker({now:()=>now});
  assert.equal(tracker.observe(offer,{active:true}).stable,false);
  let tracked=tracker.observe({...offer,observedAt:'sample-2'},{active:true});assert.equal(tracked.stable,true);
  state.game={phase:'InProgress',lcuConnected:true,liveConnected:true,isMayhem:true,championId:103,
    ownItems:[{id:3089,name:'灭世者的死亡之帽'},{id:3115,name:'纳什之牙'}],team:[],availableChampionIds:[103]};
  state.monitor={game:{hwnd:'1',x:100,y:100,width:1920,height:1080,foreground:true,visible:true,minimized:false},client:null};
  state.offer=tracked;state.offeredIds=tracked.cards.map(c=>c.id);
  const chosen=state.catalog.augments.find(a=>a.key==='EtherealWeapon')||state.augments[0];
  state.selectedAugments=[{id:chosen.id,confidence:'inferred',name:chosen.name}];
  recalculate();layout();publish();await wait(200);
  for(let i=0;i<3;i++){
    const w=cardWindows[i];assert.equal(await w.webContents.executeJavaScript('document.getElementById("card-hint").hidden'),false);
    assert.notEqual(await w.webContents.executeJavaScript('document.getElementById("card-score").textContent'),'—');
    assert.equal(await w.webContents.executeJavaScript('document.documentElement.scrollWidth<=innerWidth'),true);
    await fs.writeFile(path.join(dir,`card-${i+1}.png`),(await w.webContents.capturePage()).toPNG());
  }
  await fs.writeFile(path.join(dir,'overlay.png'),(await overlay.webContents.capturePage()).toPNG());
  const picked=offer.cards[1],rect=picked.selectionRect;
  tracker.observe({...offer,observedAt:'sample-2'},{active:true,x:rect.x+rect.width/2,y:rect.y+rect.height/2,leftPressed:true,pressId:1});
  now=1800;tracker.observe({cards:[],observedAt:'empty-1'},{active:true});
  now=2500;tracked=tracker.observe({cards:[],observedAt:'empty-2'},{active:true});
  assert.equal(tracked.selected[0].id,picked.id);assert.equal(tracked.selected[0].confidence,'inferred');
  state.game={phase:'ChampSelect',lcuConnected:true,liveConnected:false,isMayhem:true,championId:103,ownItems:null,
    team:[{championId:103,isSelf:true},{championId:22},{championId:51},{championId:238},{championId:11}],bench:[54,117],availableChampionIds:[103,54,117]};
  state.monitor={game:null,client:{x:0,y:0,width:1920,height:1080,foreground:true,visible:true,minimized:false}};
  state.offer={cards:[],stable:false};state.offeredIds=[];state.selectedAugments=[];recalculate();layout();publish();await wait(200);
  assert.equal(await run('document.getElementById("tab-draft").hidden'),false);
  assert.deepEqual(state.draft.candidates.map(c=>c.championId).sort((a,b)=>a-b),[54,103,117]);
  assert.ok(state.draft.candidates.every(c=>c.winRate===null));
  assert.equal(state.buildSuggestions[0].itemsKnown,false);
  await fs.writeFile(path.join(dir,'draft.png'),(await panel.webContents.capturePage()).toPNG());
  await fs.writeFile(path.join(dir,'draft-overlay.png'),(await overlay.webContents.capturePage()).toPNG());
  state.monitor.client.foreground=false;layout();assert.equal(state.overlayVisible,false,'Switching away hides automatic overlays');
  for(const w of cardWindows)assert.equal(w.isVisible(),false);
  assert.equal(panel.isVisible(),false);assert.equal(overlay.isVisible(),false);
  const report={passed:true,hiddenWindows:true,focusableOverlay:false,champions:state.catalog.champions.length,
    augments:state.catalog.augments.length,championAugments:state.augments.length,checks:['sandbox','custom controls','search','rarity filter','three-option comparison','builds','settings','invalid IPC input','disconnected scan','hidden overlay render','automatic card geometry','selection inference','available-only draft','unknown inventory','focus visibility']};
  await fs.writeFile(path.join(dir,'smoke.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
module.exports={runSmoke};
