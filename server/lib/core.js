// Configuración, fechas, autenticación, permisos y auditoría.
import crypto from 'node:crypto';
import { all, get, run, insert, parseJSON, DEMO } from '../db.js';

export { DEMO };

// ---------- configuración ----------
export const DEFAULT_SETTINGS = {
  hotel: {
    name: 'Mi Hotel', legal_name: '', nit: '', rnt: '', address: '', city: '', department: '',
    city_code: '', phone: '', whatsapp: '', email: '', website: '', logo: null,
  },
  schedule: { check_in_time: '15:00', check_out_time: '12:00' },
  taxes: {
    prices_include_tax: true,
    lodging_rate: 19,      // IVA alojamiento
    services_rate: 19,
    products_rate: 19,
  },
  payment_methods: [
    { code: 'cash', name: 'Efectivo', active: true },
    { code: 'card', name: 'Tarjeta débito/crédito', active: true },
    { code: 'transfer', name: 'Transferencia', active: true },
    { code: 'nequi', name: 'Nequi', active: true },
    { code: 'daviplata', name: 'Daviplata', active: true },
  ],
  reservation_sources: [
    { code: 'walk_in', name: 'Presencial', active: true },
    { code: 'phone', name: 'Teléfono', active: true },
    { code: 'whatsapp', name: 'WhatsApp', active: true },
    { code: 'agency', name: 'Agencia', active: true },
    { code: 'ota', name: 'Plataforma externa', active: true },
    { code: 'web', name: 'Web propia', active: false },
  ],
  policies: {
    cancellation: 'Cancelación gratuita hasta 48 horas antes de la llegada. Después se cobra la primera noche.',
    advance_percent: 30,
    house_rules: '',
  },
  weekend: { enabled: true, days: [5, 6], mode: 'percent', percent: 15, prices: {} }, // 5=viernes, 6=sábado (noche)
  // Los códigos SIRE (tipo de documento y país) son tablas propias de Migración Colombia:
  // verifíquelos en la guía vigente del portal SIRE antes del primer reporte.
  compliance: {
    sire_establishment_code: '', sire_city_code: '', tra_enabled: true,
    sire_doc_codes: { PA: '3', CE: '5' },
    sire_country_codes: {},
  },
  einvoice: { enabled: false, provider: 'none', environment: 'test', api_url: '', api_key: '', resolution: '', prefix: '' },
  online_booking: { enabled: false, hold_minutes: 30, require_advance: true },
  survey: { enabled: true, message: 'Hola {nombre}, gracias por hospedarte en {hotel}. ¿Nos ayudas con esta breve encuesta? {enlace}' },
};

export function getSettings() {
  const rows = all('SELECT key, value FROM settings');
  const out = structuredClone(DEFAULT_SETTINGS);
  for (const r of rows) {
    const v = parseJSON(r.value, null);
    if (v && typeof v === 'object' && !Array.isArray(v) && out[r.key] && !Array.isArray(out[r.key])) out[r.key] = { ...out[r.key], ...v };
    else if (v !== null) out[r.key] = v;
  }
  return out;
}

export function saveSetting(key, value) {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}

// ---------- fechas (zona horaria de Colombia) ----------
export const TZ = 'America/Bogota';
export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function nightsBetween(a, b) {
  return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);
}
export function eachNight(from, to) {
  const out = [];
  for (let d = from; d < to; d = addDays(d, 1)) out.push(d);
  return out;
}
export const dow = (dateStr) => new Date(dateStr + 'T12:00:00Z').getUTCDay();
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

// ---------- errores ----------
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const fail = (status, msg) => { throw new HttpError(status, msg); };
export const wrap = (fn) => (req, res, next) => {
  try {
    const r = fn(req, res, next);
    if (r && typeof r.then === 'function') r.catch(next);
  } catch (e) { next(e); }
};

// ---------- contraseñas y sesiones ----------
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
export function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(pw, salt, 64);
  return crypto.timingSafeEqual(h, Buffer.from(hash, 'hex'));
}
// Los tokens van firmados (usuario.vence.aleatorio.firma). En modo demo, donde cada
// instancia tiene su propia base, la firma permite aceptar la sesión en cualquier instancia.
const SECRET = process.env.SESSION_SECRET || (DEMO ? 'hotel-pms-demo' : crypto.randomBytes(32).toString('hex'));
const sign = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('hex').slice(0, 32);
export function createSession(userId) {
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 14;
  const body = `${userId}.${exp}.${crypto.randomBytes(16).toString('hex')}`;
  const token = `${body}.${sign(body)}`;
  run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', token, userId, new Date(exp).toISOString());
  return token;
}
function signedUserId(token) {
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const body = parts.slice(0, 3).join('.');
  const sig = Buffer.from(sign(body)); const given = Buffer.from(parts[3]);
  if (sig.length !== given.length || !crypto.timingSafeEqual(sig, given) || Number(parts[1]) < Date.now()) return null;
  return Number(parts[0]);
}

// Permisos por rol. Las rutas declaran qué permiso requieren.
export const PERMISSIONS = {
  admin: ['*'],
  reception: [
    'dashboard', 'rooms.view', 'reservations', 'guests', 'checkin', 'payments', 'sales', 'inventory.view',
    'services.view', 'housekeeping', 'parking', 'feedback', 'compliance', 'rates.view',
  ],
  housekeeping: ['housekeeping', 'rooms.view'],
};
export const can = (user, perm) => {
  const p = PERMISSIONS[user?.role] || [];
  return p.includes('*') || p.includes(perm);
};

export function authMiddleware(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  let row = get(
    `SELECT u.id, u.name, u.username, u.role, u.active, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
    String(token),
  );
  if (!row && DEMO) {
    const uid = signedUserId(String(token));
    if (uid) row = get(`SELECT id, name, username, role, active, '9999' AS expires_at FROM users WHERE id = ?`, uid);
  }
  if (!row || !row.active || row.expires_at < new Date().toISOString()) return res.status(401).json({ error: 'Sesión expirada' });
  req.user = { id: row.id, name: row.name, username: row.username, role: row.role };
  req.token = String(token);
  next();
}

export const requirePerm = (...perms) => (req, res, next) => {
  if (perms.some((p) => can(req.user, p))) return next();
  res.status(403).json({ error: 'No tiene permiso para esta acción' });
};

// ---------- auditoría ----------
export function audit(user, action, entity, entityId, details) {
  insert('audit_log', {
    user_id: user?.id ?? null, action, entity: entity ?? null, entity_id: entityId ?? null,
    details: details == null ? null : details,
  });
}

// ---------- impuestos ----------
/** Calcula total e impuesto de una línea según la configuración (precio con o sin IVA incluido). */
export function lineTax(amount, rate, settings) {
  const r = Number(rate) || 0;
  if (!r) return { total: Math.round(amount), tax: 0 };
  if (settings.taxes.prices_include_tax) {
    const total = Math.round(amount);
    return { total, tax: Math.round(total - total / (1 + r / 100)) };
  }
  const tax = Math.round(amount * r / 100);
  return { total: Math.round(amount) + tax, tax };
}

export function newCode(prefix) {
  return prefix + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}
