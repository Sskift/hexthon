const get=id=>document.getElementById(id);
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let imageAssets={},signature='';
function image(item){
  const url=item?.image,local=imageAssets[url?.split('?')[0]];
  const src=local?`../../assets/opgg/${local}`:url;
  return src?`<img src="${escapeHtml(src)}" alt="">`:'';
}
function render(state){
  const nextSignature=JSON.stringify([state.selectedChampion,state.game?.ownItems,state.buildSuggestions,state.buildMeta,state.selectedAugments,state.matchup,state.imageAssets,state.loading]);
  if(nextSignature===signature)return;signature=nextSignature;imageAssets=state.imageAssets||{};
  const champion=state.selectedChampion,inventory=state.game?.ownItems;
  const group=(state.buildSuggestions||[]).find(row=>row.name==='核心装备');
  const suggestion=group?.rows?.find(row=>row.next)||group?.rows?.[0];
  const items=suggestion?.items||[];
  const nextItem=suggestion?.next;
  const matchup=state.matchup||{},seen=new Set();
  const advice=(matchup.recommendations||[]).filter(rec=>{
    if(!rec?.item?.id||seen.has(rec.item.id))return false;seen.add(rec.item.id);return true;
  }).slice(0,2);
  const nextText=advice[0]?`优先查看 · ${advice[0].item.name}`:nextItem?`路线下一件 · ${nextItem.name}`:!Array.isArray(inventory)?'装备未读取，展示来源路线':items.length&&items.every(item=>item.owned===true)?'当前核心路线已拥有':'根据本局情况调整出装';
  get('shop-hero').innerHTML=champion?`${image(champion)}<div><h2>${escapeHtml(champion.name)}</h2><p>${escapeHtml(nextText)}</p></div>`:'<div><h2>等待游戏英雄</h2><p>读取后自动更新出装资料</p></div>';
  const kindLabel={quest:'任务前置',upgrade:'强化所需',synergy:'强化联动',matchup:'装备对策'};
  get('shop-advice').innerHTML=advice.length?advice.map(rec=>`<article class="advice-card"><div class="advice-heading"><strong>${escapeHtml(rec.item.name)}</strong><span>${rec.tentative?'待确认 · ':''}${kindLabel[rec.kind]||'装备对策'}</span></div><p title="${escapeHtml(rec.reason)}">${escapeHtml(rec.reason)}</p><small>${escapeHtml(rec.source?.startsWith('OP.GG')?'来自 OP.GG 路线':'Riot 装备资料 · 商店可购为准')}</small></article>`).join(''):
    `<div class="advice-empty">${!Array.isArray(inventory)?'当前装备未读取，暂不判断补购。':state.loading?'正在更新英雄资料…':'暂无有证据的额外补购建议，可参考下方路线。'}</div>`;
  const fit=advice[0]?.fit||nextItem?.fit;
  const contextualNote=fit?.cautions?.[0]||matchup.cautions?.[0]||suggestion?.fitCautions?.[0]||fit?.benefits?.[0]||suggestion?.reasons?.[0];
  get('shop-context-note').textContent=contextualNote||'已选记录可能不完整 · 敌方强化未知';
  get('shop-context-note').title=contextualNote||matchup.summary||'';
  get('shop-items').innerHTML=items.length?items.slice(0,3).map((item,index)=>`<div class="shop-item ${item.owned===true?'owned':item.blocked?'blocked':nextItem?.id===item.id?'next':''}" title="${escapeHtml((item.reasons||[]).join('；')||item.name)}"><span class="item-number">0${index+1}</span>${image(item)}<div class="item-detail"><strong>${escapeHtml(item.name)}</strong><small>${item.owned===true?'已拥有 / 已升级':item.blocked?'暂不补购':nextItem?.id===item.id?'路线下一件':'路线参考'}</small></div></div>`).join(''):`<div class="empty">${state.loading?'正在读取出装…':'暂未取得核心出装资料'}</div>`;
  get('shop-inventory-status').textContent=Array.isArray(inventory)?`${inventory.length} 件`:'未读取';
  get('shop-inventory-section').hidden=advice.length>1;
  get('shop-inventory').textContent=Array.isArray(inventory)?inventory.length?inventory.map(item=>item.name||`装备 ${item.id}`).join(' · '):'当前没有装备':'等待自动读取装备';
  const selected=state.selectedAugments||[];
  get('shop-augments').hidden=!selected.length;
  get('shop-augments').textContent=selected.length?`已选强化 · ${selected.map(item=>`${item.name||`#${item.id}`}${item.confidence==='visual'?'（图标识别）':item.confidence==='inferred'?'（推断）':''}`).join(' / ')}`:'';
  get('shop-source').textContent=`OP.GG 路线 · ${state.buildMeta?.patch||state.catalog?.patch||'—'}`;
  get('shop-data-status').textContent=state.buildMeta?.cacheStatus==='stale'?'历史缓存，留意版本':'敌方强化未知';
}
window.hexthon.onState(render);
window.hexthon.getState().then(render);
