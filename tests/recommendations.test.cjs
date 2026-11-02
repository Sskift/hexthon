const { test } = require('node:test');
const assert = require('node:assert/strict');
const { draftFromSession, liveContext, LeagueReader } = require('../src/core/league.cjs');
const { scoreAugments, rankDraft, buildRecommendations, rerollAdvice, itemFeatures, bundledStatic } = require('../src/core/recommendations.cjs');
const catalog = require('../data/seed/index.json');

const findAugment = key => ({ ...catalog.augments.find(a => a.key === key), scope: 'champion' });

test('champ-select choices contain own champion and bench, never locked teammates', () => {
  const state = draftFromSession({ localPlayerCellId: 2, myTeam: [{ cellId: 1, championId: 22 }, { cellId: 2, championId: 103 }], benchChampions: [{ championId: 54 }, { championId: 54 }, { championId: 0 }], rerollsRemaining: 1 });
  assert.deepEqual(state.availableChampionIds, [103, 54]);
  assert.deepEqual(state.team, [{ cellId: 1, championId: 22, isSelf: false }, { cellId: 2, championId: 103, isSelf: true }]);
  assert.equal(state.rerollsRemaining, 1);
  assert.equal(draftFromSession(null).rerollsRemaining, null);
});

test('Live context distinguishes absent fields from zero values and strips player identities', () => {
  const result = liveContext({ riotId: 'own#private', championStats: { abilityPower: 0, attackDamage: 80, currentGold: 1234 } }, [
    { riotId: 'own#private', team: 'ORDER', rawChampionName: 'game_character_displayname_Ahri', items: [{ itemID: 3115, displayName: '纳什之牙', count: 1 }] },
    { riotId: 'ally#private', team: 'ORDER', rawChampionName: 'game_character_displayname_Ashe', items: [] },
    { riotId: 'enemy#private', team: 'CHAOS', rawChampionName: 'game_character_displayname_Garen', items: [] },
  ], catalog.champions);
  assert.deepEqual(result.ownItems, [{ id: 3115, name: '纳什之牙', count: 1 }]);
  assert.deepEqual(result.ownChampStats, { abilityPower: 0, attackDamage: 80 });
  assert.equal(result.ownChampStats.armor, undefined);
  assert.equal(result.ownSelectedAugmentIds, null);
  assert.equal(result.team.length, 2);
  assert.equal(JSON.stringify(result).includes('private'), false);
  const absent = liveContext(null, [], catalog.champions);
  assert.equal(absent.ownItems, null); assert.equal(absent.ownChampStats, null);
});

test('League poll carries public draft context and never reuses champion rerolls in a match', async () => {
  const responses = {
    '/lol-gameflow/v1/gameflow-phase': 'ChampSelect',
    '/lol-gameflow/v1/session': { gameData: { queue: { id: 2400 }, gameId: 123 } },
    '/lol-champ-select/v1/session': { localPlayerCellId: 3, myTeam: [{ cellId: 3, championId: 103 }], benchChampions: [{ championId: 54 }], rerollsRemaining: 2 },
  };
  const reader = new LeagueReader({ discover: async () => ({ port: 1234, password: 'local-secret' }), get: async endpoint => {
    if (Object.hasOwn(responses, endpoint)) return responses[endpoint];
    throw new Error('not available');
  } });
  const draft = await reader.poll({}, catalog.champions);
  assert.deepEqual(draft.availableChampionIds, [103, 54]); assert.equal(draft.rerollsRemaining, 2);
  assert.equal(JSON.stringify(draft).includes('local-secret'), false);
  responses['/liveclientdata/activeplayer'] = { riotId: 'own#private', level: 3 };
  responses['/liveclientdata/playerlist'] = [{ riotId: 'own#private', rawChampionName: 'game_character_displayname_Ahri', team: 'ORDER', items: [] }];
  const live = await reader.poll({}, catalog.champions);
  assert.equal(live.phase, 'InProgress'); assert.equal(live.rerollsRemaining, null);
  assert.deepEqual(live.availableChampionIds, [103]); assert.deepEqual(live.ownItems, []);
  assert.equal(live.ownSelectedAugmentIds, null);
});

test('item upgrades reward an actually owned prerequisite and expose missing prerequisites', () => {
  const augment = findAugment('ARAM_Upgrade_IE');
  const score = ownItems => scoreAugments({ augments: [augment], champion: { id: 22 }, ownItems, selectedAugments: [] })[0];
  const owned = score([{ id: 3031 }]), missing = score([]), unknown = score(null);
  assert.ok(owned.score > missing.score);
  assert.ok(owned.reasons.some(r => r.includes('已持有无尽之刃')));
  assert.ok(missing.reasons.some(r => r.includes('尚未持有')));
  assert.equal(unknown.itemsKnown, false); assert.equal(unknown.components.equipment, 0);
});

test('explicit selected augment synergy raises score while conversion mismatch lowers equipment component', () => {
  const weapon = findAugment('ARAM_EtherealWeapon');
  const candidate = { id: 99998, key: 'on-hit-fixture', name: '攻击特效测试', description: '技能施加攻击特效', tier: 3, rarity: 4, scope: 'champion' };
  const score = selectedAugments => scoreAugments({ augments: [candidate, weapon], champion: { id: 103 }, ownItems: [], selectedAugments })[0];
  assert.ok(score([weapon]).score > score([]).score);
  assert.ok(score([weapon]).reasons.some(r => r.includes('虚幻武器')));
  const convert = findAugment('ARAM_escAPADe');
  const mismatch = scoreAugments({ augments: [convert], champion: { id: 103 }, ownItems: [{ id: 3157 }], selectedAugments: [] })[0];
  assert.ok(mismatch.components.equipment < 0);
  assert.ok(mismatch.reasons.some(r => r.includes('改变当前法术构筑')));
});

test('unknown rank and inferred selections do not gain false score or confidence', () => {
  const a = findAugment('ARAM_Eureka');
  const unknown = scoreAugments({ augments: [{ ...a, tier: null }], champion: { id: 103 }, ownItems: [], selectedAugments: [] })[0];
  assert.equal(unknown.score, null); assert.equal(unknown.confidence, 'unknown');
  const inferred = scoreAugments({ augments: [a], champion: { id: 103 }, ownItems: [], selectedAugments: [], selectedKnown: false })[0];
  assert.equal(inferred.selectedKnown, false); assert.equal(inferred.confidence, 'low');
  assert.equal('winRate' in inferred, false); assert.match(inferred.label, /非胜率/);
});

test('draft ranking compares actionable alternatives and fills frontline when OP.GG tiers are equal', () => {
  const champions = [22, 103, 54, 51, 222, 81].map((id, i) => ({ ...catalog.champions.find(c => c.id === id), tier: 2, rank: i + 1 }));
  const team = [{ championId: 22, isSelf: true }, { championId: 51 }, { championId: 222 }, { championId: 81 }];
  const draft = rankDraft({ catalog: { champions }, team, selfId: 22, availableChampionIds: [22, 103, 54, 51] });
  assert.deepEqual(draft.candidates.map(c => c.id).sort((a,b) => a-b), [22, 54, 103]);
  assert.equal(draft.best.id, 54); assert.equal(draft.best.championId, 54);
  assert.equal(draft.best.composition.count, 4); assert.equal(draft.composition.count, 3);
  assert.ok(draft.best.reasons.some(r => r.includes('前排')));
  assert.ok(draft.candidates.every(c => c.winRate === null));
});

test('draft fallback replaces just one matching self entry instead of adding or removing duplicated players', () => {
  const champions = [22, 54].map(id => ({ ...catalog.champions.find(c => c.id === id), tier: 2 }));
  const draft = rankDraft({ catalog: champions, selfId: 22, team: [{ championId: 22 }, { championId: 22 }], availableChampionIds: [22, 54] });
  assert.equal(draft.composition.count, 1);
  assert.ok(draft.candidates.every(c => c.composition.count === 2));
});

test('win rate is never inferred from ranking or unexplained numeric fields', () => {
  const make = extra => rankDraft({ catalog: [{ id: 22, tier: 1, rank: 1, ...extra }], availableChampionIds: [22] }).best;
  assert.equal(make({ rawPerformance: 88, winRate: 88 }).winRate, null);
  assert.equal(make({ winRate: 54.2, winRateSource: 'OP.GG' }).winRate, 54.2);
  assert.equal(make({ winRate: 120, winRateSource: 'OP.GG' }).winRate, null);
});

test('build guidance recognizes owned upgrades and distinguishes unknown inventory', () => {
  const builds = [{ name: '核心装备', rows: [[{ id: 3057, name: '耀光' }, { id: 3031, name: '无尽之刃' }]] }];
  const known = buildRecommendations({ builds, ownItems: [{ id: 3100 }] })[0].rows[0];
  assert.equal(known.items[0].owned, true); assert.equal(known.items[1].owned, false); assert.equal(known.next.id, 3031);
  const unknown = buildRecommendations({ builds })[0];
  assert.equal(unknown.itemsKnown, false); assert.equal(unknown.rows[0].next, null); assert.equal(unknown.rows[0].items[0].owned, null);
});

test('Poro snacks are separated from equipment for both regional ids and translated names', () => {
  const active = { riotId: 'own#local' };
  const items = [
    { itemID: 2052, displayName: 'Poro-Snax' },
    { itemID: 220013, displayName: '魄罗佳肴' },
    { itemID: 999901, displayName: '魄 罗 佳 肴' },
    { itemID: 3115, displayName: '纳什之牙' },
  ];
  const result = liveContext(active, [{ riotId: 'own#local', team: 'ORDER', items }], catalog.champions);
  assert.deepEqual(result.ownItems.map(item => item.id), [3115]);
  assert.deepEqual(result.ownUtilityItems.map(item => item.id), [2052, 220013, 999901]);
  const absent = liveContext(active, [], catalog.champions);
  assert.equal(absent.ownItems, null); assert.equal(absent.ownUtilityItems, null);
  const empty = liveContext(active, [{ riotId: 'own#local', items: [items[1]] }], catalog.champions);
  assert.deepEqual(empty.ownItems, []);
  assert.deepEqual([...itemFeatures([2052, 220013, { id: 999901, name: '魄罗佳肴' }, 3115]).itemIds], [3115]);
});

test('Poro snacks are removed while non-purchasable upgrades remain visible without becoming a purchase', () => {
  const builds = [
    { name: '出门装', rows: [[{ id: 2052, name: '魄罗佳肴' }, { id: 1052, name: '增幅典籍' }]] },
    { name: '核心装备', rows: [[{ id: 220013, name: '魄罗佳肴' }, { id: 999901, name: '魄罗佳肴' }, { id: 999902, name: '升级装备' }]] },
    { name: '无有效装备', rows: [[{ id: 2052 }]] },
  ];
  const staticData = { items: { 999902: { gold: { purchasable: false } } } };
  const result = buildRecommendations({ builds, ownItems: [{ id: 220013 }], staticData });
  assert.deepEqual(result.map(group => group.name), ['出门装', '核心装备']);
  assert.deepEqual(result.map(group => group.rows[0].next?.id??null), [1052, null]);
  assert.equal(result[1].rows[0].items[0].blocked,true);
  assert.deepEqual(result.flatMap(group => group.rows.flatMap(row => row.items.map(item => item.id))), [1052, 999902]);
  const unknown = buildRecommendations({ builds, ownItems: null, staticData });
  assert.ok(unknown.every(group => !group.itemsKnown && group.rows.every(row => row.next === null)));
});

test('reroll references same rarity only, and qualifies incomplete live context', () => {
  const augments = Array.from({ length: 14 }, (_, i) => ({ id: i + 1, rarity: 4 }));
  const scores = augments.map((a, i) => ({ id: a.id, sourceScope: 'champion', score: i < 3 ? 50 : 78 }));
  const context = { augments, scores, offeredIds: [1,2,3], selectedKnown: true, rerollsRemaining: 1 };
  assert.equal(rerollAdvice(context).action, 'consider-reroll');
  assert.match(rerollAdvice(context).reason, /概率未知/);
  const remainingUnknown = rerollAdvice({ ...context, rerollsRemaining: null });
  assert.equal(remainingUnknown.action, 'consider-reroll');
  assert.equal(remainingUnknown.canReroll, null); assert.equal(remainingUnknown.confidence, 'low');
  assert.equal(remainingUnknown.conditional, true); assert.match(remainingUnknown.reason, /若仍有刷新次数/);
  assert.match(remainingUnknown.reason, /刷新次数未读取/);
  const inferred = rerollAdvice({ ...context, selectedKnown: false });
  assert.equal(inferred.action, 'consider-reroll'); assert.equal(inferred.confidence, 'low');
  assert.match(inferred.reason, /可能不完整/);
  assert.equal(rerollAdvice({ ...context, rerollsRemaining: 0 }).action, 'keep');
  assert.equal(rerollAdvice({ ...context, augments: augments.map(a => a.id === 2 ? { ...a, rarity: 8 } : a) }).action, 'unknown');
  assert.equal(rerollAdvice({ ...context, scores: scores.map(s => ({ ...s, sourceScope: 'global' })) }).action, 'unknown');
});

test('automatically inferred synergy is counted as tentative rather than claimed excluded', () => {
  const weapon = findAugment('ARAM_EtherealWeapon');
  const candidate = { id: 99998, key: 'on-hit-fixture', name: '攻击特效测试', description: '技能施加攻击特效', tier: 3, rarity: 4, scope: 'champion' };
  const score = scoreAugments({ augments: [candidate, weapon], champion: { id: 103 }, ownItems: [], selectedAugments: [weapon], selectedKnown: false })[0];
  assert.ok(score.components.augments > 0); assert.equal(score.confidence, 'low');
  assert.ok(score.reasons.some(r => /自动推断.*仅作参考/.test(r)));
  assert.ok(score.reasons.every(r => !r.includes('不计已选联动')));
});

test('missing refresh count never creates available refreshes or probability estimates', () => {
  const augments = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, rarity: 4 }));
  const scores = augments.map(a => ({ id: a.id, score: 82, sourceScope: 'champion', confidence: 'low', itemsKnown: false }));
  const result = rerollAdvice({ offeredIds: [1,2,3], scores, augments });
  assert.equal(result.action, 'keep'); assert.equal(result.canReroll, null);
  assert.equal(result.remainingKnown, false); assert.equal(result.confidence, 'low');
  assert.equal(result.probability, undefined); assert.match(result.reason, /装备尚未读取/);
  assert.equal(rerollAdvice({ offeredIds: [1,2], scores, augments }).action, 'unknown');
});

test('static attributes retain official provenance without performance statistics', () => {
  assert.equal(bundledStatic.source, 'Riot Data Dragon');
  assert.equal(bundledStatic.version, '16.21.1');
  assert.ok(bundledStatic.champions[103].tags.includes('Mage'));
  assert.equal(bundledStatic.items[3031].stats.FlatCritChanceMod, .25);
  assert.ok(bundledStatic.urls.every(url => url.startsWith('https://ddragon.leagueoflegends.com/')));
  assert.equal('winRate' in bundledStatic.champions[103], false);
});
