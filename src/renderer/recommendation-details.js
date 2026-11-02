// Shared escaped, text-only explanations for the panel and offline UI checks.
(() => {
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const list=v=>Array.isArray(v)?v:[];
  function fit(fit,limit=3){
    if(!fit)return '';
    return [...list(fit.cautions).map(text=>({text,kind:'caution'})),...list(fit.benefits).map(text=>({text,kind:'benefit'}))].slice(0,limit)
      .map(row=>`<p class="fit-${row.kind}">${esc(row.text)}</p>`).join('');
  }
  function buildRow(row){
    const blocks=list(row.items).filter(item=>item.blocked).flatMap(item=>list(item.reasons).map(reason=>`${item.name}：${reason}`));
    const cautions=[...new Set([...blocks,...list(row.fitCautions)])].slice(0,3);
    const benefits=list(row.items).filter(item=>!item.blocked).flatMap(item=>list(item.fit?.benefits).map(text=>`${item.name}：${text}`)).slice(0,2);
    return cautions.length||benefits.length?`<div class="build-fit-summary">${cautions.map(text=>`<p class="fit-caution">${esc(text)}</p>`).join('')}${benefits.map(text=>`<p class="fit-benefit">${esc(text)}</p>`).join('')}</div>`:'';
  }
  function draft(draft,catalog){
    const r=draft?.recommendation;if(!r)return '';
    const hero=list(catalog?.champions).find(c=>c.id===r.championId),coverage=draft.coverage||{};
    const delta=Number.isFinite(r.scoreDelta)&&r.scoreDelta>0?` · 参考指数 +${r.scoreDelta}`:'';
    return `<div class="draft-decision"><strong>${esc(r.label)}${r.action==='consider-swap'&&hero?` · ${esc(hero.name)}`:''}${esc(delta)}</strong>${list(r.reasons).slice(0,2).map(t=>`<p class="fit-benefit">${esc(t)}</p>`).join('')}${list(r.tradeoffs).slice(0,2).map(t=>`<p class="fit-caution">${esc(t)}</p>`).join('')}<small>队友职业已知 ${Number(coverage.rolesKnown)||0}/${Number(coverage.teammates)||0} · ${r.confidence==='medium'?'可作阵容参考':'信息有限'} · 指数不代表胜率</small></div>`;
  }
  function style(value){
    if(!value)return '';
    const directions=list(value.directions).map(x=>x.label);
    const mechanisms=list(value.mechanisms).slice(0,3).map(x=>`${x.tentative?'待确认记录 · ':''}${x.augmentName}：${x.effect}`);
    return `<div class="build-style"><strong>${esc(value.label||'当前构筑线索')}</strong><p>${esc(directions.join(' · ')||'现有信息还不足以确定路线')}</p>${mechanisms.map(x=>`<p>${esc(x)}</p>`).join('')}<small>${esc(value.notice)}</small></div>`;
  }
  window.hexthonDetails={fit,buildRow,draft,style};
})();
