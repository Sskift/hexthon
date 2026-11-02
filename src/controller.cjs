const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, globalShortcut, screen, shell, desktopCapturer, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { OpggProvider, BASE } = require('./core/opgg.cjs');
const { LeagueReader } = require('./core/league.cjs');
const { OcrReader, WindowsOcrWorker } = require('./core/ocr.cjs');
const { WindowMonitor,emptySnapshot } = require('./core/window-monitor.cjs');
const { locateOffer, OfferTracker } = require('./core/vision.cjs');
const { detectShop, ShopTracker } = require('./core/shop-vision.cjs');
const {prepareTemplates,matchAugmentIcons,AugmentIconTracker}=require('./core/augment-icons.cjs');
const { scoreAugments, rankDraft, buildRecommendations, matchupRecommendations, rerollAdvice } = require('./core/recommendations.cjs');
const { DEFAULTS } = require('./core/settings.cjs');
const {startupSettings,updateSettings}=require('./core/runtime-settings.cjs');
const {compatibility,ScanBudget,diagnosticReport}=require('./core/runtime-diagnostics.cjs');
const {buildItemSet}=require('./core/native-itemsets.cjs');
const {NativeItemSetSync}=require('./core/native-itemsets-sync.cjs');
const { cardBounds, shopBounds, draftBounds } = require('./core/overlay-layout.cjs');
const {WindowCapture}=require('./core/window-capture.cjs');
const sceneGate=require('./core/scene-gate.cjs');
const {titleOffer}=require('./core/light-offer.cjs');
const {readOfferTitles}=require('./core/title-reader.cjs');
const {LightShopScanner}=require('./core/shop-scanner.cjs');
const {SelectionHistory,SelectionHistoryStore}=require('./core/selection-history.cjs');
const {AugmentIconWorker}=require('./core/augment-icon-worker.cjs');
const {HUD_REGION}=require('./core/augment-icons.cjs');
const {visualContext,sameVisualContext,isCurrentVisualContext,captureMatchesContext,captureIsFresh,trackingPresentation}=require('./core/visual-context.cjs');

const apiSmoke=process.argv.includes('--api-smoke-test');
const lightSmoke=process.argv.includes('--light-smoke-test');
const lifecycleSmoke=process.argv.includes('--lifecycle-smoke-test');
const smoke = process.argv.includes('--smoke-test')||apiSmoke||lightSmoke||lifecycleSmoke;
const lightVisualMode=process.argv.includes('--assist')||process.argv.includes('--visual-light-experimental')||lightSmoke||(lifecycleSmoke&&!process.argv.includes('--api-only'));
const visualMode=lightVisualMode||process.argv.includes('--visual-experimental')||process.argv.includes('--smoke-test');
if(!visualMode)app.disableHardwareAcceleration();
app.setName('Hexthon');
if (smoke) app.setPath('userData', path.resolve(__dirname, lifecycleSmoke?'../.qa/lifecycle-profile':'../.qa/profile'));
let panel, overlay, draftWindow, tray, provider, reader, ocr, monitor, staticData = {}, quitting = false;
let settingsQueue=Promise.resolve(),statusQueue=Promise.resolve(),shutdownPromise=null,shutdownComplete=false;
let panelShowRequests=0;
let nativeSync,nativeEpoch=0,recommendationCache=null;
const scanBudget=new ScanBudget();
let gameTimer, scanTimer, viewTimer, statusTimer, manualOverlay = null, loadSerial = 0, captureBusy = false, gameEpoch = 0;
let lastOffer = null, tracker = new OfferTracker(), inferredMode = false, captureAt = 0, trackingSignature = '';
const shopTracker=new ShopTracker({observationTtlMs:5000});
const iconTracker=new AugmentIconTracker(),ignoredVisualSelections=new Set();
let iconTemplates=[];
let windowCapture,rerollTemplates=[],lightCache=null;
let selectionHistory,historyStore,persistedHistory=null,historyLoaded=false,historySignature='',historySavedAt=0,augmentWorker;
let hudReadsRemaining=2,hudNextAt=0,shopHintUntil=0,lastShopPress=0,lastHudLevel=null;
const lightShop=new LightShopScanner();
let lastLiveTime = null, lastGameId = null, liveLostAt = 0;
const consumedSelections = new Set();
const cardWindows = [];
const readyWindows=new WeakSet(),windowLoads=new WeakMap();
let settings = { ...DEFAULTS };
const state = { version:require('../package.json').version, recognitionMode:lightVisualMode?'visual-light':visualMode?'visual':'api', captureEnabled:visualMode, catalog:null, selectedChampion:null, augments:[], builds:[],
  augmentMeta:null, buildMeta:null, game:{phase:'Disconnected',lcuConnected:false,liveConnected:false,team:[],bench:[],ownItems:null},
  offeredIds:[], selectedAugments:[], augmentScores:[], reroll:null, draft:null, buildSuggestions:[], matchup:null,
  offer:{cards:[],stable:false,present:false}, shop:{visible:false}, visualSelection:{matches:[],pending:[]}, overlayMode:null, selectionHistoryComplete:false, monitor:{game:null,client:null}, autoStatus:visualMode?'正在寻找英雄联盟窗口…':'正在连接本地客户端接口…',
  ocr:{status:'idle',matches:[],text:''}, overlayVisible:false, loading:false, error:'', shortcuts:{},
  modeConfirmed:false, displays:[], imageAssets:{},nativeItemSets:{status:'disabled'},compatibility:null,scanBudget:null };
const settingsFile = () => path.join(app.getPath('userData'),'settings.json');
const snapshot = () => ({...state,captureEnabled:visualMode&&settings.autoScan&&!quitting,settings});
function publish() {
  for (const win of [panel,overlay,draftWindow,...cardWindows]) if (win && !win.isDestroyed() && !win.webContents.isLoading() && (smoke||win.isVisible())) win.webContents.send('state',snapshot());
}
function reportError(error) { if(quitting)return;state.error=error?.message||String(error);publish(); }
function applyHistory(result,{save=true}={}){
  if(!result)return;
  state.selectedAugments=result.selected;state.selectionHistoryComplete=result.complete;
  state.selectionRecovery={restored:result.restored,canUndo:result.canUndo,persistent:Boolean(result.matchId&&result.championId),complete:result.complete};
  if(save&&historyStore){
    const payload=selectionHistory.serialize();
    // A live API connection can precede LCU's reliable match ID. Keep the
    // already loaded checkpoint until that ID is known; resetGame explicitly
    // clears persistedHistory when an actual match boundary is established.
    if(payload===null&&persistedHistory)return;
    const key=JSON.stringify(payload&&{matchId:payload.matchId,championId:payload.championId,entries:payload.entries.map(({observedAt,...entry})=>entry),manualIds:payload.manualIds,excludedIds:payload.excludedIds});
    if(key!==historySignature||Date.now()-historySavedAt>15000){historySignature=key;historySavedAt=Date.now();historyStore.save(payload).catch(()=>{state.selectionRecovery.saveFailed=true;});}
  }
}
function requestHudRecovery(){hudReadsRemaining=2;hudNextAt=0;}
function metadata(d) { return d && {patch:d.patch,fetchedAt:d.fetchedAt,cacheStatus:d.cacheStatus||'cached',warning:d.warning||'',url:d.url}; }
function recalculate() {
  const liveHeroMatches=state.game.liveConnected&&state.game.championId===state.selectedChampion?.id;
  state.compatibility=compatibility({gameVersion:state.game.gameVersion,catalogPatch:state.catalog?.patch,augmentPatch:state.augmentMeta?.patch,buildPatch:state.buildMeta?.patch,staticVersion:staticData.version});
  const usableStatic=state.compatibility.staticRulesEnabled?staticData:{champions:{},items:{}};
  const ownItems=liveHeroMatches?state.game.ownItems:null;
  const selected = liveHeroMatches?state.selectedAugments.map(s=>({...state.catalog?.augments.find(a=>a.id===s.id),...s})):[];
  const selectedKnown=liveHeroMatches&&state.selectionHistoryComplete&&state.selectedAugments.every(a=>a.confidence==='confirmed');
  const key=JSON.stringify({hero:state.selectedChampion?.id,liveHeroMatches,ownItems,selected:selected.map(({id,confidence,source,slot})=>({id,confidence,source,slot})),selectedKnown,stats:state.game.ownChampStats,
    team:state.game.team,opponents:state.game.opponents,available:state.game.availableChampionIds,self:state.game.championId,rerolls:state.game.augmentRerollsRemaining,offered:state.offeredIds,staticRules:state.compatibility.staticRulesEnabled});
  if(recommendationCache?.key===key&&recommendationCache.augments===state.augments&&recommendationCache.builds===state.builds&&recommendationCache.catalog===state.catalog){queueNativeSync();return;}
  recommendationCache={key,augments:state.augments,builds:state.builds,catalog:state.catalog};
  state.recommendationRevision=(state.recommendationRevision||0)+1;
  state.augmentScores=scoreAugments({augments:state.augments,champion:state.selectedChampion,
    ownItems, selectedAugments:selected, championStats:liveHeroMatches?state.game.ownChampStats:null,
    staticData:usableStatic, contextKnown:liveHeroMatches, selectedKnown});
  state.draft=rankDraft({catalog:state.catalog,team:state.game.team||[],availableChampionIds:state.game.availableChampionIds||[],
    selfId:state.game.championId,staticData:usableStatic});
  state.buildSuggestions=buildRecommendations({builds:state.builds,ownItems,staticData:usableStatic,selectedAugments:selected});
  state.matchup=liveHeroMatches?matchupRecommendations({champion:state.selectedChampion,ownItems,
    team:state.game.team,opponents:state.game.opponents,selectedAugments:selected,staticData:usableStatic,builds:state.builds}):null;
  state.reroll=rerollAdvice({offeredIds:state.offeredIds,scores:state.augmentScores,augments:state.augments,
    rerollsRemaining:state.game.augmentRerollsRemaining??null,selectedKnown});
  if (state.reroll && !state.reroll.label) state.reroll.label=({keep:'保留当前选项', 'consider-reroll':'可以考虑刷新', unknown:'信息不足，暂不判断'})[state.reroll.action];
  queueNativeSync();
}
function currentItemSet(){
  const c=state.selectedChampion;if(!c||state.loading)return null;
  const choices=(state.matchup?.recommendations||[]).map(row=>row.item).filter(Boolean);
  const groups=[...(choices.length?[{name:'本局优先查看 · 规则建议',rows:[{items:choices}]}]:[]),...state.buildSuggestions.map(group=>({...group,rows:group.rows.map(row=>({...row,items:row.items.filter(item=>!item.blocked)}))}))];
  return buildItemSet({championId:c.id,championName:c.name,championKey:c.key,buildSuggestions:groups});
}
function queueNativeSync(){
  if(!nativeSync||smoke||quitting||!settings.nativeItemSets||state.loading||state.game.championId!==state.selectedChampion?.id)return;
  if(!state.compatibility?.itemSetSyncEnabled){state.nativeItemSets={status:'patch-mismatch'};return;}
  const itemSet=currentItemSet();if(!itemSet)return;
  const epoch=nativeEpoch,hero=state.game.championId,gameId=state.game.gameId,revision=state.recommendationRevision,serial=loadSerial;
  nativeSync.sync({enabled:true,game:state.game,itemSet,isCurrent:()=>!quitting&&!state.loading&&state.compatibility?.itemSetSyncEnabled&&serial===loadSerial&&settings.nativeItemSets&&state.game.isMayhem&&['ChampSelect','InProgress'].includes(state.game.phase)&&epoch===nativeEpoch&&hero===state.game.championId&&hero===state.selectedChampion?.id&&gameId===state.game.gameId&&revision===state.recommendationRevision}).then(result=>{
    if(quitting||epoch!==nativeEpoch||['busy','throttled','inactive'].includes(result.status))return;
    state.nativeItemSets=result;publish();
  }).catch(()=>{if(!quitting)state.nativeItemSets={status:'unavailable'};});
}
async function saveSettings(patch) {
  if(quitting)throw new Error('程序正在退出，停止接收设置变更');
  const oldPath=settings.leaguePath,oldScan=settings.autoScan,oldNative=settings.nativeItemSets;
  settings=updateSettings(patch,settings,{visual:visualMode,light:lightVisualMode});
  if(lightVisualMode&&oldScan!==settings.autoScan)recognitionChanged();
  if(oldNative!==settings.nativeItemSets||oldPath!==settings.leaguePath){nativeEpoch++;state.nativeItemSets={status:settings.nativeItemSets?'waiting':'disabled'};}
  const encoded=JSON.stringify(settings,null,2);
  const write=async()=>{
    await fs.mkdir(app.getPath('userData'),{recursive:true});
    await fs.writeFile(settingsFile()+'.tmp',encoded);
    await fs.rename(settingsFile()+'.tmp',settingsFile());
  };
  const saved=settingsQueue.then(write,write);settingsQueue=saved;
  if(oldPath!==settings.leaguePath) reader.reset();
  layout();publish();queueNativeSync();
  await saved;
}
function showPanel() { if(quitting)return;panelShowRequests++;if(!smoke){panel.webContents.send('state',snapshot());panel.showInactive();} }
function protect(win) {
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.on('will-attach-webview',event=>event.preventDefault());
}
function nativeRect(w) {
  if(!w || ![w.x,w.y,w.width,w.height].every(Number.isFinite)) return null;
  const r={x:Math.round(w.x),y:Math.round(w.y),width:Math.round(w.width),height:Math.round(w.height)};
  return process.platform==='win32'?screen.screenToDipRect(null,r):r;
}
function applyBounds(win,bounds) {
  if(!bounds)return;
  const previous=win.getBounds();
  if(Object.keys(bounds).some(k=>bounds[k]!==previous[k]))win.setBounds(bounds);
}
function activeMayhem() { return state.game.isMayhem||state.modeConfirmed||inferredMode; }
function createSceneWindow(width,height,file,query){
  const win=new BrowserWindow({width,height,show:false,frame:false,transparent:true,resizable:false,focusable:false,skipTaskbar:true,hasShadow:false,alwaysOnTop:true,
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  win.setIgnoreMouseEvents(true,{forward:true});win.setAlwaysOnTop(true,'screen-saver');protect(win);
  const loaded=win.loadFile(path.join(__dirname,'renderer',file),query?{query}:undefined).then(()=>{
    if(quitting||win.isDestroyed())return;
    readyWindows.add(win);layout();publish();
  });
  windowLoads.set(win,loaded);loaded.catch(error=>{if(!quitting&&!win.isDestroyed())reportError(error);});return win;
}
function ensureSceneWindows(kind){
  if(kind==='shop'&&!overlay)overlay=createSceneWindow(300,360,'shop.html');
  if(kind==='draft'&&!draftWindow)draftWindow=createSceneWindow(300,580,'overlay.html');
  if(kind==='cards'&&!cardWindows.length)for(let i=0;i<3;i++)cardWindows.push(createSceneWindow(260,116,'cards.html',{slot:String(i)}));
}
function releaseSceneWindows(){
  const old=[overlay,draftWindow,...cardWindows];overlay=null;draftWindow=null;cardWindows.length=0;
  for(const win of old)if(win){windowLoads.delete(win);readyWindows.delete(win);if(!win.isDestroyed())win.destroy();}
}
function layout() {
  if(quitting)return;
  if(lightVisualMode){
    const client=state.monitor.client,rect=nativeRect(client);
    const eligible=settings.autoScan&&settings.autoOverlay&&manualOverlay!==false&&state.game.phase==='ChampSelect'&&activeMayhem()&&client?.foreground&&client.visible&&!client.minimized&&state.selectedChampion?.id===state.game.championId;
    const bounds=eligible&&rect?draftBounds(rect,screen.getDisplayMatching(rect).workArea):null;
    if(bounds)ensureSceneWindows('draft');
    state.draftOverlayVisible=Boolean(bounds&&readyWindows.has(draftWindow));state.draftOverlayReason=eligible&&!bounds?'客户端旁没有足够空位，推荐仍可在面板查看':'';
    if(bounds&&readyWindows.has(draftWindow)){applyBounds(draftWindow,bounds);if(!draftWindow.isVisible()&&!smoke){draftWindow.webContents.send('state',snapshot());draftWindow.showInactive();}}
    else if(draftWindow?.isVisible())draftWindow.hide();
  }
  if(!visualMode){state.overlayVisible=false;state.overlayEnabled=false;state.overlayMode=null;return;}
  const w=state.monitor.game,gameRect=nativeRect(lightVisualMode&&w?.clientRect?w.clientRect:w);
  state.overlayEnabled=settings.autoOverlay&&manualOverlay!==false&&(!lightVisualMode||settings.autoScan);
  const eligible=Boolean(state.overlayEnabled&&state.game.phase==='InProgress'&&activeMayhem()&&w?.foreground&&w?.visible&&!w?.minimized);
  const cardRects=state.offer.cards.map(card=>cardBounds(gameRect,card));
  const wantCards=Boolean(eligible&&state.offer.present&&state.offer.stable&&cardRects.length===3&&cardRects.every(Boolean));
  if(wantCards)ensureSceneWindows('cards');
  const showCards=wantCards&&cardWindows.every(win=>readyWindows.has(win));
  const bounds=state.shop.visible?shopBounds(gameRect,state.shop):null;
  const wantShop=Boolean(eligible&&bounds&&!wantCards&&!state.offer.present);
  if(wantShop)ensureSceneWindows('shop');
  const showShop=wantShop&&readyWindows.has(overlay);
  if(overlay){
    if(bounds)applyBounds(overlay,bounds);if(overlay.getOpacity()!==settings.opacity)overlay.setOpacity(settings.opacity);
    if(showShop&&!smoke){if(!overlay.isVisible()){overlay.webContents.send('state',snapshot());overlay.showInactive();}}else if(overlay.isVisible())overlay.hide();
  }
  state.overlayVisible=showShop||showCards;state.overlayMode=showCards?'cards':showShop?'shop':null;
  for(let i=0;i<cardWindows.length;i++){
    const rect=showCards?cardRects[i]:null;
    if(rect)applyBounds(cardWindows[i],rect);
    if(cardWindows[i].getOpacity()!==settings.opacity)cardWindows[i].setOpacity(settings.opacity);
    if(rect&&!smoke){if(!cardWindows[i].isVisible()){cardWindows[i].webContents.send('state',snapshot());cardWindows[i].showInactive();}}else if(cardWindows[i].isVisible())cardWindows[i].hide();
  }
}
function recognitionChanged(){
  if(quitting)return;
  gameEpoch++;lightCache=null;lightShop.reset();
  lastOffer=null;state.shop=shopTracker.invalidate();iconTracker.invalidate();consumeTracking(tracker.invalidate());
  if(settings.autoScan)requestHudRecovery();
  if(monitor){if(settings.autoScan)monitor.start();else{monitor.stop();onWindowUpdate(emptySnapshot());}}
  if(!settings.autoScan)releaseSceneWindows();
  state.autoStatus=settings.autoScan?'自动识别已恢复':'自动识别与场景提示已暂停';
  tray?.setToolTip(settings.autoScan?'Hexthon · 自动识别已开启':'Hexthon · 自动识别已暂停');
}
async function toggleOverlay(){
  if(lightVisualMode){await saveSettings({autoScan:!settings.autoScan});return;}
  manualOverlay=manualOverlay===false?null:false;
  layout();publish();
}
function updateDisplays(){state.displays=screen.getAllDisplays().map((d,i)=>({id:d.id,label:`显示器 ${i+1} · ${d.size.width} × ${d.size.height}`,primary:d.id===screen.getPrimaryDisplay().id}));layout();publish();}
async function loadChampion(key,force=false){
  const c=state.catalog?.champions.find(c=>c.key===key);if(!c)return;
  if(state.selectedChampion?.key===key&&!force&&(state.loading||state.augmentMeta))return;
  const serial=++loadSerial;
  state.selectedChampion=c;state.loading=true;state.error='';state.augments=state.catalog.augments;
  state.augmentMeta=null;state.buildMeta=null;state.builds=[];recalculate();publish();
  const results=await Promise.allSettled([provider.get('augments',key,force),provider.get('build',key,force)]);
  if(quitting||serial!==loadSerial)return;
  const errors=[];
  if(results[0].status==='fulfilled'){state.augments=results[0].value.augments;state.augmentMeta=metadata(results[0].value);}else errors.push('专属档位暂不可用，当前使用通用资料');
  if(results[1].status==='fulfilled'){state.builds=results[1].value.builds;state.buildMeta=metadata(results[1].value);}else errors.push('出装资料暂不可用');
  state.loading=false;state.error=errors.join('；');recalculate();publish();
}
function resetGame(){
  releaseSceneWindows();
  lightCache=null;lightShop.reset();requestHudRecovery();persistedHistory=null;
  if(selectionHistory)applyHistory(selectionHistory.reset());
  gameEpoch++;tracker.reset();lastOffer=null;inferredMode=false;manualOverlay=null;trackingSignature='';
  consumedSelections.clear();
  iconTracker.reset();ignoredVisualSelections.clear();state.visualSelection={matches:[],pending:[]};
  state.offeredIds=[];state.selectedAugments=[];state.offer={cards:[],stable:false,present:false};state.shop=shopTracker.invalidate();state.modeConfirmed=false;
  state.selectionHistoryComplete=false;lastLiveTime=null;lastGameId=null;liveLostAt=0;
  state.ocr={status:'idle',matches:[],text:''};
}
function pointer(snapshot){
  const game=snapshot.game,w=lightVisualMode&&game?.clientRect?{...game,...game.clientRect}:game,c=snapshot.cursor;
  return w&&c?{x:(c.x-w.x)/w.width,y:(c.y-w.y)/w.height,leftDown:c.leftDown,leftPressed:c.leftPressed,pressId:c.pressId,active:Boolean(w.foreground&&!w.minimized&&c.active!==false),at:snapshot.observedAt}: {active:false,leftDown:false};
}
function consumeTracking(result){
  if(!result)return;
  const {signature,offer}=trackingPresentation(result,lastOffer);
  if(signature===trackingSignature)return;trackingSignature=signature;
  state.offer=offer;
  state.offeredIds=state.offer.stable?state.offer.cards.map(c=>c.id):[];
  const selections=Array.isArray(result.selected)?result.selected:result.selected?[result.selected]:[];
  for(const pick of selections){
    const eventKey=`${pick.generation}:${pick.id}`;
    if(consumedSelections.has(eventKey))continue;
    consumedSelections.add(eventKey);
    if(selectionHistory){applyHistory(selectionHistory.observe([{...pick,source:'inferred'}]));requestHudRecovery();}
    else if(!state.selectedAugments.some(a=>a.id===pick.id)){
      const a=state.catalog.augments.find(a=>a.id===pick.id);
      if(a)state.selectedAugments.push({id:a.id,name:a.name,confidence:'inferred',evidence:pick.evidence||'卡片点击后消失',detectedAt:new Date().toISOString()});
    }
  }
  recalculate();layout();publish();
}
function onWindowUpdate(snapshot){
  const changed=!sameVisualContext(visualContext(state.monitor.game,lightVisualMode),visualContext(snapshot.game,lightVisualMode));
  state.monitor=snapshot;
  if(changed){gameEpoch++;lightCache=null;lightShop.reset();requestHudRecovery();state.shop=shopTracker.invalidate();iconTracker.invalidate();lastOffer=null;consumeTracking(tracker.invalidate());}
  if(snapshot.cursor?.shopPressId&&snapshot.cursor.shopPressId!==lastShopPress){lastShopPress=snapshot.cursor.shopPressId;shopHintUntil=Date.now()+4500;}
  if(!state.game.lcuConnected&&!state.game.liveConnected)state.autoStatus=snapshot.client?'已发现客户端窗口，正在连接…':'等待英雄联盟客户端…';
}
async function pollGame(){
  try{
    const old=state.game,next=await reader.poll(settings,state.catalog?.champions||[],state.catalog?.augments||[]);
    if(quitting)return;
    state.game=next;
    const ended=old.phase==='InProgress'&&['WaitingForStats','EndOfGame','PreEndOfGame','Lobby','None','Matchmaking','ChampSelect'].includes(state.game.phase)&&state.game.lcuConnected;
    const changed=lastGameId&&state.game.gameId&&lastGameId!==state.game.gameId;
    const newSelect=state.game.phase==='ChampSelect'&&old.phase!=='ChampSelect';
    const restarted=lastLiveTime!=null&&state.game.gameTime!=null&&lastLiveTime-state.game.gameTime>30;
    // A temporary local API failure preserves selections. A vanished game window
    // plus sustained disconnection marks the end even when LCU is unavailable.
    if(!state.game.liveConnected&&old.liveConnected)liveLostAt=Date.now();
    const reconnecting=state.game.lcuConnected&&['Reconnect','InProgress','GameStart'].includes(state.game.phase);
    const gone=liveLostAt&&Date.now()-liveLostAt>15000&&!state.monitor.game&&!reconnecting;
    if(ended||changed||newSelect||restarted||gone)resetGame();
    if(state.game.gameId)lastGameId=state.game.gameId;
    if(state.game.liveConnected){
      if(Number.isFinite(state.game.gameTime))lastLiveTime=state.game.gameTime;
      liveLostAt=0;
      if(selectionHistory){
        applyHistory(selectionHistory.begin({matchId:state.game.gameId,championId:state.game.championId,gameTime:state.game.gameTime},persistedHistory));
        if(state.game.gameId&&state.game.championId)persistedHistory=null;
      }
      if(state.game.level!==lastHudLevel){lastHudLevel=state.game.level;requestHudRecovery();}
    }
    if(Array.isArray(state.game.ownSelectedAugmentIds)){
      if(selectionHistory)applyHistory(selectionHistory.observe(state.game.ownSelectedAugmentIds.map(id=>({id,source:'api'}))));
    }
    for(const detected of state.game.detectedAugments||[]){
      if(ignoredVisualSelections.has(detected.id))continue;
      if(selectionHistory){applyHistory(selectionHistory.observe([{...detected,source:'api'}]));continue;}
      const existing=state.selectedAugments.find(a=>a.id===detected.id);
      if(!existing)state.selectedAugments.push({...detected});
      else if(existing.confidence!=='confirmed')Object.assign(existing,detected);
    }
    if(settings.autoFollow&&state.game.championId){
      const c=state.catalog.champions.find(c=>c.id===state.game.championId);
      if(c&&c.key!==state.selectedChampion?.key)loadChampion(c.key).catch(reportError);
    }
    if(state.game.phase==='ChampSelect')state.autoStatus='已识别选人界面，正在跟随英雄与队友阵容';
    else if(state.game.liveConnected)state.autoStatus=visualMode?'已连接对局，自动监测强化卡片':'已连接对局，仅读取英雄与装备；画面采集已停用';
    else if(state.game.lcuConnected)state.autoStatus=['EndOfGame','WaitingForStats'].includes(state.game.phase)?'本局已结束，等待下一局自动跟随':'已连接英雄联盟客户端，等待选人与对局';
    if(lightVisualMode&&!settings.autoScan)state.autoStatus='自动识别与场景提示已暂停';
    state.connectionError='';recalculate();layout();publish();
  }catch(error){if(!quitting){state.connectionError='本地接口暂不可用，将自动重连';publish();}}
  finally{if(!quitting&&!smoke)gameTimer=setTimeout(pollGame,visualMode&&settings.autoScan?1800:3000);}
}
async function scanGame(){
  if(!visualMode)throw new Error('当前为接口模式，画面采集与 OCR 已停用');
  if(quitting||(lightVisualMode&&!settings.autoScan))throw new Error('自动识别已暂停，请先恢复识别');
  const w=state.monitor.game;
  if(captureBusy||ocr.busy)return;
  if(!state.game.liveConnected||!w?.foreground||w.minimized||!w.visible)throw new Error('等待游戏窗口进入前台后自动识别');
  // KIWI was observed in this Tencent client's Live API. It permits checking
  // the card evidence when LCU is unavailable; it does not confirm Mayhem.
  if(!activeMayhem() && (state.game.queueId || !/^(?:ARAM|KIWI)$/i.test(state.game.gameMode||'')))throw new Error('当前不是已确认的海克斯模式');
  const context=visualContext(w,lightVisualMode);
  if(!context)throw new Error('游戏窗口尺寸与缩放尚未确认');
  captureBusy=true;captureAt=Date.now();const epoch=gameEpoch,workStarted=performance.now();let scanFailed=false;
  const current=()=>epoch===gameEpoch&&!quitting&&isCurrentVisualContext(context,state.monitor.game);
  try{
    if(lightVisualMode){await scanLightGame(w,context,current);return;}
    const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:2560,height:1440},fetchWindowIcons:false});
    if(!current())return;
    const source=sources.find(s=>{try{return BigInt(s.id.split(':')[1])===BigInt(w.hwnd);}catch{return false;}});
    if(!source||source.thumbnail.isEmpty())throw new Error('游戏窗口画面暂不可用，请使用无边框模式');
    const iconStart=Date.now(),size=source.thumbnail.getSize();
    const visual=iconTracker.observe(matchAugmentIcons({...size,bgraBuffer:source.thumbnail.toBitmap()},iconTemplates),{active:Boolean(state.monitor.game?.foreground)});
    state.visualSelection={matches:visual.matches,pending:visual.pending,durationMs:Date.now()-iconStart};
    if(selectionHistory)applyHistory(selectionHistory.observe(visual.selected.map(row=>({...row,source:'visual'}))));
    recalculate();
    state.ocr={...state.ocr,status:'running'};
    let result=await ocr.read(source.thumbnail,{x:.08,y:.08,width:.84,height:.84},state.catalog.augments);
    if(!current())return;
    state.shop=shopTracker.observe(detectShop(result));
    lastOffer=locateOffer(result,state.catalog.augments);
    // A tighter second pass preserves small title strokes when the wider shop
    // scan found augment names but could not establish the three-card layout.
    if(!lastOffer.cards.length&&result.matches.filter(m=>m.exact).length>=2){
      result=await ocr.read(source.thumbnail,settings.ocrRegion,state.catalog.augments);
      if(!current())return;
      lastOffer=locateOffer(result,state.catalog.augments);
    }
    lastOffer.observedAt=result.capturedAt||new Date().toISOString();
    if(lastOffer.cards?.length===3)inferredMode=true;
    state.ocr={...result,status:'done',message:lastOffer.cards?.length===3?'已定位三个强化符文':'持续监测卡片区域'};
    state.autoStatus=lastOffer.cards?.length===3?'已定位强化卡片，自动更新推荐指数':state.shop.visible?'商店已打开，显示出装参考':'自动监测中，商店或海克斯页面出现时显示推荐';
    state.offer.present=lastOffer.cards?.length===3;
    consumeTracking(tracker.observe(lastOffer,pointer(state.monitor)));
    layout();publish();
  }catch(error){scanFailed=true;if(!current())return;lightCache=null;state.shop=shopTracker.invalidate();state.offer.present=false;lastOffer=null;consumeTracking(tracker.invalidate());state.ocr={...state.ocr,status:'error',message:error.message};state.autoStatus=error.message;publish();}
  finally{captureBusy=false;scanBudget.record(performance.now()-workStarted,{failed:scanFailed});state.scanBudget=scanBudget.snapshot();}
}
async function scanLightGame(w,context,current){
  const started=performance.now(),client=context.rect;
  const geometry=client&&sceneGate.layout(client.width,client.height);
  if(!geometry)throw new Error('轻量实验：客户区尺寸尚未确认');
  windowCapture??=new WindowCapture();
  const frame=await windowCapture.capture({hwnd:w.hwnd,region:geometry.rerollRegion,maxWidth:1800});
  if(!current())return;
  if(!captureMatchesContext(frame,context)){lightCache=null;throw new Error('窗口位置、尺寸或缩放变化，等待下一次采样');}
  const gateStart=performance.now();
  const gate=sceneGate.detectRerolls({...frame,clientWidth:client.width,clientHeight:client.height},rerollTemplates);
  const stats={mode:'targeted-gdi',gateMs:Math.round(performance.now()-gateStart),gateScore:gate.score,
    capturedPixels:frame.width*frame.height,ocrRan:false,ocrCacheHit:false};
  if(!gate.present){
    lightCache=null;lastOffer={cards:[],observedAt:frame.capturedAt};
    state.ocr={status:'idle',matches:[],text:'',message:'轻量实验：未检测到选卡按钮，不运行 OCR'};
    state.autoStatus='后台监测选卡、商店与已选强化';
    state.capturePerformance={...stats,totalMs:Math.round(performance.now()-started)};
    consumeTracking(tracker.observe(lastOffer,pointer(state.monitor)));
    await scanLightSupport(w,context,current,stats);
    if(current()){state.capturePerformance={...stats,totalMs:Math.round(performance.now()-started)};layout();publish();}
    return;
  }
  state.shop=shopTracker.invalidate();lightShop.reset();
  const titles=await windowCapture.capture({hwnd:w.hwnd,region:geometry.titleRegion,maxWidth:2200});
  if(!current())return;
  if(!captureMatchesContext(titles,context)){lightCache=null;throw new Error('窗口位置、尺寸或缩放变化，等待下一次采样');}
  if(!captureIsFresh(titles))throw new Error('标题画面已过期，等待新的画面');
  stats.capturedPixels+=titles.width*titles.height;
  const fingerprint=sceneGate.fingerprint({...titles,clientWidth:client.width,clientHeight:client.height});
  const cached=(state.offer.stable||lightCache?.offer?.cards?.length!==3)&&lightCache&&sameVisualContext(lightCache.context,context)&&Date.now()-lightCache.at<2000&&
    !sceneGate.fingerprintChanged(lightCache.fingerprint,fingerprint);
  if(cached){lastOffer=lightCache.offer;stats.ocrCacheHit=true;}
  else{
    state.ocr={...state.ocr,status:'running'};
    const bitmap=nativeImage.createFromBitmap(titles.bgraBuffer,{width:titles.width,height:titles.height});
    const reading=await readOfferTitles({ocr,image:bitmap,region:titles.region,geometry,augments:state.catalog.augments,capturedAt:titles.capturedAt,isCurrent:()=>current()&&captureIsFresh(titles)});
    const result=reading.result;
    if(!current())return;
    stats.ocrRan=true;stats.ocrMs=reading.durationMs;stats.ocrReads=reading.reads;
    state.ocr={...result,status:'done',message:'轻量实验：只识别标题条'};
    lastOffer=reading.offer;
    lightCache={context,at:Date.now(),fingerprint,offer:lastOffer};
  }
    if(lastOffer.cards.length!==3){
      // A visible button with an unreadable title is not a selection/close event.
      lastOffer=null;consumeTracking(tracker.invalidate());state.offer.present=true;
      state.capturePerformance={...stats,totalMs:Math.round(performance.now()-started)};
      state.autoStatus='轻量实验：选卡按钮可见，标题尚未读全';layout();publish();return;
  }
  if(lastOffer?.cards?.length===3)inferredMode=true;
  state.autoStatus=stats.ocrCacheHit?'轻量实验：标题未变，复用识别结果':'轻量实验：已识别三个标题，等待稳定确认';
  state.capturePerformance={...stats,totalMs:Math.round(performance.now()-started)};
  consumeTracking(tracker.observe(lastOffer,pointer(state.monitor)));
}
async function scanLightSupport(w,context,current,stats){
  const capture=async(region,maxWidth=1200)=>{
    const frame=await windowCapture.capture({hwnd:w.hwnd,region,maxWidth});
    if(!current())throw new Error('STALE_SUPPORT_SCAN');
    if(!captureMatchesContext(frame,context))throw new Error('窗口位置、尺寸或缩放变化，等待下一次采样');
    stats.capturedPixels+=frame.width*frame.height;return frame;
  };
  const shop=await lightShop.scan({width:context.rect.width,height:context.rect.height,scope:JSON.stringify(context),
    capture,read:frame=>ocr.read(nativeImage.createFromBitmap(frame.bgraBuffer,{width:frame.width,height:frame.height}),{x:0,y:0,width:1,height:1},[],{allowSmall:true,allowFallback:false}),
    isCurrent:current,urgent:Date.now()<shopHintUntil});
  if(!current())return;
  if(shop.observation)state.shop=shopTracker.observe(shop.observation);
  stats.shop=shop.stats||null;
  if(state.shop.visible){state.autoStatus='商店已打开，结合装备与已知强化更新建议';return;}
  if(Date.now()<hudNextAt||!augmentWorker)return;
  const hud=await capture(HUD_REGION,1000);
  const started=performance.now(),detection=await augmentWorker.read(hud);
  if(!current())return;
  if(!captureIsFresh(hud,Date.now(),4000)){
    iconTracker.invalidate();hudReadsRemaining=2;hudNextAt=Date.now()+5000;
    stats.hudStale=true;return;
  }
  const visual=iconTracker.observe(detection,{active:true});
  state.visualSelection={matches:visual.matches,pending:visual.pending,durationMs:Math.round(performance.now()-started)};
  if(selectionHistory)applyHistory(selectionHistory.observe(visual.selected.map(row=>({...row,source:'visual'}))));
  stats.hudMs=state.visualSelection.durationMs;stats.hudMatches=visual.matches.length;
  hudReadsRemaining=Math.max(0,hudReadsRemaining-1);
  if(hudReadsRemaining)hudNextAt=Date.now()+650;
  else{hudReadsRemaining=2;hudNextAt=Date.now()+20000;}
  recalculate();
}
async function scanLoop(){
  if(settings.autoScan&&state.monitor.game?.foreground&&state.game.liveConnected&&!captureBusy)await scanGame().catch(()=>{});
  const candidateScene=state.offer.present?'cards':state.shop.visible||lightShop.lock?'shop':'idle';
  if(!quitting&&!smoke)scanTimer=setTimeout(scanLoop,lightVisualMode?scanBudget.delay({scene:candidateScene,hint:Date.now()<shopHintUntil}):1300);
}
async function writeStatus(){
  const payload={version:state.version,pid:process.pid,updatedAt:new Date().toISOString(),lifecycle:quitting?'stopped':'running',phase:state.game.phase,
    lcuConnected:state.game.lcuConnected,liveConnected:state.game.liveConnected,queueId:state.game.queueId,
    champion:state.selectedChampion?.key,autoStatus:state.autoStatus,autoScan:settings.autoScan&&!quitting,autoFollow:settings.autoFollow,recognitionMode:state.recognitionMode,captureEnabled:visualMode&&settings.autoScan&&!quitting,windowMonitorEnabled:Boolean(monitor?.running)&&!quitting,windowCount:BrowserWindow.getAllWindows().length,
    window:state.monitor.game||state.monitor.client||null,offeredIds:state.offeredIds,selectedAugments:state.selectedAugments,
    overlayVisible:state.overlayVisible,overlayMode:state.overlayMode,shop:state.shop,visualSelection:state.visualSelection,shopOverlay:overlay?{visible:overlay.isVisible(),bounds:overlay.getBounds()}:null,cardOverlays:cardWindows.map(w=>({visible:w.isVisible(),bounds:w.getBounds()})),
    error:state.error,connectionError:state.connectionError||'',monitorError:state.monitorError||'',ocr:{status:state.ocr.status,message:state.ocr.message,lastCapture:captureAt},capturePerformance:state.capturePerformance||null,selectionRecovery:state.selectionRecovery||null,
    nativeItemSets:state.nativeItemSets,compatibility:state.compatibility,scanBudget:state.scanBudget,recommendationRevision:state.recommendationRevision,
    itemIds:state.game.ownItems?.map(i=>i.id),availableChampionIds:state.game.availableChampionIds,
    matchup:state.matchup?{completeAugments:state.matchup.completeAugments,evidence:state.matchup.evidence,recommendations:state.matchup.recommendations}:null};
  const filename=path.join(app.getPath('userData'),'runtime-status.json'),encoded=JSON.stringify(payload,null,2);
  const write=async()=>{
    await fs.mkdir(app.getPath('userData'),{recursive:true});
    await fs.writeFile(filename+'.tmp',encoded);await fs.rename(filename+'.tmp',filename);
  };
  const pending=statusQueue.then(write,write);statusQueue=pending;await pending;
}
function registerIpc(){
  const handle=(name,fn,readOnly=false)=>ipcMain.handle(name,async(e,arg)=>{
    if(e.sender!==panel.webContents&&!(readOnly&&[overlay,draftWindow,...cardWindows].filter(Boolean).some(w=>e.sender===w.webContents)))return {ok:false,error:'无效的请求来源'};
    if(quitting&&!readOnly)return {ok:false,error:'程序正在退出，停止接收变更'};
    try{return {ok:true,data:await fn(arg)};}catch(error){return {ok:false,error:error.message};}
  });
  handle('get-state',snapshot,true);
  handle('native-itemsets-probe',async()=>{state.nativeItemSets=await nativeSync.probe();publish();return state.nativeItemSets;});
  handle('native-itemsets-import',async()=>{
    const itemSet=currentItemSet();if(!itemSet)throw new Error('当前英雄出装资料尚未就绪');
    if(!state.compatibility?.itemSetSyncEnabled)throw new Error('资料与游戏补丁不一致，请先更新资料');
    const epoch=++nativeEpoch,hero=state.selectedChampion.id,serial=loadSerial,revision=state.recommendationRevision;
    state.nativeItemSets={status:'busy'};publish();
    state.nativeItemSets=await nativeSync.importPreview({itemSet,isCurrent:()=>!quitting&&!state.loading&&state.compatibility?.itemSetSyncEnabled&&epoch===nativeEpoch&&serial===loadSerial&&revision===state.recommendationRevision&&hero===state.selectedChampion?.id});publish();return state.nativeItemSets;
  });
  handle('native-itemsets-restore',async()=>{
    await saveSettings({nativeItemSets:false});nativeEpoch++;await nativeSync.flush().catch(()=>{});
    state.nativeItemSets=await nativeSync.restore({isCurrent:()=>!quitting});publish();return state.nativeItemSets;
  });
  handle('export-diagnostics',async()=>{
    const directory=path.join(app.getPath('userData'),'diagnostics');await fs.mkdir(directory,{recursive:true});
    const filename=path.join(directory,`hexthon-${Date.now()}.json`);await fs.writeFile(filename,JSON.stringify(diagnosticReport(snapshot()),null,2));return {filename};
  });
  handle('save-settings',async patch=>{await saveSettings(patch||{});return snapshot();});
  handle('window-action',action=>{if(action==='hide')panel.hide();else if(action==='minimize')panel.minimize();else if(action==='quit'){quitting=true;app.quit();}else throw new Error('无效的窗口操作');});
  handle('select-champion',async key=>{if(!state.catalog.champions.some(c=>c.key===key))throw new Error('未知英雄');await saveSettings({manualChampion:key,autoFollow:false});await loadChampion(key);return snapshot();});
  handle('follow-champion',async()=>{await saveSettings({autoFollow:true});const c=state.catalog.champions.find(c=>c.id===state.game.championId);if(c)await loadChampion(c.key);return snapshot();});
  handle('refresh',async()=>{state.catalog=await provider.get('index',null,true);await loadChampion(state.selectedChampion?.key||settings.manualChampion,true);publish();});
  const validIds=ids=>Array.isArray(ids)&&ids.every(id=>state.catalog.augments.some(a=>a.id===id));
  handle('set-offers',ids=>{if(!validIds(ids)||ids.length>3)throw new Error('最多选择三个有效符文');state.offeredIds=[...new Set(ids)];recalculate();publish();});
  handle('set-selected-augments',ids=>{if(!validIds(ids)||ids.length>20)throw new Error('无效的已选符文');applyHistory(selectionHistory.correct([...new Set(ids)]));recalculate();publish();});
  handle('confirm-selected-augment',id=>{if(!state.selectedAugments.some(a=>a.id===id))throw new Error('未找到该符文');applyHistory(selectionHistory.confirm(id));recalculate();publish();});
  handle('undo-selected-correction',()=>{applyHistory(selectionHistory.undoCorrection());recalculate();publish();});
  handle('scan',scanGame);handle('toggle-overlay',toggleOverlay);
  handle('import-image',()=>{throw new Error(visualMode?'自动识别已启用，无需导入图片':'当前为接口模式，画面采集与 OCR 已停用');});
  handle('confirm-mode',value=>{state.modeConfirmed=value===true;layout();publish();});
  handle('open-source',async kind=>{const key=state.selectedChampion?.key;const url=key&&['build','augments'].includes(kind)?`${BASE}/${key}/${kind}`:BASE;if(!smoke)await shell.openExternal(url);return url;});
}
async function start(){
  if(quitting)return;
  Menu.setApplicationMenu(null);session.defaultSession.setPermissionRequestHandler((_w,_p,cb)=>cb(false));session.defaultSession.setPermissionCheckHandler(()=>false);
  let previous={};try{previous=JSON.parse(await fs.readFile(settingsFile(),'utf8'));}catch{}
  if(quitting)return;
  settings=startupSettings(previous,{visual:visualMode,light:lightVisualMode,paused:process.argv.includes('--paused')});
  if(smoke&&!lifecycleSmoke)settings={...settings,...DEFAULTS,autoScan:visualMode};
  provider=new OpggProvider(path.join(app.getPath('userData'),'cache'),path.resolve(__dirname,'../data/seed'));
  if(lifecycleSmoke)provider.get=async(kind,key)=>{const value=await provider.read(kind==='index'?'index':`${key}-${kind}`);if(!value)throw new Error('Missing offline fixture');return value;};
  reader=new LeagueReader();
  nativeSync=new NativeItemSetSync({client:reader.itemSetsClient(),journalPath:path.join(app.getPath('userData'),'native-itemsets.json')});
  state.nativeItemSets={status:settings.nativeItemSets?'waiting':'disabled'};
  if(visualMode)ocr=new OcrReader(path.join(app.getPath('userData'),'ocr'),()=>{},(bitmap,size)=>nativeImage.createFromBitmap(bitmap,size),lightVisualMode?{nativeWorker:new WindowsOcrWorker({timeoutMs:2500,retryMs:15000})}:{});
  state.catalog=await provider.read('index');
  if(quitting)return;
  if(!state.catalog)throw new Error('内置资料缺失，请重新解压完整安装包');
  selectionHistory=new SelectionHistory({catalog:state.catalog.augments});
  historyStore=new SelectionHistoryStore(path.join(app.getPath('userData'),'selection-history.json'));
  const loadingHistory=historyStore.load();
  if(lifecycleSmoke&&process.argv.includes('--lifecycle-step=early-exit'))app.quit();
  persistedHistory=await loadingHistory;
  if(quitting)return;historyLoaded=true;
  try{staticData=JSON.parse(await fs.readFile(path.resolve(__dirname,'../data/static/riot.json'),'utf8'));}catch{}
  if(quitting)return;
  try{state.imageAssets=JSON.parse(await fs.readFile(path.resolve(__dirname,'../assets/manifest.json'),'utf8'));}catch{}
  if(quitting)return;
  // Prepare one source image at a time; retaining every decoded bitmap here
  // inflated startup memory even though only tiny descriptors are retained.
  function* iconSources(){for(const a of state.catalog.augments){
    const local=state.imageAssets[a.image?.split('?')[0]];if(!local)continue;
    const image=nativeImage.createFromPath(path.resolve(__dirname,'../assets/opgg',local));if(image.isEmpty())continue;
    yield {id:a.id,name:a.name,image:{...image.getSize(),bgraBuffer:image.toBitmap()}};
  }}
  if(visualMode)iconTemplates=prepareTemplates(iconSources());
  if(lightVisualMode)augmentWorker=new AugmentIconWorker({templates:iconTemplates,timeoutMs:2500});
  if(lightVisualMode)rerollTemplates=sceneGate.prepareTemplates(['reroll-unused.png','reroll-spent.png'].map(name=>{
    const image=nativeImage.createFromPath(path.resolve(__dirname,'../assets/vision',name));
    return {...image.getSize(),bgraBuffer:image.toBitmap()};
  }));
  const prefs={preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true};
  const primary=screen.getPrimaryDisplay().workArea;
  panel=new BrowserWindow({title:'Hexthon · 海克斯助手',width:Math.min(1280,primary.width),height:Math.min(900,primary.height),minWidth:900,minHeight:650,
    frame:false,show:false,backgroundColor:'#0b1119',icon:path.resolve(__dirname,'../assets/icon.png'),webPreferences:prefs});
  protect(panel);panel.on('close',e=>{if(!quitting){e.preventDefault();panel.hide();}});registerIpc();updateDisplays();
  if(smoke&&!lifecycleSmoke&&visualMode){ensureSceneWindows('shop');ensureSceneWindows('cards');if(lightVisualMode)ensureSceneWindows('draft');}
  await Promise.all([panel.loadFile(path.join(__dirname,'renderer/index.html')),...[overlay,draftWindow,...cardWindows].filter(Boolean).map(win=>windowLoads.get(win))]);
  if(quitting)return;
  const initialLoad=loadChampion(settings.manualChampion);
  if(smoke){
    await initialLoad;
    if(quitting)return;
    if(lifecycleSmoke){
      await require('../scripts/lifecycle-smoke.cjs').runLifecycleSmoke({app,panel,overlay,draftWindow,cardWindows,state,snapshot,saveSettings,pollGame,scanGame,
        setReader:fake=>{reader=fake;},setCapture:fake=>{windowCapture=fake;},onWindowUpdate,history:selectionHistory,applyHistory,layout,
        writeStatus,getWindows:()=>BrowserWindow.getAllWindows(),panelShowRequests:()=>panelShowRequests,loadedWindows:()=>Promise.all(BrowserWindow.getAllWindows().map(win=>windowLoads.get(win)))});
      app.quit();return;
    }
    if(lightSmoke){
      try{await require('../scripts/light-smoke.cjs').runLightSmoke({panel,overlay,draftWindow,cardWindows,state,snapshot,publish,recalculate,layout,scanGame,
        setCapture:fake=>{windowCapture=fake;},pointer:value=>consumeTracking(tracker.observe(lastOffer,value)),
        onWindowUpdate,resetGame,history:selectionHistory,applyHistory,resetShop:()=>lightShop.reset()});
        await augmentWorker?.close();await ocr?.close();await historyStore.queue;quitting=true;app.exit(0);
      }catch(error){console.error(error.stack);await augmentWorker?.close();await ocr?.close();quitting=true;app.exit(1);}return;
    }
    if(apiSmoke){try{await require('../scripts/api-smoke.cjs').runApiSmoke({panel,state,snapshot,publish,recalculate,windows:BrowserWindow.getAllWindows(),setNativeSync:fake=>{nativeSync=fake;}});quitting=true;app.exit(0);}catch(error){console.error(error.stack);app.exit(1);}return;}
    try{await require('../scripts/smoke.cjs').runSmoke({panel,overlay,cardWindows,state,snapshot,publish,ocr,recalculate,layout});quitting=true;app.exit(0);}
    catch(error){console.error(error.stack);quitting=true;app.exit(1);}return;
  }
  initialLoad.catch(reportError);
  await saveSettings({});
  if(quitting)return;
  tray=new Tray(nativeImage.createFromPath(path.resolve(__dirname,'../assets/icon.png')).resize({width:32,height:32}));
  tray.setToolTip(visualMode?(settings.autoScan?'Hexthon · 自动识别已开启':'Hexthon · 自动识别已暂停'):'Hexthon · 接口模式，无画面采集');tray.on('click',showPanel);tray.on('right-click',showPanel);
  const shortcuts=visualMode?[['Control+Alt+O',()=>toggleOverlay().catch(reportError)],['Control+Alt+H',showPanel],['Control+Alt+S',()=>scanGame().catch(reportError)]]:[['Control+Alt+H',showPanel]];
  for(const [key,fn] of shortcuts)state.shortcuts[key]=globalShortcut.register(key,fn);
  if(visualMode){
    monitor=new WindowMonitor();monitor.on('update',snapshot=>{if(snapshot.observedAt)state.monitorError='';onWindowUpdate(snapshot);});
    monitor.on('status',status=>{state.monitorError=status.connected?'':status.message;publish();});
    monitor.on('pointer',(_cursor,snapshot)=>{if(lastOffer&&state.game.phase==='InProgress')consumeTracking(tracker.observe(lastOffer,pointer(snapshot)));});
    if(settings.autoScan)monitor.start();
    viewTimer=setInterval(()=>{if(!settings.autoScan)return;const expired=tracker.expire();if(expired.changed)consumeTracking(expired);state.shop=shopTracker.expire();layout();},200);
  }
  statusTimer=setInterval(()=>writeStatus().catch(()=>{}),visualMode?2000:5000);
  for(const name of ['display-metrics-changed','display-added','display-removed'])screen.on(name,updateDisplays);
  pollGame();if(visualMode)scanLoop();provider.get('index').then(d=>{if(quitting)return;state.catalog=d;recalculate();publish();}).catch(reportError);
  if(process.argv.includes('--panel'))showPanel();
}
const ownsInstance=app.requestSingleInstanceLock();
if(!ownsInstance)app.quit();else app.whenReady().then(()=>process.argv.includes('--quit')?app.quit():start()).catch(error=>{console.error(error.stack||error);app.exit(1);});
app.on('second-instance',(_event,argv)=>{if(argv.includes('--quit'))app.quit();else if(panel&&argv.includes('--panel'))showPanel();});
app.on('before-quit',event=>{
  if(!ownsInstance)return;
  if(shutdownComplete)return;
  event.preventDefault();if(shutdownPromise)return;
  quitting=true;gameEpoch++;clearTimeout(gameTimer);clearTimeout(scanTimer);clearInterval(viewTimer);clearInterval(statusTimer);globalShortcut.unregisterAll();monitor?.stop();
  state.overlayVisible=false;state.overlayMode=null;
  for(const win of [panel,overlay,draftWindow,...cardWindows])if(win&&!win.isDestroyed())win.hide();
  const flush=async()=>{
    if(!historyLoaded)return;
    const payload=selectionHistory?.serialize();
    if(historyStore&&!(payload===null&&persistedHistory))await historyStore.save(payload??null);
    await historyStore?.flush();
  };
  shutdownPromise=(async()=>{
    let timer;const deadline=Date.now()+4000;
    const cleanup=Promise.allSettled([flush(),settingsQueue,nativeSync?.flush(),windowCapture?.close(),augmentWorker?.close(),ocr?.close()]);
    const results=await Promise.race([cleanup,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),3500);})]);clearTimeout(timer);
    if(!results||results.some(row=>row.status==='rejected'))state.error='退出保存或资源回收未完成，请检查诊断';
    await Promise.race([writeStatus().catch(()=>{}),new Promise(resolve=>{timer=setTimeout(resolve,Math.max(1,deadline-Date.now()));})]);clearTimeout(timer);
    shutdownComplete=true;app.quit();
  })();
});
app.on('window-all-closed',()=>{});
