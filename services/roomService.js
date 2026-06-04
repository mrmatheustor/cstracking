const liveStore = require('./gsiLiveStore');
const { pickSelfStats } = require('./matchStats');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const GSI_OK_MS = 120000;

function generateRoomCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

async function generateUniqueCode(db) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = generateRoomCode();
    const exists = await db.get(`SELECT id FROM match_rooms WHERE code = ?`, [code]);
    if (!exists) return code;
  }
  throw new Error('Não foi possível gerar código da sala');
}

async function getUserActiveMembership(db, userId) {
  return db.get(
    `SELECT r.*, m.user_id AS member_user_id
     FROM match_room_members m
     JOIN match_rooms r ON r.id = m.room_id
     WHERE m.user_id = ? AND r.status IN ('open', 'live')
     ORDER BY r.created_at DESC
     LIMIT 1`,
    [userId]
  );
}

async function getLiveRoomIdForUser(db, userId) {
  const row = await db.get(
    `SELECT r.id FROM match_room_members m
     JOIN match_rooms r ON r.id = m.room_id
     WHERE m.user_id = ? AND r.status = 'live'`,
    [userId]
  );
  return row?.id || null;
}

async function listRoomMembers(db, roomId) {
  const rows = await db.all(
    `SELECT u.id, u.username, u.steam_id, r.host_user_id
     FROM match_room_members m
     JOIN users u ON u.id = m.user_id
     JOIN match_rooms r ON r.id = m.room_id
     WHERE m.room_id = ?
     ORDER BY m.joined_at ASC`,
    [roomId]
  );

  const now = Date.now();
  return rows.map((row) => {
    const lastAt = liveStore.getLastGsiAt(row.id);
    const gsi_connected = !!(lastAt && now - lastAt < GSI_OK_MS);
    return {
      id: row.id,
      username: row.username,
      is_host: row.id === row.host_user_id,
      gsi_connected,
      last_gsi_at: lastAt ? new Date(lastAt).toISOString() : null,
    };
  });
}

async function getRoomByCode(db, code) {
  const normalized = (code || '').trim().toUpperCase();
  if (!normalized) return null;
  return db.get(`SELECT * FROM match_rooms WHERE code = ?`, [normalized]);
}

async function createRoom(db, hostUserId, options = {}) {
  const title = typeof options === 'string' ? options : options.title || '';
  const autoStart = typeof options === 'object' && options.auto_start !== false;
  const mapName = (options.map_name || '').trim() || null;
  const lobbyPassword = (options.lobby_password || '').trim() || null;

  const existing = await getUserActiveMembership(db, hostUserId);
  if (existing) {
    const err = new Error('Você já está em uma sala ativa');
    err.code = 'ALREADY_IN_ROOM';
    err.room = existing;
    throw err;
  }

  const roomCode = await generateUniqueCode(db);
  const status = autoStart ? 'live' : 'open';

  const insert = await db.run(
    `INSERT INTO match_rooms (code, host_user_id, title, status, map_name, lobby_password, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ${autoStart ? "datetime('now')" : 'NULL'})`,
    [roomCode, hostUserId, (title || '').trim() || null, status, mapName, lobbyPassword]
  );

  await db.run(
    `INSERT INTO match_room_members (room_id, user_id) VALUES (?, ?)`,
    [insert.lastID, hostUserId]
  );

  return getRoomPayload(db, roomCode, hostUserId);
}

async function joinRoom(db, userId, code) {
  const room = await getRoomByCode(db, code);
  if (!room) {
    const err = new Error('Código inválido');
    err.status = 404;
    throw err;
  }
  if (room.status === 'closed') {
    const err = new Error('Esta sala já foi encerrada');
    err.status = 400;
    throw err;
  }

  const other = await getUserActiveMembership(db, userId);
  if (other && other.id !== room.id) {
    const err = new Error('Saia da sala atual antes de entrar em outra');
    err.code = 'ALREADY_IN_ROOM';
    throw err;
  }

  await db.run(
    `INSERT OR IGNORE INTO match_room_members (room_id, user_id) VALUES (?, ?)`,
    [room.id, userId]
  );

  return getRoomPayload(db, room.code, userId);
}

async function leaveRoom(db, userId, code) {
  const room = await getRoomByCode(db, code);
  if (!room) {
    const err = new Error('Sala não encontrada');
    err.status = 404;
    throw err;
  }

  if (room.host_user_id === userId && room.status !== 'closed') {
    const err = new Error('O host deve encerrar a sala em vez de sair');
    err.status = 400;
    throw err;
  }

  await db.run(`DELETE FROM match_room_members WHERE room_id = ? AND user_id = ?`, [
    room.id,
    userId,
  ]);

  return { left: true, code: room.code };
}

async function startRoom(db, hostUserId, code) {
  const room = await getRoomByCode(db, code);
  if (!room) {
    const err = new Error('Sala não encontrada');
    err.status = 404;
    throw err;
  }
  if (room.host_user_id !== hostUserId) {
    const err = new Error('Apenas o host pode iniciar a partida');
    err.status = 403;
    throw err;
  }
  if (room.status === 'closed') {
    const err = new Error('Sala já encerrada');
    err.status = 400;
    throw err;
  }

  await db.run(
    `UPDATE match_rooms SET status = 'live', started_at = datetime('now') WHERE id = ?`,
    [room.id]
  );

  return getRoomPayload(db, room.code, hostUserId);
}

async function closeRoom(db, hostUserId, code) {
  const room = await getRoomByCode(db, code);
  if (!room) {
    const err = new Error('Sala não encontrada');
    err.status = 404;
    throw err;
  }
  if (room.host_user_id !== hostUserId) {
    const err = new Error('Apenas o host pode encerrar a sala');
    err.status = 403;
    throw err;
  }

  await db.run(
    `UPDATE match_rooms SET status = 'closed', closed_at = datetime('now') WHERE id = ?`,
    [room.id]
  );

  return getRoomPayload(db, room.code, hostUserId);
}

function mergePlayerRows(allStats) {
  const byKey = new Map();

  for (const row of allStats) {
    const key = (row.player_steamid || '').trim() || `name:${row.player_name}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...row });
      continue;
    }
    byKey.set(key, {
      ...prev,
      player_name: prev.player_name || row.player_name,
      kills: Math.max(prev.kills || 0, row.kills || 0),
      deaths: Math.max(prev.deaths || 0, row.deaths || 0),
      assists: Math.max(prev.assists || 0, row.assists || 0),
      mvps: Math.max(prev.mvps || 0, row.mvps || 0),
      score: Math.max(prev.score || 0, row.score || 0),
      sources: (prev.sources || 1) + 1,
    });
  }

  return [...byKey.values()].sort(
    (a, b) => (b.score || 0) - (a.score || 0) || (b.kills || 0) - (a.kills || 0)
  );
}

async function buildRoomResult(db, roomId) {
  const room = await db.get(`SELECT * FROM match_rooms WHERE id = ?`, [roomId]);
  if (!room) return null;

  const matches = await db.all(
    `SELECT m.*, u.username AS tracker_username
     FROM matches m
     JOIN users u ON u.id = m.user_id
     WHERE m.room_id = ? AND m.finished = 1
     ORDER BY m.updated_at DESC`,
    [roomId]
  );

  const allStats = [];
  let scoreCt = 0;
  let scoreT = 0;
  let mapName = null;
  let gameMode = null;

  for (const match of matches) {
    const stats = await db.all(
      `SELECT player_steamid, player_name, kills, assists, deaths, mvps, score
       FROM player_stats WHERE match_id = ?`,
      [match.id]
    );
    const self = pickSelfStats(match, stats);
    if (self) {
      allStats.push({
        ...self,
        tracker_username: match.tracker_username,
        tracker_user_id: match.user_id,
      });
    }
    if (!mapName && match.map_name) mapName = match.map_name;
    if (!gameMode && match.game_mode) gameMode = match.game_mode;
    if ((match.score_ct || 0) + (match.score_t || 0) >= scoreCt + scoreT) {
      scoreCt = match.score_ct || 0;
      scoreT = match.score_t || 0;
    }
  }

  const scoreboard = mergePlayerRows(allStats);

  return {
    room: {
      id: room.id,
      code: room.code,
      status: room.status,
      title: room.title,
      started_at: room.started_at,
      closed_at: room.closed_at,
    },
    map_name: mapName,
    game_mode: gameMode,
    score_ct: scoreCt,
    score_t: scoreT,
    matches_count: matches.length,
    members_reported: matches.length,
    scoreboard,
  };
}

async function getRoomPayload(db, code, viewerUserId) {
  const room = await getRoomByCode(db, code);
  if (!room) return null;

  const members = await listRoomMembers(db, room.id);
  const isMember = members.some((m) => m.id === viewerUserId);
  const result =
    room.status === 'closed' || room.status === 'live'
      ? await buildRoomResult(db, room.id)
      : null;

  const gsiReady = members.filter((m) => m.gsi_connected).length;

  return {
    room: {
      id: room.id,
      code: room.code,
      title: room.title,
      status: room.status,
      host_user_id: room.host_user_id,
      map_name: room.map_name,
      lobby_password: room.lobby_password,
      created_at: room.created_at,
      started_at: room.started_at,
      closed_at: room.closed_at,
    },
    is_host: room.host_user_id === viewerUserId,
    is_member: isMember,
    members,
    gsi_ready_count: gsiReady,
    members_count: members.length,
    share_url: `/sala?code=${room.code}`,
    result,
  };
}

module.exports = {
  createRoom,
  joinRoom,
  leaveRoom,
  startRoom,
  closeRoom,
  getRoomByCode,
  getRoomPayload,
  getUserActiveMembership,
  getLiveRoomIdForUser,
  buildRoomResult,
};
