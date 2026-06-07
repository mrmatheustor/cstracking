const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const AVATARS_DIR = path.join(DATA_DIR, 'uploads', 'avatars');

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function ensureDir() {
  if (!fs.existsSync(AVATARS_DIR)) {
    fs.mkdirSync(AVATARS_DIR, { recursive: true });
  }
}

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/i);
  if (!match) return null;

  const mime = match[1].toLowerCase();
  const ext = ALLOWED[mime];
  if (!ext) return null;

  let buffer;
  try {
    buffer = Buffer.from(match[2], 'base64');
  } catch {
    return null;
  }

  if (!buffer.length || buffer.length > MAX_BYTES) return null;
  return { mime, ext, buffer };
}

function avatarPath(userId, ext) {
  return path.join(AVATARS_DIR, `${userId}.${ext}`);
}

function publicUrl(userId, ext) {
  return `/uploads/avatars/${userId}.${ext}`;
}

function deleteExisting(userId) {
  ensureDir();
  for (const ext of Object.values(ALLOWED)) {
    const file = avatarPath(userId, ext);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

function saveFromDataUrl(userId, dataUrl) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    const err = new Error('Imagem inválida. Use JPG, PNG, WebP ou GIF (máx. 2 MB).');
    err.status = 400;
    throw err;
  }

  ensureDir();
  deleteExisting(userId);

  const file = avatarPath(userId, parsed.ext);
  fs.writeFileSync(file, parsed.buffer);
  return publicUrl(userId, parsed.ext);
}

function deleteForUser(userId) {
  deleteExisting(userId);
}

module.exports = {
  AVATARS_DIR,
  saveFromDataUrl,
  deleteForUser,
  publicUrl,
};
