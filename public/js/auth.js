const api = window.CSTrackingAPI;

const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const loginError = document.getElementById('login-error');
const registerError = document.getElementById('register-error');

const STEAM_ERRORS = {
  steam_not_configured: 'Login Steam não configurado no servidor.',
  steam_auth_failed: 'Login Steam cancelado ou inválido.',
  steam_id_missing: 'Steam ID não encontrado.',
  steam_auth_error: 'Erro ao entrar com Steam.',
};

if (api.getToken()) {
  api.apiRequest('/api/user/profile').then(({ user }) => {
    window.CSTrackingNav.redirectAfterLogin(user);
  }).catch(() => {
    api.setToken(null);
  });
}

function showError(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}

const steamError = new URLSearchParams(window.location.search).get('error');
if (steamError && loginError) {
  showError(loginError, STEAM_ERRORS[steamError] || 'Falha no login Steam.');
  window.history.replaceState({}, '', '/');
}

loginForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError?.classList.add('hidden');
  try {
    const data = await api.apiRequest('/api/auth/login', {
      method: 'POST',
      body: {
        email: document.getElementById('login-email').value,
        password: document.getElementById('login-password').value,
      },
    });
    api.setToken(data.token);
    window.CSTrackingNav.redirectAfterLogin(data.user);
  } catch (err) {
    showError(loginError, err.message);
  }
});

registerForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  registerError?.classList.add('hidden');
  try {
    const data = await api.apiRequest('/api/auth/register', {
      method: 'POST',
      body: {
        username: document.getElementById('register-username').value,
        email: document.getElementById('register-email').value,
        password: document.getElementById('register-password').value,
      },
    });
    api.setToken(data.token);
    window.CSTrackingNav.redirectAfterLogin(data.user);
  } catch (err) {
    showError(registerError, err.message);
  }
});
