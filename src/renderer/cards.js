const slot=Number(new URLSearchParams(location.search).get('slot')||0);
const $=id=>document.getElementById(id);
const explanation=x=>typeof x==='string'?x:x?.text||x?.reason||x?.label||'';
function render(s){
 const card=s.offer?.cards?.[slot];
 $('card-hint').hidden=!card;
 if(!card)return;
 const augment=(s.augments||[]).find(a=>a.id===card.id)||(s.catalog?.augments||[]).find(a=>a.id===card.id);
 const score=(s.augmentScores||[]).find(a=>a.id===card.id);
 $('card-name').textContent=card.name||augment?.name||'强化符文';
 $('card-tier').textContent=augment?.tier==null?'':`T${augment.tier}`;
 $('card-score').textContent=Number.isFinite(score?.score)?Math.round(score.score):'—';
 $('card-reason').textContent=score?.reasons?.slice(0,2).map(explanation).join(' · ')||'等待该英雄的构筑资料';
 const offeredScores=(s.offer?.cards||[]).map(c=>(s.augmentScores||[]).find(a=>a.id===c.id)?.score).filter(Number.isFinite).sort((a,b)=>b-a);
 const placement=Number.isFinite(score?.score)&&offeredScores.length===3?(score.score===offeredScores[0]?'最高分':score.score===offeredScores[1]?'可选':'次选'):'';
 const action={keep:'倾向保留','consider-reroll':s.reroll?.conditional?'若可刷新，可重随':'可考虑刷新',unknown:'信息待确认'}[s.reroll?.action]||s.reroll?.label||'等待构筑信息';
 $('card-reroll').textContent=action;
 $('card-confidence').textContent=placement||(!score||score.confidence==='unknown'?'信息待确认':score.confidence==='low'?'资料有限':'OP.GG + 构筑适配');
}
window.hexthon.onState(render);window.hexthon.getState().then(render);
