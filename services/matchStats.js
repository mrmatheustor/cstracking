/** Identifica a linha de estatísticas do dono da partida (conta GSI). */

function pickSelfStats(match, playerStats = match?.player_stats) {
  const stats = playerStats || [];
  if (!stats.length) return null;

  const ownerId = (match?.owner_steamid || '').trim();
  if (ownerId) {
    const found = stats.find((s) => (s.player_steamid || '').trim() === ownerId);
    if (found) return found;
  }

  if (stats.length === 1) return stats[0];

  return stats[0];
}

function sortStatsForDisplay(stats, ownerSteamid) {
  const ownerId = (ownerSteamid || '').trim();
  const copy = [...stats];
  copy.sort((a, b) => {
    const aSelf = ownerId && (a.player_steamid || '').trim() === ownerId;
    const bSelf = ownerId && (b.player_steamid || '').trim() === ownerId;
    if (aSelf !== bSelf) return aSelf ? -1 : 1;
    return (b.score || 0) - (a.score || 0) || (b.kills || 0) - (a.kills || 0);
  });
  return copy;
}

module.exports = { pickSelfStats, sortStatsForDisplay };
