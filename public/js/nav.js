(function () {
  function requireAuth() {
    if (!window.CSTrackingAPI?.getToken()) {
      window.location.href = '/';
      return false;
    }
    return true;
  }

  function setActiveNav() {
    const path = window.location.pathname;
    document.querySelectorAll('[data-nav]').forEach((el) => {
      const href = el.getAttribute('data-nav');
      el.classList.toggle('active', href === path);
    });
  }

  /** Garante username + badge de papel no menu logado */
  function ensureAuthNavChrome() {
    const authed = document.getElementById('nav-authed');
    if (!authed) return;

    const logoutBtn = document.getElementById('logout-btn');

    let usernameEl = document.getElementById('nav-username');
    if (!usernameEl || !authed.contains(usernameEl)) {
      usernameEl = document.createElement('span');
      usernameEl.id = 'nav-username';
      usernameEl.className = 'nav-link';
      usernameEl.style.cursor = 'default';
      authed.insertBefore(usernameEl, logoutBtn || null);
    }

    let roleEl = document.getElementById('nav-role');
    if (roleEl && !authed.contains(roleEl)) {
      roleEl.remove();
      roleEl = null;
    }

    roleEl = document.getElementById('nav-role');
    if (!roleEl || !authed.contains(roleEl)) {
      roleEl = document.createElement('span');
      roleEl.id = 'nav-role';
      roleEl.className = 'badge-user';
      authed.insertBefore(roleEl, logoutBtn || null);
    }

    let sep = authed.querySelector('[data-nav-sep]');
    if (!sep) {
      sep = document.createElement('span');
      sep.setAttribute('data-nav-sep', '');
      sep.className = 'nav-sep hidden sm:inline';
      sep.textContent = '|';
      const insertBefore = usernameEl || logoutBtn;
      if (insertBefore) authed.insertBefore(sep, insertBefore);
    }
  }

  function renderAuthLinks(user) {
    const guest = document.getElementById('nav-guest');
    const authed = document.getElementById('nav-authed');
    if (guest) guest.classList.add('hidden');
    if (authed) authed.classList.remove('hidden');

    ensureAuthNavChrome();

    const nameEl = document.getElementById('nav-username');
    if (nameEl) nameEl.textContent = user.username;

    const roleEl = document.getElementById('nav-role');
    if (roleEl) {
      const isAdmin = user.role === 'admin';
      roleEl.textContent = isAdmin ? 'Admin' : 'Jogador';
      roleEl.className = isAdmin ? 'badge-admin' : 'badge-user';
      roleEl.classList.remove('hidden');
    }

    document.getElementById('nav-admin-link')?.classList.toggle('hidden', user.role !== 'admin');
    document.getElementById('nav-conta-link')?.classList.remove('hidden');
    document.getElementById('nav-sala-link')?.classList.remove('hidden');
  }

  function renderGuestLinks() {
    const guest = document.getElementById('nav-guest');
    const authed = document.getElementById('nav-authed');
    if (guest) guest.classList.remove('hidden');
    if (authed) authed.classList.add('hidden');

  }

  function bindLogout() {
    document.getElementById('logout-btn')?.addEventListener('click', () => {
      window.CSTrackingAPI.setToken(null);
      window.location.href = '/profiles';
    });
  }

  async function initNav(options = {}) {
    const { publicPage = false, adminOnly = false } = options;
    const api = window.CSTrackingAPI;
    const token = api.getToken();

    if (!publicPage && !token) {
      window.location.href = '/';
      return null;
    }

    bindLogout();

    if (!token) {
      renderGuestLinks();
      setActiveNav();
      return null;
    }

    try {
      const { user } = await api.apiRequest('/api/user/profile');
      if (adminOnly && user.role !== 'admin') {
        window.location.href = '/profiles';
        return null;
      }
      renderAuthLinks(user);
      setActiveNav();
      return user;
    } catch {
      api.setToken(null);
      if (publicPage) {
        renderGuestLinks();
        setActiveNav();
        return null;
      }
      window.location.href = '/';
      return null;
    }
  }

  function redirectAfterLogin(user) {
    window.location.href = user?.role === 'admin' ? '/admin' : '/conta';
  }

  window.CSTrackingNav = { initNav, requireAuth, redirectAfterLogin };
})();
