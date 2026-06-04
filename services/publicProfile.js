/** Dados de perfil expostos publicamente (sem e-mail, token, etc.). */

function toPublicProfile(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    username: profile.username,
    created_at: profile.created_at,
    matches_played: profile.matches_played,
    total_kills: profile.total_kills,
    total_deaths: profile.total_deaths,
    total_assists: profile.total_assists,
    total_mvps: profile.total_mvps,
    kd_ratio: profile.kd_ratio,
  };
}

module.exports = { toPublicProfile };
