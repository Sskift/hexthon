const bundledStatic = require('../../data/static/riot.json');
const { isPoroSnack } = require('./league.cjs');
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
  return { ap: /法术强度/.test(text), attack: /攻击力|攻击速度/.test(text), crit: /暴击/.test(text), onHit: /攻击特效/.test(text),
    haste: /技能急速|技能.*冷却/.test(text), health: /最大生命值/.test(text), mana: /法力/.test(text), healing: /治疗|护盾/.test(text) };
}

// Explicit interactions use names/keys from OP.GG and owned item ids from Riot.
// Values below are transparent product rules, not learned outcome probabilities.
const upgradeItems = [
  [/Upgrade_IE|升级：无尽之刃/i, [3031], '无尽之刃'],
  [/Upgrade_Collector|升级：收集者/i, [6676], '收集者'],
  [/Upgrade_ZH|升级：中娅/i, [3157, 2420], '中娅沙漏 / 探索者的护臂'],
  [/Upgrade_Sheen|升级：耀光/i, [3057, 3078, 3100, 6662], '咒刃装备'],
  [/Upgrade_Immolate|升级：献祭/i, [3068, 6664], '日炎 / 璀璨回响'],
  [/Upgrade_Ravenous|升级：贪欲九头蛇/i, [3074], '贪欲九头蛇'],
  [/Upgrade_DeathDance|升级：死亡之舞/i, [6333], '死亡之舞'],
  [/Upgrade_Stormsurge|升级：风暴狂涌/i, [4646], '风暴狂涌'],
  [/Upgrade_SunderedSky|升级：焚天/i, [6610], '焚天'],
  [/Quest_SteelYourHeart|钢化你心/i, [3084], '心之钢（层数需自行核对）'],
];

function scoreAugments({ augments = [], champion = null, ownItems = null, selectedAugments = null, selectedKnown: selectedKnownOverride, championTags, championStats, staticData = bundledStatic, contextKnown = true } = {}) {
  const cid = champion?.id ?? champion?.championId;
  const championMeta = staticData.champions?.[cid] || {};
  const tags = championTags || champion?.tags || championMeta.tags || [];
  const features = itemFeatures(ownItems, staticData);
  const stats = championStats || {};
  const resolvedSelected = list(selectedAugments).map(a => typeof a === 'number' ? augments.find(x => x.id === a) : a);
  const selected = [...new Map(resolvedSelected.filter(Boolean).map(a => [a.id, a])).values()];
  const selectedKnown = Array.isArray(selectedAugments) && resolvedSelected.every(Boolean) && (typeof selectedKnownOverride === 'boolean' ? selectedKnownOverride : true);
  return augments.map(a => {
    const base = Number.isInteger(a.tier) && TIER_SCORE[a.tier] != null ? TIER_SCORE[a.tier] : null;
    if (base === null) return { id: a.id, score: null, label: INDEX_LABEL, components: { tier: null, equipment: 0, augments: 0, champion: 0 }, reasons: ['来源没有可核实的档位'], confidence: 'unknown', sourceScope: a.scope || 'unknown', selectedKnown, itemsKnown: features.known };
    const af = augmentFeatures(a), components = { tier: base, equipment: 0, augments: 0, champion: 0 };
    const reasons = [`OP.GG ${a.scope === 'champion' ? '英雄专属' : '通用'} T${a.tier}`];
    const add = (group, n, reason) => { components[group] += n; reasons.push(reason); };
    if (features.known) {
      const upgrade = upgradeItems.find(([match]) => match.test(`${a.key} ${a.name}`));
      if (upgrade) {
        if (upgrade[1].some(id => features.itemIds.has(id))) add('equipment', 12, `已持有${upgrade[2]}，直接满足装备联动`);
        else add('equipment', -10, `尚未持有${upgrade[2]}，效果需要额外出装投入`);
      }
      if (af.ap && features.ap >= 80) add('equipment', 5, '现有装备偏法强，可延续法术构筑');
      if (af.attack && (features.ad >= 70 || features.attackSpeed >= .4)) add('equipment', 5, '现有装备偏普攻输出');
      if (af.crit && features.crit >= .2) add('equipment', 6, '现有暴击装备与暴击效果联动');
      if (af.onHit && features.onHit) add('equipment', 7, '现有攻击特效装备可参与联动');
      if (af.health && features.health >= 500) add('equipment', 4, '现有生命值装备与生命成长契合');
      if (af.mana && features.mana >= 400) add('equipment', 4, '现有法力装备可支撑法力机制');
      if (af.healing && features.healing) add('equipment', 4, '现有治疗护盾装备形成辅助构筑');
      if (a.key?.includes('Eureka') && (features.ap >= 100 || (finite(stats.abilityPower) && stats.abilityPower >= 150))) add('equipment', 5, '尤里卡可将已有法强转为技能急速');
      if (a.key?.includes('JeweledGauntlet') && features.ap >= 80 && features.crit >= .2) add('equipment', 4, '法强与暴击装备同时存在，支持技能暴击');
      if (/ADAPt/i.test(a.key || '') && features.ad >= 100 && tags.includes('Marksman')) add('equipment', -9, '已投入较多攻击装备，转法强会改变当前普攻构筑');
      if (/escAPADe/i.test(a.key || '') && features.ap >= 100 && tags.includes('Mage')) add('equipment', -9, '已投入较多法强装备，转攻击力会改变当前法术构筑');
    }
    // Champion-class bonuses are deliberately small; OP.GG champion-specific tiers dominate.
    if (af.ap && tags.includes('Mage')) add('champion', 3, '职业标签为法师');
    if (af.attack && tags.includes('Marksman')) add('champion', 3, '职业标签为射手');
    if (af.health && tags.includes('Tank')) add('champion', 3, '职业标签为坦克');
    if (af.healing && tags.includes('Support')) add('champion', 2, '职业标签含辅助，具体技能仍需核对');
    if (af.mana && championMeta.resource && !/法力|Mana/.test(championMeta.resource) && !/NoManaNoProblem/.test(a.key || '')) add('champion', -9, '该英雄不使用法力；法力机制可能不适用');
    for (const chosen of selected) {
      if (chosen.id === a.id) continue;
      const cf = augmentFeatures(chosen);
      if (/EtherealWeapon/.test(chosen.key || '') && af.onHit) add('augments', 6, `与已选「${chosen.name}」的技能触发攻击特效联动`);
      else if (/EtherealWeapon/.test(a.key || '') && cf.onHit) add('augments', 6, `让已选「${chosen.name}」的攻击特效参与技能触发`);
      else if (/JeweledGauntlet|JeweledBracelet/.test(chosen.key || '') && af.crit) add('augments', 5, `与已选「${chosen.name}」的技能暴击方向契合`);
      else if (/CriticalHealing/.test(chosen.key || '') && af.crit) add('augments', 5, `与已选「${chosen.name}」的治疗暴击联动`);
      else if (/Eureka/.test(chosen.key || '') && af.ap) add('augments', 4, `新增法强也可供已选「${chosen.name}」转化急速`);
    }
    components.equipment = Math.max(-18, Math.min(18, components.equipment));
    components.augments = Math.min(12, components.augments);
    components.champion = Math.max(-9, Math.min(6, components.champion));
    if (!features.known) reasons.push('装备尚未读取，本项不计装备修正');
    if (!selectedKnown) reasons.push(selected.length ? '已选记录为自动推断或可能不完整，联动仅作参考' : '已选海克斯记录可能不完整，尚无可用联动记录');
    const confidence = !contextKnown ? 'low' : a.scope === 'champion' && features.known && selectedKnown ? 'medium' : 'low';
    return { id: a.id, score: clamp(Object.values(components).reduce((sum, n) => sum + n, 0)), label: INDEX_LABEL,
      components, reasons, confidence, sourceScope: a.scope || 'global', selectedKnown, itemsKnown: features.known };
  });
}

function championProfile(champion, staticData = bundledStatic) {
  const c = staticData.champions?.[champion?.id ?? champion?.championId] || champion || {};
  const tags = c.tags || [];
  const primary = tags[0];
  let damage = 'unknown';
  if (primary === 'Mage' || ((c.info?.magic || 0) >= 7 && (c.info?.attack || 0) <= 5)) damage = 'magic';
  else if (['Marksman', 'Fighter', 'Assassin'].includes(primary)) damage = 'physical';
  return { tags, damage, frontline: tags.includes('Tank') ? 1 : tags.includes('Fighter') ? .5 : 0, support: tags.includes('Support') ? 1 : 0, known: tags.length > 0 };
}
function summarizeComposition(champions, staticData = bundledStatic) {
  const summary = { physical: 0, magic: 0, frontline: 0, support: 0, unknown: 0, count: champions.length, label: '职业覆盖估计，非实际伤害占比' };
  for (const c of champions) {
    const p = championProfile(c, staticData); summary[p.damage]++; summary.frontline += p.frontline; summary.support += p.support;
  }
  return summary;
}
function rankDraft({ catalog, team = [], availableChampionIds = [], selfId = null, staticData = bundledStatic } = {}) {
  const champions = Array.isArray(catalog) ? catalog : catalog?.champions || [];
  const selfEntry = team.find(p => p.isSelf);
  const currentId = selfEntry?.championId || selfId;
  let removedFallback = false;
  const teammates = team.filter(p => {
    if (p.isSelf) return false;
    if (!selfEntry && !removedFallback && p.championId === currentId) { removedFallback = true; return false; }
    return true;
  }).map(p => champions.find(c => c.id === p.championId) || { id: p.championId }).filter(p => p.id);
  const taken = new Set(teammates.map(c => c.id));
  const composition = summarizeComposition(teammates, staticData);
  const candidates = [...new Set(availableChampionIds)].filter(id => id === currentId || !taken.has(id)).map(id => champions.find(c => c.id === id)).filter(Boolean).map(c => {
    const tierBase = Number.isInteger(c.tier) ? TIER_SCORE[c.tier] ?? null : null;
    const profile = championProfile(c, staticData), reasons = [], components = { tier: tierBase, rank: 0, composition: 0 };
    if (tierBase !== null) reasons.push(`OP.GG T${c.tier}`);
    if (Number.isInteger(c.rank) && c.rank > 0) { components.rank = Math.max(0, Math.round(5 * (1 - (c.rank - 1) / Math.max(1, champions.length - 1)))); reasons.push(`OP.GG 综合排名 ${c.rank}`); }
    if (teammates.length >= 2 && profile.known) {
      if (composition.frontline < 1 && profile.frontline >= 1) { components.composition += 12; reasons.push('补足当前队伍前排'); }
      else if (composition.frontline < .5 && profile.frontline > 0) { components.composition += 5; reasons.push('增加近战承伤角色'); }
      if (composition.magic === 0 && composition.physical >= 2 && profile.damage === 'magic') { components.composition += 9; reasons.push('补充队伍的法术输出方向'); }
      if (composition.physical === 0 && composition.magic >= 2 && profile.damage === 'physical') { components.composition += 9; reasons.push('补充队伍的物理输出方向'); }
      if (composition.support === 0 && composition.frontline >= 1 && profile.support) { components.composition += 4; reasons.push('为已有前排补充辅助功能'); }
      if (composition.support >= 2 && profile.support) { components.composition -= 6; reasons.push('队伍辅助角色较多，需要留意持续输出'); }
    } else reasons.push('队友信息不足，暂不计阵容修正');
    const score = tierBase === null ? null : clamp(tierBase + components.rank + components.composition);
    const winRate = finite(c.winRate) && c.winRate >= 0 && c.winRate <= 100 && c.winRateSource === 'OP.GG' ? c.winRate : null;
    return { ...c, championId: c.id, score, label: INDEX_LABEL, components, reasons, isCurrent: c.id === currentId,
      winRate, winRateNotice: winRate === null ? 'OP.GG 当前页面未提供可核实胜率' : 'OP.GG',
      composition: summarizeComposition([...teammates, c], staticData), profile, confidence: teammates.length >= 2 && composition.unknown === 0 && profile.known ? 'medium' : 'low' };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || (a.rank ?? Infinity) - (b.rank ?? Infinity));
  return { candidates, best: candidates.find(c => c.score !== null) || null, composition,
    label: INDEX_LABEL, notice: '仅比较当前英雄与共享备选池；阵容适配是职业规则估计，未统计队伍胜率。' };
}

function buildRecommendations({ builds = [], ownItems = null, staticData = bundledStatic } = {}) {
  const owned = new Set(list(ownItems).filter(i => i !== null && i !== undefined && !isPoroSnack(i)).map(i => Number(typeof i === 'number' ? i : i.id ?? i.itemID)));
  const ownsOrUpgrade = id => {
    if (owned.has(id)) return true;
    const visited = new Set(), queue = [...(staticData.items?.[id]?.into || [])];
    while (queue.length && visited.size < 50) { const next = queue.shift(); if (owned.has(next)) return true; if (visited.has(next)) continue; visited.add(next); queue.push(...(staticData.items?.[next]?.into || [])); }
    return false;
  };
  return builds.map(group => ({ name: group.name, itemsKnown: Array.isArray(ownItems), rows: group.rows.map(items => {
    const annotated = items.filter(item => !isPoroSnack(item, staticData.items?.[item.id]?.name)).map(item => ({ ...item, owned: Array.isArray(ownItems) ? ownsOrUpgrade(item.id) : null }));
    return { items: annotated, next: Array.isArray(ownItems) ? annotated.find(i => !i.owned) || null : null };
  }).filter(row => row.items.length) })).filter(group => group.rows.length);
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
module.exports = { INDEX_LABEL, scoreAugments, rankDraft, buildRecommendations, rerollAdvice, itemFeatures, championProfile, summarizeComposition, bundledStatic };
