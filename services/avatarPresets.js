/** Presets de ícone da conta (validação server-side). */

const AVATAR_PRESETS = {
  default: { label: 'Iniciais' },
  ct: { label: 'CT' },
  tr: { label: 'TR' },
  awp: { label: 'AWP' },
  ace: { label: 'Ace' },
  defuse: { label: 'Kit' },
};

const AVATAR_IDS = Object.keys(AVATAR_PRESETS);

function isValidAvatarId(id) {
  return AVATAR_IDS.includes(id);
}

module.exports = { AVATAR_PRESETS, AVATAR_IDS, isValidAvatarId };
