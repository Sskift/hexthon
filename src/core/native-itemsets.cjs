const { createHash } = require('node:crypto');

// Native item-set JSON shape reference, independently implemented:
// https://github.com/Sygnano/aram-mayhem-tracker/blob/main/apps/desktop/src-tauri/src/engine/itemsets.rs
// This module prepares data only. It never reads/writes the client or the disk.
// Mayhem's current map is not assumed: an empty associatedMaps list is intentional.

function positiveId(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function itemSetUid(championId) {
  const hex = createHash('sha256').update(`hexthon:native-itemset:champion:${championId}`).digest('hex').slice(0, 32).split('');
  // A Hexthon prefix and custom/version-8 UUID layout. Stable across data refreshes,
  // locale changes and renamed champions, so an update never adds a second page.
  hex.splice(0, 8, ...'68657874');
  hex[12] = '8';
  hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const id = hex.join('');
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

function isPoroSnack(item, id) {
  if (id === 2052 || id === 220013) return true;
  return [item?.name, item?.displayName].some(value => {
    if (typeof value !== 'string') return false;
    const name = value.toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g, '');
    return name === '魄罗佳肴' || /^poro(?:snax|snacks?)$/.test(name);
  });
}

function blockItems(row) {
  const input = Array.isArray(row?.items) ? row.items : Array.isArray(row) ? row : [];
  const items = [], seen = new Set();
  for (const item of input) {
    const id = positiveId(typeof item === 'object' && item !== null ? item.id ?? item.itemID : item);
    if (!id || seen.has(id) || isPoroSnack(item, id)) continue;
    seen.add(id);
    items.push({ id: String(id), count: 1 });
  }
  return items;
}

function limit(value, fallback, maximum) {
  return Number.isInteger(value) && value > 0 ? Math.min(value, maximum) : fallback;
}

function buildItemSet({ championId, championName, championKey, buildSuggestions = [], maxRowsPerGroup = 3, maxBlocks = 8 } = {}) {
  const id = positiveId(championId);
  if (!id || !Array.isArray(buildSuggestions)) return null;
  const rowLimit = limit(maxRowsPerGroup, 3, 3), blockLimit = limit(maxBlocks, 8, 8);
  const blocks = [];
  for (const group of buildSuggestions) {
    if (!Array.isArray(group?.rows)) continue;
    const rows = group.rows.map(blockItems).filter(items => items.length).slice(0, rowLimit);
    const name = typeof group.name === 'string' && group.name.trim() ? group.name.trim() : '推荐装备';
    for (let index = 0; index < rows.length && blocks.length < blockLimit; index++) {
      blocks.push({
        type: rows.length > 1 ? `${name} · 方案 ${index + 1}` : name,
        showIfSummonerSpell: '', hideIfSummonerSpell: '', items: rows[index],
      });
    }
    if (blocks.length >= blockLimit) break;
  }
  if (!blocks.length) return null;
  const hero = [championName, championKey].find(value => typeof value === 'string' && value.trim())?.trim() || String(id);
  return {
    title: `Hexthon · 海克斯 · ${hero}`,
    type: 'custom', map: 'any', mode: 'any', priority: false, sortrank: 1, startedFrom: 'blank',
    associatedChampions: [id], associatedMaps: [], uid: itemSetUid(id), blocks,
  };
}

function mergeItemSet(existingWrapper, itemSet) {
  // Do not turn an unexpected response into an empty collection and overwrite it.
  if (!existingWrapper || typeof existingWrapper !== 'object' || Array.isArray(existingWrapper) || !Array.isArray(existingWrapper.itemSets)) {
    throw new TypeError('现有装备页响应缺少 itemSets 数组，已停止准备写入');
  }
  const championId = itemSet?.associatedChampions?.length === 1 ? positiveId(itemSet.associatedChampions[0]) : null;
  if (!championId || itemSet.uid !== itemSetUid(championId) || !Array.isArray(itemSet.blocks) || !itemSet.blocks.length) {
    throw new TypeError('只能合并由 Hexthon 生成的有效装备页');
  }
  let replaced = false;
  const itemSets = [];
  for (const existing of existingWrapper.itemSets) {
    if (existing?.uid !== itemSet.uid) { itemSets.push(existing); continue; }
    if (!replaced) itemSets.push({ ...existing, ...itemSet });
    replaced = true;
  }
  if (!replaced) itemSets.push(itemSet);
  return { ...existingWrapper, itemSets };
}

module.exports = { buildItemSet, mergeItemSet };
