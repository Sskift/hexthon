const bundledStatic = require('../../data/static/riot.json');
const { isPoroSnack } = require('./league.cjs');
const {CONVERSIONS,ULTIMATE_DEPENDENCIES}=require('./recommendation-rules.cjs');
const TIER_SCORE = [84, 76, 67, 58, 49, 40];
const INDEX_LABEL = '规则匹配指数（非胜率）';
const clamp = n => Math.max(0, Math.min(100, Math.round(n)));
const finite = n => typeof n === 'number' && Number.isFinite(n);
const list = value => Array.isArray(value) ? value : [];

function itemFeatures(ownItems, staticData = bundledStatic) {
  const features = { known: Array.isArray(ownItems), ap: 0, ad: 0, crit: 0, attackSpeed: 0, health: 0, mana: 0, onHit: false, healing: false, itemIds: new Set(), names: [] };
  for (const item of list(ownItems).filter(item => item !== null && item !== undefined)) {
    const id = Number(typeof item === 'number' ? item : item.id ?? item.itemID);
    const meta = staticData.items?.[id] || {};
    if (isPoroSnack(item, meta.name)) continue;
    features.itemIds.add(id);
    const stats = meta.stats || item.stats || {};
    features.names.push(meta.name || item.name || '');
    const count = Number(item.count) > 0 ? Number(item.count) : 1;
    for (const [key, stat] of [['ap', 'FlatMagicDamageMod'], ['ad', 'FlatPhysicalDamageMod'], ['crit', 'FlatCritChanceMod'], ['attackSpeed', 'PercentAttackSpeedMod'], ['health', 'FlatHPPoolMod'], ['mana', 'FlatMPPoolMod']]) features[key] += (finite(stats[stat]) ? stats[stat] : 0) * count;
    if (/攻击特效|On.Hit/i.test(meta.description || '') || [3153, 3124, 3115, 3091].includes(id)) features.onHit = true;
    if ((meta.tags || []).includes('HealAndShieldPower') || /治疗和护盾强度/.test(meta.description || '')) features.healing = true;
  }
  return features;
}
function augmentFeatures(augment) {
  const text = `${augment?.name || ''} ${augment?.description || ''}`;
  return { ap: /法术强度/.test(text), ad:/攻击力/.test(text),attackSpeed:/攻击速度/.test(text),attack: /攻击力|攻击速度/.test(text), crit: /暴击/.test(text), onHit: /攻击特效/.test(text),
    haste: /技能急速|技能.*冷却/.test(text), health: /最大生命值/.test(text), mana: /法力/.test(text), healing: /治疗|护盾/.test(text) };
}

// Explicit IDs were checked against OP.GG seed descriptions and Riot 16.21.1.
// Never derive mode IDs arithmetically, or apply a rule from a similar name.
const ITEM_VARIANTS = [
  [3031,223031,773031], [6676,226676,667666], [3157,223157,773157], [2420,773191],
  [3057,223057,773057], [3078,223078,773078], [3100,223100,773100], [6662,226662,773025],
  [3068,223068], [6664,226664], [3074,223074,773074], [6333,226333], [4646,224646],
  [6610,226610], [3084,223084], [3089,223089,773089], [6698,226698], [3748,223748],
  [124011,4011,664011],
];
const DEPENDENCY_RULES = [
  { id:1336,key:'ARAM_Upgrade_IE',words:['装备无尽之刃'],items:[3031] },
  { id:1320,key:'ARAM_Upgrade_Collector',words:['收集者','处决'],items:[6676] },
  { id:1318,key:'ARAM_Upgrade_ZH',words:['中娅沙漏','探索者的护臂','沃格勒特的巫师帽'],items:[3157,2420,228002],ownedDescription:/凝滞|时间停止|2\.5秒里免疫/ },
  { id:1996,key:'ARAM_Upgrade_Sheen',words:['咒刃效果'],items:[3057,3078,3100,6662],effect:'咒刃' },
  { id:1319,key:'ARAM_Upgrade_Immolate',words:['璀璨回响','日炎圣盾','献祭'],items:[3068,6664] },
  { id:2140,key:'Upgrade_Ravenous',words:['贪欲九头蛇','顺劈'],items:[3074] },
  { id:2157,key:'Upgrade_DeathDance',words:['死亡之舞','无视痛苦'],items:[6333] },
  { id:3150,key:'Upgrade_Stormsurge',words:['风暴狂涌','风啸'],items:[4646] },
  { id:2143,key:'Upgrade_SunderedSky',words:['焚天','冷却时间'],items:[6610] },
  { id:1379,key:'Upgrade_SwordOfBlossom',words:['花晓之剑','治疗'],items:[124011] },
  { id:1152,key:'ARAM_Quest_SteelYourHeart',words:['心之钢','300层'],items:[3084],all:true,condition:'还需心之钢至少 300 层；层数未读取，不能确认任务完成' },
  { id:1156,key:'ARAM_Quest_WoogletsWitchcap',words:['任务：持有灭世者的死亡之帽和中娅沙漏','奖励：获得沃格勒特的巫师帽'],items:[3089,3157],all:true,reward:228002 },
  { id:2141,key:'Quest_UltraHydra',words:['任务：拥有','贪欲九头蛇','亵渎九头蛇','巨型九头蛇','终极九头蛇'],items:[3074,6698,3748],all:true,reward:226668 },
  { id:1361,key:'ARAM_Quest_VoidImmolation',words:['任务：持有日炎圣盾和璀璨回响','合成为虚空献祭'],items:[3068,6664],all:true,reward:223069,replaces:true },
];
const QUEST_REWARDS=new Set(DEPENDENCY_RULES.map(rule=>rule.reward).filter(Boolean));
const itemId = item => {
  const raw = typeof item === 'object' && item !== null ? item.id ?? item.itemID : item;
  const id = typeof raw === 'number' || typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};
function sameItem(id, ownedId, metadata) {
  if (id === ownedId) return true;
  const family = ITEM_VARIANTS.find(ids => ids.includes(id) && ids.includes(ownedId));
  return Boolean(family && metadata[id]?.name && metadata[id].name === metadata[ownedId]?.name);
}
function ownsItemOrUpgrade(id, owned, metadata) {
  const pending=[Number(id)],visited=new Set();
  while(pending.length&&visited.size<100){
    const next=Number(pending.shift());if(visited.has(next))continue;visited.add(next);
    if([...owned].some(held=>sameItem(next,held,metadata)))return true;
    const equivalents=ITEM_VARIANTS.find(ids=>ids.includes(next))||[next];
    for(const equivalent of equivalents)if(sameItem(next,equivalent,metadata))pending.push(...list(metadata[equivalent]?.into));
  }
  return false;
}
function verifiedAugment(augment,id,key,words) {
  return augment?.id===id && augment.key===key && typeof augment.description==='string' && words.every(word=>augment.description.replace(/\s/g,'').includes(word.replace(/\s/g,'')));
}
function equipmentContext(ownItems,selectedAugments,staticData=bundledStatic){
  const raw=itemFeatures(ownItems,staticData),effective={...raw},conversions=[];
  for(const rule of CONVERSIONS){
    const augment=list(selectedAugments).find(a=>verifiedAugment(a,rule.id,rule.key,rule.words));if(!augment)continue;
    const tentative=!['api','confirmed'].includes(augment.confidence);
    conversions.push({augmentId:augment.id,augmentName:augment.name,from:rule.from,to:rule.to,partial:rule.partial===true,
      observedSource:raw.known?raw[rule.from]:null,tentative,
      reason:`${tentative?'若已选记录正确，':''}「${augment.name}」会将${rule.fromLabel}${rule.partial?'的一部分':''}转为${rule.toLabel}；不再按原始${rule.fromLabel}推断收益，转化后数值未读取`});
    // A partial conversion also makes the original threshold unreliable. Do
    // not fabricate its remaining amount or the order of multiple conversions.
    effective[rule.from]=0;
  }
  return {raw,effective,conversions,amountsKnown:false};
}
const requiresUltimate=a=>ULTIMATE_DEPENDENCIES.some(rule=>verifiedAugment(a,rule.id,rule.key,rule.words));
function augmentDependency(augment,ownItems,staticData=bundledStatic) {
  const rule=DEPENDENCY_RULES.find(r=>verifiedAugment(augment,r.id,r.key,r.words));
  const metadata=staticData.items||{};
  if(!rule || rule.items.some(id=>!metadata[id]?.name || (rule.effect ? !metadata[id].description?.includes(rule.effect) : !augment.description.includes(metadata[id].name))))return null;
  if(rule.reward && (!metadata[rule.reward]?.name || !augment.description.includes(metadata[rule.reward].name)))return null;
  const known=Array.isArray(ownItems),owned=new Set(list(ownItems).map(itemId).filter(id=>id&&(!rule.ownedDescription||rule.ownedDescription.test(metadata[id]?.description||''))));
  const items=rule.items.map(id=>({id,name:metadata[id].name,owned:known?ownsItemOrUpgrade(id,owned,metadata):null}));
  const rewardOwned=Boolean(known&&rule.reward&&ownsItemOrUpgrade(rule.reward,owned,metadata));
  const satisfied=known&&(rule.all?items.every(i=>i.owned):items.some(i=>i.owned));
  const missing=known&&!rewardOwned&&!satisfied?items.filter(i=>!i.owned):[];
  const status=!known?'unknown':rewardOwned?'reward-owned':!satisfied?'missing':rule.condition?'condition-unknown':'equipment-ready';
  const label=items.map(i=>i.name).join(rule.all?' + ':' / ');
  const reason=!known?`装备未读取，前置条件：${label}`:rewardOwned?`已持有任务奖励「${metadata[rule.reward].name}」，停止重复补前置装备`:
    !satisfied?`尚未持有${missing.map(i=>i.name).join(rule.all?' + ':' / ')}${rule.all?'；任务需要全部前置':'，效果需要额外出装投入'}`:
      rule.condition?`已持有${label}；${rule.condition}`:`已持有${rule.all?label:items.filter(i=>i.owned).map(i=>i.name).join(' / ')}，满足装备条件${rule.all?'；任务奖励到账仍需确认':''}`;
  return {augmentId:augment.id,augmentName:augment.name,kind:rule.all?'quest':'upgrade',requirement:rule.all?'all':'any',status,items,
    missingItemIds:missing.map(i=>i.id),rewardItemId:rule.reward||null,replaces:rule.replaces===true,condition:rule.condition||null,reason};
}
const disablesUltimate = a => verifiedAugment(a,1004,'ARAM_BacktoBasics',['不能使用你的终极技能']);
function itemRestrictions(id,selectedAugments,staticData) {
  const reasons=[],meta=staticData.items?.[id];
  if(list(selectedAugments).some(a=>disablesUltimate(a)&&['api','confirmed'].includes(a.confidence))&&/终极技能/.test(meta?.description||''))reasons.push('已选「回归基本功」无法使用终极技能；该装备描述依赖终极技能');
  return reasons;
}
const PENETRATION_FAMILIES = [
  {kind:'magic',base:3135,ids:[3135,223135,773135]}, {kind:'magic',base:3137,ids:[3137,223137]},
  {kind:'physical',base:3033,ids:[3033,223033]}, {kind:'physical',base:3036,ids:[3036,223036]},
  {kind:'physical',base:6694,ids:[6694,226694]}, {kind:'physical',base:3035,ids:[773035]},
];
function penetrationKind(id,metadata){
  const family=PENETRATION_FAMILIES.find(f=>f.ids.includes(id)),meta=metadata[id];
  if(!family||!meta?.name||meta.name!==metadata[family.base]?.name)return null;
  const magic=family.kind==='magic',stat=magic?'FlatMagicDamageMod':'FlatPhysicalDamageMod',tag=magic?'MagicPenetration':'ArmorPenetration';
  const description=meta.description||'',percent=magic?/\d+(?:\.\d+)?%\s*(?:法术穿透|magic penetration)/i:/\d+(?:\.\d+)?%\s*(?:护甲穿透|armor penetration)/i;
  const legacy=id===773135&&/无视目标\d+(?:\.\d+)?%的魔法抗性/.test(description)||id===773035&&/无视对手\d+(?:\.\d+)?%的护甲/.test(description);
  return finite(meta.stats?.[stat])&&meta.stats[stat]>0&&list(meta.tags).includes(tag)&&(percent.test(description)||legacy)?family.kind:null;
}

function scoreAugments({ augments = [], champion = null, ownItems = null, selectedAugments = null, selectedKnown: selectedKnownOverride, championTags, championStats, staticData = bundledStatic, contextKnown = true } = {}) {
  const cid = champion?.id ?? champion?.championId;
  const championMeta = staticData.champions?.[cid] || {};
  const tags = championTags || champion?.tags || championMeta.tags || [];
  const stats = championStats || {};
  const resolvedSelected = list(selectedAugments).map(a => typeof a === 'number' ? augments.find(x => x.id === a) : a);
  const selected = [...new Map(resolvedSelected.filter(Boolean).map(a => [a.id, a])).values()];
  const equipment=equipmentContext(ownItems,selected,staticData),features=equipment.effective;
  const selectedKnown = Array.isArray(selectedAugments) && resolvedSelected.every(Boolean) && (typeof selectedKnownOverride === 'boolean' ? selectedKnownOverride : true);
  return augments.map(a => {
    const dependency=augmentDependency(a,ownItems,staticData),constraints=[];
    const base = Number.isInteger(a.tier) && TIER_SCORE[a.tier] != null ? TIER_SCORE[a.tier] : null;
    if (base === null) return { id: a.id, score: null, label: INDEX_LABEL, components: { tier: null, equipment: 0, augments: 0, champion: 0 }, reasons: ['来源没有可核实的档位'], dependency, constraints, confidence: 'unknown', sourceScope: a.scope || 'unknown', selectedKnown, itemsKnown: features.known };
    const af = augmentFeatures(a), components = { tier: base, equipment: 0, augments: 0, champion: 0 };
    const conversion=CONVERSIONS.find(rule=>verifiedAugment(a,rule.id,rule.key,rule.words));
    if(conversion){af[conversion.from]=false;af.attack=af.ad||af.attackSpeed;}
    const reasons = [`OP.GG ${a.scope === 'champion' ? '英雄专属' : '通用'} T${a.tier}`];
    const add = (group, n, reason) => { components[group] += n; reasons.push(reason); };
    if (features.known) {
      if (dependency) {
        const adjustment=dependency.status==='missing'?(dependency.requirement==='all'?-Math.min(12,dependency.missingItemIds.length*4):-10):dependency.status==='condition-unknown'?4:12;
        add('equipment',adjustment,dependency.reason);
      }
      if(disablesUltimate(a)&&[...features.itemIds].some(id=>/终极技能/.test(staticData.items?.[id]?.description||''))){
        const reason='已有装备效果依赖终极技能；选择后这些触发条件无法满足';constraints.push(reason);add('equipment',-12,reason);
      }
      if (af.ap && features.ap >= 80) add('equipment', 5, '现有装备偏法强，可延续法术构筑');
      if ((af.ad && features.ad >= 70) || (af.attackSpeed && features.attackSpeed >= .4)) add('equipment', 5, '现有装备的攻击力或攻速与此强化对应');
      if (af.crit && features.crit >= .2) add('equipment', 6, '现有暴击装备与暴击效果联动');
      if (af.onHit && features.onHit) add('equipment', 7, '现有攻击特效装备可参与联动');
      if (af.health && features.health >= 500) add('equipment', 4, '现有生命值装备与生命成长契合');
      if (af.mana && features.mana >= 400) add('equipment', 4, '现有法力装备可支撑法力机制');
      if (af.healing && features.healing) add('equipment', 4, '现有治疗护盾装备形成辅助构筑');
      if(conversion&&equipment.raw[conversion.from]>0)add('equipment',4,`已有${conversion.fromLabel}可供「${a.name}」转为${conversion.toLabel}；具体转化收益未计算`);
      for(const changed of equipment.conversions)if(af[changed.from])reasons.push(changed.reason);
      if (verifiedAugment(a,1030,'ARAM_Eureka',['法术强度的技能急速']) && (features.ap >= 100 || (finite(stats.abilityPower) && stats.abilityPower >= 150))) add('equipment', 5, '尤里卡可将已有法强转为技能急速');
      if (verifiedAugment(a,1048,'ARAM_JeweledGauntlet',['技能可以造成暴击']) && features.ap >= 80 && features.crit >= .2) add('equipment', 4, '法强与暴击装备同时存在，支持技能暴击');
      if (verifiedAugment(a,1205,'ARAM_ADAPt',['额外攻击力转化为法术强度']) && features.ad >= 100 && tags.includes('Marksman')) add('equipment', -9, '已投入较多攻击装备，转法强会改变当前普攻构筑');
      if (verifiedAugment(a,1206,'ARAM_escAPADe',['法术强度转化为额外攻击力']) && features.ap >= 100 && tags.includes('Mage')) add('equipment', -9, '已投入较多法强装备，转攻击力会改变当前法术构筑');
    }
    // Champion-class bonuses are deliberately small; OP.GG champion-specific tiers dominate.
    if (af.ap && tags.includes('Mage')) add('champion', 3, '职业标签为法师');
    if (af.attack && tags.includes('Marksman')) add('champion', 3, '职业标签为射手');
    if (af.health && tags.includes('Tank')) add('champion', 3, '职业标签为坦克');
    if (af.healing && tags.includes('Support')) add('champion', 2, '职业标签含辅助，具体技能仍需核对');
    if (af.mana && championMeta.resource && !/法力|Mana/.test(championMeta.resource) && !/NoManaNoProblem/.test(a.key || '')) add('champion', -9, '该英雄不使用法力；法力机制可能不适用');
    for (const chosen of selected) {
      if (chosen.id === a.id) continue;
      if((disablesUltimate(chosen)&&requiresUltimate(a)) || (disablesUltimate(a)&&requiresUltimate(chosen))){
        const reason=`「回归基本功」禁用终极技能，与${disablesUltimate(chosen)?'此强化':`已选「${chosen.name}」`}的终极技能条件冲突`;
        constraints.push(reason);add('augments',-12,reason);continue;
      }
      const cf = augmentFeatures(chosen);
      if (verifiedAugment(chosen,1029,'ARAM_EtherealWeapon',['技能可施加攻击特效']) && af.onHit) add('augments', 6, `与已选「${chosen.name}」的技能触发攻击特效联动`);
      else if (verifiedAugment(a,1029,'ARAM_EtherealWeapon',['技能可施加攻击特效']) && cf.onHit) add('augments', 6, `让已选「${chosen.name}」的攻击特效参与技能触发`);
      else if ((verifiedAugment(chosen,1048,'ARAM_JeweledGauntlet',['技能可以造成暴击'])||verifiedAugment(chosen,3123,'JeweledBracelet',['技能可以暴击'])) && af.crit) add('augments', 5, `与已选「${chosen.name}」的技能暴击方向契合`);
      else if (verifiedAugment(chosen,1118,'ARAM_CriticalHealing',['治疗和护盾可以暴击']) && af.crit) add('augments', 5, `与已选「${chosen.name}」的治疗暴击联动`);
      else if (verifiedAugment(chosen,1030,'ARAM_Eureka',['法术强度的技能急速']) && af.ap && !equipment.conversions.some(rule=>rule.from==='ap')) add('augments', 4, `新增法强也可供已选「${chosen.name}」转化急速`);
    }
    components.equipment = Math.max(-18, Math.min(18, components.equipment));
    components.augments = Math.max(-18,Math.min(12, components.augments));
    components.champion = Math.max(-9, Math.min(6, components.champion));
    if (!features.known) reasons.push('装备尚未读取，本项不计装备修正');
    if (!selectedKnown) reasons.push(selected.length ? '已选记录为自动推断或可能不完整，联动仅作参考' : '已选海克斯记录可能不完整，尚无可用联动记录');
    const confidence = !contextKnown ? 'low' : a.scope === 'champion' && features.known && selectedKnown ? 'medium' : 'low';
    return { id: a.id, score: clamp(Object.values(components).reduce((sum, n) => sum + n, 0)), label: INDEX_LABEL,
      components, reasons, dependency, constraints, conversions:equipment.conversions, confidence, sourceScope: a.scope || 'global', selectedKnown, itemsKnown: features.known };
  });
}

function championProfile(champion, staticData = bundledStatic) {
  const c = staticData.champions?.[champion?.id ?? champion?.championId] || champion || {};
  const tags = c.tags || [];
  const primary = tags[0];
  let damage = 'unknown';
  if (primary === 'Mage' || ((c.info?.magic || 0) >= 7 && (c.info?.attack || 0) <= 5)) damage = 'magic';
  else if (['Marksman', 'Fighter', 'Assassin'].includes(primary)) damage = 'physical';
  const attackRange=finite(c.stats?.attackrange)&&c.stats.attackrange>0?c.stats.attackrange:null;
  return { tags, damage, frontline: tags.includes('Tank') ? 1 : tags.includes('Fighter') ? .5 : 0, support: tags.includes('Support') ? 1 : 0,
    attackRange,longRange:attackRange===null?null:attackRange>=500,marksman:tags.includes('Marksman'),known: tags.length > 0 };
}
function summarizeComposition(champions, staticData = bundledStatic) {
  const summary = { physical: 0, magic: 0, frontline: 0, support: 0, unknown: 0, rolesUnknown:0,rolesKnown:0,damageKnown:0,longRange:0,rangeKnown:0,marksmen:0,count: champions.length, label: '职业与基础普攻射程覆盖估计，非实际伤害占比' };
  for (const c of champions) {
    const p = championProfile(c, staticData); summary[p.damage]++; summary.frontline += p.frontline; summary.support += p.support;
    if(p.known)summary.rolesKnown++;else summary.rolesUnknown++;if(p.damage!=='unknown')summary.damageKnown++;
    if(p.attackRange!==null){summary.rangeKnown++;if(p.longRange)summary.longRange++;}if(p.marksman)summary.marksmen++;
  }
  return summary;
}
function rankDraft({ catalog, team = [], availableChampionIds = [], selfId = null, staticData = bundledStatic } = {}) {
  const champions = Array.isArray(catalog) ? catalog : catalog?.champions || [];
  const selfEntry = team.find(p => p.isSelf);
  const currentId = itemId(selfEntry?.championId) || itemId(selfId);
  let removedFallback = false;
  const teammates = team.filter(p => {
    if (p.isSelf) return false;
    if (!selfEntry && !removedFallback && currentId > 0 && p.championId === currentId) { removedFallback = true; return false; }
    return true;
  }).map(p => champions.find(c => c.id === p.championId) || { id: p.championId || null });
  const taken = new Set(teammates.map(c => c.id));
  const composition = summarizeComposition(teammates, staticData);
  const candidates = [...new Set([...availableChampionIds,currentId].map(itemId).filter(Boolean))].filter(id => id === currentId || !taken.has(id)).map(id => champions.find(c => c.id === id)).filter(Boolean).map(c => {
    const tierBase = Number.isInteger(c.tier) ? TIER_SCORE[c.tier] ?? null : null;
    const profile = championProfile(c, staticData), reasons = [], components = { tier: tierBase, rank: 0, composition: 0 };
    if (tierBase !== null) reasons.push(`OP.GG T${c.tier}`);
    if (Number.isInteger(c.rank) && c.rank > 0) { components.rank = Math.max(0, Math.round(5 * (1 - (c.rank - 1) / Math.max(1, champions.length - 1)))); reasons.push(`OP.GG 综合排名 ${c.rank}`); }
    if (teammates.length >= 2 && composition.rolesUnknown === 0 && profile.known) {
      if (composition.frontline < 1 && profile.frontline >= 1) { components.composition += 12; reasons.push('补足当前队伍前排'); }
      else if (composition.frontline < .5 && profile.frontline > 0) { components.composition += 5; reasons.push('增加近战承伤角色'); }
      if (composition.unknown === 0 && composition.magic === 0 && composition.physical >= 2 && profile.damage === 'magic') { components.composition += 9; reasons.push('补充队伍的法术输出方向'); }
      if (composition.unknown === 0 && composition.physical === 0 && composition.magic >= 2 && profile.damage === 'physical') { components.composition += 9; reasons.push('补充队伍的物理输出方向'); }
      if (composition.support === 0 && composition.frontline >= 1 && profile.support) { components.composition += 4; reasons.push('为已有前排补充辅助功能'); }
      if (composition.support >= 2 && profile.support) { components.composition -= 6; reasons.push('队伍辅助角色较多，需要留意持续输出'); }
      if(composition.rangeKnown===teammates.length&&composition.longRange===0&&profile.longRange){components.composition+=4;reasons.push(`补充基础普攻射程：${profile.attackRange}（Riot 静态值，不含技能与强化）`);}
      if(composition.marksmen===0&&composition.frontline>=1&&profile.marksman){components.composition+=3;reasons.push('已有前排，补充射手职业覆盖；持续输出仍取决于构筑');}
      if(composition.unknown>0)reasons.push('部分队友的伤害方向无法由职业确定；仅按已知职责和射程补位');
    } else reasons.push(composition.rolesUnknown > 0 ? '部分队友英雄尚未识别，不判断阵容缺少的职责' : '队友信息不足，暂不计阵容修正');
    const score = tierBase === null ? null : clamp(tierBase + components.rank + components.composition);
    const winRate = finite(c.winRate) && c.winRate >= 0 && c.winRate <= 100 && c.winRateSource === 'OP.GG' ? c.winRate : null;
    return { ...c, championId: c.id, score, label: INDEX_LABEL, components, reasons, isCurrent: c.id === currentId,
      winRate, winRateNotice: winRate === null ? 'OP.GG 当前页面未提供可核实胜率' : 'OP.GG',
       composition: summarizeComposition([...teammates, c], staticData), profile, confidence: teammates.length >= 2 && composition.rolesUnknown === 0 && profile.known ? 'medium' : 'low' };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || (a.rank ?? Infinity) - (b.rank ?? Infinity));
  return { candidates, best: candidates.find(c => c.score !== null) || null, composition,
    label: INDEX_LABEL, notice: '仅比较当前英雄与共享备选池；阵容适配是职业规则估计，未统计队伍胜率。' };
}

function buildRecommendations({ builds = [], ownItems = null, selectedAugments = [], staticData = bundledStatic } = {}) {
  const metadata=staticData.items||{},known=Array.isArray(ownItems);
  const owned = new Set(list(ownItems).filter(i => i !== null && i !== undefined && !isPoroSnack(i)).map(itemId).filter(Boolean));
  const dependencies=list(selectedAugments).map(a=>augmentDependency(a,ownItems,staticData)).filter(Boolean);
  const ownedPen=new Set([...owned].map(id=>penetrationKind(id,metadata)).filter(Boolean));
  return list(builds).map(group => ({ name: group.name, itemsKnown:known, rows: list(group.rows).map(items => {
    const seen=new Set(),plannedPen=new Set();
    const annotated = list(Array.isArray(items)?items:items?.items).filter(item => item&&itemId(item)&&!isPoroSnack(item, metadata[itemId(item)]?.name)).map(item=>typeof item==='object'?{...item,id:itemId(item)}:{id:itemId(item),name:metadata[itemId(item)]?.name||String(item)}).filter(item=>{
      if([...seen].some(id=>sameItem(id,item.id,metadata)))return false;seen.add(item.id);return true;
    }).map(item => {
      const held=known?ownsItemOrUpgrade(item.id,owned,metadata):null,reasons=itemRestrictions(item.id,selectedAugments,staticData);
      if(!held&&QUEST_REWARDS.has(item.id))reasons.push('强化任务奖励，按任务说明获取；不直接作为购买目标');
      if(!held&&metadata[item.id]?.gold?.purchasable===false)reasons.push('Riot 资料标记为不可直接购买；保留路线展示，需按游戏升级或任务条件获取');
      const dependency=dependencies.find(d=>d.items.some(i=>sameItem(i.id,item.id,metadata)));
      if(dependency?.status==='reward-owned')reasons.push(dependency.reason);
      const family=penetrationKind(item.id,metadata);
      if(family&&!held&&(ownedPen.has(family)||plannedPen.has(family)))reasons.push('已拥有或路线已包含同类百分比穿透成品；作为备选，不重复补购');
      if(family&&!reasons.length)plannedPen.add(family);
      return {...item,owned:held,blocked:reasons.length>0,reasons,dependency:dependency||null};
    });
    const blockedItems=annotated.filter(i=>i.blocked);
    return { items: annotated, next: known ? annotated.find(i => !i.owned&&!i.blocked) || null : null,
      reasons:[...new Set(blockedItems.flatMap(i=>i.reasons))],blockedItems:blockedItems.map(i=>({id:i.id,reasons:i.reasons})) };
  }).filter(row => row.items.length) })).filter(group => group.rows.length);
}

// Bounded purchase rules using observed public equipment, not inferred enemy
// augments, cooldowns, actual damage shares or a predicted win probability.
function matchupRecommendations({ champion = null, ownItems = null, team = [], opponents = [], selectedAugments = [], staticData = bundledStatic, builds = [] } = {}) {
  const metadata = staticData?.items || {};
  const idOf = item => {
    const raw = typeof item === 'object' && item !== null ? item.id ?? item.itemID : item;
    const id = typeof raw === 'number' || typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  };
  const validItems = items => list(items).filter(item => {
    const id = idOf(item); return id !== null && !isPoroSnack(item, metadata[id]?.name);
  });
  const own = validItems(ownItems), owned = new Set(own.map(idOf));
  const text = meta => typeof meta?.description === 'string' ? meta.description : '';
  const antiHeal = meta => /重伤|grievous wounds/i.test(text(meta));
  const stat = (meta, key) => finite(meta?.stats?.[key]) ? Math.max(0, meta.stats[key]) : 0;
  // Explicit finished-item families verified in the bundled Riot metadata.
  // Components (4630/3035), boots and conditional Terminus penetration must
  // not suppress a later completed penetration purchase. Mode IDs are not
  // derived by arithmetic or guessed from a matching display name.
  const finishedPenetration = (_meta,id,kind) => penetrationKind(id,metadata)===kind;
  const hasFinishedPenetration = kind => own.some(item => finishedPenetration(metadata[idOf(item)], idOf(item), kind));
  const hasOwn = predicate => own.some(item => predicate(metadata[idOf(item)]));
  const ownsOrUpgrade = id => ownsItemOrUpgrade(id,owned,metadata);
  const selected=list(selectedAugments).filter(a=>a&&Number.isInteger(a.id));
  const equipment=equipmentContext(ownItems,selected,staticData),features=equipment.effective,profile=championProfile(champion,staticData);
  const hasStatConversion=equipment.conversions.some(rule=>['ad','ap'].includes(rule.from)||['ad','ap'].includes(rule.to));
  const damage = hasStatConversion?'unknown':features.ap >= 60 && features.ad >= 40 ? 'mixed' : features.ap >= 60 ? 'magic' : features.ad >= 40 ? 'physical' : profile.damage;
  const enemyPlayers = list(opponents).filter(p => p && typeof p === 'object');
  const allyPlayers = list(team).filter(p => p && typeof p === 'object' && !p.isSelf);
  const armorHolders = [], resistanceHolders = [], sustainHolders = [], allyAntiHeal = [];
  const heroId = player => Number.isSafeInteger(Number(player?.championId)) && Number(player.championId) > 0 ? Number(player.championId) : null;
  for (const enemy of enemyPlayers) {
    if (!Array.isArray(enemy.items)) continue;
    const armorItems = [], resistanceItems = [], sustainItems = [];
    let purchasedArmor = 0, purchasedMagicResist = 0;
    for (const item of validItems(enemy.items)) {
      const id = idOf(item), meta = metadata[id], count = Number.isInteger(item?.count) && item.count > 0 ? Math.min(item.count, 6) : 1;
      if (stat(meta, 'FlatArmorMod') > 0) { armorItems.push(id); purchasedArmor += stat(meta, 'FlatArmorMod') * count; }
      if (stat(meta, 'FlatSpellBlockMod') > 0) { resistanceItems.push(id); purchasedMagicResist += stat(meta, 'FlatSpellBlockMod') * count; }
      // Tags or positive stat values establish an owned sustain item. Merely
      // being a Support/Mage does not establish healing or a healing augment.
      if (stat(meta, 'PercentLifeStealMod') > 0 || list(meta?.tags).some(tag => tag === 'LifeSteal' || tag === 'SpellVamp')) sustainItems.push(id);
    }
    if (purchasedArmor >= 50) armorHolders.push({ championId: heroId(enemy), itemIds: [...new Set(armorItems)], purchasedArmor });
    if (purchasedMagicResist >= 30) resistanceHolders.push({ championId: heroId(enemy), itemIds: [...new Set(resistanceItems)], purchasedMagicResist });
    if (sustainItems.length) sustainHolders.push({ championId: heroId(enemy), itemIds: [...new Set(sustainItems)] });
  }
  for (const ally of allyPlayers) {
    if (!Array.isArray(ally.items)) continue;
    const ids = validItems(ally.items).map(idOf).filter(id => antiHeal(metadata[id]));
    if (ids.length) allyAntiHeal.push({ championId: heroId(ally), itemIds: [...new Set(ids)] });
  }
  const confirmedAugments = selected.filter(a => ['api','confirmed'].includes(a.confidence) && a.id > 0);
  const dependencies=selected.map(a=>{
    const dependency=augmentDependency(a,ownItems,staticData);return dependency&&{...dependency,tentative:!['api','confirmed'].includes(a.confidence)};
  }).filter(Boolean);
  const cautions=dependencies.filter(d=>d.status!=='missing').map(d=>d.reason);
  if(selected.some(a=>disablesUltimate(a)&&!['api','confirmed'].includes(a.confidence)))cautions.push('「回归基本功」记录尚待确认；若已选择，终极技能依赖效果将无法触发');
  if(hasStatConversion)cautions.push('已选强化包含攻击力/法强转化；装备原始属性不等于当前伤害方向，暂不据此推荐穿透');
  cautions.push(...equipment.conversions.map(rule=>rule.reason));
  if(equipment.conversions.some(a=>equipment.conversions.some(b=>a.augmentId!==b.augmentId&&a.to===b.from)))cautions.push('多个属性转换相连；结算顺序和转化结果未读取，不叠加估算收益');
  if(selected.some(a=>verifiedAugment(a,1346,'Vampirism',['不再能够被友军治疗或获得生命回复'])))cautions.push('「吸血习性」禁用友军治疗和生命回复；不要把回复装备属性当作仍可用的收益');
  const evidence = {
    source: '本机公开对局装备 + Riot 静态装备资料；候选优先保留 OP.GG 顺序',
    ownItemsKnown: Array.isArray(ownItems), damageDirection: damage,
    teamChampionIds: list(team).map(heroId).filter(Boolean), opponentChampionIds: enemyPlayers.map(heroId).filter(Boolean),
    opponentPlayers: enemyPlayers.length, opponentInventoriesKnown: enemyPlayers.filter(p => Array.isArray(p.items)).length,
    allyPlayers: allyPlayers.length, allyInventoriesKnown: allyPlayers.filter(p => Array.isArray(p.items)).length,
    armorHolders, resistanceHolders, sustainHolders, allyAntiHeal,
    confirmedSelectedAugmentIds: [...new Set(confirmedAugments.map(a => a.id))], completeAugments: false,
    usedSelectedAugmentIds:[...new Set([...dependencies.map(d=>d.augmentId),...equipment.conversions.map(rule=>rule.augmentId)])],opponentAugmentsKnown:false,
    statConversions:equipment.conversions,conversionAmountsKnown:false,
  };
  const recommendations = [];
  const baseIds = [],coreIds=[];
  for (const group of list(builds)) for (const row of list(group?.rows)) {
    for (const item of validItems(Array.isArray(row) ? row : row?.items)) {
      const id = idOf(item); if (!baseIds.includes(id)) baseIds.push(id);
      if(group.name==='核心装备'&&!coreIds.includes(id))coreIds.push(id);
    }
  }
  const choose = (predicate, fallbacks = [],preferredIds=baseIds) => [...new Set([...preferredIds, ...fallbacks])].find(id => {
    const meta = metadata[id];
    return meta && typeof meta.name === 'string' && meta.gold?.purchasable === true && !QUEST_REWARDS.has(id) && !isPoroSnack({ id, name: meta.name }) &&
      !ownsOrUpgrade(id) && !itemRestrictions(id,selected,staticData).length &&
      !dependencies.some(d=>d.status==='reward-owned'&&d.items.some(i=>sameItem(i.id,id,metadata))) &&
      !(penetrationKind(id,metadata)&&hasFinishedPenetration(penetrationKind(id,metadata))) && predicate(meta, id);
  });
  const add = (id, reason, priority, {kind='matchup',augmentIds=[],tentative=false}={}) => {
    if (!id) return;
    const existing = recommendations.find(r => r.item.id === id);
    if (existing) { existing.reason += ` ${reason}`;existing.reasons.push(reason);existing.augmentIds=[...new Set([...existing.augmentIds,...augmentIds])];existing.tentative=existing.tentative&&tentative;existing.priority = Math.max(existing.priority, priority); return; }
    const sourceItem=list(builds).flatMap(g=>list(g.rows)).flatMap(row=>Array.isArray(row)?row:list(row?.items)).find(item=>itemId(item)===id);
    recommendations.push({ item: { id, name: metadata[id].name,...(sourceItem?.image?{image:sourceItem.image}:{}) }, reason,reasons:[reason],kind,augmentIds,tentative,confidence: 'rule', priority,
      source: baseIds.includes(id) ? 'OP.GG 路线中的情境候选' : 'Riot 装备资料的情境补充（以商店可购为准）' });
  };
  if (Array.isArray(ownItems)) {
    const synergyIds=coreIds.length?coreIds:baseIds;
    for(const dependency of dependencies.filter(d=>d.status==='missing')){
      const id=choose((_meta,id)=>dependency.missingItemIds.some(required=>sameItem(required,id,metadata)),dependency.missingItemIds);
      add(id,`${dependency.tentative?'若已选记录正确，':'已选'}「${dependency.augmentName}」${dependency.kind==='quest'?'需要任务前置':'需要对应装备'}。${dependency.reason}${dependency.condition?`；${dependency.condition}`:''}`,
        dependency.tentative?58:88,{kind:dependency.kind,augmentIds:[dependency.augmentId],tentative:dependency.tentative});
    }
    for(const augment of selected){
      const tentative=!['api','confirmed'].includes(augment.confidence),prefix=tentative?'若已选记录正确，':'已选',options={kind:'synergy',augmentIds:[augment.id],tentative};
      let candidate=null,reason='';
      if(verifiedAugment(augment,1029,'ARAM_EtherealWeapon',['技能可施加攻击特效'])){
        const desired=features.ap>=60?'FlatMagicDamageMod':features.ad>=40?'FlatPhysicalDamageMod':hasStatConversion?null:profile.damage==='magic'?'FlatMagicDamageMod':profile.damage==='physical'?'FlatPhysicalDamageMod':null;
        if(desired){candidate=choose(meta=>/攻击特效/.test(text(meta))&&stat(meta,desired)>0,desired==='FlatMagicDamageMod'?[3115]:[3153],synergyIds);reason='技能可施加攻击特效；该装备描述含攻击特效，具体触发限制仍按游戏说明';}
      }else if(verifiedAugment(augment,1030,'ARAM_Eureka',['30%法术强度的技能急速'])&&!equipment.conversions.some(rule=>rule.from==='ap')){
        candidate=choose(meta=>stat(meta,'FlatMagicDamageMod')>0,[],synergyIds);reason='法术强度还能按强化描述转为技能急速，优先保留现有 OP.GG 法强路线';
      }else if(verifiedAugment(augment,1048,'ARAM_JeweledGauntlet',['技能可以造成暴击'])&&(features.ad>=40||profile.marksman)){
        candidate=choose(meta=>stat(meta,'FlatCritChanceMod')>0&&stat(meta,'FlatPhysicalDamageMod')>0,[3031],synergyIds);reason='技能能够暴击；当前攻击构筑可考虑继续补充暴击几率';
      }else if(verifiedAugment(augment,1118,'ARAM_CriticalHealing',['治疗和护盾可以暴击'])){
        candidate=choose(meta=>stat(meta,'FlatCritChanceMod')>0,[],synergyIds);reason='治疗和护盾可以暴击；只从已有 OP.GG 路线筛选暴击装备，不据此强行改成攻击构筑';
      }
      const conversion=CONVERSIONS.find(rule=>verifiedAugment(augment,rule.id,rule.key,rule.words));
      if(conversion){
        const sourceStat={ad:'FlatPhysicalDamageMod',ap:'FlatMagicDamageMod',attackSpeed:'PercentAttackSpeedMod',health:'FlatHPPoolMod',mana:'FlatMPPoolMod'}[conversion.from];
        candidate=choose(meta=>stat(meta,sourceStat)>0,[],synergyIds);
        reason=`已有 OP.GG 路线中的${conversion.fromLabel}${conversion.partial?'有一部分':''}会转为${conversion.toLabel}；按转换用途考虑，原属性收益和转换后数值不作保证`;
      }
      if(candidate){add(candidate,`${prefix}「${augment.name}」：${reason}`,tentative?42:60,options);evidence.usedSelectedAugmentIds.push(augment.id);}
    }
    if (damage === 'magic' && resistanceHolders.length && !hasFinishedPenetration('magic')) {
      add(choose((meta, id) => finishedPenetration(meta, id, 'magic'), [3135, 3137]), `已读到 ${resistanceHolders.length} 名对手的装备提供至少 30 魔抗；当前偏法术方向，可考虑百分比法穿。这不是对手总魔抗。`, 80);
    }
    if (damage === 'physical' && armorHolders.length && !hasFinishedPenetration('physical')) {
      const combined=sustainHolders.length&&!hasOwn(antiHeal)&&!allyAntiHeal.length?choose((meta,id)=>finishedPenetration(meta,id,'physical')&&antiHeal(meta),[3033]):null;
      add(combined||choose((meta, id) => finishedPenetration(meta, id, 'physical'), features.crit > 0 ? [3036, 3033, 6694] : [6694, 3036, 3033]), `已读到 ${armorHolders.length} 名对手的装备提供至少 50 护甲；当前偏物理方向，可考虑百分比护甲穿透。这不是对手总护甲。`, 80);
    }
    if (sustainHolders.length && !hasOwn(antiHeal) && ['magic', 'physical'].includes(damage)) {
      const candidates = damage === 'magic' ? [3916, 3165] : [3123, 6609, 3033];
      const id = choose((meta,id) => antiHeal(meta) && stat(meta, damage === 'magic' ? 'FlatMagicDamageMod' : 'FlatPhysicalDamageMod') > 0 &&
        !recommendations.some(rec=>rec.item.id!==id&&penetrationKind(id,metadata)&&penetrationKind(rec.item.id,metadata)===penetrationKind(id,metadata)), candidates);
      const coverage = allyAntiHeal.length ? `队友已有 ${allyAntiHeal.length} 人持有重伤装备，降低补购优先级；实际命中覆盖仍未知。` :
        allyPlayers.length && evidence.allyInventoriesKnown === allyPlayers.length ? '已读取的队友装备中未见重伤；效果仍需命中目标。' : '队友装备信息不完整，不推断队伍缺少重伤。';
      add(id, `对手已持有吸血类装备，可考虑重伤以应对回复。${coverage}`, allyAntiHeal.length ? 35 : 70);
    }
  }
  recommendations.sort((a, b) => b.priority - a.priority);
  evidence.usedSelectedAugmentIds=[...new Set(evidence.usedSelectedAugmentIds)];
  for(const id of baseIds)cautions.push(...itemRestrictions(id,selected,staticData));
  const unknown = !Array.isArray(ownItems) ? '自身装备未读取，暂不生成补购建议。' :
    !enemyPlayers.length || evidence.opponentInventoriesKnown === 0 ? '对手装备未读取，暂不作装备对策判断。' :
      evidence.opponentInventoriesKnown < enemyPlayers.length ? '对手装备仅部分可读，未读取部分保持未知。' : '根据双方已读取的公开装备形成有限规则建议。';
  return { completeAugments: false, recommendations: recommendations.slice(0, 4),dependencies,cautions:[...new Set(cautions)],
    summary: `${unknown}已选海克斯记录不完整，敌方海克斯未知；这些建议不是胜率或最优出装结论。`, evidence };
}

function rerollAdvice({ offeredIds = [], scores = [], augments = [], rerollsRemaining = null, selectedKnown = false } = {}) {
  const unknown = reason => ({ action: 'unknown', reason, label: '信息待确认', confidence: 'low' });
  if (offeredIds.length !== 3) return unknown('等待三个可靠的卡片名称');
  const offered = offeredIds.map(id => augments.find(a => a.id === id));
  if (offered.some(a => !a)) return unknown('部分选项没有资料');
  if (new Set(offered.map(a => a.rarity)).size !== 1) return unknown('选项品质不同，暂不比较刷新收益');
  const remainingKnown = Number.isInteger(rerollsRemaining) && rerollsRemaining >= 0;
  if (remainingKnown && rerollsRemaining === 0) return { action: 'keep', reason: '没有可用刷新次数', label: '倾向保留', confidence: 'medium', canReroll: false, remainingKnown: true };
  const offeredScores = offeredIds.map(id => scores.find(s => s.id === id));
  if (offeredScores.some(s => !finite(s?.score) || s.sourceScope !== 'champion')) return unknown('缺少英雄专属档位，无法形成可靠刷新参考');
  const rarity = offered[0].rarity;
  const comparable = augments.filter(a => a.rarity === rarity && !offeredIds.includes(a.id)).map(a => scores.find(s => s.id === a.id)).filter(s => finite(s?.score) && s.sourceScope === 'champion');
  if (comparable.length < 8) return unknown('同品质已知符文样本不足');
  const best = Math.max(...offeredScores.map(s => s.score));
  const stronger = comparable.filter(s => s.score >= best + 12);
  const partial = !selectedKnown || offeredScores.some(s => s.confidence === 'low' || s.itemsKnown === false);
  const confidence = remainingKnown && !partial ? 'medium' : 'low';
  const caveat = `${remainingKnown ? '' : '刷新次数未读取；仅在仍有刷新次数时适用。'}${!selectedKnown ? '已选记录为自动推断或可能不完整，联动判断仅供参考。' : ''}${offeredScores.some(s => s.itemsKnown === false) ? '装备尚未读取，未计装备联动。' : ''}`;
  const context = { confidence, remainingKnown, canReroll: remainingKnown ? true : null, conditional: !remainingKnown || partial, bestScore: best };
  // Fraction is only coverage of the known dictionary, not a roll probability.
  if (best < 62 && stronger.length >= 5) return { action: 'consider-reroll', label: remainingKnown ? '可考虑刷新' : '有次数可考虑刷新', reason: `${remainingKnown ? '' : '若仍有刷新次数，'}当前最高指数 ${best}；已知同品质列表有 ${stronger.length} 个高出至少 12 分的选项，可考虑刷新。刷新池和概率未知。${caveat}`, ...context, strongerKnownCount: stronger.length };
  return { action: 'keep', label: '倾向保留', reason: `当前已有 ${best} 分选项，倾向保留；指数为规则参考。${caveat}`, ...context };
}
module.exports = { INDEX_LABEL, scoreAugments, rankDraft, buildRecommendations, matchupRecommendations, rerollAdvice, itemFeatures, equipmentContext, championProfile, summarizeComposition, augmentDependency, bundledStatic };
