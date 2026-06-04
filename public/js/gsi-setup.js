/** Bloco GSI — Minha conta e painel admin */
window.GsiSetup = {
  async fetchStatus() {
    try {
      return await window.CSTrackingAPI.apiRequest('/api/user/gsi-status');
    } catch {
      return null;
    }
  },

  statusLabel(status) {
    if (!status) return { text: 'Status indisponível', className: 'text-slate-500', dot: 'bg-slate-500' };
    if (status.in_game) {
      return { text: 'CS2 em partida', className: 'text-green-400', dot: 'bg-green-500 animate-pulse' };
    }
    if (status.gsi_connected) {
      return { text: 'GSI conectado', className: 'text-green-400', dot: 'bg-green-500' };
    }
    if (status.last_gsi_at) {
      return { text: 'Sem sinal recente — reinicie o CS2', className: 'text-amber-400', dot: 'bg-amber-500' };
    }
    return { text: 'Aguardando primeiro sinal', className: 'text-slate-400', dot: 'bg-slate-600' };
  },

  async downloadInstaller() {
    const token = window.CSTrackingAPI.getToken();
    if (!token) throw new Error('Faça login primeiro');

    const res = await fetch('/api/user/install-gsi.bat', {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Falha ao baixar instalador');
    }

    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^"]+)"?/i);
    const filename = match ? match[1] : 'Instalar-CS2Tracking.bat';

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },

  render(container, user, options = {}) {
    if (!user?.gsi_token || !container) return null;

    const { compact = false, showAdminNote = false, showManual = false } = options;

    const manualBlock = showManual
      ? `
        <details class="text-sm">
          <summary class="text-slate-400 cursor-pointer hover:text-slate-300">Configuração manual (avançado)</summary>
          <div class="mt-4 space-y-4">
            <div>
              <p class="stat-label mb-2">Seu token</p>
              <div class="flex flex-wrap gap-2">
                <code id="gsi-token" class="flex-1 bg-slate-950/80 border border-slate-700 rounded-lg px-3 py-2 text-orange-300 text-xs break-all">${user.gsi_token}</code>
                <button type="button" id="copy-token" class="btn-ghost text-xs">Copiar</button>
              </div>
            </div>
            <div>
              <p class="stat-label mb-2">Endpoint (URI no .cfg)</p>
              <code class="block bg-slate-950/80 border border-slate-700 rounded-lg px-3 py-2 text-xs break-all text-slate-300">${user.gsi_uri || ''}</code>
            </div>
            <p class="text-xs text-slate-600">Pasta: <code class="text-slate-400">...\\\\game\\\\csgo\\\\cfg\\\\</code> · Arquivo: <code class="text-slate-400">gamestate_integration_cstracking.cfg</code></p>
          </div>
        </details>`
      : '';

    container.innerHTML = `
      <div class="card p-6 space-y-5 ${compact ? '' : ''}">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 class="text-lg font-semibold text-orange-400">Integração CS2 (GSI)</h2>
            <p class="text-sm text-slate-500 mt-1 max-w-lg">
              Instale uma vez no seu PC. Cada jogador usa seu próprio token — necessário para salas e partidas em grupo.
            </p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <span id="gsi-status-dot" class="w-2.5 h-2.5 rounded-full bg-slate-600"></span>
            <span id="gsi-status-text" class="text-sm text-slate-400">Verificando...</span>
          </div>
        </div>

        <div class="rounded-xl border border-orange-500/25 bg-orange-500/5 p-4 space-y-3">
          <p class="text-sm font-medium text-slate-200">Instalação automática (recomendado)</p>
          <ol class="text-xs text-slate-500 space-y-1 list-decimal list-inside">
            <li>Baixe o instalador abaixo (só precisa fazer <strong class="text-slate-400">uma vez</strong> por PC)</li>
            <li>Dê <strong class="text-slate-400">duplo clique</strong> no arquivo .bat</li>
            <li>Feche o CS2 e abra de novo</li>
            <li>Mantenha este site/servidor rodando enquanto joga</li>
          </ol>
          <button type="button" id="gsi-download-installer" class="btn-primary text-sm w-full sm:w-auto">
            Baixar instalador GSI (.bat)
          </button>
          <p id="gsi-download-msg" class="text-xs text-green-400 hidden"></p>
        </div>

        ${manualBlock}

        ${
          showAdminNote
            ? '<p class="text-xs text-amber-400/80">Monitor global de partidas continua no painel Admin.</p>'
            : ''
        }
      </div>`;

    const poll = async () => {
      const status = await this.fetchStatus();
      const label = this.statusLabel(status);
      const dot = container.querySelector('#gsi-status-dot');
      const text = container.querySelector('#gsi-status-text');
      if (dot) dot.className = `w-2.5 h-2.5 rounded-full ${label.dot}`;
      if (text) {
        text.textContent = label.text;
        text.className = `text-sm ${label.className}`;
      }
    };

    poll();
    const interval = setInterval(poll, 10000);

    container.querySelector('#gsi-download-installer')?.addEventListener('click', async () => {
      const msg = container.querySelector('#gsi-download-msg');
      try {
        await this.downloadInstaller();
        if (msg) {
          msg.textContent = 'Download iniciado. Execute o .bat e reinicie o CS2.';
          msg.classList.remove('hidden');
        }
      } catch (err) {
        if (msg) {
          msg.textContent = err.message;
          msg.classList.remove('hidden');
          msg.classList.add('text-red-400');
        }
      }
    });

    container.querySelector('#copy-token')?.addEventListener('click', () => {
      navigator.clipboard.writeText(user.gsi_token);
    });

    return () => clearInterval(interval);
  },
};
