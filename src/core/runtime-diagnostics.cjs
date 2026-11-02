const patch=value=>typeof value==='string'&&/^\d+\.\d+/.test(value)?value.match(/^\d+\.\d+/)[0]:null;
function compatibility({gameVersion,catalogPatch,augmentPatch,buildPatch,staticVersion}={}){
  const game=patch(gameVersion),stats=patch(staticVersion),data=[...new Set([catalogPatch,augmentPatch,buildPatch].map(patch).filter(Boolean))];
  const warnings=[];
  if(game&&data.some(value=>value!==game))warnings.push(`游戏 ${game} 与 OP.GG 资料 ${data.join(' / ')} 不同，请更新资料后对照使用`);
  if(game&&stats&&game!==stats)warnings.push(`游戏 ${game} 与装备资料 ${stats} 不同，已暂停装备属性推理与自动装备方案同步`);
  if(data.length>1)warnings.push('当前英雄与通用资料来自不同补丁');
  return {gamePatch:game,opggPatches:data,staticPatch:stats,status:warnings.length?'mismatch':game&&stats&&data.length?'matched':'unknown',
    staticRulesEnabled:!(game&&stats&&game!==stats),itemSetSyncEnabled:!warnings.length,warnings};
}
class ScanBudget{
  constructor(){this.samples=[];this.failures=0;}
  record(ms,{failed=false}={}){
    if(!Number.isFinite(ms)||ms<0)return;
    this.samples.push(Math.min(ms,30000));if(this.samples.length>30)this.samples.shift();
    this.failures=failed?Math.min(this.failures+1,4):0;
  }
  snapshot(){
    const sorted=[...this.samples].sort((a,b)=>a-b),recent=this.samples.slice(-4);
    const mean=recent.length?recent.reduce((sum,n)=>sum+n,0)/recent.length:0;
    return {samples:sorted.length,lastMs:Math.round(this.samples.at(-1)||0),p95Ms:sorted.length?Math.round(sorted[Math.ceil(sorted.length*.95)-1]):null,
      averageRecentMs:Math.round(mean),consecutiveFailures:this.failures,throttled:mean>225||this.failures>=2};
  }
  delay({scene='idle',hint=false}={}){
    const {averageRecentMs,consecutiveFailures}=this.snapshot();
    if(consecutiveFailures>=2)return Math.min(6000,1500*consecutiveFailures);
    const base=hint?400:900,cap=scene==='cards'?1600:scene==='shop'?2000:3500;
    return Math.round(Math.min(cap,Math.max(base,averageRecentMs*4)));
  }
}
function diagnosticReport(state){
  const g=state.game||{},count=rows=>Array.isArray(rows)?rows.length:0;
  return {schemaVersion:1,createdAt:new Date().toISOString(),appVersion:state.version,mode:state.recognitionMode,
    recognitionEnabled:state.settings?.autoScan===true,phase:g.phase||'unknown',lcuConnected:g.lcuConnected===true,liveConnected:g.liveConnected===true,
    compatibility:compatibility({gameVersion:g.gameVersion,catalogPatch:state.catalog?.patch,augmentPatch:state.augmentMeta?.patch,buildPatch:state.buildMeta?.patch,staticVersion:state.compatibility?.staticPatch}),
    coverage:{ownInventoryKnown:Array.isArray(g.ownItems),ownItems:count(g.ownItems),knownSelectedAugments:count(state.selectedAugments),completeSelectedAugments:false,
      teamInventoriesKnown:(g.team||[]).filter(row=>Array.isArray(row.items)).length,opponentInventoriesKnown:(g.opponents||[]).filter(row=>Array.isArray(row.items)).length,enemyAugmentsKnown:false},
    scene:{mode:['cards','shop'].includes(state.overlayMode)?state.overlayMode:null,visible:state.overlayVisible===true,draftVisible:state.draftOverlayVisible===true},
    performance:state.scanBudget?{samples:state.scanBudget.samples,lastMs:state.scanBudget.lastMs,p95Ms:state.scanBudget.p95Ms,throttled:state.scanBudget.throttled}:null,
    itemSets:{status:state.nativeItemSets?.status||'disabled',hotReloadVerified:false},
    limitations:['No window pixels, OCR text, account identifiers, credentials or process command lines are exported.','Timing describes assistant work, not game FPS.']};
}
module.exports={compatibility,ScanBudget,diagnosticReport};
