const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LOL_GAME_ID, MAYHEM_FEATURES, createAugmentResolver, GepMayhemTracker } = require('../src/core/gep-mayhem.cjs');

// Payload shape and three English names follow official OW LoL documentation.
// IDs/translations are synthetic test fixtures, not a captured Tencent session.
const catalog = [
  { id: 1, name: '远程测试', englishName: 'Scopier Weapons', key: 'ScopedWeapons' },
  { id: 2, name: '回复测试', englishName: 'Rabble Rousing', aliases: ['Verified Alternate Name'] },
  { id: 3, name: '灵魂测试', englishName: 'Soul Eater' },
];
const update = (key, value) => ({ gameId: LOL_GAME_ID, feature: 'augments', category: 'me', key, value });
const match = (key, value) => ({ gameId: LOL_GAME_ID, feature: 'matchState', category: 'game_info', key, value });
const offers = JSON.stringify({ augment_1: { name: 'Scopier Weapons' }, augment_2: { name: 'Rabble Rousing' }, augment_3: { name: 'Soul Eater' } });
const tracker = () => new GepMayhemTracker({ catalog, now: () => 12345 });

test('the documented LoL payload resolves three named candidates without implying panel visibility or complete picks', () => {
  const value = tracker().observeInfo(LOL_GAME_ID, update('augments', offers));
  assert.deepEqual(value.offers.map(item => item.id), [1, 2, 3]);
  assert.deepEqual(value.offers.map(item => item.slot), [1, 2, 3]);
  assert.equal(value.offersComplete, true);
  assert.equal(value.offerVisibilityKnown, false);
  assert.equal(value.complete, false);
  assert.equal(value.offersObservedAt, 12345);
  assert.deepEqual(MAYHEM_FEATURES, ['augments', 'matchState']);
});

test('display names require exact verified catalog aliases; internal keys and fuzzy names are not identifiers', () => {
  const resolve = createAugmentResolver(catalog);
  assert.equal(resolve(' SCOPIER  WEAPONS ').id, 1);
  assert.equal(resolve('Verified Alternate Name').id, 2);
  assert.equal(resolve('回复测试').id, 2);
  assert.equal(resolve('ScopedWeapons').id, null);
  assert.equal(resolve('Scopier Weapon').id, null);
  assert.equal(resolve('Soul-Eater').id, null);
});

test('English-to-Chinese ambiguity remains unmapped rather than depending on row order', () => {
  const resolve = createAugmentResolver([...catalog, { id: 4, name: '另一强化', aliases: ['Soul Eater'] }]);
  assert.deepEqual(resolve('Soul Eater'), { rawName: 'Soul Eater', id: null, name: null, mapped: false });
  assert.equal(createAugmentResolver([...catalog, catalog[0]])('Scopier Weapons').id, 1);
});

test('partial, duplicate and unmapped candidate sets never become three reliable offers', () => {
  for (const data of [
    { augment_1: { name: 'Soul Eater' } },
    { augment_1: { name: 'Soul Eater' }, augment_2: { name: 'Soul Eater' }, augment_3: { name: 'Rabble Rousing' } },
    { augment_1: { name: 'New unknown augment' }, augment_2: { name: 'Scopier Weapons' }, augment_3: { name: 'Soul Eater' } },
  ]) {
    const result = tracker().observeInfo(LOL_GAME_ID, update('augments', data));
    assert.equal(result.offersComplete, false);
    assert.equal(result.complete, false);
  }
});

test('malformed or reset candidate values clear stale offers without evaluating input', () => {
  for (const value of [null, '', '{}', '{broken', '[]', 7, { augment_1: { name: 2 } }, { augment_4: { name: 'Soul Eater' } }, 'x'.repeat(16385)]) {
    const t = tracker();
    t.observeInfo(LOL_GAME_ID, update('augments', offers));
    const result = t.observeInfo(LOL_GAME_ID, update('augments', value));
    assert.deepEqual(result.offers, []);
    assert.equal(result.offersComplete, false);
  }
});

test('observed selections accumulate and deduplicate, but never claim the current complete loadout', () => {
  const t = tracker();
  t.observeInfo(LOL_GAME_ID, update('augments', offers));
  for (const name of ['Rabble Rousing', 'Rabble Rousing', 'Soul Eater', 'Unknown new augment']) t.observeInfo(LOL_GAME_ID, update('picked_augment', name));
  const result = t.snapshot();
  assert.deepEqual(result.observedPicks.map(item => item.id), [2, 3]);
  assert.deepEqual(result.unmappedPicks, ['Unknown new augment']);
  assert.deepEqual(result.offers, []);
  assert.equal(result.complete, false);
  assert.equal(result.observedFromMatchStart, false);
});

test('a latest-pick snapshot does not erase candidates because snapshot order is not event order', () => {
  const t = tracker();
  t.observeInfo(LOL_GAME_ID, update('augments', offers));
  const result = t.observeInfo(LOL_GAME_ID, update('picked_augment', 'Soul Eater'), { fromSnapshot: true });
  assert.equal(result.offersComplete, true);
  assert.equal(result.observedPicks.length, 1);
  assert.equal(result.complete, false);
});

test('PBE, unrelated games, other players and inconsistent game IDs cannot become local LoL evidence', () => {
  const t = tracker(), before = t.snapshot();
  for (const [id, data] of [
    [22848, update('augments', offers)], [21570, update('augments', offers)],
    [LOL_GAME_ID, { ...update('augments', offers), gameId: 22848 }],
    [LOL_GAME_ID, { ...update('augments', offers), category: 'enemy' }],
    [LOL_GAME_ID, { ...update('augments', offers), feature: 'live_client_data' }],
    [LOL_GAME_ID, { ...update('augments', offers), key: 'shop_visible' }],
  ]) assert.deepEqual(t.observeInfo(id, data), before);
});

test('a changed match ID clears observations but an initial or repeated ID does not erase current evidence', () => {
  const t = tracker();
  t.observeInfo(LOL_GAME_ID, update('picked_augment', 'Soul Eater'));
  assert.equal(t.observeInfo(LOL_GAME_ID, match('matchId', '123')).observedPicks.length, 1);
  assert.equal(t.observeInfo(LOL_GAME_ID, match('matchId', '123')).observedPicks.length, 1);
  const result = t.observeInfo(LOL_GAME_ID, match('matchId', '124'));
  assert.deepEqual(result.observedPicks, []);
  assert.equal(result.matchId, '124');
  assert.equal(result.complete, false);
});

test('start events and end state clear observations while persistent true does not prove complete history', () => {
  const t = tracker();
  t.observeInfo(LOL_GAME_ID, update('picked_augment', 'Soul Eater'));
  assert.equal(t.observeInfo(LOL_GAME_ID, match('matchStarted', 'true')).observedFromMatchStart, false);
  const started = t.observeGameEvent(LOL_GAME_ID, { gameId: LOL_GAME_ID, feature: 'matchState', key: 'matchStart', value: null });
  assert.deepEqual(started.observedPicks, []);
  assert.equal(started.observedFromMatchStart, true);
  assert.equal(started.complete, false);
  t.observeInfo(LOL_GAME_ID, update('picked_augment', 'Soul Eater'));
  const ended = t.observeInfo(LOL_GAME_ID, match('matchStarted', false));
  assert.deepEqual(ended.observedPicks, []);
  assert.deepEqual(t.observeInfo(LOL_GAME_ID, update('augments', offers)), ended);
});

test('game exit rejects late updates until a new documented LoL detection', () => {
  const t = tracker();
  t.observeInfo(LOL_GAME_ID, update('picked_augment', 'Soul Eater'));
  const exited = t.gameExited(LOL_GAME_ID);
  assert.deepEqual(exited.observedPicks, []);
  assert.deepEqual(t.observeInfo(LOL_GAME_ID, update('augments', offers)), exited);
  t.gameDetected(22848);
  assert.deepEqual(t.observeInfo(LOL_GAME_ID, update('augments', offers)), exited);
  t.gameDetected(LOL_GAME_ID);
  assert.equal(t.observeInfo(LOL_GAME_ID, update('augments', offers)).offersComplete, true);
});

test('invalid names and account fields cannot leak into state and snapshots cannot mutate internal state', () => {
  const t = tracker();
  const payload = { ...update('picked_augment', 'Soul Eater'), riotId: 'private-name', accountId: 99, commandLine: 'private-token' };
  const before = JSON.stringify(payload);
  const result = t.observeInfo(LOL_GAME_ID, payload);
  assert.doesNotMatch(JSON.stringify(result), /private-|accountId|commandLine|riotId/);
  assert.equal(JSON.stringify(payload), before);
  result.observedPicks[0].id = 666;
  assert.equal(t.snapshot().observedPicks[0].id, 3);
  for (const name of [null, {}, '', 'x'.repeat(161), 'Secret\nInjected']) assert.equal(createAugmentResolver(catalog)(name), null);
});
