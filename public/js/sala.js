const api = window.CSTrackingAPI;
const UI = window.MatchUI;

let pollTimer = null;
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

  const errEl = document.getElementById('lobby-error');
  errEl?.classList.add('hidden');

  if (focus === 'create') {
    document.getElementById('create-title')?.focus();
  } else if (focus === 'join') {
    const join = document.getElementById('join-code');
    join?.focus();
    join?.select();
  }
}

function openLobby(focus) {
  currentCode = null;
  history.replaceState({}, '', '/sala');
  showLobby(focus);
}

function showRoom() {
  const lobby = document.getElementById('lobby-view');
  const room = document.getElementById('room-view');
  lobby.classList.add('hidden');
  room.classList.remove('hidden');
  playViewEnter(room);
}

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function statusLabel(status) {
  const map = {
    open: { text: 'Sala criada — ative o tracking ou entre no CS2', class: 'text-slate-400' },
    live: { text: 'Partida ao vivo — tracking ativo para esta sala', class: 'text-green-400' },
    closed: { text: 'Encerrada — resultado consolidado abaixo', class: 'text-amber-400' },
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
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full ${m.gsi_connected ? 'bg-green-500' : 'bg-slate-600'}"></span>
        <span class="font-medium">${m.username}</span>
        ${m.is_host ? '<span class="text-xs text-amber-400">host</span>' : ''}
      </div>
      <span class="text-xs ${m.gsi_connected ? 'text-green-400' : 'text-slate-500'}">${m.gsi_connected ? 'GSI ok' : 'sem sinal'}</span>
    </li>`
    )
    .join('');
}

function renderResult(result) {
  const section = document.getElementById('result-section');
  const body = document.getElementById('result-body');
  const empty = document.getElementById('result-empty');
  const meta = document.getElementById('result-meta');

  if (!result || !result.scoreboard?.length) {
    section.classList.remove('hidden');
    body.innerHTML = '';
    empty.classList.remove('hidden');
    meta.textContent = result
      ? `${result.matches_count || 0} partida(s) registrada(s) na sala`
      : '';
    return;
  }

  empty.classList.add('hidden');
  section.classList.remove('hidden');

  const mapLabel = UI.mapDisplayName(result.map_name);
  const mode = UI.modeLabel(result.game_mode);
  meta.textContent = [
    mapLabel,
    mode,
    `CT ${result.score_ct} — ${result.score_t} TR`,
    `${result.matches_count} partida(s)`,
  ]
    .filter(Boolean)
    .join(' · ');

  body.innerHTML = result.scoreboard
    .map(
      (p) => `
    <tr>
      <td class="p-4 font-medium">${p.player_name || '—'}</td>
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
    html += `<button type="button" id="btn-new-room" class="btn-primary text-sm">Criar nova partida</button>`;
    html += `<button type="button" id="btn-join-other" class="btn-ghost text-sm">Entrar em outra sala</button>`;
  } else if (isHost && room.status === 'open') {
    html += `<button type="button" id="btn-start" class="btn-primary text-sm">Ativar tracking (ao vivo)</button>`;
    html += `<button type="button" id="btn-close" class="btn-ghost text-sm">Cancelar sala</button>`;
  } else if (isHost && room.status === 'live') {
    html += `<button type="button" id="btn-close" class="btn-primary text-sm">Encerrar sala e ver resultado</button>`;
  } else if (!isHost) {
    html += `<button type="button" id="btn-leave" class="btn-ghost text-sm">Sair da sala</button>`;
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
  if (!confirm('Sair desta sala?')) return;
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
  const fullUrl = `${window.location.origin}${data.share_url || `/sala?code=${data.room.code}`}`;

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
  const pwdEl = document.getElementById('room-lobby-password');
  if (!guide || !steps) return;

  if (room.status === 'closed') {
    guide.classList.add('hidden');
    return;
  }

  guide.classList.remove('hidden');
  const mapHint = room.map_name ? UI.mapDisplayName(room.map_name) : 'o mapa combinado';

  steps.innerHTML = [
    'No CS2: <strong class="text-slate-300">Jogar</strong> → crie um lobby privado ou convide pelo Steam',
    `Defina o mapa: <strong class="text-slate-300">${mapHint}</strong> (ou votem no lobby)`,
    room.lobby_password
      ? `Senha do lobby: use a mesma para todo o time (abaixo)`
      : 'Combine senha do lobby ou convite Steam com o outro time',
    'Todos entram na <strong class="text-slate-300">mesma partida</strong> e iniciam o jogo',
    'Cada um com <strong class="text-slate-300">GSI instalado</strong> (Minha conta) — bolinha verde nesta sala',
  ]
    .map((s) => `<li>${s}</li>`)
    .join('');

  if (room.lobby_password && pwdEl) {
    pwdEl.classList.remove('hidden');
    pwdEl.innerHTML = `Senha do lobby CS2: <code class="text-orange-400 font-mono text-base">${room.lobby_password}</code>`;
  } else if (pwdEl) {
    pwdEl.classList.add('hidden');
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
    eyebrow.textContent = data.room.status === 'closed' ? 'Sala encerrada' : 'Sala ativa';
  }
  document.getElementById('room-title').textContent = data.room.title || 'Sala de partida';

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
  renderActions(data);
  bindCopyHandlers(data);

  if (data.room.status === 'live' || data.room.status === 'closed') {
    renderResult(data.result);
  } else {
    document.getElementById('result-section').classList.add('hidden');
  }

  history.replaceState({}, '', `/sala?code=${data.room.code}`);
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

async function tryAutoJoin(code) {
  try {
    const data = await api.apiRequest('/api/rooms/join', { method: 'POST', body: { code } });
    renderRoom(data, { celebrate: true });
    return true;
  } catch (err) {
    document.getElementById('lobby-error').textContent = err.message;
    document.getElementById('lobby-error').classList.remove('hidden');
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
  const errEl = document.getElementById('lobby-error');
  errEl.classList.add('hidden');
  form.classList.add('form-submitting');
  try {
    const title = document.getElementById('create-title').value;
    const map_name = document.getElementById('create-map')?.value || '';
    const lobby_password = document.getElementById('create-password')?.value || '';
    const data = await api.apiRequest('/api/rooms', {
      method: 'POST',
      body: { title, map_name, lobby_password, auto_start: true },
    });
    renderRoom(data, { celebrate: true });
    startPoll();
  } catch (err) {
    if (err.status === 409 && err.message) {
      const mine = await api.apiRequest('/api/rooms/mine');
      if (mine?.room) {
        renderRoom(mine, { celebrate: true });
        startPoll();
        return;
      }
    }
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    form.classList.remove('form-submitting');
  }
});

document.getElementById('form-join')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = normalizeCode(document.getElementById('join-code').value);
  if (code.length < 4) return;
  const ok = await tryAutoJoin(code);
  if (ok) startPoll();
});

document.getElementById('room-back-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  openLobby();
});

async function init() {
  const user = await window.CSTrackingNav.initNav();
  if (!user) return;

  const params = new URLSearchParams(window.location.search);
  const codeParam = normalizeCode(params.get('code'));

  if (codeParam) {
    const loaded = await loadRoom(codeParam);
    if (loaded) {
      startPoll();
      return;
    }
    document.getElementById('join-code').value = codeParam;
    const joined = await tryAutoJoin(codeParam);
    if (joined) startPoll();
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
