(function () {
  function setActiveNav() {
    const path = window.location.pathname;
    document.querySelectorAll('[data-nav]').forEach((el) => {
      const href = el.getAttribute('data-nav');
      el.classList.toggle('active', href === path);
    });
  }

  function renderGuestLinks() {
    const guest = document.getElementById('nav-guest');
    const authed = document.getElementById('nav-authed');
    if (guest) guest.classList.remove('hidden');
    if (authed) authed.classList.add('hidden');
  }

  function updateProfileNavLink(user) {
    if (!user?.id) return;
    const href = `/profile?id=${user.id}`;
    document.querySelectorAll('#nav-profile-link, [data-nav-profile]').forEach((el) => {
      el.href = href;
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

      if (window.CSTrackingShell?.mountAuthed) {
        window.CSTrackingShell.mountAuthed(user);
      }

      updateProfileNavLink(user);
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
    window.location.href = user?.role === 'admin' ? '/admin' : `/profile?id=${user.id}`;
  }

  window.CSTrackingNav = { initNav, redirectAfterLogin };
})();
