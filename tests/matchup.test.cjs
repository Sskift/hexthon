const { test } = require('node:test');
const assert = require('node:assert/strict');
const { liveContext } = require('../src/core/league.cjs');
const { matchupRecommendations, rankDraft, bundledStatic } = require('../src/core/recommendations.cjs');

const item = id => ({ id });
const mage = { id: 103 };
const enemy = items => ({ championId: 86, isSelf: false, items });
const build = ids => [{ name: 'OP.GG 情境路线', rows: [ids.map(item)] }];

test('the live adapter exposes both teams equipment without player identities or Poro snacks', () => {
  const players = [
    { riotId: 'private-self#1234', summonerName: 'private-self', puuid: 'secret-a', team: 'ORDER', rawChampionName: 'game_character_displayname_Ahri', items: [{ itemID: 3157, displayName: '中娅沙漏' }, { itemID: 2052, displayName: '魄罗佳肴' }] },
    { riotId: 'private-ally#2345', summonerName: 'private-ally', puuid: 'secret-b', team: 'ORDER', rawChampionName: 'game_character_displayname_Ashe', items: [{ itemID: 3123, displayName: '死刑宣告', count: 1 }] },
    { riotId: 'private-enemy#3456', summonerName: 'private-enemy', puuid: 'secret-c', team: 'CHAOS', rawChampionName: 'game_character_displayname_Garen', items: [{ itemID: 3065, displayName: '振奋盔甲', count: 1 }, { itemID: 999901, displayName: '魄罗佳肴' }] },
    { riotId: 'unread#4567', team: 'CHAOS', rawChampionName: 'game_character_displayname_Soraka' },
  ];
  const context = liveContext({ riotId: players[0].riotId }, players, Object.values(bundledStatic.champions));
  assert.deepEqual(context.team.map(p => ({ championId: p.championId, isSelf: p.isSelf, items: p.items })), [
    { championId: 103, isSelf: true, items: [{ id: 3157, name: '中娅沙漏', count: 1 }] },
    { championId: 22, isSelf: false, items: [{ id: 3123, name: '死刑宣告', count: 1 }] },
  ]);
  assert.deepEqual(context.opponents.map(p => ({ championId: p.championId, isSelf: p.isSelf, items: p.items })), [
    { championId: 86, isSelf: false, items: [{ id: 3065, name: '振奋盔甲', count: 1 }] },
    { championId: 16, isSelf: false, items: null },
  ]);
  assert.doesNotMatch(JSON.stringify(context), /private-|secret-|riotId|summonerName|puuid/);
  assert.deepEqual(context.ownItems, [{ id: 3157, name: '中娅沙漏', count: 1 }]);
});

test('missing team identification cannot assign every visible player as an ally or enemy', () => {
  const context = liveContext({ riotId: 'self' }, [{ riotId: 'self', items: [] }, { team: 'CHAOS', items: [] }], []);
  assert.deepEqual(context.team, []);
  assert.deepEqual(context.opponents, []);
  assert.deepEqual(context.ownItems, []);
});

test('observed magic-resist purchases favor a known OP.GG percent-penetration route for an AP build', () => {
  const result = matchupRecommendations({ champion: mage, ownItems: [item(3157)], opponents: [enemy([item(3102)])], builds: build([3137, 3135]) });
  assert.equal(result.recommendations[0].item.id, 3137);
  assert.equal(result.recommendations[0].confidence, 'rule');
  assert.equal(result.recommendations[0].source, 'OP.GG 路线中的情境候选');
  assert.deepEqual(result.evidence.resistanceHolders, [{ championId: 86, itemIds: [3102], purchasedMagicResist: 40 }]);
  assert.equal(result.completeAugments, false);
  assert.match(result.summary, /不是胜率或最优/);
});

test('a physical build responds to observed armor and never receives the AP penetration rule', () => {
  const result = matchupRecommendations({ champion: { id: 22 }, ownItems: [item(3031)], opponents: [enemy([item(3110), item(3065)])], builds: build([3033, 3135]) });
  assert.deepEqual(result.recommendations.map(r => r.item.id), [3033]);
  assert.equal(result.evidence.damageDirection, 'physical');
  assert.equal(result.evidence.armorHolders[0].purchasedArmor, 75);
});

test('owned sustain items trigger anti-heal and a teammate anti-heal purchase lowers its priority', () => {
  const args = { champion: mage, ownItems: [], opponents: [enemy([item(3153)])], builds: [] };
  const uncovered = matchupRecommendations({ ...args, team: [{ championId: 22, isSelf: false, items: [] }] });
  const covered = matchupRecommendations({ ...args, team: [{ championId: 22, isSelf: false, items: [item(3123)] }] });
  assert.equal(uncovered.recommendations[0].item.id, 3916);
  assert.equal(covered.recommendations[0].item.id, 3916);
  assert.ok(covered.recommendations[0].priority < uncovered.recommendations[0].priority);
  assert.match(covered.recommendations[0].reason, /实际命中覆盖仍未知/);
  assert.deepEqual(covered.evidence.allyAntiHeal, [{ championId: 22, itemIds: [3123] }]);
  assert.deepEqual(covered.evidence.sustainHolders, [{ championId: 86, itemIds: [3153] }]);
});

test('one item satisfying armor penetration and anti-heal retains both observed reasons', () => {
  const result = matchupRecommendations({ champion: { id: 22 }, ownItems: [item(3031)], opponents: [enemy([item(3110), item(3153)])], builds: build([3033]) });
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.recommendations[0].item.id, 3033);
  assert.match(result.recommendations[0].reason, /护甲穿透/);
  assert.match(result.recommendations[0].reason, /吸血类装备/);
});

test('unknown ally equipment is not evidence that the team lacks anti-heal', () => {
  const result = matchupRecommendations({ champion: mage, ownItems: [], opponents: [enemy([item(3072)])], team: [{ championId: 22, items: null }] });
  assert.match(result.recommendations[0].reason, /信息不完整，不推断队伍缺少重伤/);
  assert.equal(result.evidence.allyInventoriesKnown, 0);
});

test('already owned anti-heal or percent penetration prevents duplicate alternatives and components', () => {
  const ap = matchupRecommendations({ champion: mage, ownItems: [item(3165), item(3137)], opponents: [enemy([item(3153), item(3065)])], builds: build([3916, 3135]) });
  assert.deepEqual(ap.recommendations, []);
  const ad = matchupRecommendations({ champion: { id: 22 }, ownItems: [item(3036), item(3123)], opponents: [enemy([item(3110), item(3153)])], builds: build([6694, 3033]) });
  assert.deepEqual(ad.recommendations, []);
});

test('verified finished penetration mode IDs prevent a duplicate base-family purchase', () => {
  for (const id of [223135, 223137, 773135]) {
    const result = matchupRecommendations({ champion: mage, ownItems: [item(id)], opponents: [enemy([item(3065)])], builds: build([3135, 3137]) });
    assert.deepEqual(result.recommendations, [], `owned magic penetration variant ${id}`);
  }
  for (const id of [223033, 223036, 226694, 773035]) {
    const result = matchupRecommendations({ champion: { id: 22 }, ownItems: [item(id)], opponents: [enemy([item(3110)])], builds: build([3036, 6694]) });
    assert.deepEqual(result.recommendations, [], `owned armor penetration variant ${id}`);
  }
});

test('penetration components, boots and conditional attack effects do not suppress finished-item advice', () => {
  for (const id of [4630, 3175, 3302]) {
    const result = matchupRecommendations({ champion: mage, ownItems: [item(id)], opponents: [enemy([item(3065)])], builds: build([4630, 3175, 3135]) });
    assert.deepEqual(result.recommendations.map(r => r.item.id), [3135], `magic component or secondary effect ${id}`);
  }
  for (const id of [3035, 3302, 223302]) {
    const result = matchupRecommendations({ champion: { id: 22 }, ownItems: [item(id)], opponents: [enemy([item(3110)])], builds: build([3035, 3302, 3036]) });
    assert.deepEqual(result.recommendations.map(r => r.item.id), [3036], `physical component or conditional effect ${id}`);
  }
});

test('finished-family recognition requires matching Riot metadata and does not guess from names or percentages', () => {
  const data = { ...bundledStatic, items: { ...bundledStatic.items,
    773135: { ...bundledStatic.items[773135], name: '新装备，语义待验证' },
    9993135: { ...bundledStatic.items[3135], id: 9993135 },
  } };
  for (const id of [773135, 9993135]) {
    const result = matchupRecommendations({ champion: mage, ownItems: [item(id)], opponents: [enemy([item(3065)])], builds: build([3135]), staticData: data });
    assert.deepEqual(result.recommendations.map(r => r.item.id), [3135]);
  }
  const offRole = matchupRecommendations({ champion: { id: 22 }, ownItems: [], opponents: [enemy([item(3110)])], builds: build([4015, 3036]) });
  assert.deepEqual(offRole.recommendations.map(r => r.item.id), [3036], 'An AP item containing armor-penetration text is not an AD finished family');
});

test('unknown own or enemy inventories remain unknown instead of empty observed inventories', () => {
  const noOwn = matchupRecommendations({ champion: mage, ownItems: null, opponents: [enemy([item(3065)])], builds: build([3135]) });
  assert.deepEqual(noOwn.recommendations, []);
  assert.equal(noOwn.evidence.ownItemsKnown, false);
  const noEnemy = matchupRecommendations({ champion: mage, ownItems: [], opponents: [enemy(null)] });
  assert.deepEqual(noEnemy.recommendations, []);
  assert.equal(noEnemy.evidence.opponentPlayers, 1);
  assert.equal(noEnemy.evidence.opponentInventoriesKnown, 0);
  assert.match(noEnemy.summary, /对手装备未读取/);
  const partial = matchupRecommendations({ champion: mage, ownItems: [], opponents: [enemy([item(3065)]), enemy(null)] });
  assert.match(partial.summary, /部分可读/);
  assert.equal(partial.evidence.opponentInventoriesKnown, 1);
});

test('mixed purchased damage and support tags do not invent a certain damage or healing requirement', () => {
  const mixed = matchupRecommendations({ champion: mage, ownItems: [item(3157), item(3072)], opponents: [enemy([item(3065), item(3110), item(3153)])] });
  assert.equal(mixed.evidence.damageDirection, 'mixed');
  assert.deepEqual(mixed.recommendations, []);
  const support = matchupRecommendations({ champion: mage, ownItems: [], opponents: [{ championId: 16, items: [] }, { championId: 37, items: null }] });
  assert.deepEqual(support.evidence.sustainHolders, []);
  assert.deepEqual(support.recommendations, []);
});

test('only purchasable known metadata candidates can be suggested and Poro items never form evidence', () => {
  const data = { ...bundledStatic, items: { ...bundledStatic.items,
    3135: { ...bundledStatic.items[3135], name: '魄罗佳肴' },
    3137: { ...bundledStatic.items[3137], gold: { purchasable: false } },
    999901: { id: 999901, name: 'Poro-Snax', stats: { FlatSpellBlockMod: 100, FlatArmorMod: 100 }, tags: ['LifeSteal'] },
  } };
  const noCandidate = matchupRecommendations({ champion: mage, ownItems: [], opponents: [enemy([item(3065)])], builds: build([999999, 3135, 3137]), staticData: data });
  assert.deepEqual(noCandidate.recommendations, []);
  const noSignal = matchupRecommendations({ champion: mage, ownItems: [], opponents: [enemy([item(2052), item(220013), item(999901)])], staticData: data });
  assert.deepEqual(noSignal.recommendations, []);
  assert.deepEqual(noSignal.evidence.resistanceHolders, []);
  assert.deepEqual(noSignal.evidence.sustainHolders, []);
});

test('partial API augment IDs remain evidence without claiming a live upgrade-equipment integration', () => {
  const args = { champion: { id: 22 }, ownItems: [], opponents: [], builds: build([3031]) };
  const selected = { id: 1336, key: 'ARAM_Upgrade_IE', name: '升级：无尽之刃', confidence: 'api' };
  const confirmed = matchupRecommendations({ ...args, selectedAugments: [selected] });
  assert.deepEqual(confirmed.recommendations, []);
  assert.deepEqual(confirmed.evidence.confirmedSelectedAugmentIds, [1336]);
  assert.equal(confirmed.completeAugments, false);
  assert.deepEqual(matchupRecommendations({ ...args, selectedAugments: [{ ...selected, confidence: 'visual' }] }).evidence.confirmedSelectedAugmentIds, []);
});

test('unidentified teammate slots remain unknown and cannot produce missing-role corrections or medium confidence', () => {
  const result = rankDraft({
    catalog: [{ id: 103, tier: 1, rank: 1 }, { id: 54, tier: 1, rank: 2 }],
    team: [
      { championId: 103, isSelf: true }, { championId: 22, isSelf: false }, { championId: 51, isSelf: false },
      { championId: null, isSelf: false }, { championId: null, isSelf: false },
    ], availableChampionIds: [103, 54], selfId: 103,
  });
  assert.equal(result.composition.count, 4);
  assert.equal(result.composition.unknown, 2);
  for (const candidate of result.candidates) {
    assert.equal(candidate.components.composition, 0);
    assert.equal(candidate.confidence, 'low');
    assert.equal(candidate.composition.count, 5);
    assert.equal(candidate.composition.unknown, 2);
    assert.ok(candidate.reasons.some(reason => reason.includes('部分队友英雄尚未识别')));
    assert.ok(candidate.reasons.every(reason => !/补足当前队伍前排|补充队伍的法术|补充队伍的物理/.test(reason)));
  }
});

test('a missing self ID does not silently discard an unidentified teammate slot', () => {
  const result = rankDraft({ catalog: [{ id: 54, tier: 1 }], team: [{ championId: null }, { championId: null }], selfId: null, availableChampionIds: [54] });
  assert.equal(result.composition.count, 2);
  assert.equal(result.composition.unknown, 2);
  assert.equal(result.candidates[0].components.composition, 0);
  assert.equal(result.candidates[0].confidence, 'low');
});

test('recommendations do not copy identity fields or modify source data', () => {
  const args = { champion: mage, ownItems: [], team: [{ championId: 22, summonerName: 'private-name', items: [] }], opponents: [{ ...enemy([item(3065)]), riotId: 'private-id#123', puuid: 'private-puuid' }], builds: build([3135]) };
  const before = JSON.stringify(args), result = matchupRecommendations(args);
  assert.equal(JSON.stringify(args), before);
  assert.doesNotMatch(JSON.stringify(result), /private-|riotId|puuid|summonerName/);
  assert.ok(result.recommendations.every(r => typeof r.item.id === 'number' && typeof r.item.name === 'string' && r.confidence === 'rule'));
});
