const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildItemSet, replaceOwnedItemSet } = require('../src/core/native-itemsets.cjs');
const { LcuItemSetsClient } = require('../src/core/lcu-itemsets.cjs');
const { NativeItemSetSync, ItemSetJournal } = require('../src/core/native-itemsets-sync.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
const page = (item = 6655, championId = 103) => buildItemSet({ championId, championName: '阿狸', buildSuggestions: [{ name: '核心', rows: [{ items: [item, 3020] }] }] });
const game = { isMayhem: true, phase: 'InProgress', championId: 103, gameId: 1234 };
function fixture(initial = []) {
  let clock = 100000, connected = { port: 12345, password: 'fixture-credential' };
  const who = { summonerId: 123, accountId: 123, puuid: 'fixture-identity', displayName: 'private-name' };
  let wrapper = { accountId: 123, timestamp: 1, itemSets: clone(initial) }, putCount = 0, beforeRequest = null, afterPut = null;
  const paths = [];
  const client = new LcuItemSetsClient({ getConnection: () => connected, request: async call => {
    paths.push([call.method, call.endpoint]); if (beforeRequest) await beforeRequest(call);
    if (call.endpoint === '/lol-summoner/v1/current-summoner') return clone(who);
    assert.equal(call.endpoint, '/lol-item-sets/v1/item-sets/123/sets');
    if (call.method === 'GET') return clone(wrapper);
    assert.equal(call.method, 'PUT'); putCount++; wrapper = clone(call.body); if (afterPut) await afterPut(); return null;
  } });
  let saved = null, saveFailure = false;
  const journal = { load: async () => saved ? clone(saved) : { version: 1, salt: 'a'.repeat(64), entries: [] },
    save: async value => { if (saveFailure) throw Object.assign(new Error('disk'), { code: 'ITEMSETS_JOURNAL' }); saved = clone(value); }, flush: async () => {} };
  const sync = new NativeItemSetSync({ client, journal, now: () => clock });
  return { client, sync, journal, who, paths, get wrapper() { return wrapper; }, set wrapper(value) { wrapper = value; }, get writes() { return putCount; },
    get saved() { return saved; }, advance: () => { clock += 30001; }, changeConnection: () => { connected = { port: 23456, password: 'other' }; },
    before: fn => { beforeRequest = fn; }, after: fn => { afterPut = fn; }, failJournal: () => { saveFailure = true; } };
}
const apply = (f, itemSet = page(), extra = {}) => f.sync.sync({ enabled: true, game, itemSet, ...extra });

test('default disabled, other queue and stale scope cannot write', async () => {
  const f = fixture();
  assert.equal((await f.sync.sync({ game, itemSet: page() })).status, 'inactive');
  assert.equal((await apply(f, page(), { game: { ...game, isMayhem: false } })).status, 'inactive');
  assert.equal((await apply(f, page(), { game: { ...game, phase: 'Lobby' } })).status, 'inactive');
  assert.equal((await apply(f, page(), { isCurrent: () => false })).status, 'stale');
  assert.equal(f.writes, 0);
});

test('read-only probe never writes or reveals identity', async () => {
  const f = fixture([{ uid: 'user', title: 'my page' }]);
  assert.deepEqual(await f.sync.probe(), { status: 'available', readable: true, itemSetCount: 1, writeVerified: false, hotReloadVerified: false });
  assert.equal(f.writes, 0); assert.equal(f.saved, null);
});

test('fresh merge, readback, throttle and content no-op preserve foreign pages and metadata', async () => {
  const foreign = { uid: 'user', title: 'my page', blocks: [{ value: 'keep' }] }, f = fixture([foreign]);
  f.wrapper.extra = { keep: true };
  assert.equal((await apply(f)).status, 'written');
  assert.deepEqual(f.wrapper.itemSets, [foreign, page()]); assert.deepEqual(f.wrapper.extra, { keep: true });
  assert.equal((await apply(f, page(3089))).status, 'throttled');
  f.advance(); assert.equal((await apply(f)).status, 'unchanged'); assert.equal(f.writes, 1);
  f.advance(); assert.equal((await apply(f, page(3089))).status, 'written'); assert.equal(f.writes, 2);
  assert.equal(f.saved.entries[0].before, null); assert.equal(f.saved.entries[0].pending, false);
  assert.equal(f.paths.filter(([method]) => method === 'PUT').length, 2);
  assert.equal(f.paths.some(([, endpoint]) => !endpoint.startsWith('/lol-item-sets/') && endpoint !== '/lol-summoner/v1/current-summoner'), false);
});

test('journal contains only owned pages and salted identity digest', async () => {
  const f = fixture([{ uid: 'user-secret-page', title: 'private-title' }]); await apply(f);
  const serialized = JSON.stringify(f.saved);
  for (const secret of ['fixture-credential', 'fixture-identity', 'private-name', 'summonerId', 'accountId', 'user-secret-page', 'private-title']) assert.equal(serialized.includes(secret), false);
  assert.match(f.saved.entries[0].identityKey, /^[a-f0-9]{64}$/);
});

test('rollback removes only our added page while preserving newly created and edited foreign pages', async () => {
  const f = fixture([{ uid: 'user', title: 'before' }]); await apply(f);
  f.wrapper.itemSets[0].title = 'edited meanwhile'; f.wrapper.itemSets.push({ uid: 'new-tool', title: 'new' });
  const result = await f.sync.restore();
  assert.equal(result.status, 'restored'); assert.equal(result.restored, 1);
  assert.deepEqual(f.wrapper.itemSets, [{ uid: 'user', title: 'edited meanwhile' }, { uid: 'new-tool', title: 'new' }]);
  assert.deepEqual(f.saved.entries, []);
});

test('repeated update rollback restores the original owned page, not the previous update', async () => {
  const original = { ...page(1052), extraNativeProperty: 'preserved' }, f = fixture([original]);
  await apply(f); f.advance(); await apply(f, page(3089)); await f.sync.restore();
  assert.deepEqual(f.wrapper.itemSets, [original]);
});

test('restart reconstructs rollback from isolated disk without raw account data', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hexthon-itemsets-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'journal.json'), f = fixture();
  const first = new NativeItemSetSync({ client: f.client, journalPath: filename });
  assert.equal((await first.sync({ enabled: true, game, itemSet: page() })).status, 'written'); await first.flush();
  const second = new NativeItemSetSync({ client: f.client, journalPath: filename });
  assert.equal((await second.restore()).status, 'restored'); assert.deepEqual(f.wrapper.itemSets, []);
});

test('user editing our page blocks subsequent sync and rollback without deleting their edit', async () => {
  const f = fixture(); await apply(f); f.wrapper.itemSets[0].title = 'my own change';
  f.advance(); assert.equal((await apply(f, page(3089))).status, 'conflict');
  assert.deepEqual(await f.sync.restore(), { status: 'conflict', restored: 0, conflicts: 1, writeVerified: false, hotReloadVerified: false });
  assert.equal(f.wrapper.itemSets[0].title, 'my own change'); assert.equal(f.writes, 1);
});

test('another identity cannot restore this identity journal', async () => {
  const f = fixture(); await apply(f); f.who.puuid = 'different-account';
  assert.equal((await f.sync.restore()).restored, 0); assert.equal(f.writes, 1);
});

test('account changing between read and write aborts without PUT', async () => {
  const f = fixture(); let reads = 0;
  f.before(call => { if (call.method === 'GET' && call.endpoint.endsWith('/sets') && ++reads === 2) f.who.puuid = 'changed-identity'; });
  assert.equal((await apply(f)).code, 'ITEMSETS_IDENTITY_CHANGED'); assert.equal(f.writes, 0);
});

test('connection changing during request invalidates captured capability', async () => {
  const f = fixture(); f.before(call => { if (call.endpoint.endsWith('/sets')) f.changeConnection(); });
  assert.equal((await apply(f)).code, 'ITEMSETS_IDENTITY_CHANGED'); assert.equal(f.writes, 0);
});

test('external collection change between initial and immediately-before-write reads blocks whole PUT', async () => {
  const f = fixture(); let reads = 0;
  f.before(call => { if (call.method === 'GET' && call.endpoint.endsWith('/sets') && ++reads === 2) f.wrapper.itemSets.push({ uid: 'created-concurrently' }); });
  assert.equal((await apply(f)).status, 'conflict'); assert.equal(f.writes, 0);
  assert.deepEqual(f.wrapper.itemSets, [{ uid: 'created-concurrently' }]);
});

test('identity and malformed collection never become empty destructive writes', async () => {
  for (const wrapper of [{ accountId: 999, itemSets: [] }, { accountId: 123 }, { accountId: 123, itemSets: null }]) {
    const f = fixture(); f.wrapper = wrapper;
    assert.equal((await apply(f)).code, 'ITEMSETS_SCHEMA'); assert.equal(f.writes, 0);
  }
  const f = fixture([page(), page()]); assert.equal((await apply(f)).status, 'conflict'); assert.equal(f.writes, 0);
  const unknown = fixture(); delete unknown.who.puuid;
  assert.equal((await apply(unknown)).code, 'ITEMSETS_IDENTITY'); assert.equal(unknown.writes, 0);
});

test('durable journal failure aborts before any client write', async () => {
  const f = fixture(); f.failJournal(); assert.equal((await apply(f)).code, 'ITEMSETS_JOURNAL'); assert.equal(f.writes, 0);
});

test('uncertain write result retains pending rollback and never claims verified', async () => {
  const f = fixture(); let fail = true;
  f.after(() => { if (fail) throw Object.assign(new Error('lost response'), { code: 'ITEMSETS_TIMEOUT' }); });
  assert.equal((await apply(f)).writeVerified, undefined); assert.equal(f.saved.entries[0].pending, true);
  fail = false; assert.equal((await f.sync.restore()).status, 'restored'); assert.deepEqual(f.wrapper.itemSets, []);
});

test('readback mismatch is unverified and rollback refuses unexpected target edit', async () => {
  const f = fixture(); f.after(() => { f.wrapper.itemSets[0].title = 'unexpected remote mutation'; });
  assert.equal((await apply(f)).status, 'unverified'); assert.equal(f.saved.entries[0].pending, true);
  assert.equal((await f.sync.restore()).status, 'conflict'); assert.equal(f.writes, 1);
});

test('stale scope after final identity check aborts even with durable pending journal', async () => {
  const f = fixture(); let valid = true, reads = 0;
  f.before(call => { if (call.endpoint.endsWith('/sets') && ++reads === 2) valid = false; });
  assert.equal((await apply(f, page(), { isCurrent: () => valid })).status, 'stale'); assert.equal(f.writes, 0);
});

test('single in-flight write rejects an overlapping restore and snapshots caller data', async () => {
  const f = fixture(); let release; const gate = new Promise(resolve => { release = resolve; }); let started;
  const observed = new Promise(resolve => { started = resolve; });
  f.before(async call => { if (call.endpoint === '/lol-summoner/v1/current-summoner') { started(); await gate; } });
  const source = page(), operation = apply(f, source); await observed;
  assert.equal((await f.sync.restore()).status, 'busy'); source.title = 'mutated caller'; release();
  assert.equal((await operation).status, 'written'); assert.equal(f.wrapper.itemSets[0].title, page().title);
});

test('corrupt rollback file prevents mutation and is not silently replaced', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hexthon-itemsets-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'journal.json'); await fs.writeFile(filename, '{broken');
  const f = fixture(), sync = new NativeItemSetSync({ client: f.client, journalPath: filename });
  assert.equal((await sync.sync({ enabled: true, game, itemSet: page() })).code, 'ITEMSETS_JOURNAL');
  assert.equal(f.writes, 0); assert.equal(await fs.readFile(filename, 'utf8'), '{broken');
});

test('journal atomic rename failure preserves prior checkpoint and flush exposes failure', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hexthon-itemsets-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'journal.json'), store = new ItemSetJournal(filename);
  const initial = await store.load(); await store.save(initial);
  const broken = new ItemSetJournal(filename, { io: { ...fs, rename: async () => { throw new Error('denied'); } } });
  await assert.rejects(broken.save({ ...initial, salt: 'b'.repeat(64) }), /ITEMSETS_JOURNAL/); await assert.rejects(broken.flush(), /ITEMSETS_JOURNAL/);
  assert.deepEqual(await store.load(), initial);
  assert.deepEqual(await fs.readdir(directory), ['journal.json']);
});

test('narrow replace helper rejects arbitrary target UID and only removes own champion', () => {
  assert.throws(() => replaceOwnedItemSet({ itemSets: [] }, 103, { ...page(), uid: 'foreign' }));
  const other = page(3089, 104);
  assert.deepEqual(replaceOwnedItemSet({ itemSets: [page(), other] }, 103, null).itemSets, [other]);
});

test('explicit preview import works outside a game without relaxing automatic eligibility', async () => {
  const f = fixture();
  assert.equal((await f.sync.importPreview({ itemSet: page() })).status, 'written');
  assert.equal((await f.sync.importPreview({ itemSet: page() })).status, 'unchanged'); assert.equal(f.writes, 1);
  assert.equal((await f.sync.importPreview({ itemSet: page(3089) })).status, 'written');
  assert.equal((await apply(f, page(), { game: { ...game, isMayhem: false } })).status, 'inactive');
  assert.equal((await apply(f)).status, 'throttled');
  assert.equal((await f.sync.restore()).status, 'restored'); assert.deepEqual(f.wrapper.itemSets, []);
});

test('preview import rejects invalid identity, hero association, foreign UID and malformed item blocks', async () => {
  const invalid = [null, { ...page(), uid: 'foreign' }, { ...page(), associatedChampions: [104] }, { ...page(), associatedChampions: [103, 104] },
    { ...page(), title: 'unowned' }, { ...page(), type: 'foreign' }, { ...page(), blocks: [] }, { ...page(), blocks: [{ type: 'x', items: [] }] },
    { ...page(), blocks: [{ type: 'x', items: [{ id: '2052', count: 1 }] }] }, { ...page(), blocks: [{ type: 'x', items: [{ id: '6655', count: -1 }] }] },
    { ...page(), blocks: [{ type: 'x', items: [{ id: 6655, count: 1 }] }] }];
  for (const itemSet of invalid) {
    const f = fixture(); assert.equal((await f.sync.importPreview({ itemSet })).code, 'ITEMSETS_INVALID'); assert.equal(f.paths.length, 0); assert.equal(f.writes, 0);
  }
});

test('preview import still requires fresh scope, durable backup, identity and conflict checks', async () => {
  const stale = fixture(); assert.equal((await stale.sync.importPreview({ itemSet: page(), isCurrent: () => false })).status, 'stale'); assert.equal(stale.writes, 0);
  const disk = fixture(); disk.failJournal(); assert.equal((await disk.sync.importPreview({ itemSet: page() })).code, 'ITEMSETS_JOURNAL'); assert.equal(disk.writes, 0);
  const f = fixture(); await f.sync.importPreview({ itemSet: page() }); f.wrapper.itemSets[0].title = 'my edit';
  assert.equal((await f.sync.importPreview({ itemSet: page(3089) })).status, 'conflict'); assert.equal(f.writes, 1);
});

function normalizeTencentDefaults(f) {
  for (const value of f.wrapper.itemSets) {
    if (value.priority === false) delete value.priority;
    if (value.preferredItemSlots === undefined) value.preferredItemSlots = [];
  }
}
test('observed Tencent default-field normalization passes readback, persists actual page and safely restores', async () => {
  const f = fixture(); f.after(() => normalizeTencentDefaults(f));
  assert.equal((await f.sync.importPreview({ itemSet: page() })).status, 'written');
  assert.equal('priority' in f.saved.entries[0].after, false); assert.deepEqual(f.saved.entries[0].after.preferredItemSlots, []);
  assert.equal((await f.sync.importPreview({ itemSet: page() })).status, 'unchanged'); assert.equal(f.writes, 1);
  assert.equal((await f.sync.restore()).status, 'restored'); assert.deepEqual(f.wrapper.itemSets, []);
});

test('pending pre-normalization journal can roll back the exact normalized page after lost write response', async () => {
  const f = fixture(); let fail = true;
  f.after(() => { normalizeTencentDefaults(f); if (fail) throw Object.assign(new Error('lost response'), { code: 'ITEMSETS_TIMEOUT' }); });
  await f.sync.importPreview({ itemSet: page() });
  assert.equal(f.saved.entries[0].pending, true); assert.equal(f.saved.entries[0].after.priority, false);
  assert.equal('priority' in f.wrapper.itemSets[0], false); assert.deepEqual(f.wrapper.itemSets[0].preferredItemSlots, []);
  fail = false;
  const restarted = new NativeItemSetSync({ client: f.client, journal: f.journal });
  assert.equal((await restarted.restore()).status, 'restored'); assert.deepEqual(f.wrapper.itemSets, []);
});

test('normalization does not hide priority=true, nonempty preferred slots or user content edits', async () => {
  for (const change of [
    value => { value.priority = true; }, value => { value.preferredItemSlots = [{ id: '6655', preferredItemSlot: 1 }]; },
    value => { value.title = 'user edit'; }, value => { value.blocks[0].items.reverse(); }, value => { value.unexpected = false; },
  ]) {
    const f = fixture(); f.after(() => normalizeTencentDefaults(f)); await f.sync.importPreview({ itemSet: page() });
    change(f.wrapper.itemSets[0]);
    assert.equal((await f.sync.restore()).status, 'conflict'); assert.equal(f.writes, 1);
  }
});

test('readback normalization allowance is restricted to our target UID', async () => {
  const foreign = { uid: 'foreign', title: 'untouched', priority: false }, f = fixture([foreign]);
  f.after(() => normalizeTencentDefaults(f));
  assert.equal((await f.sync.importPreview({ itemSet: page() })).status, 'unverified');
});
