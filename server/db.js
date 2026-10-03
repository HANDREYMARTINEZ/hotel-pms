// Conexión SQLite (módulo nativo node:sqlite), esquema y utilidades de consulta.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Modo demostración (Vercel): sin disco permanente, los datos viven en /tmp y se
// regeneran con datos ficticios cada vez que arranca una instancia.
export const DEMO = process.env.DEMO_MODE === '1' || !!process.env.VERCEL;
export const DATA_DIR = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp/hotel-data' : path.join(__dirname, '..', 'data'));
if (process.env.VERCEL) fs.rmSync(DATA_DIR, { recursive: true, force: true });
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'hotel.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','reception','housekeeping')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== Habitaciones =====
CREATE TABLE IF NOT EXISTS room_types (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  capacity INTEGER NOT NULL DEFAULT 2,
  base_price INTEGER NOT NULL DEFAULT 0,
  amenities TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  room_type_id INTEGER NOT NULL REFERENCES room_types(id),
  floor TEXT,
  capacity INTEGER,                 -- NULL = hereda del tipo
  price_override INTEGER,           -- NULL = hereda del tipo
  amenities TEXT NOT NULL DEFAULT '[]',
  description TEXT,
  housekeeping TEXT NOT NULL DEFAULT 'clean' CHECK (housekeeping IN ('clean','dirty','in_progress')),
  out_of_service INTEGER NOT NULL DEFAULT 0,
  out_of_service_reason TEXT,
  online_bookable INTEGER NOT NULL DEFAULT 1,   -- futuro módulo web
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS room_photos (
  id INTEGER PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

-- Bloqueos por mantenimiento en fechas futuras (afectan disponibilidad)
CREATE TABLE IF NOT EXISTS room_blocks (
  id INTEGER PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,           -- exclusivo
  reason TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== Tarifas =====
CREATE TABLE IF NOT EXISTS seasons (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,           -- inclusivo
  mode TEXT NOT NULL DEFAULT 'percent' CHECK (mode IN ('percent','price')),
  percent REAL NOT NULL DEFAULT 0,  -- +20 = 20% más caro
  prices TEXT NOT NULL DEFAULT '{}',-- {room_type_id: precio}
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS long_stay_rules (
  id INTEGER PRIMARY KEY,
  min_nights INTEGER NOT NULL,
  discount_percent REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

-- ===== Huéspedes =====
CREATE TABLE IF NOT EXISTS guests (
  id INTEGER PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  second_last_name TEXT,
  doc_type TEXT NOT NULL,
  doc_number TEXT NOT NULL,
  nationality TEXT NOT NULL DEFAULT 'CO',  -- ISO 3166-1 alfa-2
  birth_date TEXT,
  gender TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  residence_country TEXT NOT NULL DEFAULT 'CO',
  residence_city TEXT,
  resides_abroad INTEGER NOT NULL DEFAULT 0,
  occupation TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (doc_type, doc_number)
);

CREATE TABLE IF NOT EXISTS guest_documents (
  id INTEGER PRIMARY KEY,
  guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  original_name TEXT,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== Reservas =====
-- Una reserva es también la "cuenta" (folio) del huésped.
CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  guest_id INTEGER NOT NULL REFERENCES guests(id),
  source TEXT NOT NULL DEFAULT 'walk_in',
  source_detail TEXT,
  external_ref TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('pending','confirmed','checked_in','checked_out','cancelled','no_show')),
  check_in TEXT NOT NULL,
  check_out TEXT NOT NULL,
  adults INTEGER NOT NULL DEFAULT 1,
  children INTEGER NOT NULL DEFAULT 0,
  estimated_total INTEGER NOT NULL DEFAULT 0,
  tax_exempt INTEGER NOT NULL DEFAULT 0,
  travel_reason TEXT,
  origin_city TEXT,
  destination_city TEXT,
  notes TEXT,
  hold_expires_at TEXT,           -- para reservas web pendientes de pago
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  checked_in_at TEXT, checked_in_by INTEGER REFERENCES users(id),
  checked_out_at TEXT, checked_out_by INTEGER REFERENCES users(id),
  cancelled_at TEXT, cancelled_by INTEGER REFERENCES users(id), cancel_reason TEXT,
  tra_reported_at TEXT,
  sire_in_reported_at TEXT,
  sire_out_reported_at TEXT
);

CREATE TABLE IF NOT EXISTS reservation_rooms (
  id INTEGER PRIMARY KEY,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  check_in TEXT NOT NULL,
  check_out TEXT NOT NULL,        -- exclusivo (día de salida)
  nightly TEXT NOT NULL DEFAULT '[]',
  total INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rr_dates ON reservation_rooms(room_id, check_in, check_out);

CREATE TABLE IF NOT EXISTS reservation_guests (
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  guest_id INTEGER NOT NULL REFERENCES guests(id),
  relationship TEXT,
  PRIMARY KEY (reservation_id, guest_id)
);

-- ===== Vehículos =====
CREATE TABLE IF NOT EXISTS parking_spaces (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'car',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS reservation_vehicles (
  id INTEGER PRIMARY KEY,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  plate TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'car',
  color TEXT,
  brand TEXT,
  parking_space_id INTEGER REFERENCES parking_spaces(id)
);

-- ===== Cargos y pagos =====
CREATE TABLE IF NOT EXISTS charges (
  id INTEGER PRIMARY KEY,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id),
  category TEXT NOT NULL CHECK (category IN ('lodging','service','product','other')),
  description TEXT NOT NULL,
  service_date TEXT,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price INTEGER NOT NULL,
  total INTEGER NOT NULL,
  tax_rate REAL NOT NULL DEFAULT 0,
  tax_amount INTEGER NOT NULL DEFAULT 0,
  ref_type TEXT, ref_id INTEGER,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  voided INTEGER NOT NULL DEFAULT 0,
  voided_by INTEGER REFERENCES users(id), voided_at TEXT, void_reason TEXT
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  reservation_id INTEGER REFERENCES reservations(id),
  sale_id INTEGER REFERENCES sales(id),
  kind TEXT NOT NULL DEFAULT 'payment' CHECK (kind IN ('advance','payment','refund')),
  method TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reference TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  voided INTEGER NOT NULL DEFAULT 0,
  voided_by INTEGER REFERENCES users(id), voided_at TEXT, void_reason TEXT
);

-- ===== Servicios, inventario y ventas =====
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  tax_rate REAL,                    -- NULL = tasa por defecto de servicios
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  sku TEXT,
  category TEXT,
  price INTEGER NOT NULL DEFAULT 0,
  cost INTEGER NOT NULL DEFAULT 0,
  stock REAL NOT NULL DEFAULT 0,
  min_stock REAL NOT NULL DEFAULT 0,
  tax_rate REAL,                    -- NULL = tasa por defecto de productos
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  kind TEXT NOT NULL CHECK (kind IN ('in','out','adjust','sale','sale_void')),
  quantity REAL NOT NULL,          -- con signo
  reason TEXT,
  ref_type TEXT, ref_id INTEGER,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY,
  reservation_id INTEGER REFERENCES reservations(id), -- NULL = venta directa
  total INTEGER NOT NULL DEFAULT 0,
  tax_amount INTEGER NOT NULL DEFAULT 0,
  customer_name TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  voided INTEGER NOT NULL DEFAULT 0,
  voided_by INTEGER REFERENCES users(id), voided_at TEXT, void_reason TEXT
);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  description TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_price INTEGER NOT NULL,
  total INTEGER NOT NULL,
  tax_rate REAL NOT NULL DEFAULT 0,
  tax_amount INTEGER NOT NULL DEFAULT 0
);

-- ===== Limpieza =====
CREATE TABLE IF NOT EXISTS housekeeping_tasks (
  id INTEGER PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  kind TEXT NOT NULL DEFAULT 'checkout',  -- checkout, daily, deep, maintenance
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done')),
  notes TEXT,
  assigned_to INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT, completed_by INTEGER REFERENCES users(id)
);

-- ===== Postventa =====
CREATE TABLE IF NOT EXISTS surveys (
  id INTEGER PRIMARY KEY,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id),
  token TEXT NOT NULL UNIQUE,
  sent_at TEXT, sent_channel TEXT,
  completed_at TEXT,
  overall INTEGER,
  ratings TEXT,
  would_return INTEGER,
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY,
  reservation_id INTEGER REFERENCES reservations(id),
  guest_id INTEGER REFERENCES guests(id),
  kind TEXT NOT NULL DEFAULT 'complaint' CHECK (kind IN ('comment','complaint','suggestion','compliment')),
  subject TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS feedback_updates (
  id INTEGER PRIMARY KEY,
  feedback_id INTEGER NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  status TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== Facturación electrónica (preparado para proveedor tecnológico) =====
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  reservation_id INTEGER REFERENCES reservations(id),
  sale_id INTEGER REFERENCES sales(id),
  number TEXT,
  customer TEXT NOT NULL,          -- JSON con datos del adquiriente
  lines TEXT NOT NULL,             -- JSON
  subtotal INTEGER NOT NULL,
  tax_amount INTEGER NOT NULL,
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','queued','sent','accepted','rejected','error')),
  provider TEXT,
  provider_ref TEXT,
  cufe TEXT,
  response TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

db.exec(SCHEMA);

// ---------- utilidades ----------
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

let depth = 0;
export function tx(fn) {
  if (depth > 0) return fn();
  depth++;
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    depth--;
  }
}

/** Inserta un objeto como fila y devuelve el id. */
export function insert(table, obj) {
  const keys = Object.keys(obj);
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  return Number(run(sql, ...keys.map((k) => norm(obj[k]))).lastInsertRowid);
}

/** Actualiza columnas permitidas de una fila. */
export function update(table, id, obj, allowed) {
  const keys = Object.keys(obj).filter((k) => !allowed || allowed.includes(k));
  if (!keys.length) return;
  run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => norm(obj[k])), id);
}

function norm(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}

export function parseJSON(v, fallback) {
  try { return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
