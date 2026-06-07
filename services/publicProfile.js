/** Dados de perfil expostos publicamente (sem e-mail, token, MMR). */

const { publicSteamFields } = require('./steamAuth');

function toPublicProfile(profile, rank = null) {
  if (!profile) return null;

  const base = {
    id: profile.id,
    username: profile.username,
    avatar_url: profile.avatar_url || null,
    created_at: profile.created_at,
    matches_played: profile.matches_played,
    total_kills: profile.total_kills,
    total_deaths: profile.total_deaths,
    total_assists: profile.total_assists,
    total_mvps: profile.total_mvps,
    kd_ratio: profile.kd_ratio,
    ...publicSteamFields(profile),
  };

  if (!rank) return base;

  return {
    ...base,
    rank: rank.rank,
    rank_name: rank.rank_name,
    rank_points: rank.rank_points,
    rank_progress: rank.rank_progress,
    points_in_rank: rank.points_in_rank,
    points_to_next_rank: rank.points_to_next_rank,
    is_max_rank: rank.is_max_rank,
    ranked_wins: rank.ranked_wins,
    ranked_losses: rank.ranked_losses,
    ranked_matches: rank.ranked_matches,
    ranked_winrate: rank.winrate,
  };
}

module.exports = { toPublicProfile };
