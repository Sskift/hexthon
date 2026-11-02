const get=id=>document.getElementById(id);
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let imageAssets={},signature='';
function image(item){
  const url=item?.image,local=imageAssets[url?.split('?')[0]];
  const src=local?`../../assets/opgg/${local}`:url;
  return src?`<img src="${escapeHtml(src)}" alt="">`:'';
}
function render(state){
  const nextSignature=JSON.stringify([state.selectedChampion,state.game?.ownItems,state.buildSuggestions,state.buildMeta,state.selectedAugments,state.loading]);
  if(nextSignature===signature)return;signature=nextSignature;imageAssets=state.imageAssets||{};
  const champion=state.selectedChampion,inventory=state.game?.ownItems;
  const group=(state.buildSuggestions||[]).find(row=>row.name==='核心装备');
  const suggestion=group?.rows?.[0];
  const items=suggestion?.items||[];
  const nextItem=suggestion?.next;
  const nextText=nextItem?`下一件参考 · ${nextItem.name}`:!Array.isArray(inventory)?'装备未读取，展示来源路线':items.length&&items.every(item=>item.owned===true)?'当前核心路线已拥有':'根据本局情况调整出装';
  get('shop-hero').innerHTML=champion?`${image(champion)}<div><h2>${escapeHtml(champion.name)}</h2><p>${escapeHtml(nextText)}</p></div>`:'<div><h2>等待游戏英雄</h2><p>读取后自动更新出装资料</p></div>';
  get('shop-items').innerHTML=items.length?items.slice(0,3).map((item,index)=>`<div class="shop-item ${item.owned===true?'owned':nextItem?.id===item.id?'next':''}"><span class="item-number">0${index+1}</span>${image(item)}<div class="item-detail"><strong>${escapeHtml(item.name)}</strong><small>${item.owned===true?'已拥有 / 已升级':nextItem?.id===item.id?'可考虑下一件':'路线参考'}</small></div>${item.owned===true?'<span class="owned-mark">✓</span>':''}</div>`).join(''):`<div class="empty">${state.loading?'正在读取英雄出装资料…':'暂未取得核心出装资料'}</div>`;
  get('shop-inventory-status').textContent=Array.isArray(inventory)?`${inventory.length} 件`:'未读取';
  get('shop-inventory').textContent=Array.isArray(inventory)?inventory.length?inventory.map(item=>item.name||`装备 ${item.id}`).join(' · '):'当前没有装备':'等待自动读取装备';
  const selected=state.selectedAugments||[];
  get('shop-augments').hidden=!selected.length;
  get('shop-augments').textContent=selected.length?`已选强化 · ${selected.map(item=>`${item.name||`#${item.id}`}${item.confidence==='visual'?'（图标识别）':item.confidence==='inferred'?'（推断）':''}`).join(' / ')}`:'';
  get('shop-source').textContent=`OP.GG · ${state.buildMeta?.patch||state.catalog?.patch||'—'}`;
  get('shop-data-status').textContent=state.buildMeta?.cacheStatus==='stale'?'历史缓存，请留意版本':'结合本局自行选择';
}
window.hexthon.onState(render);
window.hexthon.getState().then(render);
