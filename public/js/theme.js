(function () {
  const STORAGE_KEY = 'cstracking-theme';

  function getStored() {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  }

  function getPreferred() {
    return getStored() || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  }

  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
  }

  apply(getPreferred());

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') || 'dark';
  }

  function updateToggleUi(btn) {
    if (!btn) return;
    const isLight = currentTheme() === 'light';
    btn.setAttribute('aria-pressed', String(isLight));
    btn.title = isLight ? 'Usar tema escuro' : 'Usar tema claro';
    btn.setAttribute('aria-label', btn.title);
  }

  function createToggleButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'theme-toggle';
    btn.className = 'theme-toggle';
    btn.innerHTML = `
      <span class="theme-toggle-track" aria-hidden="true">
        <span class="theme-toggle-thumb"></span>
      </span>
      <span class="theme-toggle-label theme-label-dark">Escuro</span>
      <span class="theme-toggle-label theme-label-light">Claro</span>
    `;
    btn.addEventListener('click', toggleTheme);
    updateToggleUi(btn);
    return btn;
  }

  function mountToggle() {
    document.querySelectorAll('.nav-inner').forEach((nav) => {
      if (nav.querySelector('#theme-toggle')) return;
      const btn = createToggleButton();
      const logout = nav.querySelector('#logout-btn');
      const authed = nav.querySelector('#nav-authed');
      if (logout && authed?.contains(logout)) {
        authed.insertBefore(btn, logout);
      } else if (authed) {
        authed.appendChild(btn);
      } else {
        const guest = nav.querySelector('#nav-guest');
        if (guest) guest.appendChild(btn);
        else nav.appendChild(btn);
      }
    });
  }

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (getStored()) return;
    apply(e.matches ? 'dark' : 'light');
    document.querySelectorAll('#theme-toggle').forEach(updateToggleUi);
  });

  function toggleTheme() {
    const next = currentTheme() === 'light' ? 'dark' : 'light';
    apply(next);
    localStorage.setItem(STORAGE_KEY, next);
    document.querySelectorAll('#theme-toggle').forEach(updateToggleUi);
  }

  window.CSTrackingTheme = { toggle: toggleTheme, getTheme: currentTheme, apply, createToggleButton };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountToggle);
  } else {
    mountToggle();
  }
})();
