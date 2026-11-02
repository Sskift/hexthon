const $ = id => document.getElementById(id);
const api = window.hexthon;
const escapeHtml = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const aliases = { ahri:'阿狸 狐狸', ashe:'艾希 寒冰', brand:'布兰德 火男', jinx:'金克丝', teemo:'提莫', lux:'拉克丝 光辉', aurelionsol:'龙王', ezreal:'伊泽瑞尔 ez', missfortune:'好运姐 女枪', kaisa:'卡莎', smolder:'斯莫德 小火龙', yone:'永恩', yasuo:'亚索', zed:'劫', chogath:'科加斯 大虫子', malphite:'墨菲特 石头人', masteryi:'易 剑圣' };
const rarity = { 1:'白银', 4:'黄金', 8:'彩色' };
const phases = { Disconnected:'等待客户端', None:'客户端空闲', Lobby:'组队大厅', Matchmaking:'匹配中', ReadyCheck:'确认对局', ChampSelect:'英雄选择', GameStart:'载入对局', InProgress:'对局进行中', WaitingForStats:'等待结算', EndOfGame:'对局结束', Reconnect:'等待重连' };
let state, filter = 'all', tab = 'augments', toastTimer, lastSettings = '', lastAugments = '', lastBuilds = '';
function tier(a) { return `<span class="tier ${a.tier === 0 ? 'top' : a.tier === 1 ? 'high' : ''}">${a.tier == null ? '—' : `T${a.tier}`}</span>`; }
function image(a, extra = '') { const local=state?.imageAssets?.[a.image?.split('?')[0]];const src=local?`../../assets/opgg/${local}`:a.image;return src?`<img src="${escapeHtml(src)}" alt="" ${extra}>`:''; }
function time(value) { return value ? new Date(value).toLocaleString('zh-CN', { hour12:false }) : '暂无'; }
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 6000); }
async function action(fn, button) { if (button) button.disabled = true; try { await fn(); } catch (e) { toast(e.message); } finally { if (button) button.disabled = false; } }
function renderChampions() {
  const q = $('champion-search').value.toLowerCase();
  const list = state.catalog?.champions.filter(c => `${c.name} ${c.key} ${aliases[c.key] || ''}`.toLowerCase().includes(q)) || [];
  $('champion-select').innerHTML = list.map(c => `<option value="${c.key}">${escapeHtml(c.name)}</option>`).join('');
  if (list.some(c => c.key === state.selectedChampion?.key)) $('champion-select').value = state.selectedChampion.key;
}
function render() {
  if (!state) return;
  const c = state.selectedChampion, g = state.game;
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
  $('augment-scope').textContent = state.loading ? '正在获取英雄专属资料；暂显示通用档位…' : state.augmentMeta ? `${c?.name}专属档位 · 按 OP.GG 原始顺序` : '通用档位 · 暂无该英雄专属数据';
  renderAugments(); renderOffers(); renderBuilds(); renderSettings();
  $('updated-at').textContent = `资料获取时间 ${time(state.augmentMeta?.fetchedAt || state.catalog?.fetchedAt)}`;
}
function renderAugments() {
  const q = $('augment-search').value.toLowerCase();
  const signature = JSON.stringify([state.selectedChampion?.key,state.augmentMeta,state.loading,state.offeredIds,q,filter]);
  if (signature === lastAugments) return; lastAugments = signature;
  const list = state.augments.filter(a => (filter === 'all' || String(a.rarity) === filter) && `${a.name} ${a.key} ${a.description}`.toLowerCase().includes(q));
  $('result-count').textContent = `${list.length} 个结果`;
  $('augment-grid').innerHTML = list.length ? list.map(a => {
    const selected = state.offeredIds.includes(a.id);
    return `<article class="augment-card ${selected?'selected':''}"><div class="augment-top">${image(a, 'loading="lazy"')}<div class="augment-title"><h3 title="${escapeHtml(a.name)}">${escapeHtml(a.name)}</h3><span>${rarity[a.rarity]||'未知品质'}强化符文</span></div>${tier(a)}</div><p class="augment-description" title="${escapeHtml(a.description)}">${escapeHtml(a.description||'来源未提供说明')}</p><div class="augment-bottom"><small>${a.scope==='champion'?'英雄专属':'通用档位'} · OP.GG</small><button class="add-offer" data-offer="${a.id}" aria-label="${selected?'移除':'比较'}${escapeHtml(a.name)}">${selected?'已加入 ✓':'+ 比较'}</button></div></article>`;
  }).join('') : '<div class="empty-state">没有找到对应的强化符文，试试名称或效果中的关键词。</div>';
}
function augmentById(id) { return state.augments.find(a => a.id === id) || state.catalog.augments.find(a => a.id === id); }
function renderOffers() {
  $('offer-slots').innerHTML = [0,1,2].map(i => {
    const a = augmentById(state.offeredIds[i]);
    return a ? `<div class="offer-slot filled">${image(a)}<div><strong>${escapeHtml(a.name)}</strong><small>${a.scope==='champion'?'英雄专属':'通用档位'} · ${rarity[a.rarity]||''}</small></div>${tier(a)}<button data-remove="${a.id}" aria-label="移除${escapeHtml(a.name)}">×</button></div>` : `<div class="offer-slot empty"><span>0${i+1}</span><small>等待添加强化符文</small></div>`;
  }).join('');
  const o = state.ocr;
  $('scan').disabled = o.status === 'running'; $('import-image').disabled = o.status === 'running';
  $('ocr-results').innerHTML = o.status === 'idle' ? '' : `<p>${escapeHtml(o.message || '')}</p>${(o.matches||[]).map(m => `<div class="ocr-candidate"><span>${escapeHtml(m.name)} · ${m.exact?'名称匹配':`待确认 ${m.confidence}%`}</span><button data-offer="${m.id}">比较</button></div>`).join('')}${o.text?`<details><summary>查看识别原文</summary><pre>${escapeHtml(o.text)}</pre></details>`:''}`;
}
function renderBuilds() {
  const signature = JSON.stringify([state.selectedChampion?.key,state.buildMeta,state.loading]);
  if (signature === lastBuilds) return; lastBuilds = signature;
  $('build-list').innerHTML = state.builds.length ? state.builds.map(group => `<section class="build-group"><h3>${escapeHtml(group.name)}</h3>${group.rows.map((items,i) => `<div class="build-row"><span class="build-number">0${i+1}</span>${items.map(a => `<span class="item">${image(a)}${escapeHtml(a.name)}</span>`).join('<span class="item-arrow">›</span>')}</div>`).join('')}</section>`).join('') : `<div class="empty-state">${state.loading?'正在获取出装…':'暂未取得这个英雄的出装资料。可以更新资料，或打开 OP.GG 原页面。'}</div>`;
}
function renderSettings() {
  const form = $('settings-form');
  const signature = JSON.stringify([state.settings, state.displays]);
  if (signature !== lastSettings && !form.contains(document.activeElement)) {
    for (const key of ['leaguePath','anchor','opacity']) form.elements[key].value = state.settings[key];
    for (const key of ['autoFollow','autoOverlay','autoScan']) form.elements[key].checked = state.settings[key];
    $('display-select').innerHTML = '<option value="">主显示器</option>' + state.displays.map(d => `<option value="${d.id}">${escapeHtml(d.label)}</option>`).join('');
    form.elements.displayId.value = state.settings.displayId ?? '';
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
    tab = nav.dataset.tab;
    document.querySelectorAll('.nav-button').forEach(b => b.classList.toggle('active', b.dataset.tab===tab));
    document.querySelectorAll('.tab-panel').forEach(p => p.hidden = p.id !== `tab-${tab}`);
    $('page-title').textContent = {augments:'每一次强化，都有据可查。',builds:'从一件装备，开始构筑。',settings:'按你的方式，随局而行。'}[tab];
    renderSettings();
  }
  const f = e.target.closest('[data-rarity]'); if (f) { filter=f.dataset.rarity; document.querySelectorAll('.filter').forEach(b=>b.classList.toggle('active',b===f)); renderAugments(); }
  const a = e.target.closest('[data-offer]'); if (a) action(() => toggleOffer(Number(a.dataset.offer)));
  const r = e.target.closest('[data-remove]'); if (r) action(() => api.setOffers(state.offeredIds.filter(id => id !== Number(r.dataset.remove))));
  const s = e.target.closest('[data-source]'); if (s) action(() => api.openSource(s.dataset.source));
});
$('champion-search').addEventListener('input', renderChampions);
$('champion-select').addEventListener('change', e => action(() => api.selectChampion(e.target.value)));
$('champion-search').addEventListener('keydown', e => { if (e.key==='Enter' && $('champion-select').value) action(() => api.selectChampion($('champion-select').value)); });
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
