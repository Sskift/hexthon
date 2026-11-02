const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { itemSetUid, isOwnedItemSet, isImportableItemSet } = require('./native-itemsets.cjs');
const { sameItemSet } = require('./lcu-itemsets.cjs');

const MAX_JOURNAL = 1024 * 1024;
const clone = value => JSON.parse(JSON.stringify(value));
function failure(code) { const error = new Error(code); error.code = code; return error; }
function validateJournal(value) {
  if (!value || value.version !== 1 || !/^[a-f0-9]{64}$/.test(value.salt) || !Array.isArray(value.entries) || value.entries.length > 100) throw failure('ITEMSETS_JOURNAL');
  const keys = new Set();
  for (const entry of value.entries) {
    if (!entry || !/^[a-f0-9]{64}$/.test(entry.identityKey) || !Number.isSafeInteger(entry.championId) || entry.championId < 1 ||
      !Number.isFinite(entry.updatedAt) || typeof entry.pending !== 'boolean' ||
      !isOwnedItemSet(entry.after, entry.championId) ||
      (entry.before !== null && !isOwnedItemSet(entry.before, entry.championId)) ||
      (entry.previous !== null && !isOwnedItemSet(entry.previous, entry.championId))) throw failure('ITEMSETS_JOURNAL');
    const key = `${entry.identityKey}:${entry.championId}`;
    if (keys.has(key)) throw failure('ITEMSETS_JOURNAL'); keys.add(key);
  }
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_JOURNAL) throw failure('ITEMSETS_JOURNAL');
  return value;
}
class ItemSetJournal {
  constructor(filename, { io = fs } = {}) { this.filename = filename; this.io = io; this.queue = Promise.resolve(); this.lastError = null; }
  async load() {
    if (!this.filename) throw failure('ITEMSETS_JOURNAL');
    try {
      if ((await this.io.stat(this.filename)).size > MAX_JOURNAL) throw failure('ITEMSETS_JOURNAL');
      return validateJournal(JSON.parse(await this.io.readFile(this.filename, 'utf8')));
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, salt: randomBytes(32).toString('hex'), entries: [] };
      throw failure('ITEMSETS_JOURNAL');
    }
  }
  save(value) {
    const text = JSON.stringify(validateJournal(value));
    const task = this.queue.then(async () => {
      const temporary = `${this.filename}.${process.pid}.tmp`;
      try {
        await this.io.mkdir(path.dirname(this.filename), { recursive: true });
        await this.io.writeFile(temporary, text, { encoding: 'utf8', mode: 0o600 });
        await this.io.rename(temporary, this.filename); this.lastError = null;
      } catch {
        await this.io.rm(temporary, { force: true }).catch(() => {});
        this.lastError = failure('ITEMSETS_JOURNAL'); throw this.lastError;
      }
    });
    this.queue = task.catch(() => {}); return task;
  }
  async flush() { let observed; do { observed = this.queue; await observed; } while (observed !== this.queue); if (this.lastError) throw this.lastError; }
}
function statusFrom(error) {
  const code = /^ITEMSETS_[A-Z_0-9]+$/.test(error?.code || '') ? error.code : 'ITEMSETS_UNAVAILABLE';
  return { status: ['ITEMSETS_CONFLICT', 'ITEMSETS_DUPLICATE', 'ITEMSETS_EXTERNAL_CHANGE'].includes(code) ? 'conflict' :
    code === 'ITEMSETS_STALE' ? 'stale' : code === 'ITEMSETS_READBACK' ? 'unverified' : 'unavailable', code };
}
function targetPage(wrapper, championId) {
  const matches = wrapper.itemSets.filter(page => page?.uid === itemSetUid(championId));
  if (matches.length > 1) throw failure('ITEMSETS_DUPLICATE');
  const value = matches[0] || null;
  if (value && !isOwnedItemSet(value, championId)) throw failure('ITEMSETS_EXTERNAL_CHANGE');
  return value;
}
function isEligible(game) { return game?.isMayhem === true && ['ChampSelect', 'InProgress'].includes(game.phase) && Number.isSafeInteger(game.championId) && game.championId > 0; }

class NativeItemSetSync {
  constructor({ client, journalPath, journal, now = Date.now, minIntervalMs = 30000 } = {}) {
    this.client = client; this.store = journal || new ItemSetJournal(journalPath); this.now = now;
    this.minIntervalMs = Math.max(5000, minIntervalMs); this.busy = false; this.lastAttempt = -Infinity;
    this.document = null; this.inflight = null;
  }
  async load() { if (!this.document) this.document = await this.store.load(); return this.document; }
  async probe() {
    try { const session = await this.client.open(), wrapper = await session.read(); return { status: 'available', readable: true, itemSetCount: wrapper.itemSets.length, writeVerified: false, hotReloadVerified: false }; }
    catch (error) { return { ...statusFrom(error), readable: false, writeVerified: false, hotReloadVerified: false }; }
  }
  run(operation) {
    if (this.busy) return Promise.resolve({ status: 'busy' });
    this.busy = true;
    const pending = Promise.resolve().then(operation).catch(statusFrom).finally(() => { this.busy = false; if (this.inflight === pending) this.inflight = null; });
    this.inflight = pending; return pending;
  }
  sync({ enabled = false, game, itemSet, isCurrent = () => true } = {}) {
    if (!enabled || !isEligible(game)) return Promise.resolve({ status: 'inactive' });
    return this.#write(itemSet, game.championId, isCurrent, false);
  }
  // Explicit user action from the self-drawn panel. It has no game-mode claim and
  // never changes the automatic sync eligibility rules.
  importPreview({ itemSet, isCurrent = () => true } = {}) {
    const championId = itemSet?.associatedChampions?.length === 1 ? itemSet.associatedChampions[0] : null;
    return this.#write(itemSet, championId, isCurrent, true);
  }
  #write(itemSet, championId, isCurrent, manual) {
    if (!Number.isSafeInteger(championId) || !isImportableItemSet(itemSet, championId)) return Promise.resolve({ status: 'unavailable', code: 'ITEMSETS_INVALID' });
    // Snapshot caller data before asynchronous work; a new champion/build cannot mutate a pending write.
    const page = clone(itemSet);
    if (!manual && this.now() - this.lastAttempt < this.minIntervalMs) return Promise.resolve({ status: 'throttled' });
    return this.run(async () => {
      this.lastAttempt = this.now();
      const document = await this.load(), session = await this.client.open();
      const identityKey = session.identityKey(document.salt);
      const wrapper = await session.read(), current = targetPage(wrapper, championId);
      if (!isCurrent()) throw failure('ITEMSETS_STALE');
      const index = document.entries.findIndex(entry => entry.identityKey === identityKey && entry.championId === championId);
      const existing = index >= 0 ? document.entries[index] : null;
      if (existing && !sameItemSet(current, existing.after) && !(existing.pending && sameItemSet(current, existing.previous))) throw failure('ITEMSETS_EXTERNAL_CHANGE');
      // Preserve any unknown native fields on our own page, as well as all foreign pages.
      const next = { ...(current || {}), ...page };
      if (sameItemSet(current, next)) return { status: 'unchanged', championId, writeVerified: false, hotReloadVerified: false };
      if (!existing && document.entries.length >= 100) throw failure('ITEMSETS_JOURNAL_FULL');
      const entry = { identityKey, championId, before: existing ? existing.before : clone(current), after: clone(next), previous: clone(current), pending: true, updatedAt: this.now() };
      const pending = clone(document);
      if (index >= 0) pending.entries[index] = entry; else pending.entries.push(entry);
      // Durable rollback intent must exist before any client mutation.
      await this.store.save(pending); this.document = pending;
      if (!isCurrent()) throw failure('ITEMSETS_STALE');
      const actualPage = await session.replaceOwned(championId, wrapper, next, isCurrent);
      const completed = clone(pending), row = completed.entries.find(value => value.identityKey === identityKey && value.championId === championId);
      row.pending = false; row.after = clone(actualPage); row.previous = clone(actualPage);
      await this.store.save(completed); this.document = completed;
      return { status: 'written', championId, writeVerified: true, hotReloadVerified: false };
    });
  }
  restore({ championId = null, isCurrent = () => true } = {}) {
    return this.run(async () => {
      const document = await this.load(), session = await this.client.open(), identityKey = session.identityKey(document.salt);
      const entries = document.entries.filter(entry => entry.identityKey === identityKey && (championId === null || entry.championId === championId));
      let restored = 0, conflicts = 0;
      for (const entry of entries) {
        const wrapper = await session.read(), current = targetPage(wrapper, entry.championId);
        if (!isCurrent()) throw failure('ITEMSETS_STALE');
        // Never restore an old whole collection. User edits to our page are also protected.
        if (!sameItemSet(current, entry.after) && !(entry.pending && sameItemSet(current, entry.previous)) && !sameItemSet(current, entry.before)) { conflicts++; continue; }
        if (!sameItemSet(current, entry.before)) await session.replaceOwned(entry.championId, wrapper, entry.before, isCurrent);
        const next = clone(this.document); next.entries = next.entries.filter(value => value.identityKey !== identityKey || value.championId !== entry.championId);
        await this.store.save(next); this.document = next; restored++;
      }
      this.lastAttempt = this.now();
      return { status: conflicts ? 'conflict' : 'restored', restored, conflicts, writeVerified: restored > 0, hotReloadVerified: false };
    });
  }
  async flush() { if (this.inflight) await this.inflight; await this.store.flush(); }
}
module.exports = { NativeItemSetSync, ItemSetJournal, validateJournal, isEligible };
