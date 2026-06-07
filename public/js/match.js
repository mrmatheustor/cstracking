const api = window.CSTrackingAPI;
const UI = window.MatchUI;

function sortPlayers(stats, ownerSteamid, userSteamId) {
  const SteamId = window.CSTrackingSteamId;
  const copy = [...stats];
  copy.sort((a, b) => {
    const aSelf = SteamId?.findPlayerStatBySteamIds([a], ownerSteamid, userSteamId);
    const bSelf = SteamId?.findPlayerStatBySteamIds([b], ownerSteamid, userSteamId);
    if (!!aSelf !== !!bSelf) return aSelf ? -1 : 1;
    return (b.score || 0) - (a.score || 0) || (b.kills || 0) - (a.kills || 0);
  });
  return copy;
}

function renderScoreboard(match, stats) {
  const body = document.getElementById('scoreboard-body');
  const empty = document.getElementById('scoreboard-empty');
  const countEl = document.getElementById('player-count');
  const hint = document.getElementById('scoreboard-hint');

  if (!stats?.length) {
    body.innerHTML = '';
    empty.classList.remove('hidden');
    countEl.textContent = '';
    return;
  }

  empty.classList.add('hidden');
  countEl.textContent = `${stats.length} jogador${stats.length !== 1 ? 'es' : ''}`;
  if (stats.length > 1) hint.classList.remove('hidden');

  const ownerId = match.owner_steamid || '';
  const userSteamId = match.user_steam_id || '';
  const sorted = sortPlayers(stats, ownerId, userSteamId);

  body.innerHTML = sorted
    .map((p, i) => {
      const isSelf = !!window.CSTrackingSteamId?.findPlayerStatBySteamIds(
        [p],
        ownerId,
        userSteamId
      );
      const rowClass = isSelf ? 'scoreboard-row-self' : '';
      return `
      <tr class="${rowClass}">
        <td class="p-4 text-slate-500">${i + 1}</td>
        <td class="p-4 font-medium">
          ${p.player_name || 'Desconhecido'}
          ${isSelf ? '<span class="text-orange-400 text-xs ml-2">você</span>' : ''}
        </td>
        <td class="p-4 text-center">${p.kills ?? 0}</td>
        <td class="p-4 text-center">${p.assists ?? 0}</td>
        <td class="p-4 text-center">${p.deaths ?? 0}</td>
        <td class="p-4 text-center">${UI.kdRatio(p.kills, p.deaths)}</td>
        <td class="p-4 text-center">${p.mvps ?? 0}</td>
        <td class="p-4 text-center text-slate-400">${p.score ?? 0}</td>
      </tr>`;
    })
    .join('');
}

function renderHeader(detail) {
  const { match, self_stat, scoreboard_count } = detail;
  const header = document.getElementById('match-header');
  header.classList.remove('hidden');

  const mode = UI.modeLabel(match.game_mode);
  document.getElementById('match-map').textContent = UI.mapDisplayName(match.map_name);
  document.getElementById('match-meta').textContent = [
    match.owner_username,
    UI.formatDate(match.updated_at),
    mode,
  ]
    .filter(Boolean)
    .join(' · ');

  document.getElementById('match-score').textContent = UI.scoreLine(match, self_stat);

  const selfEl = document.getElementById('match-self');
  if (self_stat) {
    selfEl.classList.remove('hidden');
    selfEl.textContent = `Sua performance: ${self_stat.kills}/${self_stat.deaths}/${self_stat.assists} · K/D ${UI.kdRatio(self_stat.kills, self_stat.deaths)}`;
  }

  document.title = `${UI.mapDisplayName(match.map_name)} — ${match.owner_username}`;
}

async function load() {
  const loggedUser = await window.CSTrackingNav.initNav({ publicPage: true });
  const params = new URLSearchParams(window.location.search);
  const userId = Number(params.get('user'));
  const matchId = Number(params.get('id'));

  if (!userId || !matchId) {
    document.getElementById('match-error').textContent = 'Link inválido.';
    document.getElementById('match-error').classList.remove('hidden');
    return;
  }

  try {
    const detail = await api.apiRequest(`/api/profiles/${userId}/matches/${matchId}`);
    renderHeader(detail);
    renderScoreboard(detail.match, detail.player_stats);
  } catch (err) {
    const el = document.getElementById('match-error');
    el.textContent = err.status === 404 ? 'Partida não encontrada.' : err.message || 'Erro ao carregar.';
    el.classList.remove('hidden');
  }
}

load();
