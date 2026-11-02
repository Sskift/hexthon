const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let imageAssets={};
const image=a=>{const local=imageAssets[a?.image?.split('?')[0]],src=local?`../../assets/opgg/${local}`:a?.image;return src?`<img src="${escapeHtml(src)}" alt="">`:'';};
const rarity={1:'白银',4:'黄金',8:'彩色'};
let signature='';
function render(s){
 imageAssets=s.imageAssets||{};
 const next=JSON.stringify([s.selectedChampion?.key,s.augmentMeta,s.offeredIds,s.game.phase,s.game.championId,s.settings.autoFollow,s.ocr.status,s.loading,s.buildMeta]);if(next===signature)return;signature=next;
 const c=s.selectedChampion;const following=s.settings.autoFollow&&c?.id===s.game.championId;
 document.getElementById('hero').innerHTML=c?`${image(c)}<div><h1>${escapeHtml(c.name)}</h1><p>${following?'正在跟随游戏':'手动查阅'} · 海克斯大乱斗</p></div>`:'<p>等待英雄资料</p>';
 const list=s.offeredIds.length?s.offeredIds.map(id=>s.augments.find(a=>a.id===id)||s.catalog.augments.find(a=>a.id===id)).filter(Boolean):s.augments.slice(0,4);
 document.getElementById('list-title').textContent=s.offeredIds.length?'当前选项对照':'强化符文资料';
 document.getElementById('scope').textContent=s.augmentMeta?'英雄专属 · OP.GG':'通用档位 · OP.GG';
 document.getElementById('augment-list').innerHTML=list.length?list.map(a=>`<div class="row">${image(a)}<div><strong>${escapeHtml(a.name)}</strong><small>${rarity[a.rarity]||''} · ${a.scope==='champion'?'英雄专属':'通用档位'}</small></div><span class="tier ${a.tier===0?'top':''}">${a.tier==null?'—':`T${a.tier}`}</span></div>`).join(''):'<div class="empty">等待资料载入</div>';
 const items=s.builds.find(g=>g.name==='核心装备')?.rows[0]||[];
 document.getElementById('build').innerHTML=items.length?`<span>核心出装参考</span><div class="items">${items.map(image).join('')}</div>`:'';
 document.getElementById('hint').textContent=s.augmentMeta?.cacheStatus==='stale'?'数据源暂不可用：当前显示历史缓存。':s.ocr.status==='running'?'正在本地识别卡片名称…':s.offeredIds.length?'请对照游戏确认识别名称，档位仅供参考。':'Ctrl Alt S 识别当前符文；Ctrl Alt H 打开面板。';
 document.getElementById('source').textContent=`OP.GG · ${s.augmentMeta?.patch||s.catalog?.patch||'—'}`;
}
window.hexthon.onState(render);window.hexthon.getState().then(render);
