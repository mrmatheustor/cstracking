const api = window.CSTrackingAPI;

let allProfiles = [];

function initials(name) {
  return (name || '?').slice(0, 2).toUpperCase();
}

function getFilterState() {
  return {
    q: (document.getElementById('profile-search')?.value || '').trim().toLowerCase(),
    sort: document.getElementById('profile-sort')?.value || 'rank',
    minMatches: Number(document.getElementById('profile-min-matches')?.value || 0),
    onlyActive: document.getElementById('profile-only-active')?.checked || false,
  };
}

function sortProfiles(list, sortKey) {
  const copy = [...list];
  switch (sortKey) {
    case 'name':
      return copy.sort((a, b) => (a.username || '').localeCompare(b.username || '', 'pt-BR'));
    case 'kd':
      return copy.sort((a, b) => Number(b.kd_ratio) - Number(a.kd_ratio));
    case 'kills':
      return copy.sort((a, b) => (b.total_kills || 0) - (a.total_kills || 0));
    case 'mvps':
      return copy.sort((a, b) => (b.total_mvps || 0) - (a.total_mvps || 0));
    case 'rank':
    default:
      return copy.sort(
        (a, b) =>
          (b.rank_points || 0) - (a.rank_points || 0) ||
          (b.ranked_matches || 0) - (a.ranked_matches || 0)
      );
  }
}

function filterProfiles(list, state) {
  return list.filter((p) => {
    if (state.onlyActive && (p.matches_played || 0) < 1) return false;
    if (state.minMatches > 0 && (p.matches_played || 0) < state.minMatches) return false;
    if (state.q && !(p.username || '').toLowerCase().includes(state.q)) return false;
    return true;
  });
}

function renderProfiles(profiles) {
  const list = document.getElementById('profiles-list');
  const empty = document.getElementById('profiles-empty');
  const noResults = document.getElementById('profiles-no-results');
  const countEl = document.getElementById('profiles-count');

  empty?.classList.add('hidden');
  noResults?.classList.add('hidden');

  if (!allProfiles.length) {
    empty?.classList.remove('hidden');
    if (list) list.innerHTML = '';
    if (countEl) countEl.textContent = '';
    return;
  }

  if (!profiles?.length) {
    noResults?.classList.remove('hidden');
    if (list) list.innerHTML = '';
    if (countEl) countEl.textContent = `0 de ${allProfiles.length} jogadores`;
    return;
  }

  if (countEl) {
    countEl.textContent =
      profiles.length === allProfiles.length
        ? `${profiles.length} jogador${profiles.length !== 1 ? 'es' : ''} no ranking`
        : `Mostrando ${profiles.length} de ${allProfiles.length}`;
  }

  list.innerHTML = profiles
    .map((p, i) => {
      const rankIndex = allProfiles.findIndex((x) => x.id === p.id) + 1;
      const rankLabel = rankIndex > 0 ? `#${rankIndex} no ranking` : '';
      const rankBadge = rankIndex > 0 ? `#${rankIndex}` : '';
      const avatarHtml = window.CSTrackingAvatars
        ? window.CSTrackingAvatars.html(p, 'user-avatar-md')
        : `<div class="avatar">${initials(p.username)}</div>`;
      return `
    <a href="/profile?id=${p.id}" class="profile-card-link card card-interactive">
      ${rankBadge ? `<span class="profile-card-rank">${rankBadge}</span>` : ''}
      <div class="profile-card-head">
        ${avatarHtml}
        <div class="min-w-0">
          <h3 class="profile-card-name">${p.username}${window.CSTrackingSteamUi ? window.CSTrackingSteamUi.cardMetaHtml(p) : ''}</h3>
          <p class="text-xs font-medium text-orange-400/90">${p.rank_name || 'Ferro'}</p>
          <p class="text-xs" style="color: var(--muted);">${rankLabel || `Posição ${i + 1}`} · ${p.rank_points || 0} PR</p>
        </div>
      </div>
      <div class="profile-stat-grid">
        <div>
          <p class="stat-label">Partidas</p>
          <p class="val accent">${p.matches_played}</p>
        </div>
        <div>
          <p class="stat-label">K/D</p>
          <p class="val">${p.kd_ratio}</p>
        </div>
        <div>
          <p class="stat-label">MVPs</p>
          <p class="val">${p.total_mvps}</p>
        </div>
      </div>
      <p class="profile-kda">K/D/A ${p.total_kills}/${p.total_deaths}/${p.total_assists}</p>
    </a>`;
    })
    .join('');
}

function applyFilters() {
  const state = getFilterState();
  const filtered = filterProfiles(allProfiles, state);
  const sorted = sortProfiles(filtered, state.sort);
  renderProfiles(sorted);
}

function bindFilters() {
  const search = document.getElementById('profile-search');
  let debounceTimer = null;

  search?.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applyFilters, 200);
  });

  document.getElementById('profile-sort')?.addEventListener('change', applyFilters);
  document.getElementById('profile-min-matches')?.addEventListener('change', applyFilters);
  document.getElementById('profile-only-active')?.addEventListener('change', applyFilters);

  document.getElementById('profile-clear-filters')?.addEventListener('click', () => {
    if (search) search.value = '';
    const sort = document.getElementById('profile-sort');
    const minM = document.getElementById('profile-min-matches');
    const only = document.getElementById('profile-only-active');
    if (sort) sort.value = 'rank';
    if (minM) minM.value = '0';
    if (only) only.checked = false;
    applyFilters();
  });
}

async function load() {
  await window.CSTrackingNav.initNav({ publicPage: true });
  bindFilters();

  try {
    const { profiles } = await api.apiRequest('/api/profiles');
    allProfiles = sortProfiles(profiles || [], 'rank');
    applyFilters();
  } catch (err) {
    console.error(err);
  }
}

load();
