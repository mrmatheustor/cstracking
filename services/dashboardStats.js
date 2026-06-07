const { pickSelfStats } = require('./matchStats');

function kdFromStats(s) {
  if (!s) return 0;
  const k = s.kills || 0;
  const d = s.deaths || 0;
  return d > 0 ? k / d : k;
}

function aggregateFromMatches(matches) {
  let kills = 0;
  let deaths = 0;
  let assists = 0;
  let mvps = 0;

  for (const m of matches) {
    const s = m.self_stat || pickSelfStats(m);
    if (!s) continue;
    kills += s.kills || 0;
    deaths += s.deaths || 0;
    assists += s.assists || 0;
    mvps += s.mvps || 0;
  }

  const count = matches.length;
  const kd = deaths > 0 ? (kills / deaths).toFixed(2) : kills > 0 ? kills.toFixed(2) : '0.00';

  return {
    matches_played: count,
    total_kills: kills,
    total_deaths: deaths,
    total_assists: assists,
    total_mvps: mvps,
    kd_ratio: kd,
  };
}

function weekKey(isoDate) {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const onejan = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - onejan) / 86400000 + onejan.getDay() + 1) / 7);
  return `${d.getFullYear()}-S${week}`;
}

function buildCharts(matches) {
  const chronological = [...matches].reverse().slice(-15);

  const kd_by_match = chronological.map((m, i) => {
    const s = m.self_stat || pickSelfStats(m);
    const kd = kdFromStats(s);
    const map = (m.map_name || '').replace(/^de_/i, '');
    return {
      label: map ? map.slice(0, 8) : `#${i + 1}`,
      kd: Number(kd.toFixed(2)),
      date: m.updated_at,
    };
  });

  const weekCounts = new Map();
  for (const m of matches) {
    const key = weekKey(m.updated_at);
    weekCounts.set(key, (weekCounts.get(key) || 0) + 1);
  }

  const sortedWeeks = [...weekCounts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-8);

  const matches_by_week = sortedWeeks.map(([week, count]) => ({
    week: week.replace('-S', ' sem '),
    count,
  }));

  return { kd_by_match, matches_by_week };
}

async function attachStatsToMatches(db, rows, userSteamId) {
  const result = [];
  for (const match of rows) {
    const stats = await db.all(
      `SELECT player_steamid, player_name, kills, assists, deaths, mvps, score
       FROM player_stats WHERE match_id = ?`,
      [match.id]
    );
    const self_stat = pickSelfStats(match, stats, { userSteamId });
    result.push({ ...match, player_stats: stats, self_stat });
  }
  return result;
}

async function getFilterOptions(db, userId) {
  const maps = await db.all(
    `SELECT DISTINCT map_name FROM matches
     WHERE user_id = ? AND finished = 1 AND map_name IS NOT NULL AND map_name != ''
     ORDER BY map_name`,
    [userId]
  );
  const modes = await db.all(
    `SELECT DISTINCT game_mode FROM matches
     WHERE user_id = ? AND finished = 1 AND game_mode IS NOT NULL AND game_mode != 'unknown'
     ORDER BY game_mode`,
    [userId]
  );
  return {
    maps: maps.map((r) => r.map_name),
    modes: modes.map((r) => r.game_mode),
  };
}

async function getFilteredMatches(db, userId, filters = {}) {
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 100);
  const map = (filters.map || '').trim();
  const mode = (filters.mode || '').trim();
  const days = parseInt(filters.days, 10);

  let sql = `SELECT id, map_name, game_mode, score_ct, score_t, owner_steamid, updated_at, created_at
     FROM matches WHERE user_id = ? AND finished = 1`;
  const params = [userId];

  if (map) {
    sql += ` AND map_name = ?`;
    params.push(map);
  }
  if (mode) {
    sql += ` AND game_mode = ?`;
    params.push(mode);
  }
  if (days > 0 && days <= 365) {
    sql += ` AND updated_at >= datetime('now', '-${days} days')`;
  }

  sql += ` ORDER BY updated_at DESC LIMIT ?`;
  params.push(limit);

  const rows = await db.all(sql, params);
  const user = await db.get(`SELECT steam_id FROM users WHERE id = ?`, [userId]);
  return attachStatsToMatches(db, rows, user?.steam_id);
}

module.exports = {
  getFilteredMatches,
  getFilterOptions,
  aggregateFromMatches,
  buildCharts,
};
