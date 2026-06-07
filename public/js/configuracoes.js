const api = window.CSTrackingAPI;

function showMsg(errEl, okEl, message, isError) {
  if (errEl) {
    errEl.textContent = isError ? message : '';
    errEl.classList.toggle('hidden', !isError);
  }
  if (okEl) {
    okEl.textContent = isError ? '' : message;
    okEl.classList.toggle('hidden', isError);
  }
}

function mountAvatarSection(user) {
  const avatarWrap = document.getElementById('settings-avatar');
  const uploadWrap = document.getElementById('avatar-upload-wrap');

  if (avatarWrap && window.CSTrackingAvatars) {
    avatarWrap.innerHTML = window.CSTrackingAvatars.html(user, 'user-avatar-lg');
  }

  if (uploadWrap && window.CSTrackingAvatars) {
    uploadWrap.innerHTML = window.CSTrackingAvatars.uploadSectionHtml();

    const input = document.getElementById('avatar-file-input');
    const removeBtn = document.getElementById('avatar-remove-btn');
    const statusEl = document.getElementById('avatar-upload-status');

    input?.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      if (statusEl) statusEl.textContent = 'Enviando…';
      try {
        const data = await api.uploadAvatar(file);
        user.avatar_url = data.avatar_url;
        user.avatar_version = data.avatar_version;
        mountAvatarSection(user);
        window.CSTrackingShell?.refreshProfileChrome?.(user);
      } catch (err) {
        if (statusEl) statusEl.textContent = err.message;
      }
    });

    if (removeBtn) {
      removeBtn.disabled = !user.avatar_url;
      removeBtn.classList.toggle('hidden', !user.avatar_url);
      removeBtn.onclick = async () => {
        if (statusEl) statusEl.textContent = 'Removendo…';
        try {
          const data = await api.removeAvatar();
          user.avatar_url = data.avatar_url;
          user.avatar_version = data.avatar_version;
          mountAvatarSection(user);
          window.CSTrackingShell?.refreshProfileChrome?.(user);
          if (statusEl) statusEl.textContent = 'Foto removida';
        } catch (err) {
          if (statusEl) statusEl.textContent = err.message;
        }
      };
    }
  }
}

function renderSteamMergeOffer(account, fromUsername) {
  const panel = document.getElementById('settings-steam-panel');
  if (!panel) return;

  const needsPassword = !account.login_via_steam && !!account.email;

  panel.innerHTML = `
    <div class="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
      <p class="text-sm text-slate-200">Esta Steam já está na conta <strong class="text-amber-200/90">${fromUsername || 'Steam'}</strong>.</p>
      <p class="text-xs text-slate-400">Você pode <strong class="text-slate-300 font-normal">unir tudo nesta conta</strong> (${account.username}): partidas, ranking e badge Steam. A conta criada só com login Steam será removida.</p>
      ${needsPassword ? '<input id="steam-merge-password" type="password" class="input-field text-sm" placeholder="Senha desta conta (e-mail)" autocomplete="current-password" />' : ''}
      <div class="flex flex-wrap gap-2">
        <button type="button" id="steam-merge-btn" class="btn-primary text-xs">Unir contas</button>
        <button type="button" id="steam-merge-cancel" class="btn-ghost text-xs">Cancelar</button>
      </div>
      <p id="steam-merge-msg" class="text-xs hidden"></p>
    </div>`;

  panel.querySelector('#steam-merge-cancel')?.addEventListener('click', () => {
    window.history.replaceState({}, '', '/configuracoes');
    mountSteamSection(account);
  });

  panel.querySelector('#steam-merge-btn')?.addEventListener('click', async () => {
    const msg = panel.querySelector('#steam-merge-msg');
    const pwd = panel.querySelector('#steam-merge-password')?.value;
    if (msg) {
      msg.textContent = 'Unindo contas…';
      msg.className = 'text-xs text-slate-400';
      msg.classList.remove('hidden');
    }
    try {
      const data = await api.mergeSteamAccount(pwd || undefined);
        Object.assign(account, data.user);
        if (data.token) api.setToken(data.token);
        showMsg(null, document.getElementById('settings-success'), data.message, false);
      window.history.replaceState({}, '', '/configuracoes');
      document.getElementById('settings-username').value = data.user.username || '';
      mountAvatarSection(account);
      mountSteamSection(account);
      window.CSTrackingShell?.refreshProfileChrome?.(data.user);
    } catch (err) {
      if (msg) {
        msg.textContent = err.message;
        msg.className = 'text-xs text-red-400';
      }
    }
  });
}

function mountSteamSection(account) {
  const panel = document.getElementById('settings-steam-panel');
  if (!panel) return;

  const LINK_ERRORS = {
    already_linked: 'Esta conta já tem Steam vinculada.',
    steam_already_used:
      'Esta Steam está em outra conta que não pode ser unida automaticamente. Entre com Steam na home.',
    steam_link_failed: 'Não foi possível vincular a Steam.',
  };

  const params = new URLSearchParams(window.location.search);
  if (params.get('steam_linked') === '1') {
    showMsg(null, document.getElementById('settings-success'), 'Steam vinculada com sucesso.', false);
    window.history.replaceState({}, '', '/configuracoes');
  }
  const linkErr = params.get('steam_link_error');
  if (linkErr) {
    showMsg(document.getElementById('settings-error'), null, LINK_ERRORS[linkErr] || 'Erro ao vincular Steam.', true);
    window.history.replaceState({}, '', '/configuracoes');
  }

  if (params.get('steam_merge_offer') === '1') {
    const from = params.get('from') || 'Steam';
    renderSteamMergeOffer(account, from);
    return;
  }

  if (account.steam_linked) {
    const synced = account.steam_profile_synced_at
      ? new Date(account.steam_profile_synced_at).toLocaleString('pt-BR')
      : 'nunca';
    panel.innerHTML = `
      <div class="flex flex-wrap items-center gap-2">
        ${window.CSTrackingSteamUi?.badgeHtml() || ''}
        <a href="${account.steam_profile_url}" target="_blank" rel="noopener noreferrer" class="steam-profile-link text-sm">Ver na Steam ↗</a>
      </div>
      <p class="text-xs text-slate-500">Última sync: ${synced}${account.avatar_from_steam ? ' · avatar da Steam' : ''}</p>
      <div class="flex flex-wrap gap-2 pt-1">
        <button type="button" id="steam-sync-btn" class="btn-ghost text-xs">Atualizar avatar da Steam</button>
        <label class="inline-flex items-center gap-2 text-xs text-slate-500 cursor-pointer">
          <input type="checkbox" id="steam-sync-username" class="rounded border-slate-600" />
          Atualizar nome de usuário também
        </label>
      </div>
      <p id="steam-sync-msg" class="text-xs hidden"></p>`;

    panel.querySelector('#steam-sync-btn')?.addEventListener('click', async () => {
      const msg = panel.querySelector('#steam-sync-msg');
      const syncUsername = panel.querySelector('#steam-sync-username')?.checked;
      if (msg) {
        msg.textContent = 'Sincronizando…';
        msg.className = 'text-xs text-slate-400';
        msg.classList.remove('hidden');
      }
      try {
        const data = await api.apiRequest('/api/user/sync-steam', {
          method: 'POST',
          body: { sync_username: syncUsername },
        });
        Object.assign(account, data.user);
        mountAvatarSection(account);
        mountSteamSection(account);
        document.getElementById('settings-username').value = data.user.username || '';
        window.CSTrackingShell?.refreshProfileChrome?.(data.user);
        if (msg) {
          const parts = ['Perfil Steam atualizado.'];
          if (data.avatar_updated) parts.push('Avatar atualizado.');
          if (data.username_updated) parts.push('Nome atualizado.');
          msg.textContent = parts.join(' ');
          msg.className = 'text-xs text-green-400';
        }
      } catch (err) {
        if (msg) {
          msg.textContent = err.message;
          msg.className = 'text-xs text-red-400';
        }
      }
    });
    return;
  }

  panel.innerHTML = `
    <p class="text-sm text-slate-400">Sem Steam vinculada. Suas stats usam o ID detectado pelo GSI quando disponível.</p>
    <button type="button" id="steam-link-btn" class="btn-steam w-full sm:w-auto justify-center">Vincular conta Steam</button>
    <p id="steam-link-msg" class="text-xs hidden"></p>
    <p class="text-xs text-slate-600">Abre a Steam para confirmar. Não pedimos sua senha Steam.</p>`;

  panel.querySelector('#steam-link-btn')?.addEventListener('click', async () => {
    const msg = panel.querySelector('#steam-link-msg');
    const btn = panel.querySelector('#steam-link-btn');
    if (msg) {
      msg.textContent = 'Redirecionando para a Steam…';
      msg.className = 'text-xs text-slate-400';
      msg.classList.remove('hidden');
    }
    if (btn) btn.disabled = true;
    try {
      await api.startSteamLink();
    } catch (err) {
      if (btn) btn.disabled = false;
      if (msg) {
        msg.textContent = err.message;
        msg.className = 'text-xs text-red-400';
      }
    }
  });
}

function applyAccountHints(account) {
  const emailInput = document.getElementById('settings-email');
  const emailHint = document.getElementById('settings-email-hint');
  const securityHint = document.getElementById('settings-security-hint');
  const currentPwd = document.getElementById('settings-current-password');

  if (account.login_via_steam) {
    if (emailHint) {
      emailHint.textContent = account.email
        ? 'Usado para login alternativo com senha.'
        : 'Conta criada via Steam — adicione um e-mail se quiser login por senha também.';
    }
    if (emailInput && !account.email) {
      emailInput.placeholder = 'opcional — adicionar e-mail';
      emailInput.removeAttribute('required');
    }
    if (securityHint) {
      securityHint.textContent =
        'Conta Steam: altere usuário/e-mail livremente ou defina uma senha abaixo. Senha atual só é necessária depois de criar uma senha.';
    }
    if (currentPwd) {
      currentPwd.placeholder = 'Opcional até você definir uma senha';
    }
  }
}

async function init() {
  const user = await window.CSTrackingNav.initNav();
  if (!user) return;

  const profileLink = document.getElementById('nav-profile-link');
  const myProfile = document.getElementById('link-my-profile');
  const profileUrl = `/profile?id=${user.id}`;
  if (profileLink) profileLink.href = profileUrl;
  if (myProfile) myProfile.href = profileUrl;

  try {
    const { user: account } = await api.apiRequest('/api/user/profile');
    document.getElementById('settings-username').value = account.username || '';
    document.getElementById('settings-email').value = account.email || '';
    applyAccountHints(account);
    mountAvatarSection(account);
    mountSteamSection(account);
    if (!account.steam_linked) {
      api.getMergeSteamPending?.()
        .then((pending) => {
          if (pending?.pending) {
            renderSteamMergeOffer(account, pending.source_username);
          }
        })
        .catch(() => {});
    }
    if (window.GsiSetup?.mountSettingsPanel) {
      window.GsiSetup.mountSettingsPanel(document.getElementById('settings-gsi-panel'), account);
    }
  } catch (err) {
    console.error(err);
  }

  document.getElementById('form-account')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('settings-error');
    const okEl = document.getElementById('settings-success');
    showMsg(errEl, okEl, '', false);

    const body = {
      username: document.getElementById('settings-username').value,
    };

    const emailVal = document.getElementById('settings-email').value.trim();
    if (emailVal) body.email = emailVal;

    const currentPassword = document.getElementById('settings-current-password').value;
    const newPassword = document.getElementById('settings-new-password').value;

    if (currentPassword) body.current_password = currentPassword;
    if (newPassword) body.new_password = newPassword;

    try {
      const data = await api.apiRequest('/api/user/account', { method: 'PATCH', body });
      if (data.token) api.setToken(data.token);
      showMsg(errEl, okEl, 'Alterações salvas.', false);
      document.getElementById('settings-current-password').value = '';
      document.getElementById('settings-new-password').value = '';
    } catch (err) {
      showMsg(errEl, okEl, err.message, true);
    }
  });
}

init();
