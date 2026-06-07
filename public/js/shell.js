/** Layout app: sidebar + topbar (perfil) */

(function () {

  const SIDEBAR_COLLAPSED_KEY = 'cstracking-sidebar-collapsed';



  let currentUser = null;

  let gsiCleanup = null;

  let profileMenuOpen = false;



  function sidebarNavItems(user) {
    return [
      { href: '/profiles', label: 'Perfis', icon: '◉', nav: '/profiles' },
      { href: '/lobby', label: 'Lobby', icon: '⬡', nav: '/lobby' },
      { href: `/profile?id=${user.id}`, label: 'Perfil', icon: '▣', nav: '/profile' },
      { href: '/configuracoes', label: 'Configurações', icon: '⚙', nav: '/configuracoes' },
      { href: '/admin', label: 'Admin', icon: '★', nav: '/admin', adminOnly: true },
    ];
  }

  function isSidebarCollapsed() {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  }



  function applySidebarCollapsed(collapsed) {

    document.body.classList.toggle('sidebar-collapsed', collapsed);

    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');



    const btn = document.getElementById('sidebar-collapse');

    if (btn) {

      btn.setAttribute('aria-expanded', String(!collapsed));

      btn.title = collapsed ? 'Expandir menu' : 'Recolher menu';

      btn.setAttribute('aria-label', btn.title);

    }

  }



  function sidebarNavHtml(user) {
    return sidebarNavItems(user)
      .filter((item) => !item.adminOnly || user.role === 'admin')

      .map(

        (item) => `

      <a href="${item.href}" data-nav="${item.nav}" class="sidebar-link" title="${item.label}">

        <span class="sidebar-link-icon" aria-hidden="true">${item.icon}</span>

        <span class="sidebar-link-label">${item.label}</span>

      </a>`

      )

      .join('');

  }



  function closeProfileMenu() {

    profileMenuOpen = false;

    document.getElementById('profile-menu')?.classList.add('hidden');

    document.getElementById('profile-menu-trigger')?.setAttribute('aria-expanded', 'false');

  }



  function openProfileMenu() {

    profileMenuOpen = true;

    document.getElementById('profile-menu')?.classList.remove('hidden');

    document.getElementById('profile-menu-trigger')?.setAttribute('aria-expanded', 'true');

  }



  function syncPageAvatars(user) {

    const hero = document.getElementById('avatar');

    if (hero && window.CSTrackingAvatars) {

      hero.outerHTML = `<div id="avatar">${window.CSTrackingAvatars.html(user, 'user-avatar-lg')}</div>`;

    }

    const profileHero = document.getElementById('profile-avatar');

    if (profileHero && window.CSTrackingAvatars) {

      profileHero.outerHTML = `<div id="profile-avatar">${window.CSTrackingAvatars.html(user, 'user-avatar-lg')}</div>`;

    }

  }



  function bindProfileMenu() {

    const trigger = document.getElementById('profile-menu-trigger');

    const menu = document.getElementById('profile-menu');

    if (!trigger || !menu) return;



    trigger.onclick = (e) => {

      e.stopPropagation();

      profileMenuOpen ? closeProfileMenu() : openProfileMenu();

    };



    menu.querySelector('#profile-logout').onclick = () => {
      if (gsiCleanup) gsiCleanup();
      window.CSTrackingAPI.setToken(null);
      window.location.href = '/profiles';
    };
  }



  function refreshProfileChrome(user) {

    currentUser = user;

    const Avatars = window.CSTrackingAvatars;

    if (!Avatars) return;



    const triggerWrap = document.getElementById('topbar-avatar');

    if (triggerWrap) triggerWrap.innerHTML = Avatars.html(user, 'user-avatar-md');



    const menuAvatar = document.getElementById('profile-menu-avatar');

    if (menuAvatar) menuAvatar.innerHTML = Avatars.html(user, 'user-avatar-lg');



    const nameEl = document.getElementById('profile-menu-name');

    if (nameEl) nameEl.textContent = user.username;



    const roleEl = document.getElementById('profile-menu-role');

    if (roleEl) {

      roleEl.textContent = user.role === 'admin' ? 'Administrador' : 'Jogador';

      roleEl.className = user.role === 'admin' ? 'badge-admin text-xs' : 'badge-user text-xs';

    }

  }



  function mountGsi(user) {

    if (gsiCleanup) {

      gsiCleanup();

      gsiCleanup = null;

    }

    const wrap = document.getElementById('sidebar-gsi-wrap');

    if (wrap && window.GsiSetup?.mountNavDropdown) {

      gsiCleanup = window.GsiSetup.mountNavDropdown(wrap, user, { sidebar: true });

    }

  }



  function bindMobileSidebar() {

    document.getElementById('sidebar-toggle')?.addEventListener('click', () => {

      document.body.classList.toggle('sidebar-open');

    });

    document.getElementById('sidebar-backdrop')?.addEventListener('click', () => {

      document.body.classList.remove('sidebar-open');

    });

    document.querySelectorAll('.sidebar-link').forEach((a) => {

      a.addEventListener('click', () => {

        if (window.matchMedia('(max-width: 900px)').matches) {

          document.body.classList.remove('sidebar-open');

        }

      });

    });

  }



  function bindSidebarCollapse() {

    document.getElementById('sidebar-collapse')?.addEventListener('click', () => {

      applySidebarCollapsed(!document.body.classList.contains('sidebar-collapsed'));

    });

    applySidebarCollapsed(isSidebarCollapsed());

  }



  function mountAuthed(user) {

    const shell = document.querySelector('.app-shell');

    if (!shell || shell.dataset.layout === 'app') {

      if (shell?.dataset.layout === 'app') refreshProfileChrome(user);

      return;

    }



    const oldNav = shell.querySelector('nav.glass-nav, header.glass-nav');

    const main = shell.querySelector('main');

    const footer = shell.querySelector('footer.site-footer');

    if (!main) return;



    oldNav?.remove();



    document.addEventListener('click', (e) => {

      if (!document.getElementById('app-topbar')?.contains(e.target)) closeProfileMenu();

    });

    document.addEventListener('keydown', (e) => {

      if (e.key === 'Escape') closeProfileMenu();

    });



    const layout = document.createElement('div');

    layout.className = 'app-layout';

    layout.innerHTML = `

      <div id="sidebar-backdrop" class="sidebar-backdrop"></div>

      <aside id="app-sidebar" class="app-sidebar">

        <div class="sidebar-head">

          <a href="/profiles" class="brand sidebar-brand" title="CS Tracking">

            <span class="brand-mark">CS</span>

            <span class="sidebar-brand-text">Tracking</span>

          </a>

          <button type="button" id="sidebar-collapse" class="sidebar-collapse-btn" aria-expanded="true" title="Recolher menu" aria-label="Recolher menu">

            <span class="sidebar-collapse-icon" aria-hidden="true">‹</span>

          </button>

        </div>

        <nav class="sidebar-nav" id="sidebar-nav"></nav>

        <div class="sidebar-footer">

          <div id="sidebar-gsi-wrap"></div>

        </div>

      </aside>

      <div class="app-main-wrap">

        <header id="app-topbar" class="app-topbar">

          <button type="button" id="sidebar-toggle" class="sidebar-toggle btn-ghost" aria-label="Abrir menu">☰</button>

          <div class="app-topbar-spacer"></div>

          <div id="app-topbar-actions" class="app-topbar-actions"></div>

          <div class="app-profile-wrap">

            <button type="button" id="profile-menu-trigger" class="profile-menu-trigger" aria-expanded="false" aria-haspopup="true">

              <span id="topbar-avatar"></span>

              <span class="profile-menu-chevron" aria-hidden="true">▾</span>

            </button>

            <div id="profile-menu" class="profile-menu hidden" role="menu">

              <div class="profile-menu-head">

                <div id="profile-menu-avatar"></div>

                <div>

                  <p id="profile-menu-name" class="font-semibold text-sm"></p>

                  <span id="profile-menu-role"></span>

                </div>

              </div>

              <div class="profile-menu-links">
                <a href="/profile?id=${user.id}" class="profile-menu-link">Meu perfil</a>
                <a href="/configuracoes" class="profile-menu-link">Configurações</a>
              </div>
              <button type="button" id="profile-logout" class="profile-menu-link profile-menu-logout w-full text-left">Sair</button>

            </div>

          </div>

        </header>

        <div id="app-content" class="app-content"></div>

      </div>`;



    const content = layout.querySelector('#app-content');

    content.appendChild(main);

    if (footer) content.appendChild(footer);



    shell.innerHTML = '';

    shell.appendChild(layout);

    shell.dataset.layout = 'app';

    shell.classList.add('app-shell--layout');



    layout.querySelector('#sidebar-nav').innerHTML = sidebarNavHtml(user);

    const themeSlot = layout.querySelector('#app-topbar-actions');

    if (themeSlot && window.CSTrackingTheme?.createToggleButton) {

      themeSlot.appendChild(window.CSTrackingTheme.createToggleButton());

    }



    refreshProfileChrome(user);

    bindProfileMenu();

    mountGsi(user);

    bindMobileSidebar();

    bindSidebarCollapse();



    const path = window.location.pathname;

    layout.querySelectorAll('[data-nav]').forEach((el) => {

      el.classList.toggle('active', el.getAttribute('data-nav') === path);

    });

  }



  window.CSTrackingShell = { mountAuthed, refreshProfileChrome: (u) => refreshProfileChrome(u) };

})();

