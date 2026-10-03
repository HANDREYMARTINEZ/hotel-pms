// Huéspedes, documentos y parqueadero.
import { Router } from 'express';
import { all, get, run, insert, update } from '../db.js';
import { wrap, fail, requirePerm, audit } from '../lib/core.js';
import { uploadDoc } from './admin.js';

export const router = Router();

export const GUEST_FIELDS = [
  'first_name', 'last_name', 'second_last_name', 'doc_type', 'doc_number', 'nationality', 'birth_date', 'gender',
  'phone', 'email', 'address', 'residence_country', 'residence_city', 'resides_abroad', 'occupation', 'notes',
];
export const DOC_TYPES = ['CC', 'CE', 'TI', 'PA', 'PEP', 'PPT', 'RC', 'DE', 'NIT', 'OTRO'];

function clean(b) {
  const out = {};
  for (const k of GUEST_FIELDS) if (b[k] !== undefined) out[k] = typeof b[k] === 'string' ? b[k].trim() || null : b[k];
  if (out.doc_number) out.doc_number = String(out.doc_number).replace(/[\s.]/g, '').toUpperCase();
  if (out.nationality) out.nationality = out.nationality.toUpperCase();
  if (out.residence_country) {
    out.residence_country = out.residence_country.toUpperCase();
    out.resides_abroad = out.residence_country !== 'CO' ? 1 : 0;
  }
  return out;
}

/** Crea o actualiza un huésped identificado por tipo y número de documento. */
export function upsertGuest(body, user) {
  const g = clean(body);
  if (body.id) {
    update('guests', Number(body.id), g, GUEST_FIELDS);
    return Number(body.id);
  }
  if (!g.first_name || !g.last_name || !g.doc_type || !g.doc_number) fail(400, 'Nombre, apellido y documento son obligatorios');
  if (!DOC_TYPES.includes(g.doc_type)) fail(400, 'Tipo de documento inválido');
  const existing = get('SELECT id FROM guests WHERE doc_type = ? AND doc_number = ?', g.doc_type, g.doc_number);
  if (existing) {
    update('guests', existing.id, g, GUEST_FIELDS);
    return existing.id;
  }
  const id = insert('guests', g);
  audit(user, 'guest.create', 'guest', id);
  return id;
}

router.get('/guests', requirePerm('guests'), wrap((req, res) => {
  const q = `%${String(req.query.q || '').trim()}%`;
  res.json(all(
    `SELECT g.*, (SELECT COUNT(*) FROM reservations r WHERE r.guest_id = g.id AND r.status = 'checked_out') AS stays,
       (SELECT MAX(check_out) FROM reservations r WHERE r.guest_id = g.id AND r.status IN ('checked_out','checked_in')) AS last_stay
     FROM guests g
     WHERE (g.first_name || ' ' || g.last_name || ' ' || COALESCE(g.second_last_name,'')) LIKE ? OR g.doc_number LIKE ? OR g.phone LIKE ? OR g.email LIKE ?
     ORDER BY g.id DESC LIMIT 100`, q, q, q, q,
  ));
}));

router.get('/guests/:id', requirePerm('guests'), wrap((req, res) => {
  const id = Number(req.params.id);
  const g = get('SELECT * FROM guests WHERE id = ?', id);
  if (!g) fail(404, 'Huésped no encontrado');
  g.documents = all('SELECT d.*, u.name AS uploaded_by_name FROM guest_documents d LEFT JOIN users u ON u.id = d.uploaded_by WHERE guest_id = ? ORDER BY id DESC', id);
  g.history = all(
    `SELECT DISTINCT r.id, r.code, r.status, r.check_in, r.check_out, r.source, r.guest_id = ? AS is_holder,
       (SELECT GROUP_CONCAT(rm.number) FROM reservation_rooms rr JOIN rooms rm ON rm.id = rr.room_id WHERE rr.reservation_id = r.id) AS rooms,
       (SELECT COALESCE(SUM(total),0) FROM charges c WHERE c.reservation_id = r.id AND c.voided = 0) AS total
     FROM reservations r LEFT JOIN reservation_guests rg ON rg.reservation_id = r.id
     WHERE r.guest_id = ? OR rg.guest_id = ? ORDER BY r.check_in DESC`, id, id, id,
  );
  g.vehicles = all(
    `SELECT DISTINCT v.plate, v.kind, v.color, v.brand FROM reservation_vehicles v JOIN reservations r ON r.id = v.reservation_id WHERE r.guest_id = ?`, id,
  );
  g.feedback = all('SELECT * FROM feedback WHERE guest_id = ? ORDER BY id DESC', id);
  res.json(g);
}));

router.get('/guests/lookup/doc', requirePerm('guests'), wrap((req, res) => {
  const { doc_type, doc_number } = req.query;
  const n = String(doc_number || '').replace(/[\s.]/g, '').toUpperCase();
  res.json(get('SELECT * FROM guests WHERE doc_number = ? AND (? = \'\' OR doc_type = ?)', n, doc_type || '', doc_type || '') || null);
}));

router.post('/guests', requirePerm('guests'), wrap((req, res) => res.json({ id: upsertGuest(req.body, req.user) })));
router.put('/guests/:id', requirePerm('guests'), wrap((req, res) => {
  const id = Number(req.params.id);
  const g = clean(req.body);
  if (g.doc_type && g.doc_number) {
    const dup = get('SELECT id FROM guests WHERE doc_type = ? AND doc_number = ? AND id <> ?', g.doc_type, g.doc_number, id);
    if (dup) fail(409, 'Ya existe otro huésped con ese documento');
  }
  update('guests', id, g, GUEST_FIELDS);
  audit(req.user, 'guest.update', 'guest', id);
  res.json({ ok: true });
}));

router.post('/guests/:id/documents', requirePerm('guests'), uploadDoc.single('file'), wrap((req, res) => {
  if (!req.file) fail(400, 'Archivo requerido');
  const id = insert('guest_documents', {
    guest_id: Number(req.params.id), kind: req.body.kind || 'otro', path: req.file.filename,
    original_name: req.file.originalname, uploaded_by: req.user.id,
  });
  audit(req.user, 'guest.document_upload', 'guest', Number(req.params.id), { kind: req.body.kind });
  res.json({ id });
}));
router.delete('/guests/documents/:docId', requirePerm('guests'), wrap((req, res) => {
  const d = get('SELECT * FROM guest_documents WHERE id = ?', Number(req.params.docId));
  if (!d) fail(404, 'No encontrado');
  run('DELETE FROM guest_documents WHERE id = ?', d.id);
  audit(req.user, 'guest.document_delete', 'guest', d.guest_id, { kind: d.kind });
  res.json({ ok: true });
}));

// ---------- parqueadero ----------
router.get('/parking', requirePerm('parking'), wrap((req, res) => {
  const spaces = all('SELECT * FROM parking_spaces WHERE active = 1 ORDER BY code');
  const vehicles = all(
    `SELECT v.*, r.code, r.id AS reservation_id, r.check_out, r.status,
       g.first_name || ' ' || g.last_name AS guest,
       (SELECT GROUP_CONCAT(rm.number) FROM reservation_rooms rr JOIN rooms rm ON rm.id = rr.room_id WHERE rr.reservation_id = r.id) AS rooms
     FROM reservation_vehicles v JOIN reservations r ON r.id = v.reservation_id JOIN guests g ON g.id = r.guest_id
     WHERE r.status = 'checked_in' ORDER BY v.id`,
  );
  res.json({ spaces: spaces.map((s) => ({ ...s, vehicle: vehicles.find((v) => v.parking_space_id === s.id) || null })), vehicles });
}));
router.get('/parking/search', requirePerm('parking'), wrap((req, res) => {
  const q = `%${String(req.query.plate || '').toUpperCase()}%`;
  res.json(all(
    `SELECT v.*, r.code, r.id AS reservation_id, r.check_in, r.check_out, r.status, g.first_name || ' ' || g.last_name AS guest
     FROM reservation_vehicles v JOIN reservations r ON r.id = v.reservation_id JOIN guests g ON g.id = r.guest_id
     WHERE v.plate LIKE ? ORDER BY r.check_in DESC LIMIT 50`, q,
  ));
}));
