const fs = require('node:fs/promises');
const path = require('node:path');
const LIMIT = 20, MAX_RECORDS = 60, MAX_BYTES = 32768, MAX_AGE_MS = 6 * 60 * 60 * 1000;
const SOURCES = Object.freeze({inferred:1, visual:2, api:3});
const validSource = source => typeof source === 'string' && Object.hasOwn(SOURCES,source);
const idOf = id => Number.isSafeInteger(id) && id > 0 && id <= 10000000 ? id : null;
const matchIdOf = value => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  return typeof value === 'string' && /^[1-9][0-9]{0,24}$/.test(value) ? value : null;
};
const slotOf = slot => {
  if (Number.isInteger(slot) && slot >= 0 && slot < LIMIT) return `hud:${slot}`;
  return typeof slot === 'string' && /^hud:(?:[0-9]|1[0-9])$/.test(slot) ? slot : null;
};
const timeOf = (value, fallback) => {
  const time = typeof value === 'string' ? Date.parse(value) : value;
  return Number.isFinite(time) && time >= 0 && time <= fallback + 60000 ? time : fallback;
};
function sanitizeHistory(value, now = Date.now()) {
  if (!value || value.version !== 1 || !matchIdOf(value.matchId) || !idOf(value.championId) ||
      !Number.isFinite(value.savedAt) || value.savedAt < 0 || value.savedAt > now + 60000 || now - value.savedAt > MAX_AGE_MS ||
      !(value.gameTime === null || Number.isFinite(value.gameTime) && value.gameTime >= 0 && value.gameTime <= 86400) ||
      !Array.isArray(value.entries) || value.entries.length > MAX_RECORDS) return null;
  const entries = [], ids = new Set(), slots = new Set();
  for (const row of value.entries) {
    if (!row || !idOf(row.id) || !validSource(row.source) || ids.has(row.id) || typeof row.active !== 'boolean' ||
        !Number.isFinite(row.observedAt) || row.observedAt < 0 || row.observedAt > now + 60000 ||
        !(row.slot === null || slotOf(row.slot))) return null;
    const slot = slotOf(row.slot);
    if (row.active && slot && slots.has(slot)) return null;
    ids.add(row.id);if (row.active && slot) slots.add(slot);
    entries.push({id:row.id, source:row.source, slot, observedAt:row.observedAt, active:row.active});
  }
  if (entries.filter(e => e.active).length > LIMIT) return null;
  const idList = list => Array.isArray(list) && list.length <= LIMIT && list.every(idOf) && new Set(list).size === list.length ? list.slice() : null;
  const manualIds = idList(value.manualIds), excludedIds = idList(value.excludedIds);
  if (!manualIds || !excludedIds || manualIds.some(id => excludedIds.includes(id))) return null;
  return {version:1, matchId:matchIdOf(value.matchId), championId:value.championId, gameTime:value.gameTime,
    savedAt:value.savedAt, entries, manualIds, excludedIds};
}

class SelectionHistory {
  constructor({catalog = [], now = Date.now} = {}) {
    this.catalog = new Map(catalog.filter(a => idOf(a?.id)).map(a => [a.id,a]));this.now = now;this.reset();
  }
  reset() {
    this.matchId = null;this.championId = null;this.gameTime = null;this.restored = false;
    this.entries = new Map();this.manualIds = new Set();this.excludedIds = new Set();this.undo = [];
    return this.snapshot();
  }
  known(id) { return Boolean(idOf(id) && (!this.catalog.size || this.catalog.has(id))); }
  begin({matchId = null, championId = null, gameTime = null} = {}, persisted = null) {
    const id = matchIdOf(matchId), hero = idOf(championId), time = Number.isFinite(gameTime) && gameTime >= 0 && gameTime <= 86400 ? gameTime : null;
    const changed = this.matchId && id && id !== this.matchId;
    const heroChanged = this.championId && hero && hero !== this.championId;
    const restarted = this.gameTime !== null && time !== null && this.gameTime - time > 30;
    if (changed || heroChanged || restarted) this.reset();
    const canRestore = !this.matchId && id && (hero || this.championId);
    this.matchId = id || this.matchId;this.championId = hero || this.championId;
    if (time !== null) this.gameTime = time;
    const saved = canRestore ? sanitizeHistory(persisted,this.now()) : null;
    if (saved && saved.matchId === id && saved.championId === this.championId &&
        (time === null || saved.gameTime === null || time >= saved.gameTime - 30)) {
      const current=[...this.entries.values()],hasCorrection=this.manualIds.size||this.excludedIds.size||this.undo.length;
      this.entries=new Map(saved.entries.filter(entry=>this.known(entry.id)).map(entry=>[entry.id,{...entry}]));
      this.observe(current.filter(entry=>entry.active));
      for(const entry of current.filter(entry=>!entry.active)){
        if(!this.entries.has(entry.id)||this.entries.get(entry.id).observedAt<=entry.observedAt)this.entries.set(entry.id,{...entry});
      }
      if(!hasCorrection){
        this.manualIds = new Set(saved.manualIds.filter(id => this.known(id)));
        this.excludedIds = new Set(saved.excludedIds.filter(id => this.known(id)));
      }
      this.restored = true;
    }
    return this.snapshot();
  }
  observe(observations = []) {
    const list = (Array.isArray(observations) ? observations : [observations]).slice(0,MAX_RECORDS)
      .filter(row => row && this.known(row.id) && validSource(row.source));
    const slots = new Map(), idSlots = new Map();
    for (const row of list) {
      const slot = row.source === 'inferred' ? null : slotOf(row.slot);
      if (slot) {if (!slots.has(slot)) slots.set(slot,new Set());slots.get(slot).add(row.id);}
      if (slot) {if (!idSlots.has(row.id)) idSlots.set(row.id,new Set());idSlots.get(row.id).add(slot);}
    }
    for (const row of list) {
      const slot = row.source === 'inferred' ? null : slotOf(row.slot), old = this.entries.get(row.id);
      if (slot && (slots.get(slot).size !== 1 || idSlots.get(row.id).size !== 1)) continue;
      const observedAt = timeOf(row.observedAt ?? row.detectedAt,this.now());
      if (old && observedAt < old.observedAt) continue;
      // A repeated partial API field cannot resurrect a slot which was visibly
      // replaced. Fresh positive slot evidence can establish a later return.
      if (old && !old.active && !slot) continue;
      if (slot) {
        const previous = [...this.entries.values()].find(entry => entry.active && entry.slot === slot && entry.id !== row.id);
        if (previous && observedAt < previous.observedAt) continue;
        if (previous) {
          previous.active = false;previous.observedAt = observedAt;this.manualIds.delete(previous.id);
          for(const checkpoint of this.undo)checkpoint.manualIds=checkpoint.manualIds.filter(id=>id!==previous.id);
        }
      }
      if (!old?.active && [...this.entries.values()].filter(e => e.active).length >= LIMIT) continue;
      const source = old?.active && SOURCES[old.source] > SOURCES[row.source] ? old.source : row.source;
      this.entries.set(row.id,{id:row.id,source,slot:slot || old?.slot || null,observedAt,active:true});
    }
    // Keep bounded replacement tombstones so repeated partial fields do not
    // undo recent replacements. No player identity or free-form text is kept.
    const retired = [...this.entries.values()].filter(e => !e.active).sort((a,b) => b.observedAt-a.observedAt);
    for (const row of retired.slice(MAX_RECORDS-LIMIT)) this.entries.delete(row.id);
    return this.snapshot();
  }
  checkpoint() {
    this.undo.push({manualIds:[...this.manualIds],excludedIds:[...this.excludedIds]});if(this.undo.length>5)this.undo.shift();
  }
  correct(ids) {
    if (!Array.isArray(ids) || ids.length > LIMIT || !ids.every(id => this.known(id)) || new Set(ids).size !== ids.length) throw new Error('INVALID_SELECTIONS');
    this.checkpoint();const wanted = new Set(ids);
    for (const entry of this.entries.values()) if (entry.active && !wanted.has(entry.id)) this.excludedIds.add(entry.id);
    for (const id of this.manualIds) if (!wanted.has(id)) this.excludedIds.add(id);
    this.manualIds = wanted;for (const id of wanted) this.excludedIds.delete(id);
    this.excludedIds = new Set([...this.excludedIds].slice(-LIMIT));
    return this.snapshot();
  }
  confirm(id) {
    if (!this.known(id)) throw new Error('INVALID_SELECTIONS');
    if(!this.snapshot().selected.some(row=>row.id===id)&&this.snapshot().selected.length>=LIMIT)throw new Error('INVALID_SELECTIONS');
    this.checkpoint();this.manualIds.add(id);this.excludedIds.delete(id);return this.snapshot();
  }
  undoCorrection() {
    const previous = this.undo.pop();
    if(previous){this.manualIds=new Set(previous.manualIds);this.excludedIds=new Set(previous.excludedIds);}
    else {this.manualIds.clear();this.excludedIds.clear();}
    return this.snapshot();
  }
  snapshot() {
    const chosen = new Map([...this.entries.values()].filter(e => e.active && !this.excludedIds.has(e.id)).map(e => [e.id,{...e}]));
    for(const id of this.manualIds) chosen.set(id,{...(chosen.get(id)||{id,slot:null,observedAt:this.now()}),source:'manual',active:true});
    const evidence = {api:'本机接口明确暴露的部分强化',visual:'连续图标匹配的己方强化栏槽位',inferred:'卡片点击后消失的推断',manual:'手动校正（可撤销）'};
    const selected = [...chosen.values()].slice(0,LIMIT).map(row => ({id:row.id,name:this.catalog.get(row.id)?.name||String(row.id),
      confidence:row.source==='manual'?'confirmed':row.source,source:row.source,evidence:evidence[row.source],slot:row.slot,
      detectedAt:new Date(row.observedAt).toISOString()}));
    return {selected, complete:false, restored:this.restored, matchId:this.matchId, championId:this.championId,
      gameTime:this.gameTime, canUndo:this.undo.length>0||this.manualIds.size>0||this.excludedIds.size>0};
  }
  serialize() {
    if (!this.matchId || !this.championId) return null;
    return sanitizeHistory({version:1,matchId:this.matchId,championId:this.championId,gameTime:this.gameTime,savedAt:this.now(),
      entries:[...this.entries.values()].map(e=>({...e})),manualIds:[...this.manualIds],excludedIds:[...this.excludedIds]},this.now());
  }
}

class SelectionHistoryStore {
  constructor(filename,{now=Date.now}={}) {this.filename=path.resolve(filename);this.now=now;this.queue=Promise.resolve();}
  async load() {
    await this.queue.catch(()=>{});
    try {
      const file=await fs.open(this.filename,'r');
      try {
        if((await file.stat()).size>MAX_BYTES)return null;
        const buffer=Buffer.alloc(MAX_BYTES+1);const {bytesRead}=await file.read(buffer,0,buffer.length,0);
        if(bytesRead>MAX_BYTES)return null;
        return sanitizeHistory(JSON.parse(buffer.toString('utf8',0,bytesRead)),this.now());
      }
      finally {await file.close();}
    } catch {return null;}
  }
  save(payload) {
    const safe=payload===null?null:sanitizeHistory(payload,this.now());
    if(payload!==null&&!safe)return Promise.reject(new Error('INVALID_HISTORY'));
    const encoded=safe?JSON.stringify(safe):null;
    const run=async()=>{
      if(encoded===null){await fs.unlink(this.filename).catch(error=>{if(error.code!=='ENOENT')throw error;});return;}
      const temporary=`${this.filename}.${process.pid}.tmp`;
      await fs.mkdir(path.dirname(this.filename),{recursive:true});
      try {await fs.writeFile(temporary,encoded,{encoding:'utf8',mode:0o600});await fs.rename(temporary,this.filename);}
      finally {await fs.unlink(temporary).catch(()=>{});}
    };
    const pending=this.queue.then(run,run);this.queue=pending.catch(()=>{});return pending;
  }
}
module.exports={SelectionHistory,SelectionHistoryStore,sanitizeHistory};
