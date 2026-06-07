/** Avatar do usuário — foto ou iniciais */
window.CSTrackingAvatars = {
  initials(username) {
    return (username || '?').slice(0, 2).toUpperCase();
  },

  src(user) {
    if (!user?.avatar_url) return null;
    const v = user.avatar_version ? `?v=${user.avatar_version}` : '';
    return `${user.avatar_url}${v}`;
  },

  html(user, sizeClass = 'user-avatar-md') {
    const src = this.src(user);
    if (src) {
      const alt = user?.username ? `Foto de ${user.username}` : 'Foto de perfil';
      return `<img src="${src}" alt="${alt}" class="user-avatar-img ${sizeClass}" loading="lazy" />`;
    }

    const initials = this.initials(user?.username);
    return `<span class="user-avatar ${sizeClass} avatar-preset-default" title="${initials}">${initials}</span>`;
  },

  uploadSectionHtml() {
    return `
      <div class="avatar-upload">
        <label class="avatar-upload-btn">
          <input type="file" id="avatar-file-input" accept="image/jpeg,image/png,image/webp,image/gif" class="sr-only" />
          Escolher foto
        </label>
        <button type="button" id="avatar-remove-btn" class="avatar-upload-remove">Remover foto</button>
        <p id="avatar-upload-status" class="avatar-upload-status" role="status"></p>
        <p class="text-xs text-slate-500 mt-1">JPG, PNG, WebP ou GIF · máx. 2 MB</p>
      </div>`;
  },
};
