const api = window.CSTrackingAPI;
const UI = window.MatchUI;
const Charts = window.CSTrackingCharts;

let profileUserId = null;
let isOwner = false;
let filtersBound = false;
let gsiOnboardingCleanup = null;

function initials(name) {
  return (name || '?').slice(0, 2).toUpperCase();
}

function getFilterQuery() {
  const days = document.getElementById('filter-days')?.value || '';
  const map = document.getElementById('filter-map')?.value || '';
  const mode = document.getElementById('filter-mode')?.value || '';
  const params = new URLSearchParams();
  if (days) params.set('days', days);
  if (map) params.set('map', map);
  if (mode) params.set('mode', mode);
  const q = params.toString();
  return q ? `?${q}` : '';
}

function populateFilterOptions(options) {
  const mapSel = document.getElementById('filter-map');
  const modeSel = document.getElementById('filter-mode');
  if (!mapSel || !modeSel) return;

  const currentMap = mapSel.value;
  const currentMode = modeSel.value;

  mapSel.innerHTML =
    '<option value="">Todos</option>' +
    (options.maps || [])
      .map((m) => `<option value="${m}">${UI.mapDisplayName(m)}</option>`)
      .join('');

  modeSel.innerHTML =
    '<option value="">Todos</option>' +
    (options.modes || [])
      .map((m) => `<option value="${m}">${UI.modeLabel(m) || m}</option>`)
      .join('');

  if (currentMap) mapSel.value = currentMap;
  if (currentMode) modeSel.value = currentMode;
}

function renderHeader(profile) {
  const avatarEl = document.getElementById('profile-avatar');
  if (avatarEl && window.CSTrackingAvatars) {
    avatarEl.innerHTML = window.CSTrackingAvatars.html(profile, 'user-avatar-lg');
  } else if (avatarEl) {
    avatarEl.textContent = initials(profile.username);
  }

  document.getElementById('profile-name').textContent = profile.username;

  const steamMeta = document.getElementById('profile-steam-meta');
  if (steamMeta && window.CSTrackingSteamUi) {
    if (profile.steam_linked) {
      steamMeta.innerHTML = window.CSTrackingSteamUi.profileLinksHtml(profile);
      steamMeta.classList.remove('hidden');
    } else {
      steamMeta.innerHTML = '';
      steamMeta.classList.add('hidden');
    }
  }

  document.getElementById('profile-rank-name').textContent = profile.rank_name || 'Ferro';
  document.getElementById('profile-rank-points').textContent = `${profile.rank_points || 0} PR`;

  const pct = Math.round((profile.rank_progress || 0) * 100);
  document.getElementById('profile-rank-progress-bar').style.width = `${pct}%`;
  document.getElementById('profile-rank-progress-label').textContent = profile.is_max_rank
    ? 'Patente máxima'
    : `${profile.points_in_rank || 0} / ${profile.points_to_next_rank || 0} PR nesta patente (${pct}%)`;

  const wrEl = document.getElementById('profile-ranked-wr');
  if (wrEl) {
    wrEl.textContent =
      profile.ranked_matches > 0
        ? `${profile.ranked_winrate}% (${profile.ranked_wins}V · ${profile.ranked_losses}D)`
        : '—';
  }

  const mmrBlock = document.getElementById('profile-admin-mmr');
  if (mmrBlock) {
    if (profile.mmr != null) {
      mmrBlock.classList.remove('hidden');
      document.getElementById('profile-mmr-value').textContent = profile.mmr;
    } else {
      mmrBlock.classList.add('hidden');
    }
  }

  updateStats(profile, false, profile);
  document.getElementById('profile-since').textContent = UI.formatDate(profile.created_at);

  if (isOwner) {
    document.getElementById('stat-rank-aside').textContent = profile.rank_name || 'Ferro';
  }
}

function updateStats(stats, hasFilter, globalProfile) {
  const s = hasFilter ? stats : globalProfile;

  document.getElementById('stat-matches').textContent = s.matches_played ?? 0;
  document.getElementById('stat-kda').textContent =
    `${s.total_kills ?? 0}/${s.total_deaths ?? 0}/${s.total_assists ?? 0}`;
  document.getElementById('stat-kd').textContent = s.kd_ratio ?? '0.00';
  document.getElementById('stat-mvps').textContent = s.total_mvps ?? 0;

  document.getElementById('filter-badge')?.classList.toggle('hidden', !hasFilter);

  const kdaSummary = document.getElementById('kda-summary');
  if (kdaSummary) {
    kdaSummary.textContent = `K/D/A ${s.total_kills}/${s.total_deaths}/${s.total_assists}`;
  }

  if (isOwner) {
    document.getElementById('stat-deaths-aside').textContent = s.total_deaths ?? 0;
    document.getElementById('stat-assists-aside').textContent = s.total_assists ?? 0;
  }
}

function renderMatches(matches, userId) {
  const list = document.getElementById('profile-matches');
  const empty = document.getElementById('profile-matches-empty');

  if (!matches?.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    if (isOwner && getFilterQuery()) {
      empty.querySelector('p').textContent = 'Nenhuma partida neste filtro';
    } else {
      empty.querySelector('p').textContent = 'Sem partidas registradas';
    }
    return;
  }

  empty.classList.add('hidden');
  list.innerHTML = matches
    .map((m) => {
      const main = UI.pickSelfStats(m) || {};
      const mode = UI.modeLabel(m.game_mode);
      const href = UI.matchUrl(userId, m.id);
      const count = m.player_stats?.length || 0;
      const perfLabel = isOwner
        ? `Você · ${main.kills || 0}/${main.deaths || 0}/${main.assists || 0}`
        : `${main.player_name || '—'} · ${main.kills || 0}/${main.deaths || 0}/${main.assists || 0}`;

      return `
      <a href="${href}" class="match-row match-row-link block no-underline text-inherit">
        <div>
          <p class="font-semibold capitalize">${UI.mapDisplayName(m.map_name)}</p>
          <p class="text-xs text-slate-500 mt-0.5">${UI.formatDate(m.updated_at)}${mode ? ` · ${mode}` : ''}${count > 1 ? ` · ${count} jogadores` : ''}</p>
        </div>
        <div class="text-right">
          <p class="font-bold text-sm">${UI.scoreLine(m, main)}</p>
          <p class="text-xs text-slate-500 mt-0.5">${perfLabel}</p>
        </div>
      </a>`;
    })
    .join('');
}

function renderCharts(charts) {
  if (!Charts) return;
  Charts.renderKdLine(document.getElementById('chart-kd'), charts?.kd_by_match || []);
  Charts.renderBars(document.getElementById('chart-weeks'), charts?.matches_by_week || [], {
    valueKey: 'count',
    labelKey: 'week',
  });
}

function renderActiveRoom(room) {
  const card = document.getElementById('profile-active-room');
  const idle = document.getElementById('lobby-idle-card');
  if (!card) return;

  if (!room) {
    card.classList.add('hidden');
    idle?.classList.remove('hidden');
    return;
  }

  card.classList.remove('hidden');
  idle?.classList.add('hidden');

  const statusMap = { open: 'Aberta', live: 'Ao vivo', closed: 'Encerrada' };
  document.getElementById('active-room-title').textContent = room.title || 'Lobby de partida';
  document.getElementById('active-room-code').textContent = room.code;
  document.getElementById('active-room-status').textContent = statusMap[room.status] || room.status;
  const link = document.getElementById('active-room-link');
  if (link) link.href = room.share_url || `/lobby?code=${room.code}`;
}

async function loadLeaderboardPosition(userId) {
  try {
    const { profiles } = await api.apiRequest('/api/profiles');
    const idx = profiles.findIndex((p) => p.id === userId);
    const el = document.getElementById('profile-leaderboard');
    if (idx >= 0) el.textContent = `#${idx + 1} de ${profiles.length}`;
    else el.textContent = '—';
  } catch {
    document.getElementById('profile-leaderboard').textContent = '—';
  }
}

function setOwnerLayout(enabled) {
  isOwner = enabled;

  document.getElementById('profile-filters')?.classList.toggle('hidden', !enabled);
  document.getElementById('profile-charts')?.classList.toggle('hidden', !enabled);
  document.getElementById('profile-aside')?.classList.toggle('hidden', !enabled);
  document.getElementById('profile-leaderboard-wrap')?.classList.toggle('hidden', !enabled);
  document.getElementById('kda-summary')?.classList.toggle('hidden', !enabled);

  const grid = document.getElementById('profile-content-grid');
  if (grid) {
    grid.classList.toggle('lg:grid-cols-3', enabled);
  }
  document.getElementById('profile-matches-section')?.classList.toggle('lg:col-span-2', enabled);
}

async function loadOwnerDashboard() {
  const data = await api.apiRequest(`/api/user/dashboard${getFilterQuery()}`);

  populateFilterOptions(data.filter_options || {});
  updateStats(data.filtered_stats, data.has_filter, data.profile);
  renderMatches(data.matches, profileUserId);
  renderCharts(data.charts);
  renderActiveRoom(data.active_room);

  return data;
}

function setupGsiOnboarding(loggedUser, profile) {
  const wrap = document.getElementById('gsi-onboarding-wrap');
  if (!wrap || !loggedUser || !window.GsiSetup?.mountProfileCard) return;

  const needsOnboarding = (profile.matches_played || 0) === 0;
  if (!needsOnboarding) {
    wrap.classList.add('hidden');
    wrap.innerHTML = '';
    if (gsiOnboardingCleanup) {
      gsiOnboardingCleanup();
      gsiOnboardingCleanup = null;
    }
    return;
  }

  wrap.classList.remove('hidden');
  if (gsiOnboardingCleanup) gsiOnboardingCleanup();
  gsiOnboardingCleanup = window.GsiSetup.mountProfileCard(wrap, loggedUser);
}

function bindOwnerFilters() {
  if (filtersBound) return;
  filtersBound = true;

  const reload = () => loadOwnerDashboard().catch(console.error);

  document.getElementById('filter-days')?.addEventListener('change', reload);
  document.getElementById('filter-map')?.addEventListener('change', reload);
  document.getElementById('filter-mode')?.addEventListener('change', reload);

  document.getElementById('filter-reset')?.addEventListener('click', () => {
    document.getElementById('filter-days').value = '';
    document.getElementById('filter-map').value = '';
    document.getElementById('filter-mode').value = '';
    reload();
  });
}

async function load() {
  const loggedUser = await window.CSTrackingNav.initNav({ publicPage: true });
  profileUserId = Number(new URLSearchParams(window.location.search).get('id'));

  if (!profileUserId) {
    window.location.href = '/profiles';
    return;
  }

  const ownerView = loggedUser?.id === profileUserId;
  setOwnerLayout(ownerView);

  try {
    const { profile, matches } = await api.apiRequest(`/api/profiles/${profileUserId}`);
    renderHeader(profile);

    if (ownerView) {
      bindOwnerFilters();
      const dash = await loadOwnerDashboard();
      loadLeaderboardPosition(profileUserId);
      setupGsiOnboarding(loggedUser, dash?.profile || profile);
    } else {
      renderMatches(matches, profileUserId);
    }

    document.title = `${profile.username} — CS2 Tracking`;
  } catch (err) {
    if (err.status === 404) {
      document.getElementById('profile-name').textContent = 'Perfil não encontrado';
    }
  }
}

load();
