/** Identifica a linha de estatísticas do dono da partida (conta GSI) via Steam ID. */

const { findPlayerStatBySteamIds } = require('./steamId');

function pickSelfStats(match, playerStats, options = {}) {
  const stats = playerStats || [];
  if (!stats.length) return null;

  const found = findPlayerStatBySteamIds(
    stats,
    options.userSteamId,
    match?.user_steam_id,
    match?.owner_steamid
  );
  if (found) return found;

  if (match?.self_stat) {
    const linked = findPlayerStatBySteamIds(
      stats,
      match.self_stat.player_steamid,
      match?.owner_steamid,
      options.userSteamId,
      match?.user_steam_id
    );
    if (linked) return linked;
  }

  // Só jogador na sessão (ex.: DM sem allplayers) — única linha confiável.
  if (stats.length === 1) return stats[0];

  return null;
}

function sortStatsForDisplay(stats, ownerSteamid, userSteamId) {
  const copy = [...stats];
  copy.sort((a, b) => {
    const aSelf = !!findPlayerStatBySteamIds([a], userSteamId, ownerSteamid);
    const bSelf = !!findPlayerStatBySteamIds([b], userSteamId, ownerSteamid);
    if (aSelf !== bSelf) return aSelf ? -1 : 1;
    return (b.score || 0) - (a.score || 0) || (b.kills || 0) - (a.kills || 0);
  });
  return copy;
}

module.exports = { pickSelfStats, sortStatsForDisplay };
