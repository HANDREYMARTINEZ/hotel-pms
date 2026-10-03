// Autenticación, usuarios, configuración, auditoría y archivos.
import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { all, get, run, insert, update, UPLOAD_DIR } from '../db.js';
import {
  wrap, fail, hashPassword, verifyPassword, createSession, authMiddleware, requirePerm, audit,
  getSettings, saveSetting, DEFAULT_SETTINGS, PERMISSIONS,
} from '../lib/core.js';

export const PUBLIC_DIR = path.join(UPLOAD_DIR, 'public');
export const PRIVATE_DIR = path.join(UPLOAD_DIR, 'private');
fs.mkdirSync(PUBLIC_DIR, { recursive: true });
fs.mkdirSync(PRIVATE_DIR, { recursive: true });

const IMG = /\.(jpe?g|png|webp|gif)$/i;
const DOC = /\.(jpe?g|png|webp|pdf)$/i;
function uploader(dir, re) {
  return multer({
    storage: multer.diskStorage({
      destination: dir,
      filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + path.extname(file.originalname).toLowerCase()),
    }),
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(re.test(file.originalname) ? null : new Error('Tipo de archivo no permitido'), re.test(file.originalname)),
  });
}
export const uploadImage = uploader(PUBLIC_DIR, IMG);
export const uploadDoc = uploader(PRIVATE_DIR, DOC);

export const publicRouter = Router();
export const router = Router();

// ---------- login ----------
const attempts = new Map();
publicRouter.post('/auth/login', wrap((req, res) => {
  const { username, password } = req.body || {};
  const key = String(username || '').toLowerCase();
  const a = attempts.get(key) || { n: 0, until: 0 };
  if (a.until > Date.now()) fail(429, 'Demasiados intentos. Espere unos minutos.');
  const user = get('SELECT * FROM users WHERE lower(username) = ? AND active = 1', key);
  if (!user || !verifyPassword(String(password || ''), user.password_hash)) {
    a.n++; if (a.n >= 5) { a.until = Date.now() + 5 * 60000; a.n = 0; }
    attempts.set(key, a);
    fail(401, 'Usuario o contraseña incorrectos');
  }
  attempts.delete(key);
  const token = createSession(user.id);
  audit(user, 'auth.login', 'user', user.id);
  res.json({ token, user: { id: user.id, name: user.name, username: user.username, role: user.role } });
}));

publicRouter.get('/public/hotel', wrap((req, res) => {
  const s = getSettings();
  res.json({ name: s.hotel.name, logo: s.hotel.logo, online_booking: s.online_booking.enabled });
}));

router.use(authMiddleware);

router.get('/auth/me', (req, res) => res.json({ user: req.user, permissions: PERMISSIONS[req.user.role] }));
router.post('/auth/logout', wrap((req, res) => {
  run('DELETE FROM sessions WHERE token = ?', req.token);
  res.json({ ok: true });
}));
router.post('/auth/password', wrap((req, res) => {
  const { current, next } = req.body || {};
  const u = get('SELECT password_hash FROM users WHERE id = ?', req.user.id);
  if (!verifyPassword(String(current || ''), u.password_hash)) fail(400, 'La contraseña actual no es correcta');
  if (String(next || '').length < 6) fail(400, 'La nueva contraseña debe tener al menos 6 caracteres');
  run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), req.user.id);
  audit(req.user, 'user.password', 'user', req.user.id);
  res.json({ ok: true });
}));

// ---------- usuarios ----------
router.get('/users', requirePerm('users'), wrap((req, res) => {
  res.json(all('SELECT id, name, username, role, active, created_at FROM users ORDER BY name'));
}));
router.get('/users/lookup', wrap((req, res) => res.json(all('SELECT id, name, role FROM users WHERE active = 1 ORDER BY name'))));
router.post('/users', requirePerm('users'), wrap((req, res) => {
  const { name, username, password, role } = req.body;
  if (!name || !username || String(password || '').length < 6) fail(400, 'Nombre, usuario y contraseña (mín. 6) son obligatorios');
  if (!PERMISSIONS[role]) fail(400, 'Rol inválido');
  if (get('SELECT 1 FROM users WHERE lower(username) = lower(?)', username)) fail(409, 'El usuario ya existe');
  const id = insert('users', { name, username, role, password_hash: hashPassword(password) });
  audit(req.user, 'user.create', 'user', id, { username, role });
  res.json({ id });
}));
router.put('/users/:id', requirePerm('users'), wrap((req, res) => {
  const id = Number(req.params.id);
  const { name, role, active, password } = req.body;
  if (role && !PERMISSIONS[role]) fail(400, 'Rol inválido');
  if (id === req.user.id && (active === false || (role && role !== 'admin'))) fail(400, 'No puede desactivarse ni quitarse el rol de administrador a sí mismo');
  update('users', id, { name, role, active }, ['name', 'role', 'active'].filter((k) => req.body[k] !== undefined));
  if (password) {
    if (String(password).length < 6) fail(400, 'La contraseña debe tener al menos 6 caracteres');
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), id);
    run('DELETE FROM sessions WHERE user_id = ?', id);
  }
  if (active === false) run('DELETE FROM sessions WHERE user_id = ?', id);
  audit(req.user, 'user.update', 'user', id, { name, role, active, password_changed: !!password });
  res.json({ ok: true });
}));

// ---------- configuración ----------
function publicSettings(s, user) {
  const out = structuredClone(s);
  if (user.role !== 'admin') out.einvoice = { enabled: s.einvoice.enabled, provider: s.einvoice.provider };
  else if (out.einvoice.api_key) out.einvoice.api_key = '••••••••';
  return out;
}
router.get('/settings', wrap((req, res) => res.json(publicSettings(getSettings(), req.user))));
router.put('/settings/:key', requirePerm('settings'), wrap((req, res) => {
  const key = req.params.key;
  if (!(key in DEFAULT_SETTINGS)) fail(400, 'Clave inválida');
  let value = req.body;
  if (key === 'einvoice' && value.api_key === '••••••••') value.api_key = getSettings().einvoice.api_key;
  if (key === 'online_booking' && value.enabled) {
    // El módulo web aún no existe: se deja la preferencia guardada pero apagada.
    fail(400, 'El módulo de reservas en línea aún no está instalado.');
  }
  saveSetting(key, value);
  audit(req.user, 'settings.update', 'settings', null, { key });
  res.json(publicSettings(getSettings(), req.user)[key]);
}));
router.post('/settings/logo', requirePerm('settings'), uploadImage.single('file'), wrap((req, res) => {
  if (!req.file) fail(400, 'Archivo requerido');
  const s = getSettings();
  saveSetting('hotel', { ...s.hotel, logo: '/uploads/' + req.file.filename });
  audit(req.user, 'settings.logo', 'settings');
  res.json({ logo: '/uploads/' + req.file.filename });
}));

// ---------- parqueaderos (configuración) ----------
router.get('/parking-spaces', wrap((req, res) => res.json(all('SELECT * FROM parking_spaces ORDER BY code'))));
router.post('/parking-spaces', requirePerm('settings'), wrap((req, res) => {
  if (!req.body.code) fail(400, 'Código requerido');
  const id = insert('parking_spaces', { code: req.body.code, kind: req.body.kind || 'car' });
  res.json({ id });
}));
router.put('/parking-spaces/:id', requirePerm('settings'), wrap((req, res) => {
  update('parking_spaces', Number(req.params.id), req.body, ['code', 'kind', 'active']);
  res.json({ ok: true });
}));

// ---------- auditoría ----------
router.get('/audit', requirePerm('audit'), wrap((req, res) => {
  const { action, user_id, from, to } = req.query;
  const where = ['1=1']; const p = [];
  if (action) { where.push('a.action LIKE ?'); p.push(action + '%'); }
  if (user_id) { where.push('a.user_id = ?'); p.push(Number(user_id)); }
  if (from) { where.push("date(a.created_at, '-5 hours') >= ?"); p.push(from); }
  if (to) { where.push("date(a.created_at, '-5 hours') <= ?"); p.push(to); }
  res.json(all(
    `SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT 300`, ...p,
  ));
}));

// ---------- archivos privados (documentos de huéspedes) ----------
router.get('/files/:name', requirePerm('guests'), wrap((req, res) => {
  const name = path.basename(req.params.name);
  const doc = get('SELECT * FROM guest_documents WHERE path = ?', name);
  if (!doc) fail(404, 'Archivo no encontrado');
  res.sendFile(path.join(PRIVATE_DIR, name));
}));
