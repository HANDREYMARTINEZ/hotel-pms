// Habitaciones, tipos, fotos, bloqueos y tarifas.
import { Router } from 'express';
import { all, get, run, insert, update, parseJSON, tx } from '../db.js';
import { wrap, fail, requirePerm, audit, today, getSettings, saveSetting } from '../lib/core.js';
import { quoteRoom, availableRooms, roomConflicts } from '../lib/booking.js';
import { uploadImage } from './admin.js';

export const router = Router();

/** Estado visible de cada habitación, derivado de reservas, limpieza y mantenimiento. */
export function roomBoard() {
  const t = today();
  const rooms = all(
    `SELECT r.*, rt.name AS type_name, rt.base_price, COALESCE(r.capacity, rt.capacity) AS max_guests,
       COALESCE(r.price_override, rt.base_price) AS price
     FROM rooms r JOIN room_types rt ON rt.id = r.room_type_id WHERE r.active = 1 ORDER BY r.sort, r.number`,
  );
  const inHouse = all(
    `SELECT rr.room_id, r.id, r.code, r.check_in, r.check_out, g.first_name || ' ' || g.last_name AS guest
     FROM reservation_rooms rr JOIN reservations r ON r.id = rr.reservation_id JOIN guests g ON g.id = r.guest_id
     WHERE r.status = 'checked_in'`,
  );
  const arrivals = all(
    `SELECT rr.room_id, r.id, r.code, r.check_in, r.check_out, g.first_name || ' ' || g.last_name AS guest
     FROM reservation_rooms rr JOIN reservations r ON r.id = rr.reservation_id JOIN guests g ON g.id = r.guest_id
     WHERE r.status IN ('confirmed','pending') AND rr.check_in <= ? AND rr.check_out > ?`, t, t,
  );
  const photos = all('SELECT room_id, path FROM room_photos ORDER BY sort, id');
  const blocks = all('SELECT * FROM room_blocks WHERE start_date <= ? AND end_date > ?', t, t);
  return rooms.map((r) => {
    const stay = inHouse.find((x) => x.room_id === r.id);
    const arrival = arrivals.find((x) => x.room_id === r.id);
    const block = blocks.find((b) => b.room_id === r.id);
    let status = 'available';
    if (r.out_of_service || block) status = 'maintenance';
    else if (stay) status = 'occupied';
    else if (r.housekeeping !== 'clean') status = 'cleaning';
    else if (arrival) status = 'reserved';
    return {
      ...r, amenities: parseJSON(r.amenities, []), status,
      stay: stay || null, arrival: arrival || null, block: block || null,
      departs_today: stay?.check_out <= t,
      photos: photos.filter((p) => p.room_id === r.id).map((p) => p.path),
    };
  });
}

// ---------- tipos ----------
router.get('/room-types', wrap((req, res) => {
  res.json(all('SELECT * FROM room_types ORDER BY name').map((t) => ({ ...t, amenities: parseJSON(t.amenities, []) })));
}));
router.post('/room-types', requirePerm('rooms.manage'), wrap((req, res) => {
  const { name, description, capacity, base_price, amenities } = req.body;
  if (!name) fail(400, 'Nombre requerido');
  const id = insert('room_types', { name, description, capacity: capacity || 2, base_price: base_price || 0, amenities: amenities || [] });
  audit(req.user, 'room_type.create', 'room_type', id, { name, base_price });
  res.json({ id });
}));
router.put('/room-types/:id', requirePerm('rooms.manage'), wrap((req, res) => {
  update('room_types', Number(req.params.id), req.body, ['name', 'description', 'capacity', 'base_price', 'amenities', 'active']);
  audit(req.user, 'room_type.update', 'room_type', Number(req.params.id), req.body);
  res.json({ ok: true });
}));

// ---------- habitaciones ----------
router.get('/rooms', requirePerm('rooms.view'), wrap((req, res) => res.json(roomBoard())));
router.get('/rooms/:id', requirePerm('rooms.view'), wrap((req, res) => {
  const room = roomBoard().find((r) => r.id === Number(req.params.id)) || get('SELECT * FROM rooms WHERE id = ?', Number(req.params.id));
  if (!room) fail(404, 'No encontrada');
  room.photo_list = all('SELECT * FROM room_photos WHERE room_id = ? ORDER BY sort, id', room.id);
  room.blocks = all('SELECT * FROM room_blocks WHERE room_id = ? AND end_date >= ? ORDER BY start_date', room.id, today());
  room.upcoming = all(
    `SELECT r.id, r.code, r.status, rr.check_in, rr.check_out, g.first_name || ' ' || g.last_name AS guest
     FROM reservation_rooms rr JOIN reservations r ON r.id = rr.reservation_id JOIN guests g ON g.id = r.guest_id
     WHERE rr.room_id = ? AND rr.check_out >= ? AND r.status IN ('pending','confirmed','checked_in') ORDER BY rr.check_in LIMIT 10`,
    room.id, today(),
  );
  res.json(room);
}));
const ROOM_FIELDS = ['number', 'room_type_id', 'floor', 'capacity', 'price_override', 'amenities', 'description', 'online_bookable', 'sort', 'active'];
router.post('/rooms', requirePerm('rooms.manage'), wrap((req, res) => {
  const b = req.body;
  if (!b.number || !b.room_type_id) fail(400, 'Número y tipo son obligatorios');
  if (get('SELECT 1 FROM rooms WHERE number = ?', b.number)) fail(409, 'Ya existe una habitación con ese número');
  const data = Object.fromEntries(ROOM_FIELDS.filter((k) => b[k] !== undefined).map((k) => [k, b[k] === '' ? null : b[k]]));
  const id = insert('rooms', data);
  audit(req.user, 'room.create', 'room', id, { number: b.number });
  res.json({ id });
}));
router.put('/rooms/:id', requirePerm('rooms.manage'), wrap((req, res) => {
  const data = Object.fromEntries(Object.entries(req.body).map(([k, v]) => [k, v === '' ? null : v]));
  update('rooms', Number(req.params.id), data, ROOM_FIELDS);
  audit(req.user, 'room.update', 'room', Number(req.params.id), data);
  res.json({ ok: true });
}));

// Estado operativo: limpieza y mantenimiento.
router.post('/rooms/:id/housekeeping', requirePerm('housekeeping'), wrap((req, res) => {
  const { housekeeping } = req.body;
  if (!['clean', 'dirty', 'in_progress'].includes(housekeeping)) fail(400, 'Estado inválido');
  const id = Number(req.params.id);
  tx(() => {
    run('UPDATE rooms SET housekeeping = ? WHERE id = ?', housekeeping, id);
    if (housekeeping === 'clean') {
      run(`UPDATE housekeeping_tasks SET status = 'done', completed_at = datetime('now'), completed_by = ? WHERE room_id = ? AND status <> 'done' AND kind <> 'maintenance'`, req.user.id, id);
    } else if (housekeeping === 'in_progress') {
      run(`UPDATE housekeeping_tasks SET status = 'in_progress' WHERE room_id = ? AND status = 'pending' AND kind <> 'maintenance'`, id);
    }
  });
  audit(req.user, 'room.housekeeping', 'room', id, { housekeeping });
  res.json({ ok: true });
}));
router.post('/rooms/:id/maintenance', requirePerm('rooms.manage', 'housekeeping'), wrap((req, res) => {
  const id = Number(req.params.id);
  const { out_of_service, reason } = req.body;
  run('UPDATE rooms SET out_of_service = ?, out_of_service_reason = ? WHERE id = ?', out_of_service ? 1 : 0, out_of_service ? reason || null : null, id);
  if (out_of_service) insert('housekeeping_tasks', { room_id: id, kind: 'maintenance', notes: reason || 'Mantenimiento', created_by: req.user.id });
  else run(`UPDATE housekeeping_tasks SET status = 'done', completed_at = datetime('now'), completed_by = ? WHERE room_id = ? AND kind = 'maintenance' AND status <> 'done'`, req.user.id, id);
  audit(req.user, out_of_service ? 'room.maintenance_on' : 'room.maintenance_off', 'room', id, { reason });
  res.json({ ok: true });
}));

// Fotos
router.post('/rooms/:id/photos', requirePerm('rooms.manage'), uploadImage.array('files', 10), wrap((req, res) => {
  const id = Number(req.params.id);
  for (const f of req.files || []) insert('room_photos', { room_id: id, path: '/uploads/' + f.filename });
  res.json({ ok: true });
}));
router.delete('/rooms/photos/:photoId', requirePerm('rooms.manage'), wrap((req, res) => {
  run('DELETE FROM room_photos WHERE id = ?', Number(req.params.photoId));
  res.json({ ok: true });
}));

// Bloqueos por fechas
router.post('/rooms/:id/blocks', requirePerm('rooms.manage'), wrap((req, res) => {
  const id = Number(req.params.id);
  const { start_date, end_date, reason } = req.body;
  if (!start_date || !end_date || end_date <= start_date) fail(400, 'Fechas inválidas');
  const c = roomConflicts(id, start_date, end_date);
  if (c.reservations.length) fail(409, `Hay reservas en esas fechas (${c.reservations.map((r) => r.code).join(', ')})`);
  const bid = insert('room_blocks', { room_id: id, start_date, end_date, reason, created_by: req.user.id });
  audit(req.user, 'room.block', 'room', id, { start_date, end_date, reason });
  res.json({ id: bid });
}));
router.delete('/rooms/blocks/:blockId', requirePerm('rooms.manage'), wrap((req, res) => {
  run('DELETE FROM room_blocks WHERE id = ?', Number(req.params.blockId));
  audit(req.user, 'room.unblock', 'room_block', Number(req.params.blockId));
  res.json({ ok: true });
}));

// ---------- tarifas ----------
router.get('/rates', requirePerm('rates.view', 'rates'), wrap((req, res) => {
  res.json({
    seasons: all('SELECT * FROM seasons ORDER BY start_date DESC').map((s) => ({ ...s, prices: parseJSON(s.prices, {}) })),
    long_stay: all('SELECT * FROM long_stay_rules ORDER BY min_nights'),
    weekend: getSettings().weekend,
  });
}));
router.post('/rates/seasons', requirePerm('rates'), wrap((req, res) => {
  const { name, start_date, end_date, mode, percent, prices } = req.body;
  if (!name || !start_date || !end_date || end_date < start_date) fail(400, 'Datos de temporada inválidos');
  const id = insert('seasons', { name, start_date, end_date, mode: mode || 'percent', percent: percent || 0, prices: prices || {} });
  audit(req.user, 'rates.season_create', 'season', id, req.body);
  res.json({ id });
}));
router.put('/rates/seasons/:id', requirePerm('rates'), wrap((req, res) => {
  update('seasons', Number(req.params.id), req.body, ['name', 'start_date', 'end_date', 'mode', 'percent', 'prices', 'active']);
  audit(req.user, 'rates.season_update', 'season', Number(req.params.id), req.body);
  res.json({ ok: true });
}));
router.delete('/rates/seasons/:id', requirePerm('rates'), wrap((req, res) => {
  run('DELETE FROM seasons WHERE id = ?', Number(req.params.id));
  audit(req.user, 'rates.season_delete', 'season', Number(req.params.id));
  res.json({ ok: true });
}));
router.post('/rates/long-stay', requirePerm('rates'), wrap((req, res) => {
  const { min_nights, discount_percent } = req.body;
  if (!(min_nights > 1) || !(discount_percent > 0 && discount_percent < 100)) fail(400, 'Regla inválida');
  const id = insert('long_stay_rules', { min_nights, discount_percent });
  audit(req.user, 'rates.long_stay_create', 'long_stay_rule', id, req.body);
  res.json({ id });
}));
router.delete('/rates/long-stay/:id', requirePerm('rates'), wrap((req, res) => {
  run('DELETE FROM long_stay_rules WHERE id = ?', Number(req.params.id));
  audit(req.user, 'rates.long_stay_delete', 'long_stay_rule', Number(req.params.id));
  res.json({ ok: true });
}));
router.put('/rates/weekend', requirePerm('rates'), wrap((req, res) => {
  saveSetting('weekend', req.body);
  audit(req.user, 'rates.weekend', 'settings', null, req.body);
  res.json({ ok: true });
}));

// ---------- disponibilidad y cotización ----------
router.get('/availability', requirePerm('reservations', 'rates.view'), wrap((req, res) => {
  const { from, to, guests, exclude } = req.query;
  res.json(availableRooms({ from, to, guests: Number(guests) || 1, excludeReservationId: Number(exclude) || 0 }));
}));
router.get('/quote', requirePerm('reservations', 'rates.view'), wrap((req, res) => {
  const { room_id, from, to } = req.query;
  res.json(quoteRoom(Number(room_id), from, to));
}));
