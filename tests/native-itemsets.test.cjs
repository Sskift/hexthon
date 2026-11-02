const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildItemSet, mergeItemSet } = require('../src/core/native-itemsets.cjs');

const fixture = {
  championId: 103, championName: '阿狸', championKey: 'Ahri',
  buildSuggestions: [
    { name: '出门装', rows: [{ items: [{ id: 1052 }, { id: 2003 }] }, { items: [{ id: 1027 }, { id: 2003 }] }] },
    { name: '核心装备', rows: [{ items: [{ id: 6655 }, { id: 3020 }, { id: 3089 }] }] },
  ],
};

test('a native page preserves OP.GG group, alternative and item order', () => {
  const before = JSON.stringify(fixture);
  const result = buildItemSet(fixture);
  assert.equal(result.title, 'Hexthon · 海克斯 · 阿狸');
  assert.deepEqual(result.associatedChampions, [103]);
  assert.deepEqual(result.associatedMaps, []);
  assert.equal(result.type, 'custom');
  assert.deepEqual(result.blocks.map(block => block.type), ['出门装 · 方案 1', '出门装 · 方案 2', '核心装备']);
  assert.deepEqual(result.blocks.map(block => block.items), [
    [{ id: '1052', count: 1 }, { id: '2003', count: 1 }],
    [{ id: '1027', count: 1 }, { id: '2003', count: 1 }],
    [{ id: '6655', count: 1 }, { id: '3020', count: 1 }, { id: '3089', count: 1 }],
  ]);
  assert.equal(JSON.stringify(fixture), before);
});

test('one deterministic UID survives locale, key and recommendation changes', () => {
  const original = buildItemSet(fixture);
  const changed = buildItemSet({ ...fixture, championName: 'Ahri', championKey: 'Renamed', maxBlocks: 1 });
  assert.equal(original.uid, changed.uid);
  assert.match(original.uid, /^68657874-[a-f0-9]{4}-8[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.notEqual(original.uid, buildItemSet({ ...fixture, championId: 104 }).uid);
});

test('Poro snacks, invalid IDs and duplicates are excluded defensively', () => {
  const result = buildItemSet({ ...fixture, buildSuggestions: [{ name: '核心', rows: [{ items: [
    { id: 2052 }, { id: 220013 }, { id: 999901, name: '魄罗佳肴' },
    { id: 999902, name: 'Poro-Snax' }, { id: 999903, displayName: 'Poro Snack' },
    { id: 1052, count: 2 }, { id: '1052' }, { id: '3020' },
    null, { id: -1 }, { id: 1.5 }, { id: true }, { id: '12bad' }, { id: Number.MAX_SAFE_INTEGER + 1 },
  ] }] }] });
  assert.deepEqual(result.blocks[0].items, [{ id: '1052', count: 1 }, { id: '3020', count: 1 }]);
});

test('at most three viable routes per group and eight blocks are prepared', () => {
  const groups = Array.from({ length: 5 }, (_, group) => ({ name: `组${group}`, rows: Array.from({ length: 6 }, (_, route) => ({ items: [{ id: 1000 + group * 10 + route }] })) }));
  const result = buildItemSet({ ...fixture, buildSuggestions: groups });
  assert.deepEqual(result.blocks.map(block => block.items[0].id), ['1000', '1001', '1002', '1010', '1011', '1012', '1020', '1021']);
  assert.equal(buildItemSet({ ...fixture, buildSuggestions: groups, maxBlocks: 2, maxRowsPerGroup: 1 }).blocks.length, 2);
});

test('unusable data does not create an empty native page', () => {
  assert.equal(buildItemSet(), null);
  assert.equal(buildItemSet({ ...fixture, championId: 'invalid' }), null);
  assert.equal(buildItemSet({ ...fixture, buildSuggestions: null }), null);
  assert.equal(buildItemSet({ ...fixture, buildSuggestions: [{ rows: [{ items: [{ id: 2052 }] }] }] }), null);
});

test('merge preserves all foreign pages and wrapper metadata without mutating input', () => {
  const page = buildItemSet(fixture), otherHero = buildItemSet({ ...fixture, championId: 104 });
  const foreign = { uid: 'user-page', title: page.title, blocks: [{ type: '手工页', items: [] }], customMetadata: { untouched: true } };
  const existing = { accountId: 123, timestamp: 456, itemSets: [foreign, otherHero], extra: { keep: 'everything' } };
  const before = JSON.stringify(existing);
  const merged = mergeItemSet(existing, page);
  assert.equal(JSON.stringify(existing), before);
  assert.deepEqual(merged, { ...existing, itemSets: [foreign, otherHero, page] });
  assert.equal(merged.itemSets[0], foreign);
  assert.equal(merged.itemSets[1], otherHero);
  assert.equal(merged.extra, existing.extra);
});

test('repeated updates replace only the exact owned UID in its existing position', () => {
  const page = buildItemSet(fixture);
  const foreign = { uid: 'other', title: 'Hexthon · 海克斯 · 阿狸', blocks: [] };
  const existing = { accountId: 123, timestamp: 456, itemSets: [foreign, { ...page, extraNativeProperty: true }] };
  const replacement = buildItemSet({ ...fixture, maxBlocks: 1 });
  const once = mergeItemSet(existing, replacement), twice = mergeItemSet(once, replacement);
  assert.equal(twice.itemSets.length, 2);
  assert.equal(twice.itemSets[0], foreign);
  assert.deepEqual(twice.itemSets[1], { ...replacement, extraNativeProperty: true });
  assert.deepEqual(twice, once);
});

test('malformed client responses or foreign target UIDs stop the merge', () => {
  const page = buildItemSet(fixture), wrapper = { accountId: 123, itemSets: [] };
  for (const input of [null, [], {}, { itemSets: null }, { itemSets: {} }]) assert.throws(() => mergeItemSet(input, page), TypeError);
  assert.throws(() => mergeItemSet(wrapper, null), TypeError);
  assert.throws(() => mergeItemSet(wrapper, { ...page, uid: 'user-owned' }), TypeError);
  assert.throws(() => mergeItemSet(wrapper, { ...page, blocks: [] }), TypeError);
  assert.deepEqual(wrapper.itemSets, []);
});
