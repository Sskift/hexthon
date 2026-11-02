const {test}=require('node:test');
const assert=require('node:assert/strict');
const catalog=require('../data/seed/index.json');
const {CONVERSIONS,ULTIMATE_DEPENDENCIES}=require('../src/core/recommendation-rules.cjs');
const {scoreAugments,equipmentContext,buildRecommendations,matchupRecommendations,rankDraft,bundledStatic}=require('../src/core/recommendations.cjs');
const aug=key=>({...catalog.augments.find(a=>a.key===key),scope:'champion',confidence:'confirmed'});
const build=ids=>[{name:'核心装备',rows:[ids.map(id=>({id,name:bundledStatic.items[id]?.name||String(id)}))]}];
const score=(candidate,selectedAugments=[],ownItems=[])=>scoreAugments({augments:[candidate],ownItems,selectedAugments})[0];

test('Back to Basics never declares non-ultimate sniper or an automatically granted ultimate incompatible',()=>{
  const basics=aug('ARAM_BacktoBasics');
  for(const key of ['ARAM_SkilledSniper','PromQueen','ARAM_SpinToWin']){
    const candidate=aug(key),value=score(candidate,[basics]);
    assert.equal(value.constraints.length,0,key);
    assert.equal(value.components.augments,0,key);
  }
  for(const rule of ULTIMATE_DEPENDENCIES){
    const candidate=aug(rule.key);
    assert.ok(score(candidate,[basics]).constraints.length,rule.key);
    assert.ok(score(basics,[candidate]).constraints.length,rule.key);
    assert.equal(score({...candidate,key:'Unverified'},[basics]).constraints.length,0,rule.key);
  }
});

test('each verified conversion masks the original equipment threshold without inventing a converted total',()=>{
  const inventory=[3031,3157,3115,3084,3110];
  for(const rule of CONVERSIONS){
    const selected=aug(rule.key),context=equipmentContext(inventory,[selected]);
    assert.ok(context.raw[rule.from]>0,rule.key);
    assert.equal(context.effective[rule.from],0,rule.key);
    assert.equal(context.amountsKnown,false);
    assert.equal(context.conversions[0].augmentId,rule.id);
    assert.equal(context.conversions[0].tentative,false);
    const invalid=equipmentContext(inventory,[{...selected,id:-1}]);
    assert.equal(invalid.conversions.length,0);
    assert.equal(invalid.effective[rule.from],context.raw[rule.from]);
  }
});

test('AP, attack speed, health and mana that were converted no longer earn false raw-stat bonuses',()=>{
  for(const [key,description,items] of [
    ['ARAM_escAPADe','获得法术强度',[3157]],
    ['ARAM_Purist_Caster','提升攻击速度',[3115]],
    ['BigShot','提升攻击速度',[3115]],
    ['GiftoftheDrowned','提升最大生命值',[3084]],
    ['NoManaNoProblem','基于法力获得收益',[3110]],
  ]){
    const candidate={id:999,tier:2,scope:'champion',name:'规则回归用候选',description};
    assert.ok(score(candidate,[],items).components.equipment>0,key);
    const changed=score(candidate,[aug(key)],items);
    assert.equal(changed.components.equipment,0,key);
    assert.ok(changed.reasons.some(reason=>reason.includes('转化后数值未读取')),key);
  }
});

test('conversion candidates reward their actual source stat instead of calling it an ordinary attack build',()=>{
  const result=score(aug('ARAM_ADAPt'),[],[3031]);
  assert.ok(result.reasons.some(reason=>reason.includes('可供')&&reason.includes('法术强度')));
  assert.ok(result.reasons.every(reason=>!reason.includes('现有装备的攻击力或攻速')));
});

test('conversion purchase guidance follows existing OP.GG routes and keeps damage and conversion amounts unknown',()=>{
  const result=matchupRecommendations({champion:{id:22},ownItems:[],selectedAugments:[aug('ARAM_ADAPt')],builds:build([3031])});
  assert.equal(result.recommendations[0].item.id,3031);
  assert.match(result.recommendations[0].reason,/攻击力.*转为法术强度/);
  assert.equal(result.evidence.damageDirection,'unknown');
  assert.equal(result.evidence.conversionAmountsKnown,false);
  assert.equal(result.evidence.opponentAugmentsKnown,false);
  assert.equal(matchupRecommendations({ownItems:[],selectedAugments:[aug('ARAM_ADAPt')]}).recommendations.length,0);
});

test('tentative and chained conversions keep their uncertainty visible rather than calculating a cycle',()=>{
  const result=matchupRecommendations({ownItems:[3031,3157],selectedAugments:[{...aug('ARAM_ADAPt'),confidence:'visual'},aug('ARAM_escAPADe')],builds:build([3089])});
  assert.ok(result.cautions.some(reason=>reason.includes('结算顺序')));
  assert.ok(result.cautions.some(reason=>reason.includes('若已选记录正确')));
  assert.equal(result.evidence.statConversions.length,2);
  assert.equal(result.evidence.damageDirection,'unknown');
});

test('AP converted away cannot be promised again as Eureka haste',()=>{
  const result=matchupRecommendations({ownItems:[],selectedAugments:[aug('ARAM_Eureka'),aug('ARAM_escAPADe')],builds:build([3089])});
  assert.ok(result.recommendations.every(rec=>!rec.augmentIds.includes(1030)));
  assert.ok(result.recommendations.every(rec=>!rec.reason.includes('还能按强化描述转为技能急速')));
});

test('converted AD never silently falls back to a Marksman label for Ethereal Weapon shopping',()=>{
  const result=matchupRecommendations({champion:{id:22},ownItems:[3031],selectedAugments:[aug('ARAM_ADAPt'),aug('ARAM_EtherealWeapon')],builds:build([3153])});
  assert.ok(result.recommendations.every(rec=>!rec.augmentIds.includes(1029)));
});

test('same verified item variants and repeated numeric strings form only one route entry',()=>{
  const result=buildRecommendations({builds:build(['3031',3031,223031,773031,3089]),ownItems:[]})[0].rows[0];
  assert.deepEqual(result.items.map(item=>item.id),[3031,3089]);
  assert.equal(result.next.id,3031);
});

test('a mode-specific component is satisfied by the verified base recipe upgrade',()=>{
  const route=buildRecommendations({builds:build([223057,3089]),ownItems:[3100]})[0].rows[0];
  assert.equal(route.items[0].owned,true);
  assert.equal(route.next.id,3089);
});

test('observed quest reward also suppresses mode-specific prerequisite repurchases',()=>{
  const selectedAugments=[aug('ARAM_Quest_VoidImmolation')];
  const route=buildRecommendations({builds:build([223068,226664]),ownItems:[223069],selectedAugments})[0].rows[0];
  assert.equal(route.next,null);assert.ok(route.items.every(item=>item.blocked));
  const result=matchupRecommendations({ownItems:[223069],selectedAugments:[...selectedAugments,aug('GiftoftheDrowned')],builds:build([223068,226664])});
  assert.equal(result.recommendations.length,0);
});

test('non-purchasable transformed equipment stays visible but cannot be the next buy',()=>{
  assert.equal(bundledStatic.items[3040].gold.purchasable,false);
  const row=buildRecommendations({builds:build([3040,3089]),ownItems:[]})[0].rows[0];
  assert.equal(row.items[0].blocked,true);assert.equal(row.next.id,3089);
  assert.match(row.items[0].reasons.join(' '),/不可直接购买/);
});

test('combined armor and healing threats do not recommend two alternative penetration finished items',()=>{
  const result=matchupRecommendations({champion:{id:22},ownItems:[3031],opponents:[{championId:86,items:[3110,3153]}],builds:build([3036,3033])});
  assert.deepEqual(result.recommendations.map(rec=>rec.item.id),[3033]);
  assert.match(result.recommendations[0].reason,/护甲穿透/);
  assert.match(result.recommendations[0].reason,/吸血类装备/);
});

test('known tank/support roles still allow range and marksman coverage when damage type is unknown',()=>{
  const champions=[103,22,201,412].map(id=>({id,tier:2}));
  const result=rankDraft({catalog:champions,selfId:103,team:[{championId:103,isSelf:true},{championId:201},{championId:412}],availableChampionIds:[22]});
  assert.equal(result.composition.rolesUnknown,0);assert.ok(result.composition.unknown>0);
  const ashe=result.candidates.find(c=>c.id===22);
  assert.ok(ashe.reasons.some(reason=>reason.includes('基础普攻射程')));
  assert.ok(ashe.reasons.some(reason=>reason.includes('补充射手')));
  assert.ok(ashe.reasons.every(reason=>!reason.includes('补充队伍的物理输出方向')));
  assert.ok(result.candidates.some(c=>c.id===103&&c.isCurrent));
  assert.equal(ashe.winRate,null);
});

test('an unidentified teammate still prevents claims that a role is absent',()=>{
  const result=rankDraft({catalog:[{id:22,tier:2},{id:54,tier:2}],selfId:22,team:[{championId:22,isSelf:true},{championId:0},{championId:201}],availableChampionIds:[54]});
  assert.equal(result.composition.rolesUnknown,1);
  assert.ok(result.candidates.every(c=>c.components.composition===0&&c.confidence==='low'));
});
