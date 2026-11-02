const {test}=require('node:test');
const assert=require('node:assert/strict');
const {rankDraft,bundledStatic}=require('../src/core/recommendations.cjs');
const heroes=ids=>ids.map(id=>({id,name:bundledStatic.champions[id]?.name||String(id),tier:2}));
const team=(self,others)=>[{championId:self,isSelf:true},...others.map(championId=>({championId}))];

test('draft comparisons replace the local slot, expose gain versus current hero, and never score locked alternatives',()=>{
  const result=rankDraft({catalog:heroes([22,51,222,81,103,54]),team:team(22,[51,222,81,103]),selfId:22,availableChampionIds:[22,54,51]});
  assert.deepEqual(result.candidates.map(c=>c.id).sort((a,b)=>a-b),[22,54]);
  assert.equal(result.current.id,22);assert.equal(result.coverage.completeTeam,true);
  assert.equal(result.best.id,54);assert.equal(result.best.scoreDelta,result.best.score-result.current.score);
  assert.equal(result.recommendation.action,'consider-swap');assert.ok(result.best.benefits.some(r=>r.includes('前排')));
  assert.equal(result.composition.count,4);assert.ok(result.candidates.every(c=>c.composition.count===5));
});

test('removing the only tank reports the lost role even when the new OP.GG tier is higher',()=>{
  const catalog=heroes([54,51,222,81,103,22]).map(c=>({...c,tier:c.id===22?0:4}));
  const result=rankDraft({catalog,team:team(54,[51,222,81,103]),availableChampionIds:[54,22]});
  const alternative=result.candidates.find(c=>c.id===22);
  assert.ok(alternative.tradeoffs.some(r=>r.includes('唯一明确的坦克')));
  assert.equal(alternative.composition.frontline,0);assert.equal(result.current.composition.frontline,1);
  assert.equal(result.recommendation.tradeoffs.includes(alternative.tradeoffs[0]),true);
});

test('marksman and attack-range coverage are explicit estimates with loss warnings',()=>{
  const result=rankDraft({catalog:heroes([22,86,54,122,24,98]),team:team(22,[86,54,122,24]),availableChampionIds:[22,98]});
  assert.ok(result.current.benefits.some(r=>r.includes('射手职业')));
  assert.ok(result.current.benefits.some(r=>r.includes('基础普攻射程')));
  const tank=result.candidates.find(c=>c.id===98);
  assert.ok(tank.tradeoffs.some(r=>r.includes('不再包含射手职业')));
  assert.ok(tank.tradeoffs.some(r=>r.includes('短基础普攻射程')));
  assert.ok(tank.components.composition<0);
  assert.match(result.notice,/不等于已确认持续输出/);
});

test('unknown teammates suppress claims of missing roles and complete coverage',()=>{
  const result=rankDraft({catalog:heroes([22,54,51]),team:team(22,[51,0,0,0]),availableChampionIds:[22,54]});
  assert.equal(result.coverage.completeTeam,false);assert.equal(result.coverage.rolesKnown,1);
  assert.ok(result.candidates.every(c=>c.components.composition===0&&c.confidence==='low'&&c.benefits.length===0));
  assert.ok(result.candidates.every(c=>c.tradeoffs.length===0));
});

test('ambiguous self markers never remove multiple slots or claim replacement confidence',()=>{
  const result=rankDraft({catalog:heroes([22,54,51,103]),team:[{championId:22,isSelf:true},{championId:103,isSelf:true},{championId:51}],selfId:22,availableChampionIds:[22,54]});
  assert.equal(result.coverage.identity,'ambiguous');assert.equal(result.composition.count,3);
  assert.ok(result.candidates.every(c=>c.components.composition===0&&c.confidence==='low'));
  assert.equal(result.coverage.completeTeam,false);
});

test('numeric-string ids normalize consistently and duplicated fallback remains explicitly uncertain',()=>{
  const args={catalog:heroes([22,54,51,103]),team:[{championId:'22'},{championId:'51'},{championId:'103'}],selfId:'22',availableChampionIds:['22','54','51']};
  const result=rankDraft(args);assert.equal(result.coverage.identity,'fallback');assert.equal(result.composition.count,2);
  assert.deepEqual(result.candidates.map(c=>c.id).sort((a,b)=>a-b),[22,54]);
  const duplicate=rankDraft({...args,team:[...args.team,{championId:'22'}]});
  assert.equal(duplicate.coverage.identity,'ambiguous-fallback');assert.equal(duplicate.composition.count,3);
  assert.ok(duplicate.candidates.every(c=>c.components.composition===0));
});

test('ties preserve the current choice and no current score means no invented swap gain',()=>{
  const result=rankDraft({catalog:heroes([22,51,103,81]),team:team(22,[103,81]),availableChampionIds:[51,22]});
  assert.equal(result.best.id,22);assert.equal(result.recommendation.action,'keep');
  const unknown=rankDraft({catalog:[{id:22,tier:null},{id:51,tier:2},...heroes([103,81])],team:team(22,[103,81]),availableChampionIds:[22,51]});
  assert.equal(unknown.best.scoreDelta,null);assert.equal(unknown.recommendation.action,'compare');
});

test('missing range and unknown damage do not become assumed gaps',()=>{
  const data={...bundledStatic,champions:{...bundledStatic.champions,86:{...bundledStatic.champions[86],stats:{}}}};
  const result=rankDraft({catalog:heroes([22,86,54,122,103]),team:team(103,[86,54,122]),availableChampionIds:[103,22],staticData:data});
  assert.equal(result.coverage.attackRangesKnown,2);
  assert.ok(result.candidates.every(c=>c.benefits.every(r=>!r.includes('基础普攻射程'))));
  assert.ok(result.candidates.every(c=>c.benefits.every(r=>!r.includes('法术输出方向')&&!r.includes('物理输出方向'))));
});
