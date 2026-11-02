const {test}=require('node:test');
const assert=require('node:assert/strict');
const {augmentDependency,scoreAugments,buildRecommendations,matchupRecommendations,rankDraft,bundledStatic}=require('../src/core/recommendations.cjs');
const catalog=require('../data/seed/index.json');
const aug=(key,extra={})=>({...catalog.augments.find(a=>a.key===key),scope:'champion',confidence:'confirmed',...extra});
const build=ids=>[{name:'核心装备',rows:[ids.map(id=>({id,name:bundledStatic.items[id]?.name||String(id)}))]}];
const recommend=(selectedAugments,ownItems=[],extra={})=>matchupRecommendations({champion:{id:103},selectedAugments,ownItems,...extra});

test('verified selected upgrade produces a prerequisite purchase even without enemy inventories',()=>{
  const a=aug('ARAM_Upgrade_IE'),result=recommend([a],[],{champion:{id:22},builds:build([3031])});
  assert.equal(result.recommendations[0].item.id,3031);
  assert.equal(result.recommendations[0].kind,'upgrade');
  assert.deepEqual(result.recommendations[0].augmentIds,[a.id]);
  assert.equal(result.recommendations[0].tentative,false);
  assert.match(result.recommendations[0].reason,/无尽之刃/);
  assert.equal(result.evidence.opponentAugmentsKnown,false);
  assert.match(result.summary,/敌方海克斯未知/);
  assert.deepEqual(recommend([a],null).recommendations,[]);
});

test('requirements need verified ids, keys and descriptions, not a familiar display name',()=>{
  const a=aug('ARAM_Upgrade_IE');
  for(const invalid of [{...a,id:9991336},{...a,key:'Other'},{...a,description:''}]){
    assert.equal(augmentDependency(invalid,[]),null);
    assert.deepEqual(recommend([invalid]).recommendations,[]);
  }
});

test('verified owned mode variants satisfy prerequisites but an invented same-name id does not',()=>{
  const a=aug('ARAM_Upgrade_IE');
  for(const id of [3031,223031,773031]){
    assert.equal(augmentDependency(a,[{id}]).status,'equipment-ready');
    assert.deepEqual(recommend([a],[{id}]).recommendations,[]);
  }
  const data={...bundledStatic,items:{...bundledStatic.items,9993031:{...bundledStatic.items[3031],id:9993031}}};
  assert.equal(augmentDependency(a,[{id:9993031}],data).status,'missing');
});
test('same-name legacy armguards without stasis do not satisfy the stasis upgrade',()=>{
  const a=aug('ARAM_Upgrade_ZH');
  assert.equal(augmentDependency(a,[2420]).status,'equipment-ready');
  assert.equal(augmentDependency(a,[773191]).status,'missing');
  assert.equal(augmentDependency(a,[773157]).status,'equipment-ready');
});

test('all three quest recipes require every item and stop rebuying once the reward is observed',()=>{
  for(const [key,required,reward] of [
    ['ARAM_Quest_WoogletsWitchcap',[3089,3157],228002],
    ['Quest_UltraHydra',[3074,6698,3748],226668],
    ['ARAM_Quest_VoidImmolation',[3068,6664],223069],
  ]){
    const a=aug(key),partial=augmentDependency(a,[{id:required[0]}]);
    assert.equal(partial.requirement,'all');assert.equal(partial.status,'missing');
    assert.deepEqual(partial.missingItemIds,required.slice(1));
    const plan=recommend([a],[{id:required[0]}],{builds:build(required)});
    assert.equal(plan.recommendations[0].item.id,required[1]);
    assert.equal(augmentDependency(a,required).status,'equipment-ready');
    const complete=recommend([a],[reward],{builds:build(required)});
    assert.equal(complete.dependencies[0].status,'reward-owned');assert.deepEqual(complete.recommendations,[]);
    const route=buildRecommendations({builds:build(required),ownItems:[reward],selectedAugments:[a]})[0].rows[0];
    assert.equal(route.next,null);assert.ok(route.items.every(i=>i.blocked));
    assert.equal(complete.dependencies[0].replaces,key==='ARAM_Quest_VoidImmolation');
  }
});

test('holding Heartsteel does not prove the 300-stack quest condition',()=>{
  const a=aug('ARAM_Quest_SteelYourHeart'),dependency=augmentDependency(a,[3084]);
  assert.equal(dependency.status,'condition-unknown');assert.match(dependency.reason,/300 层.*未读取/);
  const result=recommend([a],[3084]);
  assert.deepEqual(result.recommendations,[]);assert.ok(result.cautions.some(r=>r.includes('层数未读取')));
  assert.equal(augmentDependency(a,null).status,'unknown');
});
test('a task reward is not suggested as a direct purchase merely because static metadata marks it purchasable',()=>{
  const a=aug('ARAM_Upgrade_ZH'),result=recommend([a],[],{builds:build([228002,3157])});
  assert.equal(bundledStatic.items[228002].gold.purchasable,true);
  assert.equal(result.recommendations[0].item.id,3157);
  const route=buildRecommendations({builds:build([228002,3157]),ownItems:[]})[0].rows[0];
  assert.equal(route.items[0].blocked,true);assert.equal(route.next.id,3157);
});

test('an inferred prerequisite has lower priority and explicit conditional language',()=>{
  const a=aug('Upgrade_Stormsurge'),certain=recommend([a]),tentative=recommend([{...a,confidence:'visual'}]);
  assert.equal(tentative.recommendations[0].tentative,true);
  assert.ok(certain.recommendations[0].priority>tentative.recommendations[0].priority);
  assert.match(tentative.recommendations[0].reason,/若已选记录正确/);
  assert.deepEqual(tentative.evidence.confirmedSelectedAugmentIds,[]);
});

test('on-hit and AP conversion synergies use selected descriptions and actual item properties',()=>{
  const weapon=recommend([aug('ARAM_EtherealWeapon')],[3157],{builds:build([3115])});
  assert.equal(weapon.recommendations[0].item.id,3115);assert.match(weapon.recommendations[0].reason,/攻击特效/);
  const eureka=recommend([aug('ARAM_Eureka')],[3157],{builds:build([3157,3089])});
  assert.equal(eureka.recommendations[0].item.id,3089);assert.match(eureka.recommendations[0].reason,/技能急速/);
  assert.deepEqual(recommend([aug('ARAM_EtherealWeapon')],[3115],{builds:build([3115])}).recommendations,[]);
  const coreFirst=recommend([aug('ARAM_Eureka')],[],{builds:[{name:'出门装',rows:[[{id:3802}]]},...build([3089])]});
  assert.equal(coreFirst.recommendations[0].item.id,3089);
});

test('ultimate-disabling augment blocks ultimate-dependent purchases and lowers conflicting augment score',()=>{
  const a=aug('ARAM_BacktoBasics'),route=buildRecommendations({builds:build([3118,3089]),ownItems:[],selectedAugments:[a]})[0].rows[0];
  assert.equal(route.items[0].blocked,true);assert.equal(route.next.id,3089);
  assert.match(route.items[0].reasons[0],/无法使用终极技能/);
  const candidate=catalog.augments.find(x=>x.id!==a.id&&/终极技能/.test(x.description));
  assert.ok(candidate);
  const score=selected=>scoreAugments({augments:[{...candidate,scope:'champion'}],ownItems:[],selectedAugments:selected})[0];
  assert.ok(score([a]).score<score([]).score);assert.ok(score([a]).constraints.length>0);
  const fake={...a,id:9991004};
  assert.equal(buildRecommendations({builds:build([3118]),ownItems:[],selectedAugments:[fake]})[0].rows[0].next.id,3118);
  const unconfirmed={...a,confidence:'inferred'};
  assert.equal(buildRecommendations({builds:build([3118]),ownItems:[],selectedAugments:[unconfirmed]})[0].rows[0].next.id,3118);
  assert.ok(recommend([unconfirmed]).cautions.some(r=>r.includes('尚待确认')));
});

test('conversion augments do not turn raw item AD/AP into a confident damage-type claim',()=>{
  const result=recommend([aug('ARAM_ADAPt')],[3031],{champion:{id:22},opponents:[{championId:54,items:[{id:3110}]}]});
  assert.equal(result.evidence.damageDirection,'unknown');assert.deepEqual(result.recommendations,[]);
  assert.ok(result.cautions.some(r=>r.includes('伤害方向')));
});

test('same completed penetration alternatives are skipped without treating components as completed items',()=>{
  const owned=buildRecommendations({builds:build([3135,3089]),ownItems:[3137]})[0].rows[0];
  assert.equal(owned.items[0].blocked,true);assert.equal(owned.next.id,3089);
  const component=buildRecommendations({builds:build([3135]),ownItems:[4630]})[0].rows[0];
  assert.equal(component.next.id,3135);
  const alternatives=buildRecommendations({builds:build([3135,3137,3089]),ownItems:[]})[0].rows[0];
  assert.equal(alternatives.items[1].blocked,true);assert.equal(alternatives.next.id,3135);
});

test('actual base attack range adds a small explainable draft correction, unknown range does not',()=>{
  const ids=[86,54,122,22,103],champions=ids.map(id=>({id,tier:2}));
  const args={catalog:champions,team:[{championId:103,isSelf:true},{championId:86},{championId:54},{championId:122}],availableChampionIds:[103,22],selfId:103};
  const result=rankDraft(args),ashe=result.candidates.find(c=>c.id===22);
  assert.equal(result.composition.longRange,0);assert.equal(ashe.profile.attackRange,600);
  assert.ok(ashe.reasons.some(r=>r.includes('基础普攻射程：600')));
  assert.equal(ashe.winRate,null);
  const data={...bundledStatic,champions:{...bundledStatic.champions,86:{...bundledStatic.champions[86],stats:{}}}};
  assert.ok(rankDraft({...args,staticData:data}).candidates.every(c=>c.reasons.every(r=>!r.includes('基础普攻射程：'))));
});
