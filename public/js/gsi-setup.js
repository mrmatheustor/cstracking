/** GSI — dropdown no header (logado) */
window.GsiSetup = {
  STEAM_HELP_URL:
    'https://help.steampowered.com/pt-br/wizard/HelpWithGameIssue/?appid=730&issueid=128',
  CFG_FOLDER: 'game\\csgo\\cfg',
  CFG_NAME: 'gamestate_integration_cstracking.cfg',

  userHasGsi(user) {
    return user?.has_gsi !== false;
  },

  async fetchCfgPreview() {
    return window.CSTrackingAPI.apiRequest('/api/user/gsi-preview');
  },

  async loadCfgPreview(container) {
    const pre = container.querySelector('#gsi-cfg-preview');
    const errEl = container.querySelector('#gsi-preview-error');
    if (!pre) return;
    pre.textContent = 'Carregando…';
    try {
      const data = await this.fetchCfgPreview();
      pre.textContent = data.cfg_content || '';
      if (errEl) errEl.classList.add('hidden');
    } catch (err) {
      pre.textContent = '';
      if (errEl) {
        errEl.textContent = err.message || 'Não foi possível carregar o preview.';
        errEl.classList.remove('hidden');
      }
    }
  },

  _cfgPreviewHtml() {
    return `
      <div class="gsi-cfg-preview-wrap">
        <div class="flex items-center justify-between gap-2 mb-2">
          <p class="text-xs font-medium text-slate-400">Conteúdo do arquivo (confira antes de instalar)</p>
          <button type="button" id="gsi-refresh-preview" class="btn-ghost text-xs py-1 px-2">Atualizar</button>
        </div>
        <pre id="gsi-cfg-preview" class="gsi-cfg-preview">Carregando…</pre>
        <p id="gsi-preview-error" class="text-xs text-red-400 hidden mt-2"></p>
        <p class="text-xs text-slate-600 mt-2">Contém URL do servidor e token de autenticação — não compartilhe o arquivo.</p>
      </div>`;
  },

  _securityLinksHtml() {
    return `<p class="text-xs text-slate-600"><a href="/seguranca" class="text-orange-400/90 hover:underline">Como funciona e por que é seguro</a> · <a href="/privacidade" class="text-orange-400/90 hover:underline">Privacidade</a></p>`;
  },

  async fetchStatus() {
    try {
      return await window.CSTrackingAPI.apiRequest('/api/user/gsi-status');
    } catch {
      return null;
    }
  },

  statusLabel(status) {
    if (!status) return { text: 'Indisponível', className: 'text-slate-500', dot: 'bg-slate-500' };
    if (status.in_game) {
      return { text: 'Em partida', className: 'text-green-400', dot: 'bg-green-500 animate-pulse' };
    }
    if (status.gsi_connected) {
      return { text: 'Conectado', className: 'text-green-400', dot: 'bg-green-500' };
    }
    if (status.last_gsi_at) {
      return { text: 'Sem sinal', className: 'text-amber-400', dot: 'bg-amber-500' };
    }
    return { text: 'Não instalado', className: 'text-slate-400', dot: 'bg-slate-600' };
  },

  async _downloadFile(url, fallbackName) {
    const token = window.CSTrackingAPI.getToken();
    if (!token) throw new Error('Faça login primeiro');

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Falha no download');
    }

    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^"]+)"?/i);
    const filename = match ? match[1] : fallbackName;

    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(objectUrl);
  },

  downloadCfg() {
    return this._downloadFile('/api/user/install-gsi.cfg', this.CFG_NAME);
  },

  downloadInstaller() {
    return this._downloadFile('/api/user/install-gsi.bat', 'Instalar-CS2Tracking.bat');
  },

  _installStepsHtml(compact) {
    const folder = this.CFG_FOLDER.replace(/\\/g, '/');
    if (compact) {
      return `
        <ol class="text-xs text-slate-500 space-y-1 list-decimal list-inside">
          <li>Baixe o arquivo <code class="text-slate-400">${this.CFG_NAME}</code></li>
          <li>Steam → CS2 → Propriedades → Arquivos instalados → Procurar</li>
          <li>Cole em <code class="text-slate-400">${folder}</code></li>
          <li>Reinicie o CS2</li>
        </ol>`;
    }

    return `
      <ol class="text-xs text-slate-500 space-y-2 list-decimal list-inside">
        <li>Baixe o arquivo <code class="text-slate-400">${this.CFG_NAME}</code> (botão abaixo)</li>
        <li>Na <strong class="text-slate-400 font-normal">Steam</strong>: biblioteca → botão direito no CS2 → <strong class="text-slate-400 font-normal">Propriedades</strong> → <strong class="text-slate-400 font-normal">Arquivos instalados</strong> → <strong class="text-slate-400 font-normal">Procurar</strong></li>
        <li>Abra a pasta <code class="text-slate-400">${folder}</code> e cole o arquivo lá<br /><span class="text-slate-600">(pasta <code class="text-slate-600">cfg</code> direto — não use subpasta <code class="text-slate-600">gamestate_integration</code>)</span></li>
        <li>Feche o CS2 completamente e abra de novo</li>
        <li>Jogue uma partida (casual, competitivo ou wingman)</li>
      </ol>
      <p class="text-xs text-slate-600 mt-2">
        Método oficial da Valve —
        <a href="${this.STEAM_HELP_URL}" target="_blank" rel="noopener noreferrer" class="text-orange-400/90 hover:underline">guia Steam sobre GSI</a>
      </p>`;
  },

  _actionsHtml() {
    return `
      <div class="rounded-lg border border-orange-500/25 bg-orange-500/5 p-3 space-y-2">
        <button type="button" id="gsi-download-cfg" class="btn-primary text-xs w-full">
          Baixar arquivo .cfg
        </button>
        <button type="button" id="gsi-download-bat" class="btn-ghost text-xs w-full">
          Ou instalação automática (.bat)
        </button>
        <p id="gsi-download-msg" class="text-xs text-green-400 hidden"></p>
      </div>`;
  },

  _bindPanel(container) {
    const showMsg = (msgEl, text, isError) => {
      if (!msgEl) return;
      msgEl.textContent = text;
      msgEl.classList.remove('hidden', 'text-red-400', 'text-green-400');
      msgEl.classList.add(isError ? 'text-red-400' : 'text-green-400');
    };

    container.querySelector('#gsi-download-cfg')?.addEventListener('click', async () => {
      const msg = container.querySelector('#gsi-download-msg');
      try {
        await this.downloadCfg();
        showMsg(
          msg,
          'Arquivo baixado. Copie para a pasta cfg do CS2 e reinicie o jogo.',
          false
        );
      } catch (err) {
        showMsg(msg, err.message, true);
      }
    });

    container.querySelector('#gsi-download-bat')?.addEventListener('click', async () => {
      const msg = container.querySelector('#gsi-download-msg');
      try {
        await this.downloadInstaller();
        showMsg(msg, 'Instalador baixado. Execute o .bat e reinicie o CS2.', false);
      } catch (err) {
        showMsg(msg, err.message, true);
      }
    });
  },

  _bindPreview(container) {
    this.loadCfgPreview(container);
    container.querySelector('#gsi-refresh-preview')?.addEventListener('click', () => {
      this.loadCfgPreview(container);
    });
  },

  _profileOnboardingHtml() {
    return `
      <div class="gsi-panel-inner space-y-4">
        <div>
          <p class="text-sm font-medium text-slate-200">Configure o tracking do CS2</p>
          <p class="text-xs text-slate-500 mt-1">Arquivo de texto na pasta do jogo — método oficial da Steam.</p>
        </div>
        <div class="flex items-center gap-2">
          <span id="gsi-status-dot" class="w-2 h-2 rounded-full bg-slate-600"></span>
          <span id="gsi-status-text" class="text-xs text-slate-400">Verificando...</span>
        </div>
        ${this._installStepsHtml(false)}
        ${this._cfgPreviewHtml()}
        ${this._actionsHtml()}
        ${this._securityLinksHtml()}
        <p id="gsi-onboarding-hint" class="text-xs text-slate-500 hidden"></p>
      </div>`;
  },

  _panelHtml() {
    return `
      <div class="gsi-panel-inner space-y-4">
        <div>
          <p class="text-sm font-medium text-slate-200">Integração CS2 (GSI)</p>
          <p class="text-xs text-slate-500 mt-1">Baixe o .cfg e coloque na pasta do jogo.</p>
        </div>
        <div class="flex items-center gap-2">
          <span id="gsi-status-dot" class="w-2 h-2 rounded-full bg-slate-600"></span>
          <span id="gsi-status-text" class="text-xs text-slate-400">Verificando...</span>
        </div>
        ${this._installStepsHtml(true)}
        ${this._cfgPreviewHtml()}
        ${this._actionsHtml()}
        ${this._securityLinksHtml()}
      </div>`;
  },

  _settingsPanelHtml(user) {
    const steamOnly = !!user?.login_via_steam;
    const regenBlock = steamOnly
      ? `
        <div class="border-t border-slate-800/80 pt-4">
          <p class="text-xs font-medium text-slate-400 mb-2">Regenerar credenciais GSI</p>
          <p class="text-xs text-slate-600 mb-3">Invalida o .cfg antigo. Conta Steam — confirmação pela sessão ativa.</p>
          <button type="button" id="gsi-regenerate-btn" class="btn-ghost text-xs w-full">Regenerar credenciais</button>
          <p id="gsi-regen-msg" class="text-xs mt-2 hidden"></p>
        </div>`
      : `
        <div class="border-t border-slate-800/80 pt-4">
          <p class="text-xs font-medium text-slate-400 mb-2">Regenerar credenciais GSI</p>
          <p class="text-xs text-slate-600 mb-3">Invalida o .cfg antigo. Use se suspeitar que vazou.</p>
          <input id="gsi-regen-password" type="password" class="input-field text-sm mb-2" placeholder="Senha atual" autocomplete="current-password" />
          <button type="button" id="gsi-regenerate-btn" class="btn-ghost text-xs w-full">Regenerar e baixar novo .cfg</button>
          <p id="gsi-regen-msg" class="text-xs mt-2 hidden"></p>
        </div>`;

    return `
      <div class="gsi-panel-inner space-y-4">
        <div class="flex items-center gap-2">
          <span id="gsi-status-dot" class="w-2 h-2 rounded-full bg-slate-600"></span>
          <span id="gsi-status-text" class="text-xs text-slate-400">Verificando...</span>
        </div>
        ${this._installStepsHtml(false)}
        ${this._cfgPreviewHtml()}
        ${this._actionsHtml()}
        ${this._securityLinksHtml()}
        ${regenBlock}
      </div>`;
  },

  _bindRegenerate(container, user) {
    container.querySelector('#gsi-regenerate-btn')?.addEventListener('click', async () => {
      const steamOnly = !!user?.login_via_steam;
      const pwd = container.querySelector('#gsi-regen-password')?.value;
      const msg = container.querySelector('#gsi-regen-msg');
      if (!steamOnly && !pwd) {
        if (msg) {
          msg.textContent = 'Informe sua senha atual.';
          msg.className = 'text-xs mt-2 text-red-400';
          msg.classList.remove('hidden');
        }
        return;
      }
      try {
        const body = steamOnly ? {} : { current_password: pwd };
        await window.CSTrackingAPI.apiRequest('/api/user/regenerate-gsi', {
          method: 'POST',
          body,
        });
        if (msg) {
          msg.textContent = 'Credenciais regeneradas. Baixe o novo .cfg abaixo.';
          msg.className = 'text-xs mt-2 text-green-400';
          msg.classList.remove('hidden');
        }
        if (!steamOnly) {
          container.querySelector('#gsi-regen-password').value = '';
        }
        await this.loadCfgPreview(container);
      } catch (err) {
        if (msg) {
          msg.textContent = err.message;
          msg.className = 'text-xs mt-2 text-red-400';
          msg.classList.remove('hidden');
        }
      }
    });
  },

  mountSettingsPanel(container, user) {
    if (!this.userHasGsi(user) || !container) return null;
    container.innerHTML = this._settingsPanelHtml(user);
    this._bindPanel(container);
    this._bindPreview(container);
    this._bindRegenerate(container, user);

    const poll = async () => {
      const status = await this.fetchStatus();
      const label = this.statusLabel(status);
      const dot = container.querySelector('#gsi-status-dot');
      const text = container.querySelector('#gsi-status-text');
      if (dot) dot.className = `w-2 h-2 rounded-full ${label.dot}`;
      if (text) {
        text.textContent = label.text;
        text.className = `text-xs ${label.className}`;
      }
    };
    poll();
    const interval = setInterval(poll, 10000);
    return () => clearInterval(interval);
  },

  _startStatusPoll(container, extraDot) {
    const poll = async () => {
      const status = await this.fetchStatus();
      const label = this.statusLabel(status);
      const dot = container.querySelector('#gsi-status-dot');
      const text = container.querySelector('#gsi-status-text');
      if (dot) dot.className = `w-2 h-2 rounded-full ${label.dot}`;
      if (text) {
        text.textContent = label.text;
        text.className = `text-xs ${label.className}`;
      }
      if (extraDot) extraDot.className = `nav-gsi-dot ${label.dot}`;
    };

    poll();
    return setInterval(poll, 10000);
  },

  mountNavDropdown(container, user, options = {}) {
    if (!this.userHasGsi(user) || !container) return null;

    container.innerHTML = `
      <div class="nav-gsi ${options.sidebar ? 'nav-gsi--sidebar' : ''}">
        <button type="button" id="nav-gsi-toggle" class="nav-gsi-trigger" aria-expanded="false" aria-haspopup="true">
          <span id="nav-gsi-dot" class="nav-gsi-dot bg-slate-600"></span>
          <span>GSI</span>
          <span class="nav-gsi-chevron" aria-hidden="true">▾</span>
        </button>
        <div id="nav-gsi-menu" class="nav-gsi-menu hidden" role="menu">
          <div id="nav-gsi-menu-body"></div>
        </div>
      </div>`;

    const toggle = container.querySelector('#nav-gsi-toggle');
    const menu = container.querySelector('#nav-gsi-menu');
    const body = container.querySelector('#nav-gsi-menu-body');
    const triggerDot = container.querySelector('#nav-gsi-dot');

    body.innerHTML = this._panelHtml();
    this._bindPanel(body);
    this._bindPreview(body);

    const close = () => {
      menu.classList.add('hidden');
      toggle.setAttribute('aria-expanded', 'false');
      if (options.sidebar) clearSidebarMenuPosition();
    };

    const positionSidebarMenu = () => {
      menu.style.position = 'fixed';
      menu.style.width = 'min(20rem, calc(100vw - 1rem))';
      menu.style.maxHeight = 'min(32rem, calc(100vh - 1rem))';
      menu.style.overflowY = 'auto';

      const gap = 8;
      const tr = toggle.getBoundingClientRect();
      const mw = menu.offsetWidth;
      const mh = menu.offsetHeight;

      let left = tr.right + gap;
      let top = tr.bottom - mh;

      if (left + mw > window.innerWidth - gap) {
        left = Math.max(gap, tr.left - mw - gap);
      }
      if (top < gap) top = gap;
      if (top + mh > window.innerHeight - gap) {
        top = Math.max(gap, window.innerHeight - mh - gap);
      }

      menu.style.left = `${Math.round(left)}px`;
      menu.style.top = `${Math.round(top)}px`;
      menu.style.bottom = 'auto';
      menu.style.right = 'auto';
    };

    const clearSidebarMenuPosition = () => {
      menu.style.position = '';
      menu.style.left = '';
      menu.style.top = '';
      menu.style.bottom = '';
      menu.style.right = '';
      menu.style.width = '';
      menu.style.maxHeight = '';
      menu.style.overflowY = '';
    };

    const open = () => {
      menu.classList.remove('hidden');
      toggle.setAttribute('aria-expanded', 'true');
      if (options.sidebar) {
        requestAnimationFrame(() => positionSidebarMenu());
      }
    };

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.contains('hidden') ? open() : close();
    });

    const onDocClick = (e) => {
      if (!container.contains(e.target)) close();
    };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });

    const onResize = () => {
      if (options.sidebar && !menu.classList.contains('hidden')) {
        positionSidebarMenu();
      }
    };
    window.addEventListener('resize', onResize);

    const interval = this._startStatusPoll(body, triggerDot);

    return () => {
      document.removeEventListener('click', onDocClick);
      window.removeEventListener('resize', onResize);
      clearInterval(interval);
    };
  },

  mountProfileCard(container, user) {
    if (!this.userHasGsi(user) || !container) return null;

    container.innerHTML = `<div class="card p-6 border-orange-500/30 gsi-onboarding-card">${this._profileOnboardingHtml()}</div>`;
    this._bindPanel(container);
    this._bindPreview(container);

    const hint = container.querySelector('#gsi-onboarding-hint');

    const poll = async () => {
      const status = await this.fetchStatus();
      const label = this.statusLabel(status);
      const dot = container.querySelector('#gsi-status-dot');
      const text = container.querySelector('#gsi-status-text');
      if (dot) dot.className = `w-2 h-2 rounded-full ${label.dot}`;
      if (text) {
        text.textContent = label.text;
        text.className = `text-xs ${label.className}`;
      }
      if (hint) {
        if (status?.in_game) {
          hint.textContent = 'Partida detectada — ao terminar, ela aparece aqui automaticamente.';
          hint.classList.remove('hidden');
        } else if (status?.gsi_connected) {
          hint.textContent = 'GSI conectado. Entre numa partida para registrar sua primeira estatística.';
          hint.classList.remove('hidden');
        } else if (status?.last_gsi_at) {
          hint.textContent = 'Sem sinal do CS2. Abra o jogo ou verifique se o .cfg está na pasta certa.';
          hint.classList.remove('hidden');
        } else {
          hint.classList.add('hidden');
        }
      }
    };

    poll();
    const interval = setInterval(poll, 10000);
    return () => clearInterval(interval);
  },
};
