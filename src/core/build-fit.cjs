const { CONVERSIONS, SCALING_RULES, CRIT_MECHANICS, ULTIMATE_DEPENDENCIES, matchesRule } = require('./recommendation-rules.cjs');
const list = value => Array.isArray(value) ? value : [];
const STAT_KEYS = { ap:'FlatMagicDamageMod', ad:'FlatPhysicalDamageMod', mana:'FlatMPPoolMod', health:'FlatHPPoolMod', attackSpeed:'PercentAttackSpeedMod', crit:'FlatCritChanceMod' };
const stat = (item, key) => Number.isFinite(item?.stats?.[STAT_KEYS[key]]) ? Math.max(0, item.stats[STAT_KEYS[key]]) : 0;
const reliable = augment => ['api','confirmed'].includes(augment.confidence);

function itemBuildFit(meta, selectedAugments, equipment) {
  const selected = list(selectedAugments).filter(a=>a&&Number.isInteger(a.id));
  const benefits = [], cautions = [], augmentIds = [];
  const conversions = selected.map(augment=>({augment,rule:CONVERSIONS.find(rule=>matchesRule(augment,rule))})).filter(row=>row.rule);
  const noUltimate=selected.find(a=>matchesRule(a,{id:1004,key:'ARAM_BacktoBasics',words:['不能使用你的终极技能']}));
  const add = (augment, message) => { benefits.push(`${reliable(augment)?'已选':'若已选记录正确，'}「${augment.name}」：${message}`); augmentIds.push(augment.id); };
  if (!meta) return { status:'unknown', benefits, cautions:['此装备缺少匹配补丁的静态属性，保留来源路线'], augmentIds, confidence:'low' };
  for (const augment of selected) {
    const scaling = SCALING_RULES.find(rule=>matchesRule(augment,rule));
    if (scaling && stat(meta,scaling.stat)>0) {
      if (noUltimate&&ULTIMATE_DEPENDENCIES.some(rule=>matchesRule(augment,rule))) cautions.push(`「${augment.name}」依赖终极技能，与「回归基本功」记录冲突，不承诺该联动收益`);
      else if (conversions.some(row=>row.rule.from===scaling.stat)) cautions.push(`「${augment.name}」需要的原始属性已存在转换，不能保证该装备继续提供对应联动`);
      else add(augment, scaling.effect);
    }
    const crit = CRIT_MECHANICS.find(rule=>matchesRule(augment,rule));
    if (crit && stat(meta,'crit')>0) add(augment,`装备暴击几率与${crit.effect}方向对应；不等同总伤害或治疗增幅`);
    if (matchesRule(augment,{id:1080,key:'ARAM_TankItOrLeaveIt',words:['最大50%几率']} ) && stat(meta,'crit')>0) {
      if (equipment?.raw?.crit>=.5) cautions.push('现有装备暴击已至少 50%；会心防御的几率上限为 50%，不能据此继续承诺防御收益');
      else cautions.push('会心防御的几率上限为 50%；装备暴击不包含英雄与强化的全部暴击，实际余量未知');
    }
    if (matchesRule(augment,{id:1346,key:'Vampirism',words:['不再能够被友军治疗或获得生命回复']}) && (list(meta.tags).includes('HealthRegen') || meta.stats?.FlatHPRegenMod>0)) cautions.push(`${reliable(augment)?'已选':'若已选记录正确，'}「${augment.name}」禁用生命回复，这部分装备收益不可用；其他属性未被一并禁用`);
    if (matchesRule(augment,{id:1029,key:'ARAM_EtherealWeapon',words:['技能可施加攻击特效']}) && /攻击特效/.test(meta.description||'')) {
      // Support items that grant a buff only after healing are not unconditional
      // on-hit purchases merely because their description contains the words.
      if (/对一名友方英雄施加治疗或护盾|为一名友军提供治疗或护盾/.test(meta.description||'')) cautions.push('该攻击特效需要先对友军施加治疗或护盾；拥有虚幻武器并不能代替这个触发条件');
      else add(augment,'技能可触发该装备描述中的攻击特效；仍受每目标冷却及装备条件限制');
    }
  }
  for (const {augment,rule} of conversions) if (stat(meta,rule.from)>0) add(augment,`${rule.fromLabel}${rule.partial?'的一部分':''}会转为${rule.toLabel}；原属性不能按通常构筑收益计算`);
  const used=selected.filter(a=>augmentIds.includes(a.id));
  return {status:cautions.length?'conditional':benefits.length?'supported':'baseline',benefits:[...new Set(benefits)],cautions:[...new Set(cautions)],
    augmentIds:[...new Set(augmentIds)],confidence:used.length&&used.every(reliable)?'medium':'low'};
}

function summarizeBuildStyle(equipment, selectedAugments) {
  const features=equipment.effective, selected=list(selectedAugments), directions=[];
  if (features.ap>=80) directions.push({key:'spell',label:'法强路线',evidence:'已读装备法强至少 80'});
  if (features.ad>=70) directions.push({key:'attack',label:'攻击路线',evidence:'已读装备攻击力至少 70'});
  if (features.crit>=.2) directions.push({key:'crit',label:'暴击路线',evidence:'已读装备暴击至少 20%'});
  if (features.health>=500) directions.push({key:'durability',label:'生命路线',evidence:'已读装备生命值至少 500'});
  if (features.healing) directions.push({key:'support',label:'治疗护盾路线',evidence:'已持有治疗护盾强度装备'});
  const mechanisms=selected.flatMap(augment=>{
    const scaling=SCALING_RULES.find(rule=>matchesRule(augment,rule));
    const crit=CRIT_MECHANICS.find(rule=>matchesRule(augment,rule));
    return scaling||crit?[{augmentId:augment.id,augmentName:augment.name,effect:scaling?.effect||crit.effect,tentative:!reliable(augment)}]:[];
  });
  return {directions,mechanisms,conversions:equipment.conversions,itemsKnown:features.known,completeAugments:false,
    label:'当前构筑线索',notice:'根据已读装备和已知强化说明描述方向；不是完整流派判定，不推算转换后的属性或收益。'};
}
module.exports={itemBuildFit,summarizeBuildStyle,STAT_KEYS};
