// OP.GG tier/rank + Riot role/range estimates. These are not damage shares,
// skill-range facts or a probability of winning a team composition.
const list = value => Array.isArray(value) ? value : [];
const finite = value => typeof value === 'number' && Number.isFinite(value);
const validId = value => (typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const clamp = value => Math.max(0, Math.min(100, Math.round(value)));
const TIER_SCORE = [84, 76, 67, 58, 49, 40];
const INDEX_LABEL = '规则匹配指数（非胜率）';

function championProfile(champion, staticData) {
  const c = staticData?.champions?.[champion?.id ?? champion?.championId] || champion || {};
  const tags = list(c.tags).filter(tag => ['Mage', 'Marksman', 'Fighter', 'Assassin', 'Tank', 'Support'].includes(tag));
  let damage = 'unknown';
  if (tags[0] === 'Mage' || (c.info?.magic >= 7 && c.info?.attack <= 5)) damage = 'magic';
  else if (['Marksman', 'Fighter', 'Assassin'].includes(tags[0])) damage = 'physical';
  const attackRange = finite(c.stats?.attackrange) && c.stats.attackrange > 0 ? c.stats.attackrange : null;
  return { tags, damage, frontline: tags.includes('Tank') ? 1 : tags.includes('Fighter') ? .5 : 0,
    support: tags.includes('Support') ? 1 : 0, primarySupport: tags[0] === 'Support',
    attackRange, longRange: attackRange === null ? null : attackRange >= 500,
    marksman: tags.includes('Marksman'), known: tags.length > 0 };
}

function summarizeComposition(champions, staticData) {
  const players = list(champions);
  const summary = { physical: 0, magic: 0, frontline: 0, support: 0, primarySupports: 0, unknown: 0,
    rolesUnknown: 0, rolesKnown: 0, damageKnown: 0, longRange: 0, rangeKnown: 0, marksmen: 0,
    count: players.length, label: '职业与基础普攻射程覆盖估计，非实际伤害占比' };
  for (const champion of players) {
    const p = championProfile(champion, staticData);
    summary[p.damage]++; summary.frontline += p.frontline; summary.support += p.support;
    if (p.primarySupport) summary.primarySupports++;
    if (p.known) summary.rolesKnown++; else summary.rolesUnknown++;
    if (p.damage !== 'unknown') summary.damageKnown++;
    if (p.attackRange !== null) { summary.rangeKnown++; if (p.longRange) summary.longRange++; }
    if (p.marksman) summary.marksmen++;
  }
  return summary;
}

function rankDraft({ catalog, team = [], availableChampionIds = [], selfId = null, staticData = {} } = {}) {
  const champions = Array.isArray(catalog) ? catalog : list(catalog?.champions);
  const players = list(team).filter(p => p && typeof p === 'object');
  const marked = players.filter(p => p.isSelf === true);
  const currentId = marked.length === 1 ? validId(marked[0].championId) : validId(selfId);
  const fallbackMatches = players.filter(p => validId(p.championId) === currentId && currentId);
  const identity = marked.length > 1 ? 'ambiguous' : marked.length === 1 ? 'identified' : fallbackMatches.length === 1 ? 'fallback' : fallbackMatches.length > 1 ? 'ambiguous-fallback' : 'unavailable';
  let removed = false;
  // Replacement removes one player, never every occurrence of the same hero.
  const teammates = players.filter(p => {
    const isSelf = marked.length === 1 ? p === marked[0] : !marked.length && currentId !== null && validId(p.championId) === currentId;
    if (isSelf && !removed) { removed = true; return false; }
    return true;
  }).map(p => champions.find(c => validId(c.id) === validId(p.championId)) || { id: validId(p.championId) });
  const taken = new Set(teammates.map(c => validId(c.id)).filter(Boolean));
  const composition = summarizeComposition(teammates, staticData);
  const identityKnown = ['identified', 'fallback'].includes(identity);
  const coverage = { identity, teammates: teammates.length, rolesKnown: composition.rolesKnown,
    damageDirectionsKnown: composition.damageKnown, attackRangesKnown: composition.rangeKnown,
    completeTeam: identityKnown && players.length === 5 && composition.rolesUnknown === 0,
    selectedAugmentsKnown: false, observedOnly: true };
  const candidates = [...new Set([...list(availableChampionIds), currentId].map(validId).filter(Boolean))]
    .filter(id => id === currentId || !taken.has(id)).map(id => champions.find(c => validId(c.id) === id)).filter(Boolean).map(c => {
      const tierBase = Number.isInteger(c.tier) ? TIER_SCORE[c.tier] ?? null : null;
      const profile = championProfile(c, staticData), reasons = [], benefits = [], tradeoffs = [];
      const components = { tier: tierBase, rank: 0, composition: 0 };
      const add = (points, reason) => { components.composition += points; reasons.push(reason); (points > 0 ? benefits : tradeoffs).push(reason); };
      if (tierBase !== null) reasons.push(`OP.GG T${c.tier}`);
      if (Number.isInteger(c.rank) && c.rank > 0) {
        components.rank = Math.max(0, Math.round(5 * (1 - (c.rank - 1) / Math.max(1, champions.length - 1))));
        reasons.push(`OP.GG 综合排名 ${c.rank}`);
      }
      const sufficient = identityKnown && teammates.length >= 2 && teammates.length <= 4 && composition.rolesUnknown === 0 && profile.known;
      if (sufficient) {
        if (composition.frontline < 1 && profile.frontline >= 1) add(12, '补足当前队伍前排');
        else if (composition.frontline < .5 && profile.frontline > 0) add(5, '增加近战承伤角色');
        if (composition.unknown === 0 && composition.magic === 0 && composition.physical >= 2 && profile.damage === 'magic') add(9, '补充队伍的法术输出方向');
        if (composition.unknown === 0 && composition.physical === 0 && composition.magic >= 2 && profile.damage === 'physical') add(9, '补充队伍的物理输出方向');
        if (composition.support === 0 && composition.frontline >= 1 && profile.support) add(4, '为已有前排补充辅助功能');
        if (composition.primarySupports >= 2 && profile.primarySupport) add(-6, '队伍主职业为辅助的英雄较多，需要留意持续输出');
        if (composition.rangeKnown === teammates.length && composition.longRange === 0 && profile.longRange) add(4, `补充基础普攻射程：${profile.attackRange}（Riot 静态值，不含技能与强化）`);
        if (composition.marksmen === 0 && composition.frontline >= 1 && profile.marksman) add(3, '已有前排，补充射手职业覆盖；持续输出仍取决于构筑');
        if (composition.frontline >= 2 && composition.marksmen === 0 && profile.frontline && !profile.marksman) add(-4, '前排职责已较多且未见射手职业；继续补前排需留意持续输出');
        if (composition.unknown > 0) reasons.push('部分队友的伤害方向无法由职业确定；仅按已知职责和射程补位');
      } else reasons.push(!identityKnown ? '本人槽位尚未可靠确定，不判断替换后的阵容收益' : composition.rolesUnknown > 0 ? '部分队友英雄尚未识别，不判断阵容缺少的职责' : '队友信息不足，暂不计阵容修正');
      components.composition = Math.max(-12, Math.min(20, components.composition));
      const score = tierBase === null ? null : clamp(tierBase + components.rank + components.composition);
      const winRate = finite(c.winRate) && c.winRate >= 0 && c.winRate <= 100 && c.winRateSource === 'OP.GG' ? c.winRate : null;
      return { ...c, championId: c.id, score, label: INDEX_LABEL, components, reasons, benefits, tradeoffs,
        isCurrent: validId(c.id) === currentId, winRate, winRateNotice: winRate === null ? 'OP.GG 当前页面未提供可核实胜率' : 'OP.GG',
        composition: summarizeComposition([...teammates, c], staticData), profile, confidence: sufficient ? 'medium' : 'low',
        scoreDelta: null, coverage };
    });
  const current = candidates.find(c => c.isCurrent) || null;
  for (const candidate of candidates) {
    if (finite(current?.score) && finite(candidate.score)) candidate.scoreDelta = candidate.score - current.score;
    if (!current || candidate.isCurrent || !identityKnown || composition.rolesUnknown || !current.profile.known || !candidate.profile.known) continue;
    if (current.profile.frontline >= 1 && composition.frontline < 1 && candidate.profile.frontline < 1) candidate.tradeoffs.push('换下当前英雄会失去唯一明确的坦克职业前排');
    if (current.profile.marksman && composition.marksmen === 0 && !candidate.profile.marksman) candidate.tradeoffs.push('换下当前英雄后，已知队伍将不再包含射手职业');
    if (composition.rangeKnown === teammates.length && current.profile.longRange && composition.longRange === 0 && candidate.profile.longRange === false) candidate.tradeoffs.push('换下当前英雄后，已知英雄均为短基础普攻射程');
    if (composition.unknown === 0 && current.profile.damage !== 'unknown' && composition[current.profile.damage] === 0 && candidate.profile.damage !== 'unknown' && candidate.profile.damage !== current.profile.damage) candidate.tradeoffs.push(`换下当前英雄会失去唯一明确的${current.profile.damage === 'magic' ? '法术' : '物理'}职业输出方向`);
  }
  candidates.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || Number(b.isCurrent) - Number(a.isCurrent) || (a.rank ?? Infinity) - (b.rank ?? Infinity));
  const best = candidates.find(c => c.score !== null) || null;
  const action = !best ? 'unknown' : !current || !finite(current.score) || best.confidence === 'low' || !identityKnown ? 'compare' : best.isCurrent ? 'keep' : best.scoreDelta >= 5 ? 'consider-swap' : 'close';
  const recommendation = { action, championId: best?.championId ?? null, currentChampionId: currentId,
    scoreDelta: best?.scoreDelta ?? null, reasons: best?.benefits || [], tradeoffs: best?.tradeoffs || [],
    label: action === 'keep' ? '当前英雄更合适' : action === 'consider-swap' ? '可考虑换英雄' : action === 'close' ? '差距较小，可保留当前英雄' : action === 'compare' ? '资料参考，暂不判断换人收益' : '等待英雄资料',
    confidence: best?.confidence || 'low' };
  return { candidates, best, current, composition, coverage, recommendation, label: INDEX_LABEL,
    notice: '仅比较当前英雄与共享备选池，替换本人一格后评估；阵容适配是职业规则估计，未统计队伍胜率，射手覆盖不等于已确认持续输出。' };
}
module.exports = { championProfile, summarizeComposition, rankDraft };
