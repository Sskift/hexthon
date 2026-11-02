const $ = id => document.getElementById(id);
const api = window.hexthon;
const escapeHtml = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const aliases = { ahri:'阿狸 狐狸', ashe:'艾希 寒冰', brand:'布兰德 火男', jinx:'金克丝', teemo:'提莫', lux:'拉克丝 光辉', aurelionsol:'龙王', ezreal:'伊泽瑞尔 ez', missfortune:'好运姐 女枪', kaisa:'卡莎', smolder:'斯莫德 小火龙', yone:'永恩', yasuo:'亚索', zed:'劫', chogath:'科加斯 大虫子', malphite:'墨菲特 石头人', masteryi:'易 剑圣' };
const rarity = { 1:'白银', 4:'黄金', 8:'彩色' };
const phases = { Disconnected:'等待客户端', None:'客户端空闲', Lobby:'组队大厅', Matchmaking:'匹配中', ReadyCheck:'确认对局', ChampSelect:'英雄选择', GameStart:'载入对局', InProgress:'对局进行中', WaitingForStats:'等待结算', EndOfGame:'对局结束', Reconnect:'等待重连' };
let state, filter = 'all', tab = 'augments', toastTimer, lastSettings = '', lastAugments = '', lastBuilds = '', lastPhase;
function tier(a) { return `<span class="tier ${a.tier === 0 ? 'top' : a.tier === 1 ? 'high' : ''}">${a.tier == null ? '—' : `T${a.tier}`}</span>`; }
function image(a, extra = '') { const local=state?.imageAssets?.[a.image?.split('?')[0]];const src=local?`../../assets/opgg/${local}`:a.image;return src?`<img src="${escapeHtml(src)}" alt="" ${extra}>`:''; }
function time(value) { return value ? new Date(value).toLocaleString('zh-CN', { hour12:false }) : '暂无'; }
const explanation = x => typeof x === 'string' ? x : x?.text || x?.reason || x?.label || '';
const usefulReasons = list => [...(list||[])].sort((a,b)=>Number(explanation(a).startsWith('OP.GG'))-Number(explanation(b).startsWith('OP.GG')));
function scoreFor(id) { return (state.augmentScores || []).find(s => s.id === id); }
function scoreBadge(score, compact=false) { return `<span class="recommend-score ${compact?'compact':''}"><strong>${Number.isFinite(score)?Math.round(score):'—'}</strong>${compact?'':'<small>推荐指数</small>'}</span>`; }
function winRate(value) { return typeof value==='number'&&Number.isFinite(value)?`${(value<=1?value*100:value).toFixed(1)}%`:'未公开'; }
function championById(id) { return state.catalog?.champions.find(c=>c.id===id); }
function selectedList() { return (state.selectedAugments||[]).map(s=>({...augmentById(s.id),...s})); }
function setTab(name) {
  tab=name;
  document.querySelectorAll('.nav-button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  document.querySelectorAll('.tab-panel').forEach(p=>p.hidden=p.id!==`tab-${tab}`);
  $('page-title').textContent={augments:'专注对局，资料随行。',draft:'补齐阵容，找到你的选择。',builds:'从现有装备，规划下一件。',settings:'按你的方式，随局而行。'}[tab];
}
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 6000); }
async function action(fn, button) { if (button) button.disabled = true; try { await fn(); } catch (e) { toast(e.message); } finally { if (button) button.disabled = false; } }
function renderChampions() {
  const q = $('champion-search').value.toLowerCase();
  const list = state.catalog?.champions.filter(c => `${c.name} ${c.key} ${aliases[c.key] || ''}`.toLowerCase().includes(q)) || [];
  $('champion-options').innerHTML = list.slice(0,50).map(c => `<button type="button" role="option" data-champion="${c.key}">${image(c)}<span>${escapeHtml(c.name)}<small>${escapeHtml(c.key)}</small></span>${tier(c)}</button>`).join('') || '<p class="picker-empty">没有匹配的英雄</p>';
  $('champion-select').value = q ? list[0]?.key || '' : state.selectedChampion?.key || '';
}
function render() {
  if (!state) return;
  const c = state.selectedChampion, g = state.game;
  if(g.phase!==lastPhase){if(g.phase==='ChampSelect')setTab('draft');else if(g.phase==='InProgress')setTab('augments');lastPhase=g.phase;}
  $('auto-status').textContent = state.autoStatus || (g.liveConnected ? '已连接游戏，正在自动检查强化卡片与构筑变化。' : g.lcuConnected ? '已连接客户端，等待进入选人或对局。' : '等待英雄联盟窗口，进入选人或对局后自动跟随。');
  document.querySelector('.auto-banner strong').textContent = state.settings.autoScan===false ? '自动识别已暂停' : '自动识别运行中';
  $('patch').textContent = `PATCH ${state.augmentMeta?.patch || state.catalog?.patch || '—'}`;
  $('overlay-toggle').textContent = state.overlayVisible ? '隐藏浮层 ↙' : '显示浮层 ↗';
  const online = g.lcuConnected || g.liveConnected;
  $('connection-strip').innerHTML = `<div class="connection-card ${online?'online':''}"><span class="connection-symbol">⌁</span><div><strong>${online?'已连接本地客户端':'等待国服客户端'}</strong><small>${online?'本机只读接口':'也可以先查阅英雄资料'}</small></div></div><div class="connection-card ${g.isMayhem?'online':''}"><span class="connection-symbol">◇</span><div><strong>${phases[g.phase] || escapeHtml(g.phase)}</strong><small>${g.isMayhem?'海克斯大乱斗':state.modeConfirmed?'本局模式：手动确认':'尚未确认海克斯模式'}</small></div></div><div class="connection-card online"><span class="connection-symbol">▤</span><div><strong>OP.GG 公开资料</strong><small>${state.augmentMeta?.cacheStatus==='stale'?'正在使用过期缓存':`${state.catalog?.champions.length||0} 位英雄 · ${state.catalog?.augments.length||0} 个符文`}</small></div></div>`;
  const following = state.settings.autoFollow && g.championId === c?.id;
  $('champion-summary').innerHTML = c ? `${image(c)}<div><h2>${escapeHtml(c.name)}</h2><p>${following?'正在跟随游戏':'当前查阅'} · ${escapeHtml(c.key)} ${g.level&&following?`· Lv.${g.level}`:''}</p></div>` : '<p>选择一个英雄开始查阅</p>';
  if (document.activeElement !== $('champion-select') && document.activeElement !== $('champion-search')) renderChampions();
  $('follow').textContent = state.settings.autoFollow ? (following?'正在自动跟随':'自动跟随已开启') : '跟随游戏英雄';
  const warnings = [state.error, state.augmentMeta?.warning, state.buildMeta?.warning].filter(Boolean);
  if (state.augmentMeta?.patch && state.buildMeta?.patch && state.augmentMeta.patch !== state.buildMeta.patch) warnings.push('强化符文与出装来自不同补丁，请更新资料后对照使用');
  $('notice').hidden = !warnings.length; $('notice').textContent = [...new Set(warnings)].join('；');
  $('augment-scope').textContent = state.loading ? '正在获取英雄专属资料；暂显示通用档位…' : state.augmentMeta ? `${c?.name}专属档位 · 按构筑推荐指数排序` : '通用档位 · 暂无该英雄专属数据';
  renderAugments(); renderOffers(); renderBuilds(); renderLoadout(); renderDraft(); renderSettings();
  $('updated-at').textContent = `资料获取时间 ${time(state.augmentMeta?.fetchedAt || state.catalog?.fetchedAt)}`;
}
function renderAugments() {
  const q = $('augment-search').value.toLowerCase();
  const signature = JSON.stringify([state.selectedChampion?.key,state.augmentMeta,state.loading,state.offeredIds,state.augmentScores,q,filter,state.selectedAugments]);
  if (signature === lastAugments) return; lastAugments = signature;
  const list = state.augments.filter(a => (filter === 'all' || String(a.rarity) === filter) && `${a.name} ${a.key} ${a.description}`.toLowerCase().includes(q)).sort((a,b)=>(scoreFor(b.id)?.score??-1)-(scoreFor(a.id)?.score??-1));
  $('result-count').textContent = `${list.length} 个结果`;
  $('augment-grid').innerHTML = list.length ? list.map(a => {
    const selected = state.offeredIds.includes(a.id);
    const score=scoreFor(a.id);
    return `<article class="augment-card ${selected?'selected':''}"><div class="augment-top">${image(a, 'loading="lazy"')}<div class="augment-title"><h3 title="${escapeHtml(a.name)}">${escapeHtml(a.name)}</h3><span>${rarity[a.rarity]||'未知品质'}强化符文 · ${a.tier==null?'档位未知':`T${a.tier}`}</span></div>${score?scoreBadge(score.score,true):tier(a)}</div><p class="augment-description" title="${escapeHtml(a.description)}">${escapeHtml(a.description||'来源未提供说明')}</p>${score?.reasons?.length?`<p class="score-reason">${escapeHtml(explanation(score.reasons[0]))}</p>`:''}<div class="augment-bottom"><small>${score?'适配评分':'OP.GG 档位'} · ${a.scope==='champion'?'英雄专属':'通用'}</small><div class="card-actions"><button class="text-button" data-chosen="${a.id}" title="修正本地已选强化">记为已选</button><button class="add-offer" data-offer="${a.id}" aria-label="${selected?'移除':'比较'}${escapeHtml(a.name)}">${selected?'已加入 ✓':'+ 比较'}</button></div></div></article>`;
  }).join('') : '<div class="empty-state">没有找到对应的强化符文，试试名称或效果中的关键词。</div>';
}
function augmentById(id) { return state.augments.find(a => a.id === id) || state.catalog.augments.find(a => a.id === id); }
function renderOffers() {
  $('offer-slots').innerHTML = [0,1,2].map(i => {
    const a = augmentById(state.offeredIds[i]);
    return a ? `<div class="offer-slot filled">${image(a)}<div><strong>${escapeHtml(a.name)}</strong><small>${a.scope==='champion'?'英雄专属':'通用档位'} · ${rarity[a.rarity]||''}</small></div>${scoreFor(a.id)?scoreBadge(scoreFor(a.id).score,true):tier(a)}<button data-remove="${a.id}" aria-label="移除${escapeHtml(a.name)}">×</button></div>` : `<div class="offer-slot empty"><span>0${i+1}</span><small>等待自动识别卡片</small></div>`;
  }).join('');
  const o = state.ocr;
  const reroll=state.reroll;
  $('reroll-advice').innerHTML=reroll?`<span>重随参考</span><strong>${escapeHtml(reroll.label||reroll.advice||'等待充分信息')}</strong><p>${escapeHtml(reroll.reason||'')}</p>`:'<span>重随参考</span><p>识别到完整选项后，比较同品质符文池与当前构筑。</p>';
  $('scan').disabled = o.status === 'running'; $('import-image').disabled = o.status === 'running';
  $('ocr-results').innerHTML = o.status === 'idle' ? '' : `<p>${escapeHtml(o.message || '')}</p>${(o.matches||[]).map(m => `<div class="ocr-candidate"><span>${escapeHtml(m.name)} · ${m.exact?'名称匹配':`待确认 ${m.confidence}%`}</span><button data-offer="${m.id}">比较</button></div>`).join('')}${o.text?`<details><summary>查看识别原文</summary><pre>${escapeHtml(o.text)}</pre></details>`:''}`;
}
function renderBuilds() {
  const signature = JSON.stringify([state.selectedChampion?.key,state.buildMeta,state.loading,state.game.ownItems,state.buildSuggestions]);
  if (signature === lastBuilds) return; lastBuilds = signature;
  const groups=state.buildSuggestions?.length?state.buildSuggestions:state.builds.map(group=>({...group,rows:group.rows.map(items=>({items,next:null}))}));
  $('build-list').innerHTML = groups.length ? groups.map(group => `<section class="build-group"><h3>${escapeHtml(group.name)}</h3>${group.rows.map((row,i) => `<div class="build-row"><span class="build-number">0${i+1}</span>${row.items.map(a => `<span class="item ${a.owned===true?'owned':row.next?.id===a.id?'next':''}">${image(a)}<span>${escapeHtml(a.name)}${a.owned===true?'<small>已拥有 / 已升级 ✓</small>':row.next?.id===a.id?'<small>可考虑下一件</small>':''}</span></span>`).join('<span class="item-arrow">›</span>')}</div>`).join('')}</section>`).join('') : `<div class="empty-state">${state.loading?'正在获取出装…':'暂未取得这个英雄的出装资料。可以更新资料，或打开 OP.GG 原页面。'}</div>`;
}
function renderLoadout() {
  const items=state.game.ownItems||[];
  $('owned-items').innerHTML=items.length?items.map(i=>`<span class="loadout-item" title="${escapeHtml(i.name||i.id)}">${image(i)}<span>${escapeHtml(i.name||i.id)}</span></span>`).join(''):`<span class="loadout-empty">${Array.isArray(state.game.ownItems)?'暂无装备':'等待自动读取装备'}</span>`;
  const selected=selectedList();
  $('selected-status').textContent=selected.some(a=>a.confidence==='inferred')?'含推断结果':'';
  $('selected-augments').innerHTML=selected.length?selected.map(a=>`<span class="selected-pill ${a.confidence==='inferred'?'inferred':''}" title="${escapeHtml(a.evidence||'本地构筑记录')}">${escapeHtml(a.name||`#${a.id}`)}<small>${a.confidence==='inferred'?'推断':'已确认'}</small>${a.confidence==='inferred'?`<button data-confirm-chosen="${a.id}" aria-label="确认${escapeHtml(a.name)}">✓</button>`:''}<button data-unchoose="${a.id}" aria-label="移除${escapeHtml(a.name)}">×</button></span>`).join(''):'<span class="loadout-empty">尚未检测到已选强化</span>';
}
function renderDraft() {
  const team=state.game.team||[],d=state.draft||{},c=state.selectedChampion;
  $('draft-stage').textContent=state.game.phase==='ChampSelect'?'正在读取选人':'等待选人阶段';
  $('team-lineup').innerHTML=team.length?team.map(p=>{const champion=championById(p.championId);return `<div class="teammate ${p.isSelf?'self':''}">${champion?image(champion):'<span class="empty-portrait">?</span>'}<strong>${escapeHtml(champion?.name||'尚未选择')}</strong><small>${p.isSelf?'自己':'队友'}</small></div>`;}).join(''):'<div class="empty-state">进入选人界面后，自动读取队友与备选英雄。</div>';
  const comp=d.composition;
  const summary=Array.isArray(comp?.reasons)?comp.reasons: Array.isArray(comp?.needs)?comp.needs: Array.isArray(comp?.gaps)?comp.gaps: typeof comp?.summary==='string'?[comp.summary]:comp?.label?[`队友物理方向 ${comp.physical??'—'} · 法术方向 ${comp.magic??'—'}`,`前排覆盖 ${comp.frontline??'—'} · 辅助角色 ${comp.support??'—'}`,comp.label]:[];
  $('composition-summary').innerHTML=summary.length?summary.map(x=>`<span>${escapeHtml(explanation(x))}</span>`).join(''):'<span>阵容分析将结合队友的角色、前排和伤害类型。</span>';
  const candidates=d.candidates||[];
  $('draft-candidates').innerHTML=candidates.length?candidates.map((r,i)=>{const hero=championById(r.championId||r.id);return `<article class="draft-candidate ${i===0?'best':''}"><span class="draft-rank">${String(i+1).padStart(2,'0')}</span>${hero?image(hero):''}<div class="draft-candidate-body"><h3>${escapeHtml(hero?.name||r.name||'未知英雄')}${i===0?'<small>阵容适配优先</small>':''}</h3><p>${usefulReasons(r.reasons).slice(0,2).map(x=>escapeHtml(explanation(x))).join(' · ')||'依据已知英雄资料进行比较'}</p><div class="draft-meta">OP.GG ${hero?.rank?`#${hero.rank}`:'排名未知'} · 胜率 ${winRate(r.winRate??hero?.winRate)}${r.championId===state.game.championId?' · 当前英雄':''}</div></div>${scoreBadge(r.score)}</article>`;}).join(''):'<div class="empty-state">尚未读到可选英雄池。会在选人时比较自己与共享备选区的英雄。</div>';
  $('draft-champion-title').textContent=c?.name||'当前英雄资料';
  $('draft-statistics').innerHTML=c?`<div><span>OP.GG 排名</span><strong>${c.rank?`#${c.rank}`:'未知'}</strong></div><div><span>档位</span><strong>${c.tier==null?'未知':`T${c.tier}`}</strong></div><div><span>胜率</span><strong>${winRate(c.winRate)}</strong></div>`:'';
  $('draft-augments').innerHTML=(state.augments||[]).slice(0,4).map(a=>`<div class="draft-mini">${image(a)}<span>${escapeHtml(a.name)}</span>${tier(a)}</div>`).join('');
  $('draft-build').innerHTML=(state.builds.find(b=>b.name==='核心装备')?.rows[0]||[]).map(i=>`<span title="${escapeHtml(i.name)}">${image(i)}</span>`).join('');
}
function fillCustomSelect(name, options, value) {
  const wrap=document.querySelector(`[data-select="${name}"]`);
  wrap.querySelector('input').value=value??'';
  wrap.querySelector('.select-trigger').innerHTML=`${escapeHtml(options.find(o=>String(o.value)===String(value??''))?.label||options[0]?.label||'请选择')} <span>⌄</span>`;
  wrap.querySelector('.select-menu').innerHTML=options.map(o=>`<button type="button" data-select-option="${name}" data-value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</button>`).join('');
}
function renderSettings() {
  const form = $('settings-form');
  const signature = JSON.stringify([state.settings, state.displays]);
  if (signature !== lastSettings && !form.contains(document.activeElement)) {
    for (const key of ['leaguePath','opacity']) form.elements[key].value = state.settings[key];
    for (const key of ['autoFollow','autoOverlay','autoScan']) form.elements[key].checked = state.settings[key];
    fillCustomSelect('displayId',[{value:'',label:'主显示器'},...state.displays.map(d=>({value:d.id,label:d.label}))],state.settings.displayId);
    fillCustomSelect('anchor',[{value:'top-right',label:'右上角'},{value:'top-left',label:'左上角'},{value:'bottom-right',label:'右下角'},{value:'bottom-left',label:'左下角'}],state.settings.anchor);
    for (const [field,key] of [['ocrX','x'],['ocrY','y'],['ocrW','width'],['ocrH','height']]) form.elements[field].value = Math.round(state.settings.ocrRegion[key]*100);
    lastSettings = signature;
  }
  $('confirm-mode').checked = state.modeConfirmed;
  const g = state.game;
  $('diagnostics').textContent = `LCU：${g.lcuConnected?'已连接':'未连接'}　Live Client：${g.liveConnected?'已连接':'未连接'}\n队列：${g.queueId||'未知'}　阶段：${phases[g.phase]||g.phase}`;
  const failed = Object.entries(state.shortcuts).filter(([,ok]) => !ok).map(([k]) => k);
  if (failed.length) $('diagnostics').textContent += `\n快捷键注册失败：${failed.join('、')}，可使用托盘菜单`;
  $('data-status').textContent = `资料补丁：${state.augmentMeta?.patch||state.catalog?.patch||'未知'}\n符文：${state.augmentMeta?'英雄专属':'通用'}　缓存：${state.augmentMeta?.cacheStatus||'cached'}\n取得时间：${time(state.augmentMeta?.fetchedAt||state.catalog?.fetchedAt)}`;
}
function toggleOffer(id) { const next = state.offeredIds.includes(id) ? state.offeredIds.filter(x => x !== id) : [...state.offeredIds,id]; return api.setOffers(next); }
document.addEventListener('click', e => {
  const nav = e.target.closest('[data-tab]');
  if (nav) {
    setTab(nav.dataset.tab);
    renderSettings();
  }
  const f = e.target.closest('[data-rarity]'); if (f) { filter=f.dataset.rarity; document.querySelectorAll('.filter').forEach(b=>b.classList.toggle('active',b===f)); renderAugments(); }
  const a = e.target.closest('[data-offer]'); if (a) action(() => toggleOffer(Number(a.dataset.offer)));
  const r = e.target.closest('[data-remove]'); if (r) action(() => api.setOffers(state.offeredIds.filter(id => id !== Number(r.dataset.remove))));
  const s = e.target.closest('[data-source]'); if (s) action(() => api.openSource(s.dataset.source));
  const windowButton=e.target.closest('[data-window]');if(windowButton)action(()=>api.windowAction(windowButton.dataset.window));
  const championButton=e.target.closest('[data-champion]');if(championButton){$('champion-options').hidden=true;$('champion-search').setAttribute('aria-expanded','false');$('champion-search').value='';action(()=>api.selectChampion(championButton.dataset.champion));}
  const chosen=e.target.closest('[data-chosen]');if(chosen){const ids=[...new Set([...selectedList().map(a=>a.id),Number(chosen.dataset.chosen)])];action(()=>api.setSelectedAugments(ids));}
  const unchoose=e.target.closest('[data-unchoose]');if(unchoose)action(()=>api.setSelectedAugments(selectedList().filter(a=>a.id!==Number(unchoose.dataset.unchoose)).map(a=>a.id)));
  const confirm=e.target.closest('[data-confirm-chosen]');if(confirm)action(()=>api.confirmSelectedAugment(Number(confirm.dataset.confirmChosen)));
  const trigger=e.target.closest('.select-trigger');if(trigger){const menu=trigger.parentElement.querySelector('.select-menu');menu.hidden=!menu.hidden;trigger.setAttribute('aria-expanded',String(!menu.hidden));}
  const option=e.target.closest('[data-select-option]');if(option){const wrap=option.closest('.custom-select');wrap.querySelector('input').value=option.dataset.value;wrap.querySelector('.select-trigger').innerHTML=`${escapeHtml(option.textContent)} <span>⌄</span>`;wrap.querySelector('.select-menu').hidden=true;wrap.querySelector('.select-trigger').setAttribute('aria-expanded','false');}
  if(!e.target.closest('.custom-select'))document.querySelectorAll('.select-menu').forEach(m=>m.hidden=true);
  if(!e.target.closest('.champion-picker')){$('champion-options').hidden=true;$('champion-search').setAttribute('aria-expanded','false');}
});
$('champion-search').addEventListener('input',()=>{renderChampions();$('champion-options').hidden=false;$('champion-search').setAttribute('aria-expanded','true');});
$('champion-search').addEventListener('focus',()=>{renderChampions();$('champion-options').hidden=false;$('champion-search').setAttribute('aria-expanded','true');});
$('champion-select').addEventListener('change', e => action(() => api.selectChampion(e.target.value)));
$('champion-search').addEventListener('keydown', e => { if (e.key==='Enter' && $('champion-select').value) {action(() => api.selectChampion($('champion-select').value));$('champion-options').hidden=true;$('champion-search').setAttribute('aria-expanded','false');}else if(e.key==='Escape'){$('champion-options').hidden=true;$('champion-search').setAttribute('aria-expanded','false');} });
$('augment-search').addEventListener('input', renderAugments);
$('follow').addEventListener('click', () => action(() => api.followChampion()));
$('refresh').addEventListener('click', e => action(async () => { await api.refresh(); toast(state.augmentMeta?.cacheStatus==='stale'?'连接暂不可用，保留已有资料':'资料更新完成'); }, e.currentTarget));
$('overlay-toggle').addEventListener('click', () => action(() => api.toggleOverlay()));
$('clear-offers').addEventListener('click', () => action(() => api.setOffers([])));
$('scan').addEventListener('click', () => action(() => api.scan()));
$('import-image').addEventListener('click', () => action(() => api.importImage()));
$('confirm-mode').addEventListener('change', e => action(() => api.confirmMode(e.target.checked)));
$('settings-form').addEventListener('submit', e => {
  e.preventDefault(); const form = e.currentTarget;
  const values = { leaguePath:form.elements.leaguePath.value, anchor:form.elements.anchor.value, opacity:Number(form.elements.opacity.value), displayId:form.elements.displayId.value?Number(form.elements.displayId.value):null };
  for(const key of ['autoFollow','autoOverlay','autoScan']) values[key]=form.elements[key].checked;
  values.ocrRegion={x:Number(form.elements.ocrX.value)/100,y:Number(form.elements.ocrY.value)/100,width:Number(form.elements.ocrW.value)/100,height:Number(form.elements.ocrH.value)/100};
  action(async()=>{await api.saveSettings(values);toast('设置已保存');});
});
api.onState(value => { state=value; render(); });
api.getState().then(value=>{state=value;render();}).catch(e=>toast(e.message));
