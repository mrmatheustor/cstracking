const api = window.CSTrackingAPI;
const UI = window.MatchUI;
const Charts = window.CSTrackingCharts;

let profileId = null;
let gsiCleanup = null;

function initials(name) {
  return (name || '?')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
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

function renderActiveRoom(room) {
  const card = document.getElementById('active-room-card');
  const idle = document.getElementById('sala-idle-card');
  if (!room) {
    card?.classList.add('hidden');
    idle?.classList.remove('hidden');
    return;
  }

  card?.classList.remove('hidden');
  idle?.classList.add('hidden');

  const statusMap = { open: 'Aberta', live: 'Ao vivo', closed: 'Encerrada' };
  document.getElementById('active-room-title').textContent = room.title || 'Sala de partida';
  document.getElementById('active-room-code').textContent = room.code;
  document.getElementById('active-room-status').textContent = statusMap[room.status] || room.status;
  const link = document.getElementById('active-room-link');
  if (link) link.href = room.share_url || `/sala?code=${room.code}`;
}

function renderStats(stats, hasFilter, globalProfile) {
  const s = hasFilter ? stats : globalProfile;
  document.getElementById('stat-matches').textContent = s.matches_played ?? 0;
  document.getElementById('stat-kd').textContent = s.kd_ratio ?? '0.00';
  document.getElementById('stat-kills').textContent = s.total_kills ?? 0;
  document.getElementById('stat-deaths').textContent = s.total_deaths ?? 0;
  document.getElementById('stat-assists').textContent = s.total_assists ?? 0;
  document.getElementById('stat-mvps').textContent = s.total_mvps ?? 0;
  document.getElementById('kda-summary').textContent =
    `K/D/A ${s.total_kills}/${s.total_deaths}/${s.total_assists}`;

  const badge = document.getElementById('filter-badge');
  if (badge) badge.classList.toggle('hidden', !hasFilter);
}

function renderMatches(matches) {
  const list = document.getElementById('matches-list');
  const empty = document.getElementById('matches-empty');

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
      const href = UI.matchUrl(profileId, m.id);
      return `
      <a href="${href}" class="match-row match-row-link block no-underline text-inherit">
        <div>
          <p class="font-semibold capitalize text-white">${UI.mapDisplayName(m.map_name)}</p>
          <p class="text-xs text-slate-500 mt-0.5">${UI.formatDate(m.updated_at)}${mode ? ` · ${mode}` : ''}</p>
        </div>
        <div class="text-right">
          <p class="font-bold text-sm">${UI.scoreLine(m, main)}</p>
          <p class="text-xs text-slate-500 mt-0.5">Você · ${main.kills || 0}/${main.deaths || 0}/${main.assists || 0}</p>
          <p class="text-xs text-orange-400/80 mt-1">Ver scoreboard →</p>
        </div>
      </a>`;
    })
    .join('');
}

function renderCharts(charts) {
  Charts.renderKdLine(document.getElementById('chart-kd'), charts?.kd_by_match || []);
  Charts.renderBars(document.getElementById('chart-weeks'), charts?.matches_by_week || [], {
    valueKey: 'count',
    labelKey: 'week',
  });
}

async function loadRank(userId) {
  try {
    const { profiles } = await api.apiRequest('/api/profiles');
    const idx = profiles.findIndex((p) => p.id === userId);
    const el = document.getElementById('stat-rank');
    if (idx >= 0) el.textContent = `#${idx + 1} de ${profiles.length}`;
    else el.textContent = '—';
  } catch {
    document.getElementById('stat-rank').textContent = '—';
  }
}

async function loadDashboard() {
  const data = await api.apiRequest(`/api/user/dashboard${getFilterQuery()}`);

  populateFilterOptions(data.filter_options || {});
  renderStats(data.filtered_stats, data.has_filter, data.profile);
  renderMatches(data.matches);
  renderCharts(data.charts);
  renderActiveRoom(data.active_room);

  return data;
}

function bindFilters() {
  const reload = () => loadDashboard().catch(console.error);

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

async function init() {
  const user = await window.CSTrackingNav.initNav();
  if (!user) return;

  bindFilters();

  try {
    const profileRes = await api.apiRequest('/api/user/profile');
    gsiCleanup = window.GsiSetup.render(
      document.getElementById('gsi-panel-root'),
      profileRes.user,
      { showAdminNote: user.role === 'admin', showManual: false }
    );

    const data = await loadDashboard();
    const { profile } = data;
    profileId = profile.id;

    document.getElementById('avatar').textContent = initials(profile.username);
    document.getElementById('hero-username').textContent = profile.username;
    document.getElementById('hero-email').textContent = user.email;
    document.getElementById('hero-since').textContent = UI.formatDate(profile.created_at);

    const profileUrl = `/profile?id=${profile.id}`;
    document.getElementById('link-perfil-publico').href = profileUrl;
    document.getElementById('share-profile').href = profileUrl;

    loadRank(profile.id);

    if (user.role === 'admin') {
      document.getElementById('admin-hint').classList.remove('hidden');
    }
  } catch (err) {
    console.error(err);
  }
}

init();
