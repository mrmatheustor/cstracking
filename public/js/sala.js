const api = window.CSTrackingAPI;
const UI = window.MatchUI;

let pollTimer = null;
let lobbyListTimer = null;
let currentCode = null;

function normalizeCode(raw) {
  return (raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function playViewEnter(el) {
  if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.classList.remove('view-enter');
  void el.offsetWidth;
  el.classList.add('view-enter');
}

function showLobby(focus) {
  const lobby = document.getElementById('lobby-view');
  const room = document.getElementById('room-view');
  lobby.classList.remove('hidden');
  room.classList.add('hidden');
  room.classList.remove('view-enter');
  playViewEnter(lobby);
  stopPoll();
  loadPublicRooms();
  startLobbyListPoll();

  const errEl = document.getElementById('join-modal-error');
  errEl?.classList.add('hidden');

  if (focus === 'create') {
    openCreateModal();
  } else if (focus === 'join') {
    openJoinModal();
  }
}

function openLobby(focus) {
  currentCode = null;
  history.replaceState({}, '', '/lobby');
  showLobby(focus);
}

function showRoom() {
  const lobby = document.getElementById('lobby-view');
  const room = document.getElementById('room-view');
  lobby.classList.add('hidden');
  room.classList.remove('hidden');
  playViewEnter(room);
  stopLobbyListPoll();
}

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function stopLobbyListPoll() {
  if (lobbyListTimer) {
    clearInterval(lobbyListTimer);
    lobbyListTimer = null;
  }
}

function startLobbyListPoll() {
  stopLobbyListPoll();
  lobbyListTimer = setInterval(() => loadPublicRooms(), 12000);
}

function updateModalOpenState() {
  const anyOpen = [...document.querySelectorAll('.app-modal')].some(
    (m) => !m.classList.contains('hidden')
  );
  document.body.classList.toggle('modal-open', anyOpen);
}

function closeModal(modalId) {
  document.getElementById(modalId)?.classList.add('hidden');
  updateModalOpenState();
}

function openCreateModal() {
  const modal = document.getElementById('create-lobby-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  document.body.classList.add('modal-open');
  document.getElementById('create-modal-error')?.classList.add('hidden');
  document.getElementById('create-title')?.focus();
}

function closeCreateModal() {
  closeModal('create-lobby-modal');
}

function openJoinModal(code = '', { focusPassword = false } = {}) {
  const modal = document.getElementById('join-lobby-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  document.body.classList.add('modal-open');
  document.getElementById('join-modal-error')?.classList.add('hidden');

  const codeInput = document.getElementById('join-code');
  const pwdInput = document.getElementById('join-password');
  if (codeInput) codeInput.value = normalizeCode(code);

  if (focusPassword) pwdInput?.focus();
  else {
    codeInput?.focus();
    codeInput?.select();
  }
}

function closeJoinModal() {
  closeModal('join-lobby-modal');
}

function bindModals() {
  document.getElementById('btn-open-create-modal')?.addEventListener('click', openCreateModal);
  document.getElementById('btn-open-join-modal')?.addEventListener('click', () => openJoinModal());

  document.querySelectorAll('[data-modal-close]').forEach((el) => {
    el.addEventListener('click', () => {
      const modal = el.closest('.app-modal');
      if (modal?.id) closeModal(modal.id);
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = document.querySelector('.app-modal:not(.hidden)');
    if (open?.id) closeModal(open.id);
  });
}

function statusLabel(status) {
  const map = {
    open: { text: 'Lobby criado — ative o tracking ou entre no CS2', class: 'text-slate-400' },
    live: { text: 'Partida ao vivo — tracking ativo para este lobby', class: 'text-green-400' },
    closed: { text: 'Encerrado — resultado consolidado abaixo', class: 'text-amber-400' },
  };
  return map[status] || map.open;
}

function renderMembers(members, { animate = false } = {}) {
  const list = document.getElementById('members-list');
  list.classList.toggle('members-animate', animate);
  list.innerHTML = members
    .map(
      (m) => `
    <li class="member-row flex items-center justify-between gap-3 py-2 border-b border-slate-800/60 last:border-0">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="w-2 h-2 rounded-full ${m.gsi_connected ? 'bg-green-500' : 'bg-slate-600'}"></span>
        <span class="font-medium">${m.username}</span>
        ${m.is_host ? '<span class="text-xs text-amber-400">host</span>' : ''}
        ${m.rating ? `<span class="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-orange-400/90">${m.rating.rank_name || 'Ferro'}</span>` : ''}
        ${m.rating?.mmr != null ? `<span class="text-xs px-1.5 py-0.5 rounded bg-amber-950 text-amber-400" title="Admin">${m.rating.mmr} MMR</span>` : ''}
      </div>
      <div class="text-xs text-right shrink-0">
        ${m.rating ? `<span class="text-slate-400">${m.rating.rank_points ?? 0} PR</span><br>` : ''}
        <span class="${m.gsi_connected ? 'text-green-400' : 'text-slate-500'}">${m.gsi_connected ? 'GSI ok' : 'sem sinal'}</span>
    </li>`
    )
    .join('');
}

function renderTeamBalance(balance, roomStatus) {
  const section = document.getElementById('team-balance-section');
  if (!section) return;

  if (!balance || roomStatus === 'closed') {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');

  const renderPlayer = (m) => {
    const r = m.rating || {};
    const wr = r.ranked_matches > 0 ? `${r.winrate}% WR` : 'sem ranked';
    const pct = r.rank_progress != null ? Math.round(r.rank_progress * 100) : 0;
    return `
      <li class="flex items-center justify-between gap-2 py-1.5 border-b border-slate-800/40 last:border-0">
        <div class="flex items-center gap-2 min-w-0">
          <span class="font-medium truncate">${m.username}</span>
          ${m.is_host ? '<span class="text-xs text-amber-400 shrink-0">host</span>' : ''}
        </div>
        <div class="text-xs text-slate-500 shrink-0 text-right">
          <span class="text-orange-400/90">${r.rank_name || 'Ferro'}</span>
          · ${r.rank_points ?? 0} PR (${pct}%)
          · K/D ${r.kd_ratio ?? '—'} · ${wr}
        </div>
      </li>`;
  };

  document.getElementById('team-a-list').innerHTML = balance.team_a.map(renderPlayer).join('');
  document.getElementById('team-b-list').innerHTML = balance.team_b.map(renderPlayer).join('');
  document.getElementById('team-a-rating').textContent = `Total PR: ${balance.team_a_rank_points ?? 0}`;
  document.getElementById('team-b-rating').textContent = `Total PR: ${balance.team_b_rank_points ?? 0}`;
  document.getElementById('team-balance-diff').textContent = `Diferença: ${balance.rank_points_diff ?? 0} PR`;
}

function renderTracking(tracking, room) {
  const section = document.getElementById('tracking-section');
  if (!section || !tracking || room?.status === 'closed') {
    section?.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');

  const summary = document.getElementById('tracking-summary');
  const liveBadge = document.getElementById('tracking-live-badge');
  const list = document.getElementById('tracking-members');

  if (summary) {
    summary.textContent = `GSI ${tracking.gsi_ready_count}/${tracking.members_count} · ${tracking.reported_count} registraram partida · ${tracking.in_game_count} em jogo agora`;
  }

  liveBadge?.classList.toggle('hidden', room.status !== 'live');

  if (list) {
    list.innerHTML = (tracking.members || [])
      .map((m) => {
        let status = 'sem GSI';
        let statusClass = 'text-slate-500';
        if (m.in_game) {
          status = m.live_map ? `em jogo · ${UI.mapDisplayName(m.live_map)}` : 'em jogo';
          statusClass = 'text-green-400';
        } else if (m.matches_reported > 0) {
          status = `${m.matches_reported} partida(s) registrada(s)`;
          statusClass = 'text-orange-400';
        } else if (m.gsi_connected) {
          status = 'GSI conectado';
          statusClass = 'text-sky-400';
        }

        return `
        <li class="flex items-center justify-between gap-3 py-2 border-b border-slate-800/40 last:border-0">
          <span class="font-medium">${m.username}</span>
          <span class="text-xs ${statusClass} shrink-0">${status}</span>
        </li>`;
      })
      .join('');
  }
}

function buildResultEmptyHtml(result, tracking, roomStatus) {
  const lines = [];
  if (roomStatus !== 'live') {
    lines.push('<p class="font-medium text-slate-300 mb-3">Aguardando tracking</p>');
    lines.push('<p class="text-sm text-slate-500">O host precisa ativar o tracking (ao vivo) antes da partida.</p>');
  } else {
    lines.push('<p class="font-medium text-slate-300 mb-3">Nenhuma estatística ainda</p>');
    lines.push('<ul class="text-sm text-slate-500 space-y-2 text-left max-w-md mx-auto">');
    lines.push(`<li>${tracking?.gsi_ready_count || 0}/${tracking?.members_count || 0} com GSI conectado</li>`);
    lines.push(`<li>${tracking?.reported_count || 0} jogador(es) com partida registrada</li>`);
    lines.push('<li>Joguem uma partida no CS2 — ao terminar, o placar aparece aqui</li>');
    lines.push('</ul>');
  }
  if (result?.matches_count) {
    lines.push(`<p class="text-xs text-slate-600 mt-3">${result.matches_count} partida(s) no banco aguardando stats</p>`);
  }
  return lines.join('');
}

function renderResult(result, tracking, roomStatus) {
  const section = document.getElementById('result-section');
  const body = document.getElementById('result-body');
  const empty = document.getElementById('result-empty');
  const meta = document.getElementById('result-meta');

  if (roomStatus !== 'live' && roomStatus !== 'closed') {
    section.classList.add('hidden');
    return;
  }

  if (!result || !result.scoreboard?.length) {
    section.classList.remove('hidden');
    body.innerHTML = '';
    empty.classList.remove('hidden');
    empty.innerHTML = buildResultEmptyHtml(result, tracking, roomStatus);
    meta.textContent = result?.has_live_stats ? 'Stats parciais em andamento…' : '';
    return;
  }

  empty.classList.add('hidden');
  section.classList.remove('hidden');

  const mapLabel = UI.mapDisplayName(result.map_name);
  const mode = UI.modeLabel(result.game_mode);
  const liveNote = result.has_live_stats ? ' · stats ao vivo' : '';
  meta.textContent = [
    mapLabel,
    mode,
    `CT ${result.score_ct} — ${result.score_t} TR`,
    `${result.members_reported} jogador(es)`,
    `${result.matches_count} partida(s)`,
  ]
    .filter(Boolean)
    .join(' · ') + liveNote;

  body.innerHTML = result.scoreboard
    .map(
      (p) => `
    <tr${p.in_progress ? ' class="opacity-90"' : ''}>
      <td class="p-4 font-medium">${p.player_name || '—'}${p.in_progress ? ' <span class="text-xs text-green-400/80">(ao vivo)</span>' : ''}</td>
      <td class="p-4 text-center">${p.kills ?? 0}</td>
      <td class="p-4 text-center">${p.assists ?? 0}</td>
      <td class="p-4 text-center">${p.deaths ?? 0}</td>
      <td class="p-4 text-center">${UI.kdRatio(p.kills, p.deaths)}</td>
      <td class="p-4 text-center text-xs text-slate-500">${p.tracker_username || '—'}</td>
    </tr>`
    )
    .join('');
}

function renderActions(data) {
  const el = document.getElementById('room-actions');
  const { room, is_host: isHost } = data;
  let html = '';

  if (room.status === 'closed') {
    html += `<p class="room-next-hint w-full">Partida finalizada. Comece outra partida abaixo.</p>`;
    html += `<button type="button" id="btn-new-room" class="btn-primary text-sm">Criar novo lobby</button>`;
    html += `<button type="button" id="btn-join-other" class="btn-ghost text-sm">Entrar em outro lobby</button>`;
  } else if (isHost && room.status === 'open') {
    html += `<button type="button" id="btn-start" class="btn-primary text-sm">Ativar tracking (ao vivo)</button>`;
    html += `<button type="button" id="btn-close" class="btn-ghost text-sm">Cancelar lobby</button>`;
  } else if (isHost && room.status === 'live') {
    html += `<button type="button" id="btn-close" class="btn-primary text-sm">Encerrar lobby e ver resultado</button>`;
  } else if (!isHost) {
    html += `<button type="button" id="btn-leave" class="btn-ghost text-sm">Sair do lobby</button>`;
  }

  el.innerHTML = html;

  document.getElementById('btn-start')?.addEventListener('click', () => roomAction('start'));
  document.getElementById('btn-close')?.addEventListener('click', () => roomAction('close'));
  document.getElementById('btn-leave')?.addEventListener('click', leaveRoom);
  document.getElementById('btn-new-room')?.addEventListener('click', () => openLobby('create'));
  document.getElementById('btn-join-other')?.addEventListener('click', () => openLobby('join'));
}

async function roomAction(action) {
  try {
    const data = await api.apiRequest(`/api/rooms/${currentCode}/${action}`, { method: 'POST' });
    renderRoom(data);
  } catch (err) {
    alert(err.message);
  }
}

async function leaveRoom() {
  if (!confirm('Sair deste lobby?')) return;
  try {
    await api.apiRequest('/api/rooms/leave', { method: 'POST', body: { code: currentCode } });
    openLobby();
  } catch (err) {
    alert(err.message);
  }
}

async function copyWithFeedback(btn, text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }
  const original = btn.textContent;
  btn.classList.add('copy-flash');
  btn.textContent = 'Copiado!';
  setTimeout(() => {
    btn.classList.remove('copy-flash');
    btn.textContent = original;
  }, 1400);
}

function bindCopyHandlers(data) {
  const closed = data.room.status === 'closed';
  const fullUrl = `${window.location.origin}${data.share_url || `/lobby?code=${data.room.code}`}`;

  const btnCode = document.getElementById('btn-copy-code');
  const btnLink = document.getElementById('btn-copy-link');
  const copyGroup = document.getElementById('room-copy-actions');

  if (copyGroup) {
    copyGroup.classList.toggle('hidden', closed);
  }

  [btnCode, btnLink].forEach((btn) => {
    if (!btn) return;
    btn.disabled = closed;
    if (closed) {
      btn.onclick = null;
      btn.classList.remove('copy-flash');
    } else if (btn === btnCode) {
      btn.onclick = () => copyWithFeedback(btnCode, data.room.code);
    } else {
      btn.onclick = () => copyWithFeedback(btnLink, fullUrl);
    }
  });
}

function renderCs2Guide(room) {
  const guide = document.getElementById('cs2-guide');
  const steps = document.getElementById('cs2-guide-steps');
  if (!guide || !steps) return;

  if (room.status === 'closed') {
    guide.classList.add('hidden');
    return;
  }

  guide.classList.remove('hidden');

  steps.innerHTML = [
    'No CS2: <strong class="text-slate-300">Jogar</strong> → crie um lobby privado ou convide pelo Steam',
    'Combinem mapa e times entre vocês (em breve integraremos lobby pelo site)',
    'Todos entram na <strong class="text-slate-300">mesma partida</strong> e iniciam o jogo',
    'Use a <strong class="text-slate-300">sugestão de times</strong> acima para dividir CT/TR no lobby',
    'Cada um com <strong class="text-slate-300">GSI instalado</strong> — bolinha verde neste lobby',
  ]
    .map((s) => `<li>${s}</li>`)
    .join('');
}

function publicRoomStatusLabel(status) {
  if (status === 'live') return { text: 'Ao vivo', class: 'public-room-status--live' };
  return { text: 'Aberta', class: 'public-room-status--open' };
}

function renderPublicRooms(rooms) {
  const list = document.getElementById('public-rooms-list');
  const empty = document.getElementById('public-rooms-empty');
  const loading = document.getElementById('public-rooms-loading');
  if (!list) return;

  loading?.classList.add('hidden');

  if (!rooms?.length) {
    list.innerHTML = '';
    empty?.classList.remove('hidden');
    return;
  }

  empty?.classList.add('hidden');
  list.innerHTML = rooms
    .map((room) => {
      const st = publicRoomStatusLabel(room.status);
      return `
    <li class="public-room-row">
      <div class="public-room-main min-w-0">
        <p class="public-room-title">${room.title}</p>
        <p class="public-room-meta">
          <span class="public-room-code">${room.code}</span>
          · host ${room.host_username}
          · ${room.members_count} jogador${room.members_count !== 1 ? 'es' : ''}
          ${room.has_password ? ' · <span class="public-room-lock" title="Senha obrigatória">🔒</span>' : ''}
          ${room.is_mine ? ' · <span class="text-amber-400/90">seu lobby</span>' : ''}
        </p>
      </div>
      <div class="public-room-actions">
        <span class="public-room-status ${st.class}">${st.text}</span>
        <button type="button" class="btn-ghost text-xs public-room-join" data-code="${room.code}" data-protected="${room.has_password ? '1' : '0'}">
          Entrar
        </button>
      </div>
    </li>`;
    })
    .join('');

  list.querySelectorAll('.public-room-join').forEach((btn) => {
    btn.addEventListener('click', () => {
      const code = btn.getAttribute('data-code');
      const protectedRoom = btn.getAttribute('data-protected') === '1';
      openJoinModal(code, { focusPassword: protectedRoom });
    });
  });
}

async function loadPublicRooms() {
  const loading = document.getElementById('public-rooms-loading');
  try {
    loading?.classList.remove('hidden');
    const data = await api.apiRequest('/api/rooms');
    renderPublicRooms(data.rooms || []);
  } catch {
    /* ignore */
  } finally {
    loading?.classList.add('hidden');
  }
}

function renderRoom(data, { celebrate = false } = {}) {
  if (!data?.room) return;

  currentCode = data.room.code;
  showRoom();

  renderCs2Guide(data.room);

  const st = statusLabel(data.room.status);
  const eyebrow = document.getElementById('room-eyebrow');
  if (eyebrow) {
    eyebrow.textContent = data.room.status === 'closed' ? 'Lobby encerrado' : 'Lobby ativo';
  }
  document.getElementById('room-title').textContent = data.room.title || 'Lobby de partida';

  const codeEl = document.getElementById('room-code');
  codeEl.textContent = data.room.code;
  if (celebrate) {
    const hero = document.querySelector('#room-view .hero-account');
    hero?.classList.remove('celebrate');
    codeEl.classList.remove('code-reveal');
    void codeEl.offsetWidth;
    codeEl.classList.add('code-reveal');
    hero?.classList.add('celebrate');
    setTimeout(() => hero?.classList.remove('celebrate'), 900);
  }

  const statusEl = document.getElementById('room-status');
  statusEl.textContent = st.text;
  statusEl.className = `text-sm mt-2 ${st.class}${data.room.status === 'live' ? ' status-live-pulse' : ''}`;
  document.getElementById('gsi-ready-label').textContent = `GSI: ${data.gsi_ready_count}/${data.members_count} prontos`;

  renderMembers(data.members || [], { animate: celebrate });
  renderTeamBalance(data.team_balance, data.room.status);
  renderTracking(data.tracking, data.room);
  renderActions(data);
  bindCopyHandlers(data);

  if (data.room.status === 'live' || data.room.status === 'closed') {
    renderResult(data.result, data.tracking, data.room.status);
  } else {
    document.getElementById('result-section')?.classList.add('hidden');
  }

  history.replaceState({}, '', `/lobby?code=${data.room.code}`);
}

async function loadRoom(code) {
  try {
    const data = await api.apiRequest(`/api/rooms/${code}`);
    renderRoom(data, { celebrate: false });
    return true;
  } catch (err) {
    if (err.status === 403) return false;
    throw err;
  }
}

async function tryJoinRoom(code, password = '') {
  const errEl = document.getElementById('join-modal-error');
  errEl?.classList.add('hidden');
  try {
    const data = await api.apiRequest('/api/rooms/join', {
      method: 'POST',
      body: { code, password: password || undefined },
    });
    closeJoinModal();
    document.getElementById('form-join')?.reset();
    renderRoom(data, { celebrate: true });
    return true;
  } catch (err) {
    if (errEl) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
    if (err.code === 'PASSWORD_REQUIRED' || err.code === 'WRONG_PASSWORD') {
      document.getElementById('join-password')?.focus();
    }
    return false;
  }
}

function startPoll() {
  stopPoll();
  pollTimer = setInterval(async () => {
    if (!currentCode) return;
    try {
      const data = await api.apiRequest(`/api/rooms/${currentCode}`);
      renderRoom(data);
    } catch {
      /* ignore */
    }
  }, 5000);
}

document.getElementById('form-create')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const errEl = document.getElementById('create-modal-error');
  errEl?.classList.add('hidden');
  form.classList.add('form-submitting');
  try {
    const title = document.getElementById('create-title').value;
    const password = document.getElementById('create-password')?.value || '';
    const data = await api.apiRequest('/api/rooms', {
      method: 'POST',
      body: { title, password, auto_start: true },
    });
    closeCreateModal();
    form.reset();
    renderRoom(data, { celebrate: true });
    startPoll();
  } catch (err) {
    if (err.status === 409 && err.message) {
      const mine = await api.apiRequest('/api/rooms/mine');
      if (mine?.room) {
        closeCreateModal();
        renderRoom(mine, { celebrate: true });
        startPoll();
        return;
      }
    }
    if (errEl) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  } finally {
    form.classList.remove('form-submitting');
  }
});

document.getElementById('form-join')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const code = normalizeCode(document.getElementById('join-code').value);
  const password = document.getElementById('join-password')?.value || '';
  if (code.length < 4) return;
  form.classList.add('form-submitting');
  try {
    const ok = await tryJoinRoom(code, password);
    if (ok) startPoll();
  } finally {
    form.classList.remove('form-submitting');
  }
});

document.getElementById('btn-refresh-rooms')?.addEventListener('click', () => loadPublicRooms());

async function init() {
  const user = await window.CSTrackingNav.initNav();
  if (!user) return;

  if (window.location.pathname === '/sala') {
    history.replaceState({}, '', `/lobby${window.location.search}`);
  }

  bindModals();

  const params = new URLSearchParams(window.location.search);
  const codeParam = normalizeCode(params.get('code'));

  if (codeParam) {
    const loaded = await loadRoom(codeParam);
    if (loaded) {
      startPoll();
      return;
    }
    showLobby();
    openJoinModal(codeParam);
    return;
  }

  try {
    const mine = await api.apiRequest('/api/rooms/mine');
    if (mine?.room) {
      renderRoom(mine);
      startPoll();
      return;
    }
  } catch {
    /* no active room */
  }

  showLobby();
}

init();
