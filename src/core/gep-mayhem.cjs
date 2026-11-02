// An independent consumer of OW-Electron's documented LoL InfoUpdate contract.
// No runtime, game process, network, disk or screen access occurs in this module.
// https://github.com/overwolf/ow-electron-packages-types/blob/main/modules/gep.d.ts
// https://dev.overwolf.com/ow-electron/live-game-data-gep/supported-games/league-of-legends/#augments
const LOL_GAME_ID = 5426;
const MAYHEM_FEATURES = Object.freeze(['augments', 'matchState']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function displayName(value) {
  if (typeof value !== 'string' || value.length > 160 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const name = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  return name || null;
}

function createAugmentResolver(catalog = []) {
  const names = new Map();
  for (const row of Array.isArray(catalog) ? catalog : []) {
    const name = displayName(row?.name);
    if (!name || !Number.isSafeInteger(row.id) || row.id <= 0) continue;
    // English display names must be supplied by a verified bilingual catalog.
    // Internal keys are not display names and must not be used as guessed aliases.
    for (const candidate of [name, row.englishName, ...(Array.isArray(row.aliases) ? row.aliases : [])]) {
      const key = displayName(candidate)?.toLowerCase();
      if (!key) continue;
      const previous = names.get(key);
      if (!names.has(key)) names.set(key, { id: row.id, name });
      else if (previous === null || previous.id !== row.id) names.set(key, null);
    }
  }
  return raw => {
    const rawName = displayName(raw);
    if (!rawName) return null;
    const resolved = names.get(rawName.toLowerCase());
    return { rawName, id: resolved?.id ?? null, name: resolved?.name ?? null, mapped: Boolean(resolved) };
  };
}

function unpackOffers(value, resolve) {
  if (value === null || value === '') return { offers: [], valid: true };
  let data = value;
  if (typeof value === 'string') {
    if (value.length > 16384) return { offers: [], valid: false };
    try { data = JSON.parse(value); } catch { return { offers: [], valid: false }; }
  }
  if (!object(data)) return { offers: [], valid: false };
  const offers = [];
  for (const slot of [1, 2, 3]) {
    if (!Object.hasOwn(data, `augment_${slot}`)) continue;
    const item = data[`augment_${slot}`];
    const resolved = object(item) ? resolve(item.name) : null;
    if (!resolved) return { offers: [], valid: false };
    offers.push({ slot, ...resolved });
  }
  if (Object.keys(data).some(key => !/^augment_[123]$/.test(key))) return { offers: [], valid: false };
  return { offers, valid: true };
}

class GepMayhemTracker {
  constructor({ catalog = [], now = Date.now } = {}) {
    this.resolve = createAugmentResolver(catalog);
    this.now = now;
    this.acceptUpdates = true;
    this.reset('waiting');
  }

  reset(reason = 'reset') {
    this.state = { source: 'overwolf-gep', gameId: LOL_GAME_ID, complete: false,
      matchId: null, matchStarted: null, observedFromMatchStart: false,
      offers: [], offersComplete: false, offersObservedAt: null, offersValid: null,
      offerVisibilityKnown: false, observedPicks: [], unmappedPicks: [],
      lastUpdateAt: null, reason };
    return this.snapshot();
  }

  snapshot() { return structuredClone(this.state); }

  gameDetected(gameId) {
    if (gameId !== LOL_GAME_ID) return this.snapshot();
    this.acceptUpdates = true;
    return this.reset('game-detected');
  }

  gameExited(gameId) {
    if (gameId !== LOL_GAME_ID) return this.snapshot();
    this.acceptUpdates = false;
    return this.reset('game-exit');
  }

  accepts(gameId, data) {
    return this.acceptUpdates && gameId === LOL_GAME_ID && object(data) &&
      (data.gameId === undefined || data.gameId === LOL_GAME_ID);
  }

  observeInfo(gameId, data, { fromSnapshot = false } = {}) {
    if (!this.accepts(gameId, data)) return this.snapshot();
    if (data.feature === 'matchState' && data.category === 'game_info') {
      if (data.key === 'matchId') {
        const value = typeof data.value === 'number' && Number.isSafeInteger(data.value) ? String(data.value) : data.value;
        if (typeof value !== 'string' || !/^\d{1,24}$/.test(value) || /^0+$/.test(value)) return this.snapshot();
        // An ID arriving after offers is merely identifying this session; a
        // changed known ID clears every observation before accepting new data.
        if (this.state.matchId && value !== this.state.matchId) this.reset('match-changed');
        this.state.matchId = value;
      } else if (data.key === 'matchStarted') {
        const started = data.value === true || data.value === 'true' ? true :
          data.value === false || data.value === 'false' ? false : null;
        if (started === null) return this.snapshot();
        if (started === false) { this.reset('match-ended'); this.state.matchStarted = false; }
        else this.state.matchStarted = true;
        // A true persistent value or getInfo snapshot does not prove we saw the
        // start or all selections. Only the discrete matchStart sets that flag.
      } else return this.snapshot();
      this.state.lastUpdateAt = this.now();
      return this.snapshot();
    }
    if (data.feature !== 'augments' || data.category !== 'me' || this.state.matchStarted === false) return this.snapshot();
    if (data.key === 'augments') {
      const result = unpackOffers(data.value, this.resolve);
      this.state.offers = result.offers;
      this.state.offersValid = result.valid;
      this.state.offersComplete = result.valid && result.offers.length === 3 &&
        result.offers.every(item => item.mapped) && new Set(result.offers.map(item => item.id)).size === 3;
      this.state.offersObservedAt = this.now();
    } else if (data.key === 'picked_augment') {
      // GEP gives only the latest picked name. Never treat this history as the
      // full current loadout: missed events and transmuted/replaced picks exist.
      const picked = this.resolve(data.value);
      if (!picked) return this.snapshot();
      if (picked.mapped && !this.state.observedPicks.some(item => item.id === picked.id)) {
        if (this.state.observedPicks.length < 32) this.state.observedPicks.push({ ...picked, confidence: 'gep' });
      } else if (!picked.mapped && !this.state.unmappedPicks.includes(picked.rawName)) {
        if (this.state.unmappedPicks.length < 32) this.state.unmappedPicks.push(picked.rawName);
      }
      // A snapshot's latest pick may precede its current offers; it has no
      // event ordering and therefore must not erase a newer candidate list.
      if (!fromSnapshot) { this.state.offers = []; this.state.offersComplete = false; this.state.offersObservedAt = null; }
    } else return this.snapshot();
    this.state.reason = 'receiving';
    this.state.lastUpdateAt = this.now();
    return this.snapshot();
  }

  observeGameEvent(gameId, data) {
    if (!this.accepts(gameId, data) || data.feature !== 'matchState' || data.key !== 'matchStart') return this.snapshot();
    // Conservatively clear on every real start event, including duplicates.
    // A deprecated matchEnd event is deliberately not a lifecycle dependency.
    this.reset('match-start');
    this.state.matchStarted = true;
    this.state.observedFromMatchStart = true;
    this.state.lastUpdateAt = this.now();
    return this.snapshot();
  }
}

module.exports = { LOL_GAME_ID, MAYHEM_FEATURES, createAugmentResolver, GepMayhemTracker };
