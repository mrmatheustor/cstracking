const api = window.CSTrackingAPI;
const UI = window.MatchUI;

let currentUserId = null;

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b) => {
    const active = b.getAttribute('data-tab') === tab;
    b.classList.toggle('tab-active', active);
  });
  document.getElementById('tab-monitor').classList.toggle('hidden', tab !== 'monitor');
  document.getElementById('tab-users').classList.toggle('hidden', tab !== 'users');
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
});

function renderLiveSessions(sessions) {
  const list = document.getElementById('live-list');
  const empty = document.getElementById('live-empty');
  if (!sessions?.length) {
    empty?.classList.remove('hidden');
    if (list) list.innerHTML = '';
    return;
  }
  empty?.classList.add('hidden');
  list.innerHTML = sessions
    .map((s) => {
      const m = s.match;
      const you = m.player_stats?.[0] || {};
      const score = UI.isDmMode(m.game_mode)
        ? `Pontos ${you.score || you.kills || 0} · ${you.kills || 0}K`
        : `${m.score_ct} x ${m.score_t}`;
      return `
      <article class="card border-green-500/30 p-4">
        <div class="flex justify-between gap-2 mb-2">
          <a href="/profile?id=${s.user.id}" class="font-semibold text-green-400 hover:underline">${s.user.username}</a>
          <span class="text-xs ${s.gsi_connected ? 'text-green-400' : 'text-amber-400'}">${s.gsi_connected ? 'Online' : 'Idle'}</span>
        </div>
        <p class="font-medium capitalize">${UI.mapDisplayName(m.map_name)} · ${m.map_phase || 'live'}</p>
        <p class="text-sm text-slate-300 mt-1">${score}</p>
        <p class="text-xs text-slate-500 mt-2">${you.player_name || '-'} · K/D/A ${you.kills || 0}/${you.deaths || 0}/${you.assists || 0}</p>
      </article>`;
    })
    .join('');
}

function renderRecentMatches(matches) {
  const list = document.getElementById('recent-list');
  const empty = document.getElementById('recent-empty');
  if (!matches?.length) {
    empty?.classList.remove('hidden');
    if (list) list.innerHTML = '';
    return;
  }
  empty?.classList.add('hidden');
  list.innerHTML = matches
    .map((m) => {
      const main = m.player_stats?.[0] || {};
      const mode = UI.modeLabel(m.game_mode);
      return `
      <article class="card p-4 card-interactive">
        <div class="flex justify-between gap-2 mb-2">
          <a href="/profile?id=${m.user_id}" class="text-orange-400 font-medium hover:underline">${m.username}</a>
          <span class="text-xs text-slate-500">${UI.formatDate(m.updated_at)}</span>
        </div>
        <p class="font-semibold capitalize">${UI.mapDisplayName(m.map_name)} ${mode ? `<span class="text-xs text-slate-500">${mode}</span>` : ''}</p>
        <p class="text-sm mt-1">${UI.scoreLine(m, main)}</p>
        <p class="text-xs text-slate-400 mt-1">${main.player_name || '-'} · K/D/A ${main.kills || 0}/${main.deaths || 0}/${main.assists || 0}</p>
      </article>`;
    })
    .join('');
}

function renderUsers(users) {
  const tbody = document.getElementById('admin-users-body');
  tbody.innerHTML = users
    .map((u) => {
      const s = u.stats || {};
      const isSelf = u.id === currentUserId;
      return `
      <tr class="border-t border-slate-800">
        <td class="py-3 px-4">${u.username} ${isSelf ? '<span class="text-xs text-slate-500">(voce)</span>' : ''}</td>
        <td class="py-3 px-4 text-slate-400">${u.email}</td>
        <td class="py-3 px-4 font-mono text-xs text-slate-500">${u.steam_id || '—'}</td>
        <td class="py-3 px-4">${u.role === 'admin' ? '<span class="text-amber-400">Admin</span>' : 'Jogador'}</td>
        <td class="py-3 px-4 text-amber-400/90 font-mono">${s.mmr ?? '—'}</td>
        <td class="py-3 px-4">${s.matches_played ?? 0}</td>
        <td class="py-3 px-4"><a href="/profile?id=${u.id}" class="text-orange-400 text-xs">Ver perfil</a></td>
        <td class="py-3 px-4">
          <select data-user-id="${u.id}" class="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm" ${isSelf ? 'disabled' : ''}>
            <option value="user" ${u.role === 'user' ? 'selected' : ''}>Jogador</option>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
          </select>
        </td>
      </tr>`;
    })
    .join('');

  tbody.querySelectorAll('select[data-user-id]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const userId = sel.getAttribute('data-user-id');
      const msg = document.getElementById('admin-msg');
      try {
        await api.apiRequest(`/api/admin/users/${userId}/role`, {
          method: 'PATCH',
          body: { role: sel.value },
        });
        msg.textContent = 'Permissao atualizada. O usuario deve entrar de novo para o token refletir a mudanca.';
        msg.className = 'text-sm text-green-400';
        await loadUsers();
      } catch (err) {
        msg.textContent = err.message;
        msg.className = 'text-sm text-red-400';
        await loadUsers();
      }
    });
  });
}

async function loadOverview() {
  const data = await api.apiRequest('/api/admin/overview');
  renderLiveSessions(data.live_sessions);
  renderRecentMatches(data.recent_matches);
}

async function loadUsers() {
  const { users } = await api.apiRequest('/api/admin/users');
  renderUsers(users);
}

function formatRepairLog(result) {
  const lines = [];
  const s = result.summary || {};
  lines.push(
    `Banco: ${result.dbPath}`,
    `Partidas finalizadas: ${s.totalFinishedMatches} | Contas com Steam: ${s.usersWithSteam}`,
    `Corrigidas: ${s.fixed} | Ignoradas: ${s.skipped} | IDs normalizados: ${s.normalizedStats}`,
    ''
  );
  for (const row of result.changes || []) {
    lines.push(
      `#${row.matchId} ${row.user} · ${row.map || '?'} · ${row.fromName} → ${row.toName}`
    );
  }
  for (const row of (result.skipped || []).slice(0, 15)) {
    lines.push(
      `[skip] #${row.matchId} ${row.user || ''} · ${row.map || ''} — ${row.reason}`
    );
  }
  if ((result.skipped || []).length > 15) {
    lines.push(`... e mais ${result.skipped.length - 15} ignoradas`);
  }
  return lines.join('\n');
}

async function runRepair(apply) {
  const msg = document.getElementById('repair-msg');
  const log = document.getElementById('repair-log');
  const dryBtn = document.getElementById('repair-dry-btn');
  const applyBtn = document.getElementById('repair-apply-btn');
  msg.classList.remove('hidden');
  msg.textContent = apply ? 'Aplicando correções…' : 'Simulando…';
  msg.className = 'text-sm text-slate-400';
  dryBtn.disabled = true;
  applyBtn.disabled = true;

  try {
    const result = await api.apiRequest(
      `/api/admin/repair-match-owners?apply=${apply ? '1' : '0'}`,
      { method: 'POST' }
    );
    log.textContent = formatRepairLog(result);
    log.classList.remove('hidden');
    const fixed = result.summary?.fixed || 0;
    msg.textContent = apply
      ? `Concluído: ${fixed} partida(s) corrigida(s).`
      : `Simulação: ${fixed} partida(s) seriam corrigidas.`;
    msg.className = `text-sm ${fixed ? 'text-green-400' : 'text-amber-400'}`;
    if (apply && fixed) await loadOverview();
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'text-sm text-red-400';
  } finally {
    dryBtn.disabled = false;
    applyBtn.disabled = false;
  }
}

async function init() {
  const user = await window.CSTrackingNav.initNav({ adminOnly: true });
  if (!user) return;
  currentUserId = user.id;

  document.getElementById('repair-dry-btn')?.addEventListener('click', () => runRepair(false));
  document.getElementById('repair-apply-btn')?.addEventListener('click', () => {
    if (!window.confirm('Gravar correções no banco de produção?')) return;
    runRepair(true);
  });

  await loadOverview();
  await loadUsers();
  setInterval(loadOverview, 5000);
}

init();
