const bcrypt = require('bcryptjs');
const liveStore = require('./gsiLiveStore');
const { pickSelfStats } = require('./matchStats');
const { getMemberRatingInternal, formatMemberForClient, balanceTeams } = require('./playerRating');

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
  throw new Error('Não foi possível gerar código do lobby');
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
     WHERE m.user_id = ? AND r.status IN ('open', 'live')`,
    [userId]
  );
  return row?.id || null;
}

/** Vincula sessões GSI ao vivo ao lobby quando o jogador entra ou o host ativa. */
async function syncLiveSessionsForRoom(db, roomId) {
  const rows = await db.all(`SELECT user_id FROM match_room_members WHERE room_id = ?`, [roomId]);
  for (const row of rows) {
    const live = liveStore.getLiveMatch(row.user_id);
    if (live) {
      live.room_id = roomId;
      liveStore.setLiveMatch(row.user_id, live);
    }
  }
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
  const members = [];
  for (const row of rows) {
    const lastAt = liveStore.getLastGsiAt(row.id);
    const gsi_connected = !!(lastAt && now - lastAt < GSI_OK_MS);
    const { publicRank, mmr } = await getMemberRatingInternal(db, row.id);
    members.push({
      id: row.id,
      username: row.username,
      is_host: row.id === row.host_user_id,
      gsi_connected,
      last_gsi_at: lastAt ? new Date(lastAt).toISOString() : null,
      rating: publicRank,
      _mmr: mmr,
    });
  }
  return members;
}

async function getRoomByCode(db, code) {
  const normalized = (code || '').trim().toUpperCase();
  if (!normalized) return null;
  return db.get(`SELECT * FROM match_rooms WHERE code = ?`, [normalized]);
}

async function verifyRoomPassword(room, password) {
  if (!room.join_password_hash) return;

  const provided = (password || '').trim();
  if (!provided) {
    const err = new Error('Este lobby exige senha');
    err.status = 403;
    err.code = 'PASSWORD_REQUIRED';
    throw err;
  }

  const ok = await bcrypt.compare(provided, room.join_password_hash);
  if (!ok) {
    const err = new Error('Senha incorreta');
    err.status = 403;
    err.code = 'WRONG_PASSWORD';
    throw err;
  }
}

async function listPublicRooms(db, viewerUserId) {
  const rows = await db.all(
    `SELECT
      r.id,
      r.code,
      r.title,
      r.status,
      r.created_at,
      r.host_user_id,
      u.username AS host_username,
      (SELECT COUNT(*) FROM match_room_members m WHERE m.room_id = r.id) AS members_count,
      CASE WHEN r.join_password_hash IS NOT NULL AND r.join_password_hash != '' THEN 1 ELSE 0 END AS has_password
     FROM match_rooms r
     JOIN users u ON u.id = r.host_user_id
     WHERE r.status IN ('open', 'live')
     ORDER BY r.created_at DESC
     LIMIT 50`
  );

  return rows.map((row) => ({
    code: row.code,
    title: row.title || 'Lobby de partida',
    status: row.status,
    host_username: row.host_username,
    members_count: row.members_count || 0,
    has_password: !!row.has_password,
    is_mine: row.host_user_id === viewerUserId,
    created_at: row.created_at,
  }));
}

async function createRoom(db, hostUserId, options = {}) {
  const title = typeof options === 'string' ? options : options.title || '';
  const autoStart = typeof options === 'object' && options.auto_start !== false;
  const rawPassword = typeof options === 'object' ? (options.password || '').trim() : '';
  if (rawPassword && rawPassword.length < 4) {
    const err = new Error('Senha do lobby deve ter no mínimo 4 caracteres');
    err.status = 400;
    throw err;
  }
  const joinPasswordHash = rawPassword ? await bcrypt.hash(rawPassword, 10) : null;

  const existing = await getUserActiveMembership(db, hostUserId);
  if (existing) {
    const err = new Error('Você já está em um lobby ativo');
    err.code = 'ALREADY_IN_ROOM';
    err.room = existing;
    throw err;
  }

  const roomCode = await generateUniqueCode(db);
  const status = autoStart ? 'live' : 'open';

  const insert = await db.run(
    `INSERT INTO match_rooms (code, host_user_id, title, status, join_password_hash, started_at)
     VALUES (?, ?, ?, ?, ?, ${autoStart ? "datetime('now')" : 'NULL'})`,
    [roomCode, hostUserId, (title || '').trim() || null, status, joinPasswordHash]
  );

  await db.run(
    `INSERT INTO match_room_members (room_id, user_id) VALUES (?, ?)`,
    [insert.lastID, hostUserId]
  );

  await syncLiveSessionsForRoom(db, insert.lastID);

  return getRoomPayload(db, roomCode, hostUserId);
}

async function joinRoom(db, userId, code, password) {
  const room = await getRoomByCode(db, code);
  if (!room) {
    const err = new Error('Código inválido');
    err.status = 404;
    throw err;
  }
  if (room.status === 'closed') {
    const err = new Error('Este lobby já foi encerrado');
    err.status = 400;
    throw err;
  }

  const other = await getUserActiveMembership(db, userId);
  if (other && other.id !== room.id) {
    const err = new Error('Saia do lobby atual antes de entrar em outro');
    err.code = 'ALREADY_IN_ROOM';
    throw err;
  }

  const alreadyMember = await db.get(
    `SELECT 1 FROM match_room_members WHERE room_id = ? AND user_id = ?`,
    [room.id, userId]
  );
  if (!alreadyMember) {
    await verifyRoomPassword(room, password);
  }

  await db.run(
    `INSERT OR IGNORE INTO match_room_members (room_id, user_id) VALUES (?, ?)`,
    [room.id, userId]
  );

  await syncLiveSessionsForRoom(db, room.id);

  return getRoomPayload(db, room.code, userId);
}

async function leaveRoom(db, userId, code) {
  const room = await getRoomByCode(db, code);
  if (!room) {
    const err = new Error('Lobby não encontrado');
    err.status = 404;
    throw err;
  }

  if (room.host_user_id === userId && room.status !== 'closed') {
    const err = new Error('O host deve encerrar o lobby em vez de sair');
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
    const err = new Error('Lobby não encontrado');
    err.status = 404;
    throw err;
  }
  if (room.host_user_id !== hostUserId) {
    const err = new Error('Apenas o host pode iniciar a partida');
    err.status = 403;
    throw err;
  }
  if (room.status === 'closed') {
    const err = new Error('Lobby já encerrado');
    err.status = 400;
    throw err;
  }

  await db.run(
    `UPDATE match_rooms SET status = 'live', started_at = datetime('now') WHERE id = ?`,
    [room.id]
  );

  await syncLiveSessionsForRoom(db, room.id);

  return getRoomPayload(db, room.code, hostUserId);
}

async function closeRoom(db, hostUserId, code) {
  const room = await getRoomByCode(db, code);
  if (!room) {
    const err = new Error('Lobby não encontrado');
    err.status = 404;
    throw err;
  }
  if (room.host_user_id !== hostUserId) {
    const err = new Error('Apenas o host pode encerrar o lobby');
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

async function buildRoomTracking(db, roomId, membersRaw) {
  const room = await db.get(`SELECT * FROM match_rooms WHERE id = ?`, [roomId]);
  if (!room) return null;

  const sessionSince = room.started_at || room.created_at;
  const matchCounts = await db.all(
    `SELECT user_id, COUNT(*) AS n FROM matches
     WHERE room_id = ? AND finished = 1 AND updated_at >= ?
     GROUP BY user_id`,
    [roomId, sessionSince]
  );
  const countByUser = new Map(matchCounts.map((r) => [r.user_id, r.n]));
  const now = Date.now();

  const members = membersRaw.map((m) => {
    const live = liveStore.getLiveMatch(m.id);
    const lastInGame = liveStore.getLastInGameAt(m.id);
    const inGame = !!(lastInGame && now - lastInGame < GSI_OK_MS);
    const liveInRoom = live?.room_id === roomId;

    return {
      id: m.id,
      username: m.username,
      gsi_connected: m.gsi_connected,
      in_game: inGame,
      matches_reported: countByUser.get(m.id) || 0,
      live_map: liveInRoom && inGame ? live.map_name : null,
    };
  });

  return {
    session_since: sessionSince,
    members,
    gsi_ready_count: members.filter((m) => m.gsi_connected).length,
    reported_count: members.filter((m) => m.matches_reported > 0).length,
    in_game_count: members.filter((m) => m.in_game).length,
    members_count: members.length,
  };
}

async function buildRoomResult(db, roomId) {
  const room = await db.get(`SELECT * FROM match_rooms WHERE id = ?`, [roomId]);
  if (!room) return null;

  const sessionSince = room.started_at || room.created_at;

  const matches = await db.all(
    `SELECT m.*, u.username AS tracker_username, u.steam_id AS tracker_steam_id
     FROM matches m
     JOIN users u ON u.id = m.user_id
     WHERE m.room_id = ? AND m.finished = 1 AND m.updated_at >= ?
     ORDER BY m.updated_at DESC`,
    [roomId, sessionSince]
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
    const self = pickSelfStats(match, stats, { userSteamId: match.tracker_steam_id });
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

  const memberRows = await db.all(
    `SELECT u.id, u.username, u.steam_id
     FROM match_room_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.room_id = ?`,
    [roomId]
  );

  for (const member of memberRows) {
    const live = liveStore.getLiveMatch(member.id);
    if (!live || live.room_id !== roomId) continue;

    const stats = live.player_stats || [];
    if (!stats.length) continue;

    const pseudoMatch = {
      owner_steamid: live.owner_steamid,
      user_steam_id: member.steam_id,
    };
    const self = pickSelfStats(pseudoMatch, stats, { userSteamId: member.steam_id });
    if (!self) continue;

    const already = allStats.some(
      (row) => row.tracker_user_id === member.id && row.in_progress
    );
    if (!already) {
      allStats.push({
        ...self,
        tracker_username: member.username,
        tracker_user_id: member.id,
        in_progress: true,
      });
    }

    if (!mapName && live.map_name) mapName = live.map_name;
    if (!gameMode && live.game_mode) gameMode = live.game_mode;
    if ((live.score_ct || 0) + (live.score_t || 0) > scoreCt + scoreT) {
      scoreCt = live.score_ct || 0;
      scoreT = live.score_t || 0;
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
    members_reported: new Set(matches.map((m) => m.user_id)).size,
    scoreboard,
    has_live_stats: allStats.some((row) => row.in_progress),
  };
}

async function getRoomPayload(db, code, viewerUserId) {
  const room = await getRoomByCode(db, code);
  if (!room) return null;

  const membersRaw = await listRoomMembers(db, room.id);
  const viewer = viewerUserId
    ? await db.get(`SELECT role FROM users WHERE id = ?`, [viewerUserId])
    : null;
  const isAdmin = viewer?.role === 'admin';

  const members = membersRaw.map((m) => formatMemberForClient(m, isAdmin));
  const isMember = members.some((m) => m.id === viewerUserId);
  const result =
    room.status === 'closed' || room.status === 'live'
      ? await buildRoomResult(db, room.id)
      : null;

  const gsiReady = members.filter((m) => m.gsi_connected).length;
  const team_balance =
    room.status !== 'closed' && membersRaw.length >= 2
      ? balanceTeams(membersRaw)
      : null;
  const tracking =
    room.status !== 'closed' ? await buildRoomTracking(db, room.id, membersRaw) : null;

  return {
    room: {
      id: room.id,
      code: room.code,
      title: room.title,
      status: room.status,
      host_user_id: room.host_user_id,
      has_password: !!room.join_password_hash,
      created_at: room.created_at,
      started_at: room.started_at,
      closed_at: room.closed_at,
    },
    is_host: room.host_user_id === viewerUserId,
    is_member: isMember,
    members,
    team_balance,
    gsi_ready_count: gsiReady,
    members_count: members.length,
    tracking,
    share_url: `/lobby?code=${room.code}`,
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
  listPublicRooms,
};
