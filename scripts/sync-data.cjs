const path = require('node:path');
const fs = require('node:fs/promises');
const { OpggProvider, parsePage, BASE } = require('../src/core/opgg.cjs');
async function main() {
  const seed = path.resolve(__dirname, '../data/seed');
  await fs.mkdir(seed, { recursive: true });
  const useResearch = process.argv.includes('--from-research');
  const provider = new OpggProvider(seed, seed);
  for (const [kind, key, fixture] of [['index', null, 'opgg-index'], ['augments', 'ahri', 'opgg-augments'], ['build', 'ahri', 'opgg-ahri']]) {
    const d = useResearch ? parsePage(await fs.readFile(path.resolve(__dirname, `../.research/${fixture}.html`), 'utf8'), { kind, championKey: key, url: key ? `${BASE}/${key}/${kind}` : BASE }) : await provider.get(kind, key, true);
    const filename = path.join(seed, (key ? `${key}-${kind}` : 'index') + '.json');
    await fs.writeFile(filename, JSON.stringify(d));
    console.log(`${path.basename(filename)}: patch ${d.patch}, ${d.champions.length} champions, ${d.augments.length} augments, ${d.builds.length} build groups`);
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
