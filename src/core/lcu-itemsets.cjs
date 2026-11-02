const https = require('node:https');
const { createHash } = require('node:crypto');
const { replaceOwnedItemSet, itemSetUid } = require('./native-itemsets.cjs');

const IDENTITY_PATH = '/lol-summoner/v1/current-summoner';
const MAX_BODY = 1024 * 1024;
function fail(code) { const error = new Error(code); error.code = code; return error; }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function same(a, b) { return stable(a) === stable(b); }
// Observed in the Tencent client on 2026-11-03: PUT drops priority:false
// and adds preferredItemSlots:[]. Accept only those default representations.
// In particular true, nonempty slots, other fields and array order remain exact.
function canonicalItemSet(page) {
  if (!page || typeof page !== 'object' || Array.isArray(page)) return page;
  const result = { ...page };
  if (result.priority === false) delete result.priority;
  if (Array.isArray(result.preferredItemSlots) && result.preferredItemSlots.length === 0) delete result.preferredItemSlots;
  return result;
}
function sameItemSet(a, b) { return same(canonicalItemSet(a), canonicalItemSet(b)); }
function sameRoundTrip(actual, expected, championId) {
  const uid = itemSetUid(championId), normalize = page => page?.uid === uid ? canonicalItemSet(page) : page;
  return same(actual.map(normalize), expected.map(normalize));
}
function validId(value) { return Number.isSafeInteger(value) && value > 0; }
function identity(raw) {
  // Numeric IDs can overlap between regional clients. Require the stable player
  // UUID too, so a journal from another region/login cannot become rollback authority.
  if (!raw || !validId(raw.summonerId) || (raw.accountId != null && !validId(raw.accountId)) ||
    typeof raw.puuid !== 'string' || !/^[A-Za-z0-9_-]{10,128}$/.test(raw.puuid)) throw fail('ITEMSETS_IDENTITY');
  return { summonerId: raw.summonerId, accountId: raw.accountId ?? raw.summonerId, puuid: raw.puuid };
}
function validateWrapper(wrapper, who) {
  if (!wrapper || typeof wrapper !== 'object' || Array.isArray(wrapper) || wrapper.accountId !== who.summonerId ||
    !Array.isArray(wrapper.itemSets) || wrapper.itemSets.length > 500 ||
    wrapper.itemSets.some(page => !page || typeof page !== 'object' || Array.isArray(page) || typeof page.uid !== 'string' || page.uid.length > 150) ||
    Buffer.byteLength(JSON.stringify(wrapper)) > MAX_BODY) throw fail('ITEMSETS_SCHEMA');
  return wrapper;
}
// Fixed loopback, exact GET identity / GET+PUT numeric own-itemsets endpoints only.
// No caller supplied URL, hostname, method passthrough, redirect or response logging.
function localItemSetRequest({ connection, method, endpoint, body }) {
  if (!connection || !Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535 ||
    typeof connection.password !== 'string' || !connection.password || connection.password.length > 4096 ||
    !((method === 'GET' && endpoint === IDENTITY_PATH) || (/^\/lol-item-sets\/v1\/item-sets\/[1-9]\d{0,15}\/sets$/.test(endpoint) && ['GET', 'PUT'].includes(method)))) return Promise.reject(fail('ITEMSETS_DENIED'));
  const payload = method === 'PUT' ? JSON.stringify(body) : null;
  if (payload && Buffer.byteLength(payload) > MAX_BODY) return Promise.reject(fail('ITEMSETS_SIZE'));
  return new Promise((resolve, reject) => {
    const request = https.request({ hostname: '127.0.0.1', port: connection.port, path: endpoint, method,
      rejectUnauthorized: false, agent: false, headers: { Authorization: 'Basic ' + Buffer.from(`riot:${connection.password}`).toString('base64'),
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) } }, response => {
      if (!((method === 'GET' && response.statusCode === 200) || (method === 'PUT' && [200, 201, 204].includes(response.statusCode)))) {
        response.resume(); reject(fail(`ITEMSETS_HTTP_${response.statusCode}`)); return;
      }
      let bytes = 0, chunks = [];
      response.on('data', chunk => { bytes += chunk.length; if (bytes > MAX_BODY) request.destroy(fail('ITEMSETS_SIZE')); else chunks.push(chunk); });
      response.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); if (method === 'PUT' && !text) return resolve(null);
        try { resolve(JSON.parse(text)); } catch { reject(fail('ITEMSETS_JSON')); } });
      response.on('error', () => reject(fail('ITEMSETS_NETWORK')));
    });
    request.setTimeout(1800, () => request.destroy(fail('ITEMSETS_TIMEOUT')));
    request.on('error', error => reject(fail(/^ITEMSETS_[A-Z_]+$/.test(error.code || '') ? error.code : 'ITEMSETS_NETWORK')));
    request.end(payload);
  });
}

class LcuItemSetsClient {
  constructor({ getConnection, request = localItemSetRequest } = {}) { this.getConnection = getConnection; this.request = request; }
  async open() {
    const connected = this.getConnection?.();
    if (!connected) throw fail('ITEMSETS_UNAVAILABLE');
    const connection = { port: connected.port, password: connected.password };
    const current = () => { const value = this.getConnection?.(); if (!value || value.port !== connection.port || value.password !== connection.password) throw fail('ITEMSETS_IDENTITY_CHANGED'); };
    const request = (method, endpoint, body) => { current(); return this.request({ connection, method, endpoint, body }); };
    const who = identity(await request('GET', IDENTITY_PATH)); current();
    const endpoint = `/lol-item-sets/v1/item-sets/${who.summonerId}/sets`;
    const verify = async () => { current(); if (!same(identity(await request('GET', IDENTITY_PATH)), who)) throw fail('ITEMSETS_IDENTITY_CHANGED'); current(); };
    const read = async () => { await verify(); const wrapper = validateWrapper(await request('GET', endpoint), who); current(); return wrapper; };
    return {
      // Salted digest prevents raw summoner/account/PUUID from entering the journal or UI.
      identityKey: salt => createHash('sha256').update(`${salt}:${stable(who)}`).digest('hex'),
      read,
      replaceOwned: async (championId, expected, page, isCurrent = () => true) => {
        validateWrapper(expected, who);
        const latest = await read();
        if (!same(latest.itemSets, expected.itemSets)) throw fail('ITEMSETS_CONFLICT');
        const next = replaceOwnedItemSet(latest, championId, page);
        await verify();
        if (!isCurrent()) throw fail('ITEMSETS_STALE');
        await request('PUT', endpoint, next);
        const actual = await read();
        if (!sameRoundTrip(actual.itemSets, next.itemSets, championId)) throw fail('ITEMSETS_READBACK');
        return actual.itemSets.find(value => value.uid === itemSetUid(championId)) || null;
      },
    };
  }
}
module.exports = { LcuItemSetsClient, stable, same, sameItemSet };
