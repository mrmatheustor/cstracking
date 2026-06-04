/** Agrega estatísticas por usuário a partir das partidas finalizadas (só linha do dono). */

const { pickSelfStats } = require('./matchStats');

/**
 * JOIN das stats do dono — evita subquery correlata com m.owner_steamid (limite do SQLite no ON).
 */
const OWNER_STATS_JOIN = `
  LEFT JOIN player_stats ps ON ps.match_id = m.id
    AND (
      (m.owner_steamid IS NOT NULL AND m.owner_steamid != '' AND ps.player_steamid = m.owner_steamid)
      OR (
        (m.owner_steamid IS NULL OR m.owner_steamid = '')
        AND u.steam_id IS NOT NULL AND u.steam_id != ''
        AND ps.player_steamid = u.steam_id
      )
      OR (
        (m.owner_steamid IS NULL OR m.owner_steamid = '')
        AND (SELECT COUNT(*) FROM player_stats c WHERE c.match_id = m.id) = 1
        AND ps.id = (SELECT ps2.id FROM player_stats ps2 WHERE ps2.match_id = m.id LIMIT 1)
      )
      OR (
        (m.owner_steamid IS NULL OR m.owner_steamid = '')
        AND (SELECT COUNT(*) FROM player_stats c WHERE c.match_id = m.id) > 1
        AND (u.steam_id IS NULL OR u.steam_id = '')
        AND ps.id = (
          SELECT ps2.id FROM player_stats ps2
          WHERE ps2.match_id = m.id
          ORDER BY ps2.kills DESC, ps2.score DESC
          LIMIT 1
        )
      )
    )
`;

const PROFILE_LIST_SQL = `
  SELECT
    u.id,
    u.username,
    u.role,
    u.created_at,
    COUNT(DISTINCT m.id) AS matches_played,
    COALESCE(SUM(ps.kills), 0) AS total_kills,
    COALESCE(SUM(ps.deaths), 0) AS total_deaths,
    COALESCE(SUM(ps.assists), 0) AS total_assists,
    COALESCE(SUM(ps.mvps), 0) AS total_mvps
  FROM users u
  LEFT JOIN matches m ON m.user_id = u.id AND m.finished = 1
  ${OWNER_STATS_JOIN}
  GROUP BY u.id
  ORDER BY matches_played DESC, u.username ASC
`;

const PROFILE_DETAIL_SQL = `
  SELECT
    u.id,
    u.username,
    u.role,
    u.created_at,
    COUNT(DISTINCT m.id) AS matches_played,
    COALESCE(SUM(ps.kills), 0) AS total_kills,
    COALESCE(SUM(ps.deaths), 0) AS total_deaths,
    COALESCE(SUM(ps.assists), 0) AS total_assists,
    COALESCE(SUM(ps.mvps), 0) AS total_mvps
  FROM users u
  LEFT JOIN matches m ON m.user_id = u.id AND m.finished = 1
  ${OWNER_STATS_JOIN}
  WHERE u.id = ?
  GROUP BY u.id
`;

function enrichProfile(row) {
  if (!row) return null;
  const deaths = row.total_deaths || 0;
  const kills = row.total_kills || 0;
  const kd = deaths > 0 ? (kills / deaths).toFixed(2) : kills > 0 ? kills.toFixed(2) : '0.00';
  return {
    id: row.id,
    username: row.username,
    role: row.role || 'user',
    created_at: row.created_at,
    matches_played: row.matches_played || 0,
    total_kills: kills,
    total_deaths: deaths,
    total_assists: row.total_assists || 0,
    total_mvps: row.total_mvps || 0,
    kd_ratio: kd,
  };
}

async function listProfiles(db) {
  const rows = await db.all(PROFILE_LIST_SQL);
  return rows.map(enrichProfile);
}

async function getProfileById(db, userId) {
  const row = await db.get(PROFILE_DETAIL_SQL, [userId]);
  return enrichProfile(row);
}

async function getMatchesForProfile(db, userId, limit = 30) {
  const matches = await db.all(
    `SELECT id, map_name, game_mode, score_ct, score_t, owner_steamid, updated_at, created_at
     FROM matches WHERE user_id = ? AND finished = 1
     ORDER BY updated_at DESC LIMIT ?`,
    [userId, limit]
  );

  const result = [];
  for (const match of matches) {
    const stats = await db.all(
      `SELECT player_steamid, player_name, kills, assists, deaths, mvps, score
       FROM player_stats WHERE match_id = ?
       ORDER BY score DESC, kills DESC`,
      [match.id]
    );
    const self_stat = pickSelfStats(match, stats);
    result.push({ ...match, player_stats: stats, self_stat });
  }
  return result;
}

async function getMatchDetail(db, userId, matchId) {
  const match = await db.get(
    `SELECT m.*, u.username AS owner_username
     FROM matches m
     JOIN users u ON u.id = m.user_id
     WHERE m.id = ? AND m.user_id = ? AND m.finished = 1`,
    [matchId, userId]
  );

  if (!match) return null;

  const player_stats = await db.all(
    `SELECT player_steamid, player_name, kills, assists, deaths, mvps, score
     FROM player_stats WHERE match_id = ?
     ORDER BY score DESC, kills DESC`,
    [matchId]
  );

  const self_stat = pickSelfStats(match, player_stats);

  return {
    match: {
      id: match.id,
      user_id: match.user_id,
      owner_username: match.owner_username,
      map_name: match.map_name,
      map_phase: match.map_phase,
      game_mode: match.game_mode,
      score_ct: match.score_ct,
      score_t: match.score_t,
      owner_steamid: match.owner_steamid,
      created_at: match.created_at,
      updated_at: match.updated_at,
    },
    player_stats,
    self_stat,
    scoreboard_count: player_stats.length,
  };
}

module.exports = {
  listProfiles,
  getProfileById,
  getMatchesForProfile,
  getMatchDetail,
};
