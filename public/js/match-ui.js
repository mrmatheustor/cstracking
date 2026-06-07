function formatDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('pt-BR');
}

function mapDisplayName(name) {
  if (!name) return 'Desconhecido';
  return name.replace(/^de_/i, '').replace(/_/g, ' ');
}

function modeLabel(mode) {
  const labels = {
    deathmatch: 'Deathmatch',
    competitive: 'Competitivo',
    casual: 'Casual',
    wingman: 'Wingman',
    arms_race: 'Arms Race',
  };
  return labels[mode] || (mode && mode !== 'unknown' ? mode : null);
}

function isDmMode(mode) {
  return mode === 'deathmatch' || mode === 'arms_race';
}

function pickSelfStats(match) {
  const stats = match?.player_stats || [];
  if (!stats.length) return match?.self_stat || null;

  const SteamId = window.CSTrackingSteamId;
  if (SteamId) {
    const found = SteamId.findPlayerStatBySteamIds(
      stats,
      match?.user_steam_id,
      match?.owner_steamid
    );
    if (found) return found;
  }

  if (match?.self_stat) return match.self_stat;
  if (stats.length === 1) return stats[0];
  return null;
}

function scoreLine(match, main) {
  const p = main || pickSelfStats(match) || {};
  if (isDmMode(match.game_mode)) {
    return `Pontos ${p.score || p.kills || 0} · K/D/A ${p.kills || 0}/${p.deaths || 0}/${p.assists || 0}`;
  }
  return `CT ${match.score_ct} — ${match.score_t} TR`;
}

function matchUrl(userId, matchId) {
  return `/match?user=${userId}&id=${matchId}`;
}

function kdRatio(kills, deaths) {
  const k = Number(kills) || 0;
  const d = Number(deaths) || 0;
  if (d === 0) return k > 0 ? k.toFixed(2) : '0.00';
  return (k / d).toFixed(2);
}

window.MatchUI = {
  formatDate,
  mapDisplayName,
  modeLabel,
  isDmMode,
  scoreLine,
  pickSelfStats,
  matchUrl,
  kdRatio,
};
