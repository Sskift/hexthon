function normalize(text) { return String(text || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g, ''); }
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = old;
    }
  }
  return row[b.length];
}
function matchAugments(text, augments) {
  const lines = String(text || '').split(/[\r\n]+/).map(normalize).filter(x => x.length >= 2);
  const matches = [];
  for (const a of augments) {
    const name = normalize(a.name); if (name.length < 2) continue;
    let best = 0, exact = false;
    for (const line of lines) {
      if (line === name || (name.length >= 4 && line.includes(name))) { best = 1; exact = true; break; }
      if (Math.abs(line.length - name.length) <= 2 && name.length >= 4) best = Math.max(best, 1 - distance(line, name) / Math.max(line.length, name.length));
    }
    if (best >= 0.72) matches.push({ id: a.id, name: a.name, confidence: Math.round(best * 100), exact });
  }
  // Fuzzy hits are candidates only. Never silently turn a guess into a confirmed selection.
  return matches.sort((a, b) => b.confidence - a.confidence).slice(0, 8);
}
module.exports = { normalize, distance, matchAugments };
