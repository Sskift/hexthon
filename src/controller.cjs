const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, globalShortcut, screen, shell, desktopCapturer, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { OpggProvider, BASE } = require('./core/opgg.cjs');
const { LeagueReader } = require('./core/league.cjs');
const { OcrReader } = require('./core/ocr.cjs');
const { WindowMonitor } = require('./core/window-monitor.cjs');
const { locateOffer, OfferTracker } = require('./core/vision.cjs');
const { detectShop, ShopTracker } = require('./core/shop-vision.cjs');
const {prepareTemplates,matchAugmentIcons,AugmentIconTracker}=require('./core/augment-icons.cjs');
const { scoreAugments, rankDraft, buildRecommendations, matchupRecommendations, rerollAdvice } = require('./core/recommendations.cjs');
const { DEFAULTS, validateSettings } = require('./core/settings.cjs');
const { cardBounds, shopBounds } = require('./core/overlay-layout.cjs');

const apiSmoke=process.argv.includes('--api-smoke-test');
const smoke = process.argv.includes('--smoke-test')||apiSmoke;
const visualMode=process.argv.includes('--visual-experimental')||(smoke&&!apiSmoke);
if(!visualMode)app.disableHardwareAcceleration();
app.setName('Hexthon');
if (smoke) app.setPath('userData', path.resolve(__dirname, '../.qa/profile'));
let panel, overlay, tray, provider, reader, ocr, monitor, staticData = {}, quitting = false;
let gameTimer, scanTimer, viewTimer, statusTimer, manualOverlay = null, loadSerial = 0, captureBusy = false, gameEpoch = 0;
let lastOffer = null, tracker = new OfferTracker(), inferredMode = false, captureAt = 0, trackingSignature = '';
const shopTracker=new ShopTracker({observationTtlMs:5000});
const iconTracker=new AugmentIconTracker(),ignoredVisualSelections=new Set();
let iconTemplates=[];
let lastLiveTime = null, lastGameId = null, liveLostAt = 0;
const consumedSelections = new Set();
const cardWindows = [];
let settings = { ...DEFAULTS };
const state = { version:'0.2.2', recognitionMode:visualMode?'visual':'api', captureEnabled:visualMode, catalog:null, selectedChampion:null, augments:[], builds:[],
  augmentMeta:null, buildMeta:null, game:{phase:'Disconnected',lcuConnected:false,liveConnected:false,team:[],bench:[],ownItems:null},
  offeredIds:[], selectedAugments:[], augmentScores:[], reroll:null, draft:null, buildSuggestions:[], matchup:null,
  offer:{cards:[],stable:false,present:false}, shop:{visible:false}, visualSelection:{matches:[],pending:[]}, overlayMode:null, selectionHistoryComplete:false, monitor:{game:null,client:null}, autoStatus:visualMode?'正在寻找英雄联盟窗口…':'正在连接本地客户端接口…',
  ocr:{status:'idle',matches:[],text:''}, overlayVisible:false, loading:false, error:'', shortcuts:{},
  modeConfirmed:false, displays:[], imageAssets:{} };
const settingsFile = () => path.join(app.getPath('userData'),'settings.json');
const snapshot = () => ({...state,settings});
function publish() {
  for (const win of [panel,overlay,...cardWindows]) if (win && !win.isDestroyed() && !win.webContents.isLoading() && (smoke||win.isVisible())) win.webContents.send('state',snapshot());
}
function reportError(error) { state.error=error?.message||String(error); publish(); }
function metadata(d) { return d && {patch:d.patch,fetchedAt:d.fetchedAt,cacheStatus:d.cacheStatus||'cached',warning:d.warning||'',url:d.url}; }
function recalculate() {
  const liveHeroMatches=state.game.liveConnected&&state.game.championId===state.selectedChampion?.id;
  const ownItems=liveHeroMatches?state.game.ownItems:null;
  const selected = liveHeroMatches?state.selectedAugments.map(s=>({...state.catalog?.augments.find(a=>a.id===s.id),...s})):[];
  const selectedKnown=liveHeroMatches&&state.selectionHistoryComplete&&state.selectedAugments.every(a=>a.confidence==='confirmed');
  state.augmentScores=scoreAugments({augments:state.augments,champion:state.selectedChampion,
    ownItems, selectedAugments:selected, championStats:liveHeroMatches?state.game.ownChampStats:null,
    staticData, contextKnown:liveHeroMatches, selectedKnown});
  state.draft=rankDraft({catalog:state.catalog,team:state.game.team||[],availableChampionIds:state.game.availableChampionIds||[],
    selfId:state.game.championId,staticData});
  state.buildSuggestions=buildRecommendations({builds:state.builds,ownItems,staticData});
  state.matchup=liveHeroMatches?matchupRecommendations({champion:state.selectedChampion,ownItems,
    team:state.game.team,opponents:state.game.opponents,selectedAugments:selected,staticData,builds:state.builds}):null;
  state.reroll=rerollAdvice({offeredIds:state.offeredIds,scores:state.augmentScores,augments:state.augments,
    rerollsRemaining:state.game.augmentRerollsRemaining??null,selectedKnown});
  if (state.reroll && !state.reroll.label) state.reroll.label=({keep:'保留当前选项', 'consider-reroll':'可以考虑刷新', unknown:'信息不足，暂不判断'})[state.reroll.action];
}
async function saveSettings(patch) {
  const oldPath=settings.leaguePath;
  settings={...validateSettings(patch,settings),schemaVersion:4};
  if(!visualMode)settings.autoScan=false;
  await fs.mkdir(app.getPath('userData'),{recursive:true});
  await fs.writeFile(settingsFile()+'.tmp',JSON.stringify(settings,null,2));
  await fs.rename(settingsFile()+'.tmp',settingsFile());
  if(oldPath!==settings.leaguePath) reader.reset();
  layout(); publish();
}
function showPanel() { if(!smoke){panel.webContents.send('state',snapshot());panel.showInactive();} }
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
function layout() {
  if(!overlay){state.overlayVisible=false;state.overlayEnabled=false;state.overlayMode=null;return;}
  const w=state.monitor.game,gameRect=nativeRect(w);
  state.overlayEnabled=settings.autoOverlay&&manualOverlay!==false;
  const eligible=Boolean(state.overlayEnabled&&state.game.phase==='InProgress'&&activeMayhem()&&w?.foreground&&w?.visible&&!w?.minimized);
  const cardRects=state.offer.cards.map(card=>cardBounds(gameRect,card));
  const showCards=Boolean(eligible&&state.offer.present&&state.offer.stable&&cardRects.length===3&&cardRects.every(Boolean));
  const bounds=state.shop.visible?shopBounds(gameRect,state.shop):null;
  const showShop=Boolean(eligible&&bounds&&!showCards&&!state.offer.present);
  if(bounds)applyBounds(overlay,bounds);if(overlay.getOpacity()!==settings.opacity)overlay.setOpacity(settings.opacity);
  if(showShop&&!smoke){if(!overlay.isVisible())overlay.showInactive();}else if(overlay.isVisible())overlay.hide();
  state.overlayVisible=showShop||showCards;state.overlayMode=showCards?'cards':showShop?'shop':null;
  for(let i=0;i<cardWindows.length;i++){
    const rect=showCards?cardRects[i]:null;
    if(rect)applyBounds(cardWindows[i],rect);
    if(cardWindows[i].getOpacity()!==settings.opacity)cardWindows[i].setOpacity(settings.opacity);
    if(rect&&!smoke){if(!cardWindows[i].isVisible())cardWindows[i].showInactive();}else if(cardWindows[i].isVisible())cardWindows[i].hide();
  }
}
function toggleOverlay(){manualOverlay=manualOverlay===false?null:false;layout();publish();}
function updateDisplays(){state.displays=screen.getAllDisplays().map((d,i)=>({id:d.id,label:`显示器 ${i+1} · ${d.size.width} × ${d.size.height}`,primary:d.id===screen.getPrimaryDisplay().id}));layout();publish();}
async function loadChampion(key,force=false){
  const c=state.catalog?.champions.find(c=>c.key===key);if(!c)return;
  if(state.selectedChampion?.key===key&&!force&&(state.loading||state.augmentMeta))return;
  const serial=++loadSerial;
  state.selectedChampion=c;state.loading=true;state.error='';state.augments=state.catalog.augments;
  state.augmentMeta=null;state.buildMeta=null;state.builds=[];recalculate();publish();
  const results=await Promise.allSettled([provider.get('augments',key,force),provider.get('build',key,force)]);
  if(serial!==loadSerial)return;
  const errors=[];
  if(results[0].status==='fulfilled'){state.augments=results[0].value.augments;state.augmentMeta=metadata(results[0].value);}else errors.push('专属档位暂不可用，当前使用通用资料');
  if(results[1].status==='fulfilled'){state.builds=results[1].value.builds;state.buildMeta=metadata(results[1].value);}else errors.push('出装资料暂不可用');
  state.loading=false;state.error=errors.join('；');recalculate();publish();
}
function resetGame(){
  gameEpoch++;tracker.reset();lastOffer=null;inferredMode=false;manualOverlay=null;trackingSignature='';
  consumedSelections.clear();
  iconTracker.reset();ignoredVisualSelections.clear();state.visualSelection={matches:[],pending:[]};
  state.offeredIds=[];state.selectedAugments=[];state.offer={cards:[],stable:false,present:false};state.shop=shopTracker.invalidate();state.modeConfirmed=false;
  state.selectionHistoryComplete=false;lastLiveTime=null;lastGameId=null;liveLostAt=0;
  state.ocr={status:'idle',matches:[],text:''};
}
function pointer(snapshot){
  const w=snapshot.game,c=snapshot.cursor;
  return w&&c?{x:(c.x-w.x)/w.width,y:(c.y-w.y)/w.height,leftDown:c.leftDown,leftPressed:c.leftPressed,pressId:c.pressId,active:Boolean(w.foreground&&!w.minimized&&c.active!==false),at:snapshot.observedAt}: {active:false,leftDown:false};
}
function consumeTracking(result){
  if(!result)return;
  const signature=JSON.stringify(result);
  if(signature===trackingSignature)return;trackingSignature=signature;
  state.offer={cards:result.cards||[],stable:Boolean(result.stable),present:lastOffer?.cards?.length===3,pendingSelection:result.pendingSelection||null};
  state.offeredIds=state.offer.stable?state.offer.cards.map(c=>c.id):[];
  const selections=Array.isArray(result.selected)?result.selected:result.selected?[result.selected]:[];
  for(const pick of selections){
    const eventKey=`${pick.generation}:${pick.id}`;
    if(consumedSelections.has(eventKey))continue;
    consumedSelections.add(eventKey);
    if(!state.selectedAugments.some(a=>a.id===pick.id)){
      const a=state.catalog.augments.find(a=>a.id===pick.id);
      if(a)state.selectedAugments.push({id:a.id,name:a.name,confidence:'inferred',evidence:pick.evidence||'卡片点击后消失',detectedAt:new Date().toISOString()});
    }
  }
  recalculate();layout();publish();
}
function onWindowUpdate(snapshot){
  const lostForeground=state.monitor.game?.foreground&&!snapshot.game?.foreground;
  state.monitor=snapshot;
  if(lostForeground){state.shop=shopTracker.invalidate();iconTracker.invalidate();lastOffer=null;consumeTracking(tracker.invalidate());}
  if(!state.game.lcuConnected&&!state.game.liveConnected)state.autoStatus=snapshot.client?'已发现客户端窗口，正在连接…':'等待英雄联盟客户端…';
}
async function pollGame(){
  try{
    const old=state.game;state.game=await reader.poll(settings,state.catalog?.champions||[],state.catalog?.augments||[]);
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
      if(visualMode&&state.game.gameTime!=null&&state.game.gameTime<5)state.selectionHistoryComplete=true;
    }
    if(Array.isArray(state.game.ownSelectedAugmentIds)){
      state.selectionHistoryComplete=true;
      state.selectedAugments=state.game.ownSelectedAugmentIds.map(id=>({id,name:state.catalog.augments.find(a=>a.id===id)?.name||String(id),confidence:'confirmed',evidence:'本机接口'}));
    }
    for(const detected of state.game.detectedAugments||[]){
      if(ignoredVisualSelections.has(detected.id))continue;
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
    recalculate();layout();publish();
  }catch(error){state.error='本地接口暂不可用，将自动重连';publish();}
  finally{if(!quitting&&!smoke)gameTimer=setTimeout(pollGame,visualMode?1800:3000);}
}
async function scanGame(){
  if(!visualMode)throw new Error('当前为接口模式，画面采集与 OCR 已停用');
  const w=state.monitor.game;
  if(captureBusy||ocr.busy)return;
  if(!state.game.liveConnected||!w?.foreground||w.minimized||!w.visible)throw new Error('等待游戏窗口进入前台后自动识别');
  if(!activeMayhem() && (state.game.queueId || !/ARAM/i.test(state.game.gameMode||'')))throw new Error('当前不是已确认的海克斯模式');
  captureBusy=true;captureAt=Date.now();const epoch=gameEpoch;
  try{
    const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:2560,height:1440},fetchWindowIcons:false});
    if(epoch!==gameEpoch||quitting)return;
    const source=sources.find(s=>{try{return BigInt(s.id.split(':')[1])===BigInt(w.hwnd);}catch{return false;}});
    if(!source||source.thumbnail.isEmpty())throw new Error('游戏窗口画面暂不可用，请使用无边框模式');
    const iconStart=Date.now(),size=source.thumbnail.getSize();
    const visual=iconTracker.observe(matchAugmentIcons({...size,bgraBuffer:source.thumbnail.toBitmap()},iconTemplates),{active:Boolean(state.monitor.game?.foreground)});
    state.visualSelection={matches:visual.matches,pending:visual.pending,durationMs:Date.now()-iconStart};
    if(visual.replacedIds?.length)state.selectedAugments=state.selectedAugments.filter(a=>a.confidence!=='visual'||!visual.replacedIds.includes(a.id));
    for(const selected of visual.selected){
      if(ignoredVisualSelections.has(selected.id))continue;
      const existing=state.selectedAugments.find(a=>a.id===selected.id);
      if(!existing)state.selectedAugments.push({...selected});
      else if(existing.confidence!=='confirmed')Object.assign(existing,selected);
    }
    recalculate();
    state.ocr={...state.ocr,status:'running'};
    let result=await ocr.read(source.thumbnail,{x:.08,y:.08,width:.84,height:.84},state.catalog.augments);
    if(epoch!==gameEpoch||quitting)return;
    state.shop=shopTracker.observe(detectShop(result));
    lastOffer=locateOffer(result,state.catalog.augments);
    // A tighter second pass preserves small title strokes when the wider shop
    // scan found augment names but could not establish the three-card layout.
    if(!lastOffer.cards.length&&result.matches.filter(m=>m.exact).length>=2){
      result=await ocr.read(source.thumbnail,settings.ocrRegion,state.catalog.augments);
      if(epoch!==gameEpoch||quitting)return;
      lastOffer=locateOffer(result,state.catalog.augments);
    }
    lastOffer.observedAt=result.capturedAt||new Date().toISOString();
    if(lastOffer.cards?.length===3)inferredMode=true;
    state.ocr={...result,status:'done',message:lastOffer.cards?.length===3?'已定位三个强化符文':'持续监测卡片区域'};
    state.autoStatus=lastOffer.cards?.length===3?'已定位强化卡片，自动更新推荐指数':state.shop.visible?'商店已打开，显示出装参考':'自动监测中，商店或海克斯页面出现时显示推荐';
    state.offer.present=lastOffer.cards?.length===3;
    consumeTracking(tracker.observe(lastOffer,pointer(state.monitor)));
    layout();publish();
  }catch(error){state.shop=shopTracker.invalidate();state.offer.present=false;lastOffer=null;consumeTracking(tracker.invalidate());state.ocr={...state.ocr,status:'error',message:error.message};state.autoStatus=error.message;publish();}
  finally{captureBusy=false;}
}
async function scanLoop(){
  if(settings.autoScan&&state.monitor.game?.foreground&&state.game.liveConnected&&!captureBusy)await scanGame().catch(()=>{});
  if(!quitting&&!smoke)scanTimer=setTimeout(scanLoop,1300);
}
async function writeStatus(){
  const payload={version:state.version,pid:process.pid,updatedAt:new Date().toISOString(),phase:state.game.phase,
    lcuConnected:state.game.lcuConnected,liveConnected:state.game.liveConnected,queueId:state.game.queueId,
    champion:state.selectedChampion?.key,autoStatus:state.autoStatus,autoScan:settings.autoScan,autoFollow:settings.autoFollow,recognitionMode:state.recognitionMode,captureEnabled:visualMode,windowMonitorEnabled:Boolean(monitor),windowCount:BrowserWindow.getAllWindows().length,
    window:state.monitor.game||state.monitor.client||null,offeredIds:state.offeredIds,selectedAugments:state.selectedAugments,
    overlayVisible:state.overlayVisible,overlayMode:state.overlayMode,shop:state.shop,visualSelection:state.visualSelection,shopOverlay:overlay?{visible:overlay.isVisible(),bounds:overlay.getBounds()}:null,cardOverlays:cardWindows.map(w=>({visible:w.isVisible(),bounds:w.getBounds()})),
    error:state.error,ocr:{status:state.ocr.status,message:state.ocr.message,lastCapture:captureAt},
    itemIds:state.game.ownItems?.map(i=>i.id),availableChampionIds:state.game.availableChampionIds,
    matchup:state.matchup?{completeAugments:state.matchup.completeAugments,evidence:state.matchup.evidence,recommendations:state.matchup.recommendations}:null};
  await fs.mkdir(app.getPath('userData'),{recursive:true});
  await fs.writeFile(path.join(app.getPath('userData'),'runtime-status.json'),JSON.stringify(payload,null,2)).catch(()=>{});
}
function registerIpc(){
  const handle=(name,fn,readOnly=false)=>ipcMain.handle(name,async(e,arg)=>{
    if(e.sender!==panel.webContents&&!(readOnly&&[overlay,...cardWindows].filter(Boolean).some(w=>e.sender===w.webContents)))return {ok:false,error:'无效的请求来源'};
    try{return {ok:true,data:await fn(arg)};}catch(error){return {ok:false,error:error.message};}
  });
  handle('get-state',snapshot,true);
  handle('save-settings',async patch=>{await saveSettings(patch||{});return snapshot();});
  handle('window-action',action=>{if(action==='hide')panel.hide();else if(action==='minimize')panel.minimize();else if(action==='quit'){quitting=true;app.quit();}else throw new Error('无效的窗口操作');});
  handle('select-champion',async key=>{if(!state.catalog.champions.some(c=>c.key===key))throw new Error('未知英雄');await saveSettings({manualChampion:key,autoFollow:false});await loadChampion(key);return snapshot();});
  handle('follow-champion',async()=>{await saveSettings({autoFollow:true});const c=state.catalog.champions.find(c=>c.id===state.game.championId);if(c)await loadChampion(c.key);return snapshot();});
  handle('refresh',async()=>{state.catalog=await provider.get('index',null,true);await loadChampion(state.selectedChampion?.key||settings.manualChampion,true);publish();});
  const validIds=ids=>Array.isArray(ids)&&ids.every(id=>state.catalog.augments.some(a=>a.id===id));
  handle('set-offers',ids=>{if(!validIds(ids)||ids.length>3)throw new Error('最多选择三个有效符文');state.offeredIds=[...new Set(ids)];recalculate();publish();});
  handle('set-selected-augments',ids=>{if(!validIds(ids)||ids.length>20)throw new Error('无效的已选符文');for(const a of state.selectedAugments)if(!ids.includes(a.id))ignoredVisualSelections.add(a.id);for(const id of ids)ignoredVisualSelections.delete(id);state.selectedAugments=[...new Set(ids)].map(id=>state.selectedAugments.find(a=>a.id===id)||({id,name:state.catalog.augments.find(a=>a.id===id).name,confidence:'confirmed',evidence:'手动校正'}));recalculate();publish();});
  handle('confirm-selected-augment',id=>{const a=state.selectedAugments.find(a=>a.id===id);if(!a)throw new Error('未找到该符文');a.confidence='confirmed';a.evidence='手动确认';recalculate();publish();});
  handle('scan',scanGame);handle('toggle-overlay',toggleOverlay);
  handle('import-image',()=>{throw new Error(visualMode?'自动识别已启用，无需导入图片':'当前为接口模式，画面采集与 OCR 已停用');});
  handle('confirm-mode',value=>{state.modeConfirmed=value===true;layout();publish();});
  handle('open-source',async kind=>{const key=state.selectedChampion?.key;const url=key&&['build','augments'].includes(kind)?`${BASE}/${key}/${kind}`:BASE;if(!smoke)await shell.openExternal(url);return url;});
}
async function start(){
  Menu.setApplicationMenu(null);session.defaultSession.setPermissionRequestHandler((_w,_p,cb)=>cb(false));session.defaultSession.setPermissionCheckHandler(()=>false);
  let previous={};try{previous=JSON.parse(await fs.readFile(settingsFile(),'utf8'));}catch{}
  settings=validateSettings(previous.schemaVersion>=2?previous:{...previous,autoFollow:true,autoOverlay:true,autoScan:true});
  if(!visualMode)settings.autoScan=false;
  if(smoke)settings={...DEFAULTS,autoScan:visualMode};
  provider=new OpggProvider(path.join(app.getPath('userData'),'cache'),path.resolve(__dirname,'../data/seed'));
  reader=new LeagueReader();
  if(visualMode)ocr=new OcrReader(path.join(app.getPath('userData'),'ocr'),()=>{},(bitmap,size)=>nativeImage.createFromBitmap(bitmap,size));
  state.catalog=await provider.read('index');
  if(!state.catalog)throw new Error('内置资料缺失，请重新解压完整安装包');
  try{staticData=JSON.parse(await fs.readFile(path.resolve(__dirname,'../data/static/riot.json'),'utf8'));}catch{}
  try{state.imageAssets=JSON.parse(await fs.readFile(path.resolve(__dirname,'../assets/manifest.json'),'utf8'));}catch{}
  if(visualMode)iconTemplates=prepareTemplates(state.catalog.augments.flatMap(a=>{
    const local=state.imageAssets[a.image?.split('?')[0]];if(!local)return [];
    const image=nativeImage.createFromPath(path.resolve(__dirname,'../assets/opgg',local));if(image.isEmpty())return [];
    return [{id:a.id,name:a.name,image:{...image.getSize(),bgraBuffer:image.toBitmap()}}];
  }));
  const prefs={preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true};
  const primary=screen.getPrimaryDisplay().workArea;
  panel=new BrowserWindow({title:'Hexthon · 海克斯助手',width:Math.min(1280,primary.width),height:Math.min(900,primary.height),minWidth:900,minHeight:650,
    frame:false,show:false,backgroundColor:'#0b1119',icon:path.resolve(__dirname,'../assets/icon.png'),webPreferences:prefs});
  const createOverlay=(width,height)=>{
    const win=new BrowserWindow({width,height,show:false,frame:false,transparent:true,resizable:false,focusable:false,skipTaskbar:true,hasShadow:false,alwaysOnTop:true,webPreferences:prefs});
    win.setIgnoreMouseEvents(true,{forward:true});win.setAlwaysOnTop(true,'screen-saver');protect(win);return win;
  };
  if(visualMode){overlay=createOverlay(300,360);for(let i=0;i<3;i++)cardWindows.push(createOverlay(260,116));}
  protect(panel);panel.on('close',e=>{if(!quitting){e.preventDefault();panel.hide();}});registerIpc();updateDisplays();
  await Promise.all([panel.loadFile(path.join(__dirname,'renderer/index.html')),...(overlay?[overlay.loadFile(path.join(__dirname,'renderer/shop.html'))]:[]),
    ...cardWindows.map((w,i)=>w.loadFile(path.join(__dirname,'renderer/cards.html'),{query:{slot:String(i)}}))]);
  const initialLoad=loadChampion(settings.manualChampion);
  if(smoke){
    await initialLoad;
    if(apiSmoke){try{await require('../scripts/api-smoke.cjs').runApiSmoke({panel,state,snapshot,publish,recalculate,windows:BrowserWindow.getAllWindows()});quitting=true;app.exit(0);}catch(error){console.error(error.stack);app.exit(1);}return;}
    try{await require('../scripts/smoke.cjs').runSmoke({panel,overlay,cardWindows,state,snapshot,publish,ocr,recalculate,layout});quitting=true;app.exit(0);}
    catch(error){console.error(error.stack);quitting=true;app.exit(1);}return;
  }
  initialLoad.catch(reportError);
  await saveSettings({});
  tray=new Tray(nativeImage.createFromPath(path.resolve(__dirname,'../assets/icon.png')).resize({width:32,height:32}));
  tray.setToolTip(visualMode?'Hexthon · 自动识别已开启':'Hexthon · 接口模式，无画面采集');tray.on('click',showPanel);tray.on('right-click',showPanel);
  const shortcuts=visualMode?[['Control+Alt+O',toggleOverlay],['Control+Alt+H',showPanel],['Control+Alt+S',()=>scanGame().catch(reportError)]]:[['Control+Alt+H',showPanel]];
  for(const [key,fn] of shortcuts)state.shortcuts[key]=globalShortcut.register(key,fn);
  if(visualMode){
    monitor=new WindowMonitor();monitor.on('update',onWindowUpdate);
    monitor.on('pointer',(_cursor,snapshot)=>{if(lastOffer&&state.game.phase==='InProgress')consumeTracking(tracker.observe(lastOffer,pointer(snapshot)));});
    monitor.start();
    viewTimer=setInterval(()=>{const expired=tracker.expire();if(expired.changed)consumeTracking(expired);state.shop=shopTracker.expire();layout();},200);
  }
  statusTimer=setInterval(()=>writeStatus().catch(()=>{}),visualMode?2000:5000);
  for(const name of ['display-metrics-changed','display-added','display-removed'])screen.on(name,updateDisplays);
  pollGame();if(visualMode)scanLoop();provider.get('index').then(d=>{state.catalog=d;recalculate();publish();}).catch(reportError);
  if(process.argv.includes('--panel'))showPanel();
}
if(!app.requestSingleInstanceLock())app.quit();else app.whenReady().then(start).catch(error=>{console.error(error.stack||error);app.exit(1);});
app.on('second-instance',()=>{if(panel)showPanel();});
app.on('before-quit',()=>{quitting=true;clearTimeout(gameTimer);clearTimeout(scanTimer);clearInterval(viewTimer);clearInterval(statusTimer);globalShortcut.unregisterAll();monitor?.stop();ocr?.close().catch(()=>{});});
app.on('window-all-closed',()=>{});
