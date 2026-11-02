const https = require('node:https');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const LCU_PATHS = new Set(['/lol-gameflow/v1/gameflow-phase', '/lol-gameflow/v1/session', '/lol-champ-select/v1/session']);
const LIVE_PATHS = new Set(['/liveclientdata/activeplayer', '/liveclientdata/playerlist', '/liveclientdata/gamestats']);

function parseLockfile(text) {
  const parts = text.trim().split(':');
  const port = Number(parts[2]);
  if (parts.length !== 5 || !Number.isInteger(port) || port < 1 || port > 65535 || !parts[3] || parts[4] !== 'https') throw new Error('无效的 League lockfile');
  return { port, password: parts[3] };
}
function parseCommandLine(command = '') {
  const port = Number(command.match(/--app-port[=\s]+"?(\d+)/)?.[1]);
  const token = command.match(/--remoting-auth-token[=\s]+(?:"([^"]+)"|([^\s"]+))/);
  if (!port || port > 65535 || !token) return null;
  return { port, password: token[1] || token[2] };
}
async function discoverConnection(configuredPath) {
  const candidates = [];
  if (configuredPath) candidates.push(configuredPath.toLowerCase().endsWith('lockfile') ? configuredPath : path.join(configuredPath, 'lockfile'));
  for (const filename of candidates) try { return parseLockfile(await fs.readFile(filename, 'utf8')); } catch { /* Try running client. */ }
  if (process.platform !== 'win32') return null;
  const script = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe' OR Name='LeagueClient.exe'\" | Select-Object ExecutablePath,CommandLine | ConvertTo-Json -Compress";
  try {
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 6000, maxBuffer: 256000 });
    const result = JSON.parse(stdout.replace(/^\uFEFF/, '').trim() || '[]');
    for (const p of Array.isArray(result) ? result : [result]) {
      const connection = parseCommandLine(p.CommandLine || '');
      if (connection) return connection;
      if (p.ExecutablePath) {
        for (const dir of [path.dirname(p.ExecutablePath), path.dirname(path.dirname(p.ExecutablePath))]) {
          try { return parseLockfile(await fs.readFile(path.join(dir, 'lockfile'), 'utf8')); } catch { /* Next path. */ }
        }
      }
    }
  } catch { /* Not running or OS denied process metadata; manual path remains available. */ }
  return null;
}
function localGet(endpoint, connection = null) {
  if (!(connection ? LCU_PATHS : LIVE_PATHS).has(endpoint)) return Promise.reject(new Error('未允许的本地接口'));
  return new Promise((resolve, reject) => {
    const req = https.get({ hostname: '127.0.0.1', port: connection?.port || 2999, path: endpoint, method: 'GET',
      // Only this fixed loopback request accepts the League self-signed certificate.
      rejectUnauthorized: false, agent: false,
      headers: connection ? { Authorization: 'Basic ' + Buffer.from(`riot:${connection.password}`).toString('base64') } : {},
    }, res => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`LOCAL_${res.statusCode}`)); return; }
      let body = ''; res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; if (body.length > 2e6) req.destroy(new Error('LOCAL_SIZE')); });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('LOCAL_JSON')); } });
      res.on('error', reject);
    });
    req.setTimeout(1600, () => req.destroy(new Error('LOCAL_TIMEOUT')));
    req.on('error', reject);
  });
}
function isMayhem(session) {
  const q = session?.gameData?.queue;
  return Number(q?.id) === 2400 || /mayhem|海克斯/i.test(`${q?.name || ''} ${q?.description || ''}`);
}
function championFromSelect(session) {
  return session?.myTeam?.find(p => p.cellId === session.localPlayerCellId)?.championId || null;
}
function normalizeName(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g, ''); }
function isPoroSnack(item, fallbackName = '') {
  const id = Number(typeof item === 'number' ? item : item?.id ?? item?.itemID);
  const name = normalizeName(item?.name || item?.displayName || fallbackName);
  return id === 2052 || id === 220013 || name === '魄罗佳肴' || /^poro(?:snax|snacks?)$/.test(name);
}
function activePlayerFromLive(active, players) {
  return (players || []).find(p => (active?.riotId && p.riotId === active.riotId) || (active?.summonerName && p.summonerName === active.summonerName)) || null;
}
function championIdFromPlayer(player, champions) {
  if (!player) return null;
  const raw = (player.rawChampionName || '').replace(/^game_character_displayname_/i, '');
  const keys = [raw, player.championName].map(normalizeName).filter(Boolean);
  return champions.find(c => keys.includes(normalizeName(c.key)) || keys.includes(normalizeName(c.name)))?.id || null;
}
function championFromLive(active, players, champions) { return championIdFromPlayer(activePlayerFromLive(active, players), champions); }
function draftFromSession(session) {
  const localPlayerCellId = Number.isInteger(session?.localPlayerCellId) ? session.localPlayerCellId : null;
  const team = (session?.myTeam || []).map(p => ({ championId: Number(p.championId) || null,
    cellId: p.cellId, isSelf: localPlayerCellId !== null && p.cellId === localPlayerCellId }));
  // The shared bench and own champion are actionable choices; teammates' locked picks are not.
  const bench = [...new Set((session?.benchChampions || []).map(p => Number(p.championId)).filter(id => id > 0))];
  const self = team.find(p => p.isSelf);
  const availableChampionIds = [...new Set([self?.championId, ...bench].filter(id => id > 0))];
  const rawRerolls = session?.rerollsRemaining ?? session?.myTeam?.find(p => p.cellId === localPlayerCellId)?.rerollsRemaining;
  return { team, bench, availableChampionIds, localPlayerCellId,
    rerollsRemaining: Number.isInteger(rawRerolls) && rawRerolls >= 0 ? rawRerolls : null };
}
function liveContext(active, players, champions) {
  const own = activePlayerFromLive(active, players);
  const inventory = own && Array.isArray(own.items) ? own.items.filter(item => Number(item.itemID) > 0).map(item => ({ id: Number(item.itemID), name: String(item.displayName || ''), count: Number(item.count) || 1 })) : null;
  const stats = {};
  for (const key of ['abilityPower', 'attackDamage', 'attackSpeed', 'attackRange', 'critChance', 'maxHealth', 'armor', 'magicResist', 'resourceMax', 'abilityHaste']) {
    const value = active?.championStats?.[key]; if (typeof value === 'number' && Number.isFinite(value)) stats[key] = value;
  }
  if (typeof active?.championStats?.resourceType === 'string') stats.resourceType = active.championStats.resourceType;
  return { ownItems: inventory?.filter(item => !isPoroSnack(item)) ?? null,
    ownUtilityItems: inventory?.filter(item => isPoroSnack(item)) ?? null,
    ownChampStats: Object.keys(stats).length ? stats : null,
    ownSelectedAugmentIds: null, selectedAugmentsSource: 'unavailable',
    team: own ? players.filter(p => p.team === own.team).map((p, i) => ({ championId: championIdFromPlayer(p, champions), cellId: i, isSelf: p === own })) : [],
  };
}
class LeagueReader {
  constructor(options = {}) { this.connection = null; this.nextDiscovery = 0; this.discover = options.discover || discoverConnection; this.get = options.get || localGet; }
  reset() { this.connection = null; this.nextDiscovery = 0; }
  async poll(settings, champions) {
    if (!this.connection && Date.now() >= this.nextDiscovery) {
      this.nextDiscovery = Date.now() + 15000;
      this.connection = await this.discover(settings.leaguePath);
    }
    let phase = 'Disconnected', session = null, championId = null, lcuConnected = false;
    let draft = draftFromSession(null), context = { ownItems: null, ownUtilityItems: null, ownChampStats: null, ownSelectedAugmentIds: null, selectedAugmentsSource: 'unavailable' };
    if (this.connection) {
      try {
        phase = await this.get('/lol-gameflow/v1/gameflow-phase', this.connection);
        lcuConnected = true;
        session = await this.get('/lol-gameflow/v1/session', this.connection).catch(() => null);
        if (phase === 'ChampSelect') {
          const selection = await this.get('/lol-champ-select/v1/session', this.connection).catch(() => null);
          championId = championFromSelect(selection); draft = draftFromSession(selection);
        }
      } catch { this.connection = null; }
    }
    let liveConnected = false, level = null, gameTime = null, gameMode = null, gameVersion = null;
    // Live Client Data can work even if the launcher is unavailable in a regional client.
    const live = await Promise.allSettled([this.get('/liveclientdata/activeplayer'), this.get('/liveclientdata/playerlist'), this.get('/liveclientdata/gamestats')]);
    if (live[0].status === 'fulfilled' && live[1].status === 'fulfilled') {
      liveConnected = true; phase = 'InProgress';
      championId = championFromLive(live[0].value, live[1].value, champions) || championId;
      context = liveContext(live[0].value, live[1].value, champions);
      draft = { ...draft, team: context.team, availableChampionIds: championId ? [championId] : [], bench: [], localPlayerCellId: context.team.find(p => p.isSelf)?.cellId ?? null, rerollsRemaining: null };
      level = live[0].value.level || null;
      if (live[2].status === 'fulfilled') {
        gameTime = live[2].value.gameTime; gameMode = live[2].value.gameMode; gameVersion = live[2].value.gameVersion || null;
      }
    }
    return { phase, lcuConnected, liveConnected, championId, isMayhem: isMayhem(session), ...draft, ...context,
      queueId: session?.gameData?.queue?.id || null, level, gameTime, gameMode, gameVersion,
      gameId: session?.gameData?.gameId || null, checkedAt: new Date().toISOString() };
  }
}
module.exports = { parseLockfile, parseCommandLine, discoverConnection, localGet, isMayhem, championFromSelect, championFromLive, draftFromSession, liveContext, LeagueReader, isPoroSnack };
