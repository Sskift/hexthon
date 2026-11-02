const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {nativeImage,screen}=require('electron');
async function runLightSmoke(t){
  const {state,history}=t,root=path.resolve(__dirname,'..'),size={width:1920,height:1080};
  const cards=nativeImage.createFromPath(path.join(root,'.qa/light-offline/synthetic-1920x1080.png'));
  const shop=nativeImage.createFromPath(path.join(root,'.qa/light-shop-offline/synthetic-1920x1080.png'));
  assert.ok(!cards.isEmpty()&&!shop.isEmpty());
  const blank=nativeImage.createFromBitmap(Buffer.alloc(size.width*size.height*4),size);
  let mode='cards',captures=0;
  const gameWindow={hwnd:'12345',pid:4242,dpi:96,x:0,y:0,...size,clientRect:{x:0,y:0,...size},foreground:true,visible:true,minimized:false};
  t.setCapture({capture:async({region,maxWidth})=>{
    captures++;const x=Math.floor(region.x*size.width),y=Math.floor(region.y*size.height);
    const width=Math.ceil((region.x+region.width)*size.width)-x,height=Math.ceil((region.y+region.height)*size.height)-y;
    let bitmap=({cards,shop,blank})[mode].crop({x,y,width,height});
    if(width>maxWidth)bitmap=bitmap.resize({width:maxWidth,height:Math.round(height*maxWidth/width)});
    return {...bitmap.getSize(),hwnd:gameWindow.hwnd,pid:gameWindow.pid,dpi:gameWindow.dpi,clientRect:{...gameWindow.clientRect},bgraBuffer:bitmap.toBitmap(),capturedAt:new Date().toISOString(),
      region:{x:x/size.width,y:y/size.height,width:width/size.width,height:height/size.height}};
  },close:()=>{}});
  state.game={...state.game,phase:'InProgress',liveConnected:true,isMayhem:true,gameId:999999,championId:103,gameTime:200,ownItems:[],team:[],opponents:[]};
  state.selectedChampion=state.catalog.champions.find(c=>c.id===103);
  t.applyHistory(history.begin({matchId:999999,championId:103,gameTime:200}));
  t.onWindowUpdate({game:gameWindow,client:null,cursor:{x:0,y:0,active:true,leftDown:false,pressId:0},observedAt:new Date().toISOString()});
  await t.scanGame();assert.equal(state.offer.stable,false);
  await t.scanGame();assert.equal(state.offer.stable,true);assert.equal(state.overlayMode,'cards');
  const ids=state.offeredIds.slice();assert.equal(ids.length,3);
  await t.scanGame();assert.equal(state.capturePerformance.ocrCacheHit,true);
  const first=state.offer.cards[0].selectionRect;
  t.pointer({active:true,x:first.x+first.width/2,y:first.y+first.height/2,leftPressed:true,leftDown:true,pressId:1});
  await new Promise(resolve=>setTimeout(resolve,280));mode='blank';
  await t.scanGame();assert.equal(state.overlayVisible,false);assert.equal(state.selectedAugments.length,0);
  await t.scanGame();assert.ok(state.selectedAugments.some(a=>a.id===ids[0]&&a.confidence==='inferred'));
  assert.equal(state.selectionHistoryComplete,false);
  mode='shop';t.resetShop();await t.scanGame();assert.equal(state.shop.visible,false);
  t.resetShop();await t.scanGame();assert.equal(state.shop.visible,true);assert.equal(state.overlayMode,'shop',JSON.stringify({shop:state.shop.rect,window:screen.screenToDipRect(null,gameWindow.clientRect),present:state.offer.present}));
  t.publish();
  const shopText=await t.overlay.webContents.executeJavaScript('document.body.textContent');assert.match(shopText,/出装|装备/);
  mode='blank';t.resetShop();await t.scanGame();assert.equal(state.shop.visible,false);assert.equal(state.overlayVisible,false);
  const monitor={...state.monitor,game:{...gameWindow,foreground:false}};t.onWindowUpdate(monitor);assert.equal(state.offer.stable,false);
  const api=code=>t.panel.webContents.executeJavaScript(code);
  await api(`window.hexthon.setSelectedAugments([${ids[0]}])`);await api('window.hexthon.undoSelectedCorrection()');
  assert.equal(state.selectedAugments[0].confidence,'inferred');
  await api('window.hexthon.toggleOverlay()');assert.equal(t.snapshot().settings.autoScan,false);
  await api('window.hexthon.toggleOverlay()');assert.equal(t.snapshot().settings.autoScan,true);
  t.resetGame();assert.equal(state.selectedAugments.length,0);
  assert.ok([t.panel,t.overlay,t.draftWindow,...t.cardWindows].every(w=>!w.isVisible()));
  const report={passed:true,syntheticOnly:true,actualWindowCapture:false,visibleWindows:0,captures,
    checks:['fresh three-card stability','unchanged-title OCR cache','one-absence overlay hide','two-absence inferred selection','partial history status','fresh independent shop strips','shop-close hide','focus invalidation','undo correction','pause/resume capture','new-game reset']};
  await fs.writeFile(path.join(root,'.qa/light-smoke.json'),JSON.stringify(report,null,2));
}
module.exports={runLightSmoke};
