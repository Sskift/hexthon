// Riot Data Dragon supplies descriptive champion/item attributes, never win rates.
const fs = require('node:fs/promises');
const path = require('node:path');
const { load } = require('cheerio');
async function main() {
  const seed = JSON.parse(await fs.readFile(path.resolve(__dirname, '../data/seed/index.json'), 'utf8'));
  const version = `${seed.patch}.1`;
  const base = `https://ddragon.leagueoflegends.com/cdn/${version}/data/zh_CN`;
  const [champions, items] = await Promise.all(['champion', 'item'].map(async type => {
    const response = await fetch(`${base}/${type}.json`, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`DataDragon ${type}: HTTP ${response.status}`);
    return response.json();
  }));
  const data = { schemaVersion: 1, version, source: 'Riot Data Dragon', fetchedAt: new Date().toISOString(),
    urls: [`${base}/champion.json`, `${base}/item.json`], champions: {}, items: {} };
  for (const c of Object.values(champions.data)) data.champions[c.key] = {
    id: Number(c.key), key: c.id.toLowerCase(), name: c.name, title: c.title, tags: c.tags,
    resource: c.partype, stats: c.stats, info: c.info,
  };
  for (const [id, item] of Object.entries(items.data)) data.items[id] = {
    id: Number(id), name: item.name, description: load(`<div>${item.description || ''}</div>`).text(),
    tags: item.tags || [], stats: item.stats || {}, from: (item.from || []).map(Number),
    into: (item.into || []).map(Number), gold: item.gold, maps: item.maps,
  };
  const dir = path.resolve(__dirname, '../data/static'); await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'riot.json'), JSON.stringify(data));
  console.log(`Data Dragon ${version}: ${Object.keys(data.champions).length} champions, ${Object.keys(data.items).length} items`);
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
