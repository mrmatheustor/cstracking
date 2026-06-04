const api = window.CSTrackingAPI;
const UI = window.MatchUI;

function initials(name) {
  return (name || '?').slice(0, 2).toUpperCase();
}

function renderHeader(profile) {
  document.getElementById('profile-avatar').textContent = initials(profile.username);
  document.getElementById('profile-name').textContent = profile.username;
  document.getElementById('stat-matches').textContent = profile.matches_played;
  document.getElementById('stat-kda').textContent =
    `${profile.total_kills}/${profile.total_deaths}/${profile.total_assists}`;
  document.getElementById('stat-kd').textContent = profile.kd_ratio;
  document.getElementById('stat-mvps').textContent = profile.total_mvps;
  document.getElementById('profile-since').textContent = UI.formatDate(profile.created_at);
}

function renderMatches(matches, userId) {
  const list = document.getElementById('profile-matches');
  const empty = document.getElementById('profile-matches-empty');

  if (!matches?.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  list.innerHTML = matches
    .map((m) => {
      const main = UI.pickSelfStats(m) || {};
      const mode = UI.modeLabel(m.game_mode);
      const href = UI.matchUrl(userId, m.id);
      const count = m.player_stats?.length || 0;
      return `
      <a href="${href}" class="match-row match-row-link block no-underline text-inherit">
        <div>
          <p class="font-semibold capitalize">${UI.mapDisplayName(m.map_name)}</p>
          <p class="text-xs text-slate-500 mt-0.5">${UI.formatDate(m.updated_at)}${mode ? ` · ${mode}` : ''}${count > 1 ? ` · ${count} jogadores` : ''}</p>
        </div>
        <div class="text-right">
          <p class="font-bold text-sm">${UI.scoreLine(m, main)}</p>
          <p class="text-xs text-slate-500">${main.player_name || '—'} · ${main.kills || 0}/${main.deaths || 0}/${main.assists || 0}</p>
          <p class="text-xs text-orange-400/80 mt-1">Scoreboard →</p>
        </div>
      </a>`;
    })
    .join('');
}

function showOwnBanner(userId, loggedUser) {
  const el = document.getElementById('own-account-banner');
  if (!loggedUser || loggedUser.id !== userId) {
    el?.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  el.innerHTML = `Este é o seu perfil público. <a href="/conta" class="text-orange-400 font-medium hover:underline">Ir para Minha conta →</a>`;
}

async function load() {
  const loggedUser = await window.CSTrackingNav.initNav({ publicPage: true });
  const userId = Number(new URLSearchParams(window.location.search).get('id'));
  if (!userId) {
    window.location.href = '/profiles';
    return;
  }

  try {
    const { profile, matches } = await api.apiRequest(`/api/profiles/${userId}`);
    renderHeader(profile);
    renderMatches(matches, userId);
    showOwnBanner(userId, loggedUser);
    document.title = `${profile.username} — CS2 Tracking`;
  } catch (err) {
    if (err.status === 404) {
      document.getElementById('profile-name').textContent = 'Perfil não encontrado';
    }
  }
}

load();
