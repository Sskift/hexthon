const { load } = require('cheerio');
const fs = require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');

const BASE = 'https://op.gg/zh-cn/lol/modes/aram-mayhem';
const TTL = 6 * 60 * 60 * 1000;
const cleanText = (s) => load(`<div>${String(s || '').replace(/<br\s*\/?\s*>/gi, '\n')}</div>`).text().trim();

// Read inert JSON from Next.js Flight records. Never evaluate a website's JavaScript.
function flightObjects(html) {
  const chunks = [];
  for (const match of html.matchAll(/self\.__next_f\.push\((\[.*?\])\)\s*<\/script>/gs)) {
    try {
      const row = JSON.parse(match[1]);
      if (row[0] === 1 && typeof row[1] === 'string') chunks.push(row[1]);
    } catch { /* Other script content is not data. */ }
  }
  const records = [];
  for (const line of chunks.join('').split('\n')) {
    const match = line.match(/^[\da-f]+:([\[{].*)$/);
    if (match) try { records.push(JSON.parse(match[1])); } catch { /* Non-JSON Flight record. */ }
  }
  return records;
}

function walk(value, visit) {
  if (!value || typeof value !== 'object') return;
  visit(value);
  for (const child of Object.values(value)) walk(child, visit);
}

function safeImage(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname === 'opgg-static.akamaized.net' ? u.href : '';
  } catch { return ''; }
}

function parsePage(html, { kind = 'index', championKey = null, url = BASE, fetchedAt = new Date().toISOString() } = {}) {
  if (!html.includes('aram-mayhem')) throw new Error('返回内容不是 OP.GG 海克斯大乱斗页面');
  const $ = load(html);
  let champions = [], augments = [];
  for (const root of flightObjects(html)) walk(root, (v) => {
    if (!Array.isArray(v) || !v.length) return;
    if (v[0]?.champion_id && v[0]?.key && v.length > champions.length) champions = v;
    if (v[0]?.largeIcon && Number.isInteger(v[0]?.rarity) && v.length > augments.length) augments = v;
  });
  const patch = $('title').text().match(/(\d+\.\d+)\s*版本/)?.[1] ||
    html.match(/\/lol\/(\d+\.\d+)\.\d+\/champion\//)?.[1] || null;
  const builds = [];
  $('table').each((_, table) => {
    const heading = $(table).find('thead').text().trim();
    if (!['核心装备', '出门装', '鞋子'].includes(heading)) return;
    const rows = [];
    $(table).find('tbody tr').each((__, row) => {
      const items = [];
      $(row).find('img[src*="/item/"]').each((___, img) => {
        const image = safeImage($(img).attr('src'));
        const id = Number(image.match(/\/item\/(\d+)\./)?.[1]);
        if (id) items.push({ id, name: $(img).attr('alt') || String(id), image });
      });
      if (items.length) rows.push(items);
    });
    if (rows.length) builds.push({ name: heading, rows });
  });
  if (kind === 'index' && (champions.length < 100 || augments.length < 100)) {
    throw new Error('OP.GG 页面结构或数据不完整，保留已有缓存');
  }
  if (kind === 'augments' && augments.length < 10) throw new Error('未取得该英雄的强化符文数据');
  if (kind === 'build' && !builds.length) throw new Error('未取得该英雄的出装数据');
  return {
    schemaVersion: 1, kind, championKey, patch, fetchedAt, source: 'OP.GG', url,
    scope: 'OP.GG 公开页面；未声明为国服统计',
    champions: champions.map(c => ({ id: c.champion_id, key: c.key, name: c.name,
      image: safeImage(c.image_url), tier: Number.isInteger(c.tier) ? c.tier : null, rank: c.rank ?? null })),
    augments: augments.filter(a => a.name && a.key && Number.isInteger(a.rarity)).map((a, i) => ({ id: a.id, key: a.key, name: a.name,
      tier: Number.isInteger(a.tier) ? a.tier : null, rarity: a.rarity,
      description: cleanText(a.desc), image: safeImage(a.largeIcon), sourceOrder: i,
      // These undocumented fields are intentionally NOT relabelled as win rate or pick rate.
      rawPerformance: a.performance ?? null, rawPopular: a.popular ?? null,
      scope: championKey ? 'champion' : 'global' })),
    builds,
  };
}

function fetchHtml(url) {
  const u = new URL(url);
  if (u.origin !== 'https://op.gg' || !u.pathname.startsWith('/zh-cn/lol/modes/aram-mayhem')) {
    return Promise.reject(new Error('仅允许 OP.GG 海克斯大乱斗数据地址'));
  }
  return new Promise((resolve, reject) => {
    const req = https.get(u, { headers: { 'User-Agent': 'Hexthon/0.1 (+local desktop companion)', Accept: 'text/html' } }, res => {
      if (res.statusCode !== 200) {
        res.resume(); reject(new Error(`OP.GG HTTP ${res.statusCode}，稍后重试`)); return;
      }
      let size = 0; const chunks = [];
      res.on('data', c => { size += c.length; if (size > 12 * 1024 * 1024) req.destroy(new Error('页面超过大小限制')); else chunks.push(c); });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.setTimeout(20000, () => req.destroy(new Error('OP.GG 连接超时')));
    req.on('error', reject);
  });
}

class OpggProvider {
  constructor(cacheDir, seedDir, fetcher = fetchHtml) {
    this.cacheDir = cacheDir; this.seedDir = seedDir; this.fetcher = fetcher;
    this.pending = new Map(); this.backoff = new Map(); this.lastFetch = 0; this.queue = Promise.resolve();
  }
  async read(key) {
    for (const dir of [this.cacheDir, this.seedDir]) {
      try {
        const data = JSON.parse(await fs.readFile(path.join(dir, key + '.json'), 'utf8'));
        if (data.schemaVersion === 1 && Array.isArray(data.augments)) return data;
      } catch { /* No usable cache. */ }
    }
    return null;
  }
  async get(kind = 'index', championKey = null, force = false) {
    if (!['index', 'augments', 'build'].includes(kind)) throw new Error('无效的数据类型');
    if (kind !== 'index' && !/^[a-z0-9]+$/.test(championKey || '')) throw new Error('无效的英雄标识');
    const key = kind === 'index' ? 'index' : `${championKey}-${kind}`;
    if (this.pending.has(key)) return this.pending.get(key);
    const work = this.getOnce(key, kind, championKey, force).finally(() => this.pending.delete(key));
    this.pending.set(key, work); return work;
  }
  async getOnce(key, kind, championKey, force) {
    const cached = await this.read(key);
    if (cached && !force && Date.now() - Date.parse(cached.fetchedAt) < TTL) return { ...cached, cacheStatus: 'cached' };
    if ((this.backoff.get(key) || 0) > Date.now()) {
      if (cached) return { ...cached, cacheStatus: 'stale', warning: '连接暂不可用，正在使用缓存' };
      throw new Error('数据源暂不可用，请两分钟后重试');
    }
    const task = this.queue.catch(() => {}).then(async () => {
      await new Promise(r => setTimeout(r, Math.max(0, 1000 - (Date.now() - this.lastFetch))));
      this.lastFetch = Date.now();
      const url = kind === 'index' ? BASE : `${BASE}/${championKey}/${kind}`;
      const data = parsePage(await this.fetcher(url), { kind, championKey, url });
      await fs.mkdir(this.cacheDir, { recursive: true });
      const filename = path.join(this.cacheDir, key + '.json');
      await fs.writeFile(filename + '.tmp', JSON.stringify(data));
      await fs.rename(filename + '.tmp', filename);
      return { ...data, cacheStatus: 'live' };
    });
    this.queue = task;
    try { return await task; } catch (e) {
      this.backoff.set(key, Date.now() + 120000);
      if (cached) return { ...cached, cacheStatus: 'stale', warning: e.message };
      throw e;
    }
  }
}
module.exports = { BASE, TTL, parsePage, flightObjects, OpggProvider, fetchHtml };
