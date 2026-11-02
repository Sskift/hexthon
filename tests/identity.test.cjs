const { test } = require('node:test');
const assert = require('node:assert/strict');
const { liveContext, championFromLive } = require('../src/core/league.cjs');

const champions = [{ id: 103, key: 'Ahri', name: '阿狸' }, { id: 22, key: 'Ashe', name: '艾希' }];
const augments = [{ id: 1310, key: 'ClownCollege', name: '小丑学院' }];
const self = { riotId: 'self#A', summonerName: 'shared-name', team: 'ORDER',
  rawChampionName: 'game_character_displayname_Ahri', items: [{ itemID: 3157 }],
  summonerSpells: { summonerSpellOne: { rawDisplayName: 'Spell_Augment_ARAM_ClownCollege_Name' } } };
const other = { riotId: 'other#B', summonerName: 'shared-name', team: 'CHAOS',
  rawChampionName: 'game_character_displayname_Ashe', items: [{ itemID: 3031 }] };

function assertUnknown(active, players) {
  assert.equal(championFromLive(active, players, champions), null);
  const context = liveContext(active, players, champions, augments);
  assert.equal(context.ownItems, null);
  assert.equal(context.ownUtilityItems, null);
  assert.deepEqual(context.team, []);
  assert.deepEqual(context.opponents, []);
  assert.deepEqual(context.detectedAugments, []);
}

test('exact Riot ID wins over an earlier same-name player for all own gameplay data', () => {
  const active = { riotId: self.riotId, summonerName: self.summonerName };
  const players = [other, self];
  assert.equal(championFromLive(active, players, champions), 103);
  const context = liveContext(active, players, champions, augments);
  assert.deepEqual(context.ownItems.map(item => item.id), [3157]);
  assert.deepEqual(context.detectedAugments.map(augment => augment.id), [1310]);
  assert.deepEqual(context.team.map(player => player.championId), [103]);
  assert.deepEqual(context.opponents.map(player => player.championId), [22]);
  assert.equal(context.team[0].isSelf, true);
});

test('a valid but unmatched Riot ID never falls back to a matching summoner name', () => {
  assertUnknown({ riotId: 'missing#C', summonerName: self.summonerName }, [self]);
});

test('an ambiguous exact Riot ID remains unknown even if one summoner name matches', () => {
  assertUnknown({ riotId: self.riotId, summonerName: self.summonerName },
    [self, { ...other, riotId: self.riotId, summonerName: 'different-name' }]);
});

test('without a Riot ID a unique nonempty summoner name can identify ourselves', () => {
  for (const riotId of [undefined, null, '', '   ']) {
    assert.equal(championFromLive({ riotId, summonerName: self.summonerName }, [self], champions), 103);
  }
});

test('without a Riot ID duplicate or absent summoner names remain unknown', () => {
  assertUnknown({ summonerName: self.summonerName }, [other, self]);
  assertUnknown({}, [self]);
  assertUnknown({ summonerName: '' }, [{ ...self, summonerName: '' }]);
  assertUnknown({ summonerName: '   ' }, [{ ...self, summonerName: '   ' }]);
});

test('the exact Riot ID does not depend on a present or matching legacy summoner name', () => {
  assert.equal(championFromLive({ riotId: self.riotId }, [other, self], champions), 103);
  assert.equal(championFromLive({ riotId: self.riotId, summonerName: other.summonerName }, [self], champions), 103);
});
