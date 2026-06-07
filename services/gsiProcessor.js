const { v4: uuidv4 } = require('uuid');
const liveStore = require('./gsiLiveStore');
const { getLiveRoomIdForUser } = require('./roomService');
const { normalizeTeam, applyMatchRating } = require('./playerRating');
const { toSteamId64 } = require('./steamId');

const IDLE_SAVE_MS = 90000;
const ACTIVE_PHASES = new Set(['warmup', 'live', 'intermission', 'gameover', 'paused']);

function normalizePhase(phase) {
  return (phase || '').toLowerCase();
}

function normalizeMapName(name) {
  const n = (name || '').trim().toLowerCase();
  if (!n || n === 'lobby') return null;
  return name.trim();
}

function getGameMode(map) {
  const mode = (map?.mode || '').toLowerCase();
  if (mode.includes('deathmatch') || mode === 'dm' || mode.includes('gg')) return 'deathmatch';
  if (mode.includes('competitive')) return 'competitive';
  if (mode.includes('casual')) return 'casual';
  if (mode.includes('wingman')) return 'wingman';
  if (mode.includes('arms') || mode.includes('gungame')) return 'arms_race';
  return mode || 'unknown';
}

function isDeathmatchMode(mode) {
  return mode === 'deathmatch' || mode === 'arms_race';
}

function extractScores(map, gameMode, playerStats, payload) {
  if (isDeathmatchMode(gameMode)) {
    const you =
      payload?.player && typeof payload.player === 'object'
        ? mapPlayer(payload.player)
        : playerStats[0];
    return {
      scoreCt: you?.score ?? you?.kills ?? 0,
      scoreT: you?.deaths ?? 0,
    };
  }
  return {
    scoreCt: Number(map?.team_ct?.score ?? 0) || 0,
    scoreT: Number(map?.team_t?.score ?? 0) || 0,
  };
}

function extractOwnerSteamId(payload) {
  const p = payload?.player;
  if (!p || typeof p !== 'object') return '';
  return toSteamId64(p.steamid || p.accountid || '');
}

function extractOwnerTeam(payload) {
  const p = payload?.player;
  if (!p || typeof p !== 'object') return null;
  return normalizeTeam(p.team);
}

function extractPlayerStats(payload) {
  const players = [];

  if (payload.player && typeof payload.player === 'object') {
    players.push(mapPlayer(payload.player));
  }

  if (payload.allplayers && typeof payload.allplayers === 'object') {
    for (const [key, p] of Object.entries(payload.allplayers)) {
      if (p && typeof p === 'object') {
        const mapped = mapPlayer(p, key);
        if (!players.some((x) => x.player_steamid && x.player_steamid === mapped.player_steamid)) {
          players.push(mapped);
        }
      }
    }
  }

  return players.filter((p) => p.player_name || p.player_steamid);
}

function mapPlayer(p, keyId = '') {
  const stats = p.match_stats || p.state || {};
  const rawId = p.steamid || p.accountid || keyId || '';
  return {
    player_steamid: toSteamId64(rawId) || String(rawId).trim(),
    player_name: p.name || p.username || 'Desconhecido',
    kills: Number(stats.kills ?? 0),
    assists: Number(stats.assists ?? 0),
    deaths: Number(stats.deaths ?? 0),
    mvps: Number(stats.mvps ?? 0),
    score: Number(stats.score ?? 0),
  };
}

function statMergeKey(p) {
  const sid = toSteamId64(p?.player_steamid);
  if (sid) return `s:${sid}`;
  const name = String(p?.player_name || '')
    .trim()
    .toLowerCase();
  if (name && name !== 'desconhecido') return `n:${name}`;
  return '';
}

function mergeStatRow(existing, incoming) {
  if (!existing) return { ...incoming };
  return {
    ...existing,
    ...incoming,
    player_steamid: toSteamId64(incoming.player_steamid) || toSteamId64(existing.player_steamid) || incoming.player_steamid || existing.player_steamid,
    player_name: incoming.player_name || existing.player_name,
  };
}

/** Acumula placar entre pacotes GSI — evita perder payload.player quando allplayers traz só um terceiro. */
function mergePlayerStats(existing, incoming, ownerSteamId, payloadPlayer) {
  const merged = new Map();

  const add = (p) => {
    if (!p) return;
    const k = statMergeKey(p);
    if (!k) return;
    merged.set(k, mergeStatRow(merged.get(k), p));
  };

  for (const p of existing || []) add(p);
  for (const p of incoming || []) add(p);

  if (payloadPlayer && typeof payloadPlayer === 'object') {
    const self = mapPlayer(payloadPlayer);
    const sid = toSteamId64(ownerSteamId) || toSteamId64(self.player_steamid);
    if (sid) self.player_steamid = sid;
    if (self.player_name || self.player_steamid) add(self);
  }

  return [...merged.values()];
}

function buildSelfPlayer(payloadPlayer, ownerSteamId) {
  if (!payloadPlayer || typeof payloadPlayer !== 'object') return null;
  const self = mapPlayer(payloadPlayer);
  const sid = toSteamId64(ownerSteamId) || toSteamId64(self.player_steamid);
  if (sid) self.player_steamid = sid;
  if (!self.player_name && !self.player_steamid) return null;
  return self;
}

function finalizeStatsForSave(playerStats, selfPlayer, userSid, username) {
  const stats = mergePlayerStats(playerStats, [], '', null);
  const sid = toSteamId64(userSid);
  const self = selfPlayer ? { ...selfPlayer } : null;

  if (self) {
    if (sid) self.player_steamid = sid;
    if (!self.player_name) self.player_name = username || 'Você';
  } else if (sid) {
    const placeholder = {
      player_steamid: sid,
      player_name: username || 'Você',
      kills: 0,
      assists: 0,
      deaths: 0,
      mvps: 0,
      score: 0,
    };
    const idx = stats.findIndex((s) => toSteamId64(s.player_steamid) === sid);
    if (idx >= 0) {
      stats[idx] = mergeStatRow(stats[idx], placeholder);
      return stats;
    }
    return [placeholder, ...stats];
  }

  if (!self) return stats;

  const idx = sid
    ? stats.findIndex((s) => toSteamId64(s.player_steamid) === sid)
    : -1;
  if (idx >= 0) {
    stats[idx] = mergeStatRow(stats[idx], self);
    return stats;
  }

  return [self, ...stats];
}

function parsePayload(payload) {
  const map = payload?.map || {};
  const mapName = normalizeMapName(map.name);
  const phase = normalizePhase(map.phase);
  const gameMode = getGameMode(map);
  const playerStats = extractPlayerStats(payload);
  const scores = extractScores(map, gameMode, playerStats, payload);

  const ownerSteamId = extractOwnerSteamId(payload);
  const ownerTeam = extractOwnerTeam(payload);

  return { map, mapName, phase, gameMode, playerStats, scores, ownerSteamId, ownerTeam };
}

/** Ignora heartbeat do menu sem mapa válido. */
function isTrackableGameState(parsed, hasLive) {
  if (parsed.mapName) {
    if (!parsed.phase || ACTIVE_PHASES.has(parsed.phase)) return true;
  }
  if (hasLive && parsed.phase === 'gameover') return true;
  return false;
}

function hasMeaningfulStats(live) {
  const stats = live.player_stats || [];
  if (stats.some((s) => s.kills > 0 || s.deaths > 0 || s.score > 0)) return true;
  const elapsed = Date.now() - new Date(live.started_at).getTime();
  return elapsed > 45000;
}

function createLiveSession(mapName, phase, gameMode, scores, playerStats, ownerSteamId = '', ownerTeam = null, selfPlayer = null) {
  return {
    match_key: `${mapName}-${Date.now()}-${uuidv4().slice(0, 8)}`,
    map_name: mapName,
    map_phase: phase,
    game_mode: gameMode,
    score_ct: scores.scoreCt,
    score_t: scores.scoreT,
    player_stats: playerStats,
    self_player: selfPlayer,
    owner_steamid: ownerSteamId || '',
    owner_team: ownerTeam || null,
    started_at: new Date().toISOString(),
  };
}

function updateLiveSession(live, parsed, payload) {
  live.map_name = parsed.mapName || live.map_name;
  live.map_phase = parsed.phase || live.map_phase;
  live.game_mode = parsed.gameMode !== 'unknown' ? parsed.gameMode : live.game_mode;
  live.score_ct = parsed.scores.scoreCt;
  live.score_t = parsed.scores.scoreT;

  const selfPlayer = buildSelfPlayer(payload?.player, parsed.ownerSteamId);
  if (selfPlayer) live.self_player = mergeStatRow(live.self_player, selfPlayer);

  if (parsed.playerStats.length || selfPlayer) {
    live.player_stats = mergePlayerStats(
      live.player_stats,
      parsed.playerStats,
      parsed.ownerSteamId,
      payload?.player
    );
  }

  if (parsed.ownerSteamId) {
    live.owner_steamid = parsed.ownerSteamId;
  }
  if (parsed.ownerTeam) {
    live.owner_team = parsed.ownerTeam;
  }
}

async function persistMatch(userId, live, dbHelpers, reason) {
  const { run, get } = dbHelpers;
  const { match_key: matchKey } = live;
  const roomId = live.room_id || (await getLiveRoomIdForUser(dbHelpers, userId));

  if (!hasMeaningfulStats(live)) {
    liveStore.markFinalized(userId, matchKey);
    return { saved: false, message: 'Sessão vazia, não salva', matchId: null };
  }

  if (liveStore.isAlreadyFinalized(userId, matchKey)) {
    return { saved: false, message: 'Partida já finalizada', matchId: null };
  }

  const existing = await get(
    `SELECT id, finished FROM matches WHERE user_id = ? AND match_key = ?`,
    [userId, matchKey]
  );

  if (existing?.finished) {
    liveStore.markFinalized(userId, matchKey);
    return { saved: false, message: 'Partida já existe no banco', matchId: existing.id };
  }

  let matchId = existing?.id;
  const finalPhase = reason === 'gameover' ? 'gameover' : 'finished';

  const userRow = await get(`SELECT steam_id, username FROM users WHERE id = ?`, [userId]);
  const userSid = toSteamId64(userRow?.steam_id);
  const liveOwner = toSteamId64(live.owner_steamid);
  let ownerSteam = liveOwner || userSid || live.owner_steamid || '';
  if (userSid && liveOwner && liveOwner !== userSid) {
    ownerSteam = userSid;
  }
  if (ownerSteam) live.owner_steamid = ownerSteam;

  const statsToSave = finalizeStatsForSave(
    live.player_stats,
    live.self_player,
    userSid,
    userRow?.username
  );

  if (!matchId) {
    const insert = await run(
      `INSERT INTO matches (user_id, match_key, map_name, map_phase, game_mode, score_ct, score_t, owner_steamid, owner_team, room_id, finished, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))`,
      [
        userId,
        matchKey,
        live.map_name,
        finalPhase,
        live.game_mode || 'unknown',
        live.score_ct,
        live.score_t,
        live.owner_steamid || null,
        live.owner_team || null,
        roomId || null,
      ]
    );
    matchId = insert.lastID;
  } else {
    await run(
      `UPDATE matches SET map_name = ?, map_phase = ?, game_mode = ?, score_ct = ?, score_t = ?, owner_steamid = COALESCE(?, owner_steamid), owner_team = COALESCE(?, owner_team), room_id = COALESCE(?, room_id), finished = 1, updated_at = datetime('now')
       WHERE id = ?`,
      [
        live.map_name,
        finalPhase,
        live.game_mode || 'unknown',
        live.score_ct,
        live.score_t,
        live.owner_steamid || null,
        live.owner_team || null,
        roomId || null,
        matchId,
      ]
    );
    await run(`DELETE FROM player_stats WHERE match_id = ?`, [matchId]);
  }

  for (const ps of statsToSave) {
    ps.player_steamid = toSteamId64(ps.player_steamid) || ps.player_steamid;
    await run(
      `INSERT INTO player_stats (match_id, player_steamid, player_name, kills, assists, deaths, mvps, score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [matchId, ps.player_steamid, ps.player_name, ps.kills, ps.assists, ps.deaths, ps.mvps, ps.score]
    );
  }

  liveStore.markFinalized(userId, matchKey);

  let ratingResult = null;
  try {
    ratingResult = await applyMatchRating(dbHelpers, userId, matchId);
  } catch (err) {
    console.error(`[Rating] Erro ao aplicar MMR user_id=${userId} match_id=${matchId}:`, err.message);
  }

  return {
    saved: true,
    matchId,
    message: `Partida salva (${reason})`,
    rating: ratingResult,
  };
}

/**
 * Processa payload GSI do CS2.
 * Deathmatch raramente envia gameover — salva também ao trocar mapa ou ficar idle.
 */
async function processGsiPayload(userId, payload, dbHelpers) {
  const parsed = parsePayload(payload);
  let live = liveStore.getLiveMatch(userId);

  if (!isTrackableGameState(parsed, !!live)) {
    return {
      live,
      saved: false,
      matchId: null,
      message: 'Fora de partida (menu/heartbeat)',
    };
  }

  let saved = false;
  let matchId = null;
  let saveMessage = null;

  // Troca de mapa: finaliza sessão anterior antes de abrir nova
  if (
    live &&
    parsed.mapName &&
    live.map_name !== parsed.mapName &&
    parsed.phase !== 'gameover'
  ) {
    const prev = await persistMatch(userId, live, dbHelpers, 'map_change');
    saved = prev.saved;
    matchId = prev.matchId;
    saveMessage = prev.message;
    liveStore.clearLiveMatch(userId);
    live = null;
  }

  if (parsed.phase === 'gameover' && live) {
    const fin = await persistMatch(userId, live, dbHelpers, 'gameover');
    saved = fin.saved;
    matchId = fin.matchId;
    saveMessage = fin.message;
    liveStore.clearLiveMatch(userId);
    return { live: null, saved, matchId, message: saveMessage || fin.message };
  }

  const needsNewSession =
    !live ||
    (parsed.phase === 'live' && live.map_phase === 'gameover');

  if (needsNewSession && parsed.mapName && parsed.phase !== 'gameover') {
    const roomId = await getLiveRoomIdForUser(dbHelpers, userId);
    const selfPlayer = buildSelfPlayer(payload?.player, parsed.ownerSteamId);
    live = createLiveSession(
      parsed.mapName,
      parsed.phase,
      parsed.gameMode,
      parsed.scores,
      parsed.playerStats,
      parsed.ownerSteamId,
      parsed.ownerTeam,
      selfPlayer
    );
    if (roomId) live.room_id = roomId;
    liveStore.setLiveMatch(userId, live);
  } else if (live) {
    updateLiveSession(live, parsed, payload);
    const roomId = await getLiveRoomIdForUser(dbHelpers, userId);
    if (roomId) live.room_id = roomId;
    liveStore.setLiveMatch(userId, live);
  }

  return {
    live: liveStore.getLiveMatch(userId),
    saved,
    matchId,
    message: saveMessage || 'Atualizado em memória',
  };
}

/** Salva sessões ao vivo sem sinal do CS2 (ex.: saiu do DM). */
async function finalizeIdleSessions(dbHelpers) {
  const userIds = liveStore.getActiveUserIds();
  const results = [];

  for (const userId of userIds) {
    const lastAt = liveStore.getLastInGameAt(userId);
    if (!lastAt || Date.now() - lastAt < IDLE_SAVE_MS) continue;

    const live = liveStore.getLiveMatch(userId);
    if (!live) continue;

    const fin = await persistMatch(userId, live, dbHelpers, 'idle_disconnect');
    liveStore.clearLiveMatch(userId);
    results.push({ userId, ...fin });
    console.log(`[GSI] Sessão idle salva user_id=${userId} match=${live.map_name}`);
  }

  return results;
}

module.exports = {
  processGsiPayload,
  finalizeIdleSessions,
  extractPlayerStats,
  extractOwnerSteamId,
  isDeathmatchMode,
};
