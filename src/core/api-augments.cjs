// A narrow, capture-free signal from Live Client Data, not a complete augment API.
// Some augment-granted summoner spells expose Augment_ARAM_<key>_ in rawDisplayName.
// Signal reference (independent implementation):
// https://github.com/CyberKird/aram-mayhem-helper/blob/master/ingame-app/live_client.py
// Ordinary passive augments and offered cards do not follow from these fields.

function normalizedKey(key) {
  if (typeof key !== 'string') return null;
  const bare = key.replace(/^ARAM_/i, '');
  return /^[a-z0-9]+$/i.test(bare) ? bare.toLowerCase() : null;
}

function detectApiAugments(ownPlayer, catalogAugments = []) {
  const result = { augments: [], complete: false };
  if (!ownPlayer || typeof ownPlayer !== 'object' || !Array.isArray(catalogAugments)) return result;
  const spells = ownPlayer.summonerSpells;
  if (!spells || typeof spells !== 'object' || Array.isArray(spells)) return result;

  // Duplicate rows for one augment are harmless; one key identifying different
  // IDs is ambiguous and must not be resolved using ordering or a fuzzy match.
  const catalog = new Map();
  for (const augment of catalogAugments) {
    if (!augment || !Number.isInteger(augment.id) || augment.id <= 0 || typeof augment.name !== 'string' || !augment.name.trim()) continue;
    const key = normalizedKey(augment.key);
    if (!key) continue;
    const old = catalog.get(key);
    if (!catalog.has(key)) catalog.set(key, augment);
    else if (old === null || old.id !== augment.id) catalog.set(key, null);
  }

  const seen = new Set();
  for (const slot of ['summonerSpellOne', 'summonerSpellTwo']) {
    const raw = spells[slot]?.rawDisplayName;
    if (typeof raw !== 'string' || raw.length > 512) continue;
    const matches = [...raw.matchAll(/(?:^|_)Augment_ARAM_([a-z0-9]+)_/gi)];
    if (matches.length !== 1) continue;
    const augment = catalog.get(matches[0][1].toLowerCase());
    if (!augment || seen.has(augment.id)) continue;
    seen.add(augment.id);
    result.augments.push({ id: augment.id, name: augment.name, confidence: 'api', evidence: '本机技能字段' });
  }
  return result;
}

module.exports = { detectApiAugments };
