(function () {
  const API_BASE = '';

  function getToken() {
    return localStorage.getItem('token');
  }

  function setToken(token) {
    if (token) localStorage.setItem('token', token);
    else localStorage.removeItem('token');
  }

  async function apiRequest(path, options = {}) {
    const headers = {
      ...(options.headers || {}),
    };

    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      body:
        options.body instanceof FormData
          ? options.body
          : options.body
            ? JSON.stringify(options.body)
            : undefined,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const err = new Error(data.error || 'Erro na requisição');
      err.status = res.status;
      if (data.code) err.code = data.code;
      throw err;
    }

    return data;
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Não foi possível ler o arquivo'));
      reader.readAsDataURL(file);
    });
  }

  async function uploadAvatar(file) {
    const image = await readFileAsDataUrl(file);
    return apiRequest('/api/user/avatar', { method: 'POST', body: { image } });
  }

  async function removeAvatar() {
    return apiRequest('/api/user/avatar', { method: 'DELETE' });
  }

  /** Inicia vínculo Steam (POST + JSON — evita problemas com redirect no fetch). */
  async function startSteamLink() {
    const { redirect } = await apiRequest('/api/user/link-steam', { method: 'POST' });
    if (!redirect) {
      throw new Error('URL da Steam não retornada pelo servidor');
    }
    window.location.assign(redirect);
  }

  async function mergeSteamAccount(currentPassword) {
    const body = currentPassword ? { current_password: currentPassword } : {};
    return apiRequest('/api/user/merge-steam', { method: 'POST', body });
  }

  async function getMergeSteamPending() {
    return apiRequest('/api/user/merge-steam/pending');
  }

  window.CSTrackingAPI = {
    apiRequest,
    getToken,
    setToken,
    uploadAvatar,
    removeAvatar,
    startSteamLink,
    mergeSteamAccount,
    getMergeSteamPending,
  };
})();
