const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectApiAugments } = require('../src/core/api-augments.cjs');

// These are synthetic raw-field fixtures for the pattern documented in:
// https://github.com/CyberKird/aram-mayhem-helper/blob/master/ingame-app/live_client.py
// That source names Clown College and Brass Blast as examples of the signal.
// IDs/keys/names below are from this repository's OP.GG ahri-augments seed.
// They are not presented as Tencent recordings or proof of complete coverage.
const catalog = [
  { id: 1310, key: 'ARAM_ClownCollege', name: '小丑学院' },
  { id: 3071, key: 'BrassBlast', name: '黄铜爆音' },
  { id: 1, key: 'ARAM_Bees', name: '被动测试项' },
];
function player(one, two = 'SummonerFlash') {
  return { summonerSpells: { summonerSpellOne: { rawDisplayName: one }, summonerSpellTwo: { rawDisplayName: two } } };
}

test('a unique raw spell key maps to the OP.GG augment without screen data', () => {
  assert.deepEqual(detectApiAugments(player('Spell_Augment_ARAM_ClownCollege_Name', 'Spell_Augment_ARAM_BrassBlast_Name'), catalog), {
    augments: [
      { id: 1310, name: '小丑学院', confidence: 'api', evidence: '本机技能字段' },
      { id: 3071, name: '黄铜爆音', confidence: 'api', evidence: '本机技能字段' },
    ], complete: false,
  });
});

test('empty or ordinary spell data stays explicitly incomplete', () => {
  for (const input of [null, undefined, {}, { summonerSpells: [] }, player('SummonerFlash'), player('Spell_Augment_ARAM_Uncatalogued_Name')]) {
    assert.deepEqual(detectApiAugments(input, catalog), { augments: [], complete: false });
  }
});

test('localized display names and unrelated fields cannot establish a selected augment', () => {
  const input = player('SummonerFlash');
  input.summonerSpells.summonerSpellOne.displayName = '小丑学院';
  input.summonerSpells.otherField = { rawDisplayName: 'Spell_Augment_ARAM_BrassBlast_Name' };
  input.abilities = { Q: { rawDisplayName: 'Spell_Augment_ARAM_ClownCollege_Name' } };
  input.items = [{ displayName: '小丑学院', itemID: 1310 }];
  assert.deepEqual(detectApiAugments(input, catalog).augments, []);
});

test('matching uses the entire key and preserves ambiguous or unknown keys as unknown', () => {
  for (const raw of ['Spell_Augment_ARAM_ClownCollegeExtra_Name', 'NotAugment_ARAM_ClownCollege_Name', 'Spell_Augment_ARAM_ClownCollege', 'Spell_Augment_ARAM_Clown_College_Name']) {
    assert.deepEqual(detectApiAugments(player(raw), catalog).augments, []);
  }
  const ambiguous = [...catalog, { id: 99, key: 'clowncollege', name: '不同强化' }];
  assert.deepEqual(detectApiAugments(player('Spell_Augment_ARAM_ClownCollege_Name'), ambiguous).augments, []);
  assert.deepEqual(detectApiAugments(player('Spell_Augment_ARAM_ClownCollege_Name_Augment_ARAM_BrassBlast_Name'), catalog).augments, []);
});

test('the same augment appearing twice produces one result and case is normalized', () => {
  const input = player('Spell_Augment_ARAM_clowncollege_Name', 'Spell_Augment_ARAM_ClownCollege_Name');
  assert.equal(detectApiAugments(input, [...catalog, catalog[0]]).augments.length, 1);
});

test('malformed catalog and spell entries are ignored without modifying the inputs', () => {
  const input = player('Spell_Augment_ARAM_ClownCollege_Name');
  const data = [null, {}, { id: 2, key: null, name: 'bad' }, ...catalog];
  const before = JSON.stringify({ input, data });
  assert.equal(detectApiAugments(input, data).augments.length, 1);
  assert.equal(JSON.stringify({ input, data }), before);
  assert.deepEqual(detectApiAugments(input, null), { augments: [], complete: false });
  assert.deepEqual(detectApiAugments(player({}), catalog).augments, []);
});
