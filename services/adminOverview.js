const liveStore = require('./gsiLiveStore');

async function attachPlayerStats(db, matches) {
  const result = [];
  for (const match of matches) {
    const stats = await db.all(
      `SELECT player_steamid, player_name, kills, assists, deaths, mvps, score
       FROM player_stats WHERE match_id = ?
       ORDER BY score DESC, kills DESC`,
      [match.id]
    );
    result.push({ ...match, player_stats: stats });
  }
  return result;
}

async function getGlobalRecentMatches(db, limit = 40) {
  const matches = await db.all(
    `SELECT m.*, u.username, u.id AS user_id
     FROM matches m
     JOIN users u ON u.id = m.user_id
     WHERE m.finished = 1
     ORDER BY m.updated_at DESC
     LIMIT ?`,
    [limit]
  );
  return attachPlayerStats(db, matches);
}

async function getAllLiveSessions(db) {
  const userIds = liveStore.getActiveUserIds();
  const sessions = [];

  for (const userId of userIds) {
    const live = liveStore.getLiveMatch(userId);
    if (!live) continue;

    const user = await db.get(`SELECT id, username, email FROM users WHERE id = ?`, [userId]);
    const lastGsiAt = liveStore.getLastGsiAt(userId);
    const lastInGameAt = liveStore.getLastInGameAt(userId);
    const gsiConnected = lastGsiAt && Date.now() - lastGsiAt < 45000;

    sessions.push({
      user: user ? { id: user.id, username: user.username } : { id: userId, username: '?' },
      gsi_connected: gsiConnected,
      last_gsi_at: lastGsiAt ? new Date(lastGsiAt).toISOString() : null,
      match: {
        match_key: live.match_key,
        map_name: live.map_name,
        map_phase: live.map_phase,
        game_mode: live.game_mode,
        score_ct: live.score_ct,
        score_t: live.score_t,
        player_stats: live.player_stats || [],
        started_at: live.started_at,
      },
    });
  }

  return sessions;
}

module.exports = { getGlobalRecentMatches, getAllLiveSessions };
