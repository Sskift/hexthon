const {test}=require('node:test');
const assert=require('node:assert/strict');
const catalog=require('../data/seed/index.json');
const {scoreAugments,buildRecommendations,matchupRecommendations,itemFeatures,bundledStatic}=require('../src/core/recommendations.cjs');
const aug=(key,extra={})=>({...catalog.augments.find(a=>a.key===key),confidence:'confirmed',scope:'champion',...extra});
const build=ids=>[{name:'核心装备',rows:[ids.map(id=>({id,name:bundledStatic.items[id]?.name||String(id)}))]}];
const matchup=(key,ids,extra={})=>matchupRecommendations({champion:{id:103},ownItems:[],selectedAugments:[aug(key)],builds:build(ids),...extra});
const score=(candidate,ownItems,selectedAugments=[])=>scoreAugments({augments:[candidate],ownItems,selectedAugments})[0];

test('target-health and unspecified-health damage never earns an own-health equipment bonus',()=>{
  for(const key of ['ARAM_MagicMissile','ARAM_Poro_Blast','Dropybara_Active','Upgrade_Stormsurge','ARAM_QuantumComputing','MercysStrike']){
    const a=aug(key),without=score(a,[]),withHealth=score(a,[3084]);
    assert.equal(withHealth.components.equipment,without.components.equipment,key);
    assert.ok(withHealth.reasons.every(r=>!r.includes('自身生命值机制')),key);
  }
  for(const key of ['ARAM_HeavyHitter','PressureCooker'])assert.ok(score(aug(key),[3084]).score>score(aug(key),[]).score,key);
});

test('verified AP, mana and own-health mechanics choose supported items only from the existing route',()=>{
  for(const [key,ids,expected,reason] of [
    ['ARAM_BigBrain',[3089,3031],3089,/护盾/],
    ['ARAM_Overflow',[3089,3118],3118,/翻倍的法力消耗/],
    ['ARAM_MindtoMatter',[3089,3003],3003,/最大生命值提升/],
    ['ARAM_HeavyHitter',[3031,3084],3084,/普攻命中/],
    ['PressureCooker',[3089,3116],3116,/接近对手/],
    ['ARAM_Zealot',[3089,3031],3089,/未读取具体换算量/],
  ]){
    const result=matchup(key,ids),rec=result.recommendations[0];
    assert.equal(rec.item.id,expected,key);assert.match(rec.reason,reason);assert.match(rec.source,/OP.GG/);
    assert.equal(rec.fit.status,'supported');assert.equal(result.evidence.completeAugments,false);
    assert.deepEqual(matchup(key,[]).recommendations,[],key);
    const fake=aug(key,{key:'Unverified'});assert.deepEqual(matchup(key,ids,{selectedAugments:[fake]}).recommendations,[],key);
  }
});

test('converted-away input disables the old scaling recommendation but retains the conversion explanation',()=>{
  const selected=[aug('ARAM_BigBrain'),aug('ARAM_escAPADe')];
  const result=matchup('ARAM_BigBrain',[3089],{selectedAugments:selected});
  assert.ok(result.recommendations.every(rec=>!rec.augmentIds.includes(1180)));
  const fit=buildRecommendations({builds:build([3089]),ownItems:[],selectedAugments:selected})[0].rows[0].items[0].fit;
  assert.equal(fit.status,'conditional');assert.ok(fit.cautions.some(r=>r.includes('原始属性已存在转换')));
  assert.ok(fit.benefits.some(r=>r.includes('转为额外攻击力')));
  assert.ok(fit.benefits.every(r=>!r.includes('可供给该强化的护盾')));
});

test('ultimate-disabled health scaling is not promised through equipment fit or dynamic purchases',()=>{
  const selected=[aug('FinalForm'),aug('ARAM_BacktoBasics')];
  const result=matchup('FinalForm',[3084],{selectedAugments:selected});
  assert.deepEqual(result.recommendations,[]);
  const fit=buildRecommendations({builds:build([3084]),ownItems:[],selectedAugments:selected})[0].rows[0].items[0].fit;
  assert.ok(fit.cautions.some(r=>r.includes('依赖终极技能')));assert.equal(fit.benefits.length,0);
});

test('crit mechanisms retain the OP.GG purchase route and preserve uncertain selected evidence',()=>{
  const known=matchup('ARAM_DoubleTap',[3089,3094]);assert.equal(known.recommendations[0].item.id,3094);
  const uncertain=matchup('ARAM_DoubleTap',[3094],{selectedAugments:[aug('ARAM_DoubleTap',{confidence:'visual'})]});
  assert.ok(uncertain.recommendations[0].priority<known.recommendations[0].priority);
  assert.match(uncertain.recommendations[0].reason,/若已选记录正确/);
  assert.equal(uncertain.recommendations[0].fit.confidence,'low');
  const grant=aug('ARAM_ItsCritical'),double=aug('ARAM_DoubleTap');
  assert.ok(score(grant,[],[double]).score>score(grant,[]).score);
  assert.ok(score(double,[],[grant]).score>score(double,[]).score);
});

test('defensive crit cap stops an extra crit-fit bonus without blocking offensive use of the same item',()=>{
  const a=aug('ARAM_TankItOrLeaveIt'),result=score(a,[3031,3094]);
  assert.ok(result.constraints.some(r=>r.includes('50%')));
  const row=buildRecommendations({builds:build([6676]),ownItems:[3031,3094],selectedAugments:[a]})[0].rows[0];
  assert.equal(row.next.id,6676);assert.equal(row.items[0].blocked,false);
  assert.ok(row.fitCautions.some(r=>r.includes('不能据此继续承诺防御收益')));
});

test('regen inhibition is an item-part caution, not a ban on all health items or an anti-heal false positive',()=>{
  const a=aug('Vampirism'),row=buildRecommendations({builds:build([3083,3033,3116]),ownItems:[],selectedAugments:[a]})[0].rows[0];
  assert.equal(row.items[0].blocked,false);assert.equal(row.items[0].fit.status,'conditional');
  assert.ok(row.items[0].fit.cautions.some(r=>r.includes('其他属性未被一并禁用')));
  assert.equal(row.items[1].fit.cautions.length,0);assert.equal(row.items[2].fit.cautions.length,0);
});

test('a healing-gated support on-hit buff is not an unconditional Ethereal Weapon purchase',()=>{
  const result=matchup('ARAM_EtherealWeapon',[3504,3115],{ownItems:[3157]});
  assert.equal(result.recommendations[0].item.id,3115);
  assert.equal(itemFeatures([3504]).onHit,false);
  const row=buildRecommendations({builds:build([3504]),ownItems:[],selectedAugments:[aug('ARAM_EtherealWeapon')]})[0].rows[0];
  assert.ok(row.items[0].fit.cautions.some(r=>r.includes('不能代替这个触发条件')));
});

test('build explanation preserves source ordering and unknown static data stays unknown',()=>{
  const row=buildRecommendations({builds:build([3031,3089]),ownItems:[],selectedAugments:[aug('ARAM_BigBrain')]})[0].rows[0];
  assert.deepEqual(row.items.map(i=>i.id),[3031,3089]);assert.equal(row.next.id,3031);assert.equal(row.sourceOrderPreserved,true);
  assert.equal(row.items[0].fit.status,'baseline');assert.equal(row.items[1].fit.status,'supported');
  const unknown=buildRecommendations({builds:build([3089]),ownItems:null,selectedAugments:[aug('ARAM_BigBrain')],staticData:{items:{}}})[0].rows[0];
  assert.equal(unknown.next,null);assert.equal(unknown.items[0].fit.status,'unknown');
});

test('style evidence describes observed raw inputs, not unknown converted totals or complete loadouts',()=>{
  const result=matchup('ARAM_escAPADe',[3089],{ownItems:[3089],selectedAugments:[aug('ARAM_escAPADe')]});
  const style=result.evidence.buildStyle;
  assert.equal(style.completeAugments,false);assert.equal(style.itemsKnown,true);
  assert.ok(style.directions.every(d=>d.key!=='spell'&&d.key!=='attack'));
  assert.equal(style.conversions.length,1);assert.match(style.notice,/不推算转换后的属性/);
  assert.equal(matchup('ARAM_BigBrain',[3089],{ownItems:null}).evidence.buildStyle.itemsKnown,false);
});
