/** Ranking público (PR) + MMR oculto (só admin). Pontos sobem ou descem a cada partida ranked. */

const { pickSelfStats } = require('./matchStats');
const { OWNER_STATS_JOIN } = require('./profileStats');

const STARTING_MMR = 1000;
const DEFAULT_OPPONENT_MMR = 1000;
const MMR_MIN = 100;
const MMR_K = 32;

const RANK_NAMES = [
  'Ferro',
  'Bronze',
  'Prata',
  'Ouro',
  'Platina',
  'Diamante',
  'Mestre',
  'Grão-Mestre',
  'Elite',
  'Lendário',
];

/** Pontos de ranking (PR) acumulados mínimos para cada patente (1–10). */
const RANK_POINTS_THRESHOLDS = [0, 100, 280, 520, 820, 1180, 1620, 2140, 2740, 3420, 4200];

const RANKED_MODES = new Set(['competitive', 'casual', 'wingman']);
const EXCLUDED_MODES = new Set(['deathmatch', 'arms_race']);

function normalizeTeam(raw) {
  const t = String(raw || '').toUpperCase();
  if (t === 'CT' || t.includes('COUNTER')) return 'CT';
  if (t === 'T' || t.includes('TERROR')) return 'T';
  return null;
}

function computeKd(kills, deaths) {
  const k = Number(kills) || 0;
  const d = Number(deaths) || 0;
  if (d === 0) return k > 0 ? k : 0;
  return k / d;
}

function isRankedEligible(gameMode) {
  const mode = (gameMode || '').toLowerCase();
  if (EXCLUDED_MODES.has(mode)) return false;
  return RANKED_MODES.has(mode) || mode === 'unknown';
}

function didPlayerWin(match) {
  const team = match?.owner_team;
  if (!team || match.score_ct == null || match.score_t == null) return null;
  if (match.score_ct === match.score_t) return null;
  if (team === 'CT') return match.score_ct > match.score_t;
  if (team === 'T') return match.score_t > match.score_ct;
  return null;
}

function computeMatchPerformance(stats) {
  if (!stats) return 0.5;

  const kills = Number(stats.kills) || 0;
  const deaths = Math.max(Number(stats.deaths) || 0, 1);
  const assists = Number(stats.assists) || 0;
  const mvps = Number(stats.mvps) || 0;

  const kd = kills / deaths;
  const kda = (kills + assists * 0.5) / deaths;

  const kdScore = Math.min(1, Math.max(0, (kd - 0.4) / 1.6));
  const kdaScore = Math.min(1, Math.max(0, (kda - 0.5) / 2));
  const mvpBonus = Math.min(0.12, mvps * 0.04);

  return Math.min(1, Math.max(0, kdScore * 0.45 + kdaScore * 0.43 + mvpBonus));
}

function getRankFromPoints(rankPoints) {
  const points = Math.max(0, Number(rankPoints) || 0);
  let rank = 1;

  for (let i = RANK_POINTS_THRESHOLDS.length - 2; i >= 0; i--) {
    if (points >= RANK_POINTS_THRESHOLDS[i]) {
      rank = i + 1;
      break;
    }
  }

  const floor = RANK_POINTS_THRESHOLDS[rank - 1] ?? 0;
  const ceiling =
    rank >= RANK_NAMES.length ? floor + 800 : (RANK_POINTS_THRESHOLDS[rank] ?? floor + 800);
  const span = Math.max(ceiling - floor, 1);

  return {
    rank,
    rank_name: RANK_NAMES[Math.min(rank - 1, RANK_NAMES.length - 1)],
    rank_points: points,
    points_in_rank: points - floor,
    points_to_next_rank: ceiling - floor,
    rank_progress: Math.min(1, (points - floor) / span),
    is_max_rank: rank >= RANK_NAMES.length && points >= RANK_POINTS_THRESHOLDS[RANK_NAMES.length],
  };
}

function calcMmrDelta(playerMmr, opponentMmr, won, performance) {
  const expected = 1 / (1 + 10 ** ((opponentMmr - playerMmr) / 400));
  const actual = won ? 1 : 0;
  let delta = MMR_K * (actual - expected);
  delta += (performance - 0.5) * 14;
  delta = Math.round(delta);
  if (won) delta = Math.max(8, delta);
  else {
    delta = Math.min(-8, delta);
    delta = Math.max(-40, delta);
  }
  return delta;
}

function calcRankPointsDelta(won, performance) {
  if (won) {
    return 55 + Math.round(performance * 45);
  }
  // Derrota: perde PR. Bom desempenho reduz a perda (ex.: -12 a -40).
  const loss = 40 - Math.round(performance * 28);
  return -Math.max(12, loss);
}

async function getOpponentMmr(db, userId, roomId) {
  if (!roomId) return DEFAULT_OPPONENT_MMR;

  const row = await db.get(
    `SELECT ROUND(AVG(u.mmr)) AS avg_mmr, COUNT(*) AS n
     FROM match_room_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.room_id = ? AND m.user_id != ?`,
    [roomId, userId]
  );

  if (!row?.n || row.avg_mmr == null) return DEFAULT_OPPONENT_MMR;
  return Number(row.avg_mmr) || DEFAULT_OPPONENT_MMR;
}

async function ensureUserRatingRow(db, userId) {
  await db.run(
    `UPDATE users SET mmr = COALESCE(mmr, ?), level_xp = COALESCE(level_xp, 0),
     rated_wins = COALESCE(rated_wins, 0), rated_losses = COALESCE(rated_losses, 0)
     WHERE id = ?`,
    [STARTING_MMR, userId]
  );
}

async function applyMatchRating(db, userId, matchId) {
  const match = await db.get(`SELECT * FROM matches WHERE id = ? AND user_id = ?`, [matchId, userId]);
  if (!match || match.rating_applied) return null;
  if (!isRankedEligible(match.game_mode)) return null;

  const won = didPlayerWin(match);
  if (won === null) return null;

  const account = await db.get(`SELECT steam_id FROM users WHERE id = ?`, [userId]);

  const stats = await db.all(
    `SELECT player_steamid, player_name, kills, assists, deaths, mvps, score
     FROM player_stats WHERE match_id = ?`,
    [matchId]
  );
  const self = pickSelfStats(match, stats, { userSteamId: account?.steam_id });
  if (!self) return null;

  await ensureUserRatingRow(db, userId);
  const user = await db.get(
    `SELECT mmr, level_xp, rated_wins, rated_losses FROM users WHERE id = ?`,
    [userId]
  );

  const performance = computeMatchPerformance(self);
  const opponentMmr = await getOpponentMmr(db, userId, match.room_id);

  const mmrBefore = user.mmr ?? STARTING_MMR;
  const mmrDelta = calcMmrDelta(mmrBefore, opponentMmr, won, performance);
  const mmrAfter = Math.max(MMR_MIN, mmrBefore + mmrDelta);

  const pointsBefore = user.level_xp ?? 0;
  const pointsDelta = calcRankPointsDelta(won, performance);
  const pointsAfter = Math.max(0, pointsBefore + pointsDelta);

  await db.run(
    `UPDATE users SET mmr = ?, level_xp = ?,
     rated_wins = rated_wins + ?, rated_losses = rated_losses + ?
     WHERE id = ?`,
    [mmrAfter, pointsAfter, won ? 1 : 0, won ? 0 : 1, userId]
  );

  await db.run(`UPDATE matches SET rating_applied = 1 WHERE id = ?`, [matchId]);

  await db.run(
    `INSERT INTO rating_events (user_id, match_id, won, performance, opponent_mmr, mmr_before, mmr_delta, mmr_after, xp_before, xp_delta, xp_after)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      matchId,
      won ? 1 : 0,
      performance,
      opponentMmr,
      mmrBefore,
      mmrDelta,
      mmrAfter,
      pointsBefore,
      pointsDelta,
      pointsAfter,
    ]
  );

  const rank = getRankFromPoints(pointsAfter);
  return {
    won,
    performance: Number(performance.toFixed(3)),
    rank_points_delta: pointsDelta,
    rank_points_after: pointsAfter,
    rank: rank.rank,
    rank_name: rank.rank_name,
    mmr_before: mmrBefore,
    mmr_delta: mmrDelta,
    mmr_after: mmrAfter,
  };
}

async function fetchLifetimeStats(db, userId) {
  return db.get(
    `SELECT
      COUNT(DISTINCT m.id) AS matches_played,
      COALESCE(SUM(ps.kills), 0) AS total_kills,
      COALESCE(SUM(ps.deaths), 0) AS total_deaths
     FROM users u
     LEFT JOIN matches m ON m.user_id = u.id AND m.finished = 1
     ${OWNER_STATS_JOIN}
     WHERE u.id = ?
     GROUP BY u.id`,
    [userId]
  );
}

/** Ranking público — sem MMR. */
async function getPublicRank(db, userId) {
  await ensureUserRatingRow(db, userId);

  const user = await db.get(
    `SELECT level_xp, rated_wins, rated_losses FROM users WHERE id = ?`,
    [userId]
  );
  const stats = await fetchLifetimeStats(db, userId);

  const rankedWins = user?.rated_wins ?? 0;
  const rankedLosses = user?.rated_losses ?? 0;
  const rankedTotal = rankedWins + rankedLosses;
  const rank = getRankFromPoints(user?.level_xp ?? 0);

  const kills = stats?.total_kills || 0;
  const deaths = stats?.total_deaths || 0;

  return {
    ...rank,
    kd_ratio: Number(computeKd(kills, deaths).toFixed(2)),
    winrate: rankedTotal > 0 ? Number(((rankedWins / rankedTotal) * 100).toFixed(1)) : null,
    ranked_wins: rankedWins,
    ranked_losses: rankedLosses,
    ranked_matches: rankedTotal,
    matches_played: stats?.matches_played || 0,
  };
}

/** MMR e histórico recente — apenas admin. */
async function getAdminRating(db, userId) {
  await ensureUserRatingRow(db, userId);
  const user = await db.get(`SELECT mmr FROM users WHERE id = ?`, [userId]);
  const recent = await db.all(
    `SELECT match_id, won, performance, mmr_delta, mmr_after, xp_delta, xp_after, created_at
     FROM rating_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`,
    [userId]
  );

  return {
    mmr: user?.mmr ?? STARTING_MMR,
    recent_events: recent,
  };
}

async function getMemberRatingInternal(db, userId) {
  const publicRank = await getPublicRank(db, userId);
  const mmrRow = await db.get(`SELECT mmr FROM users WHERE id = ?`, [userId]);
  return {
    publicRank,
    mmr: mmrRow?.mmr ?? STARTING_MMR,
  };
}

function formatMemberForClient(member, isAdmin) {
  const { _mmr, rating, ...rest } = member;
  if (isAdmin) {
    return { ...rest, rating: { ...rating, mmr: _mmr } };
  }
  return { ...rest, rating };
}

/** Balanceamento interno por MMR; totais públicos por pontos de ranking (PR). */
function balanceTeams(members) {
  if (!members || members.length < 2) return null;

  const sorted = [...members].sort((a, b) => (b._mmr ?? 0) - (a._mmr ?? 0));
  const teamA = [];
  const teamB = [];
  let mmrA = 0;
  let mmrB = 0;
  let prA = 0;
  let prB = 0;

  for (const member of sorted) {
    const mmr = member._mmr ?? STARTING_MMR;
    const pr = member.rating?.rank_points ?? 0;
    if (mmrA <= mmrB) {
      teamA.push(member);
      mmrA += mmr;
      prA += pr;
    } else {
      teamB.push(member);
      mmrB += mmr;
      prB += pr;
    }
  }

  const strip = (m) => {
    const { _mmr, ...rest } = m;
    return rest;
  };

  return {
    team_a: teamA.map(strip),
    team_b: teamB.map(strip),
    team_a_rank_points: prA,
    team_b_rank_points: prB,
    rank_points_diff: Math.abs(prA - prB),
  };
}

module.exports = {
  STARTING_MMR,
  RANK_NAMES,
  normalizeTeam,
  computeKd,
  computeMatchPerformance,
  isRankedEligible,
  didPlayerWin,
  getRankFromPoints,
  calcRankPointsDelta,
  applyMatchRating,
  getPublicRank,
  getAdminRating,
  getMemberRatingInternal,
  formatMemberForClient,
  balanceTeams,
};
