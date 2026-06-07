/** Badge e links Steam reutilizáveis no frontend. */
window.CSTrackingSteamUi = {
  badgeHtml(options = {}) {
    const compact = !!options.compact;
    const cls = compact ? 'steam-badge steam-badge--compact' : 'steam-badge';
    return `<span class="${cls}" title="Conta verificada via Steam OpenID">Steam</span>`;
  },

  profileLinksHtml(profile) {
    if (!profile?.steam_linked || !profile?.steam_profile_url) return '';
    return `
      <div class="profile-steam-links">
        ${this.badgeHtml()}
        <a href="${profile.steam_profile_url}" target="_blank" rel="noopener noreferrer" class="steam-profile-link">
          Ver na Steam ↗
        </a>
      </div>`;
  },

  cardMetaHtml(profile) {
    if (!profile?.steam_linked) return '';
    return this.badgeHtml({ compact: true });
  },
};
