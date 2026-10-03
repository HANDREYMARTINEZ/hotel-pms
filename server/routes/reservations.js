// Reservas, check-in/out, cargos y pagos.
import { Router } from 'express';
import crypto from 'node:crypto';
import { all, get, run, insert, update, parseJSON, tx } from '../db.js';
import { wrap, fail, requirePerm, audit, today, addDays, getSettings, can, isDate } from '../lib/core.js';
import {
  createReservation, setReservationRooms, syncLodgingCharges, folio, postCharge, voidCharge, addPayment,
  estimatedBalance, isRoomAvailable, quoteRoom,
} from '../lib/booking.js';
import { upsertGuest } from './guests.js';
import { receiptPdf } from '../lib/pdf.js';

export const router = Router();

const resvRooms = (id) => all(
  `SELECT rr.*, rm.number, rt.name AS type_name FROM reservation_rooms rr JOIN rooms rm ON rm.id = rr.room_id
   JOIN room_types rt ON rt.id = rm.room_type_id WHERE rr.reservation_id = ?`, id,
).map((r) => ({ ...r, nightly: parseJSON(r.nightly, []) }));

function loadReservation(id) {
  const r = get(
    `SELECT r.*, cu.name AS created_by_name, ci.name AS checked_in_by_name, co.name AS checked_out_by_name, ca.name AS cancelled_by_name
     FROM reservations r LEFT JOIN users cu ON cu.id = r.created_by LEFT JOIN users ci ON ci.id = r.checked_in_by
     LEFT JOIN users co ON co.id = r.checked_out_by LEFT JOIN users ca ON ca.id = r.cancelled_by WHERE r.id = ?`, id,
  );
  if (!r) fail(404, 'Reserva no encontrada');
  r.guest = get('SELECT * FROM guests WHERE id = ?', r.guest_id);
  r.guest.documents = all('SELECT id, kind, path, original_name, created_at FROM guest_documents WHERE guest_id = ?', r.guest_id);
  r.companions = all('SELECT g.*, rg.relationship FROM reservation_guests rg JOIN guests g ON g.id = rg.guest_id WHERE rg.reservation_id = ?', id);
  r.vehicles = all('SELECT v.*, p.code AS parking_code FROM reservation_vehicles v LEFT JOIN parking_spaces p ON p.id = v.parking_space_id WHERE reservation_id = ?', id);
  r.rooms = resvRooms(id);
  r.folio = folio(id);
  r.estimate = estimatedBalance(id);
  r.survey = get('SELECT * FROM surveys WHERE reservation_id = ?', id) || null;
  r.invoices = all('SELECT id, number, status, total, created_at FROM invoices WHERE reservation_id = ?', id);
  return r;
}

// ---------- listados ----------
router.get('/reservations', requirePerm('reservations'), wrap((req, res) => {
  const { from, to, status, q, source } = req.query;
  const where = ['1=1']; const p = [];
  if (from) { where.push('r.check_out >= ?'); p.push(from); }
  if (to) { where.push('r.check_in <= ?'); p.push(to); }
  if (status) { where.push(`r.status IN (${String(status).split(',').map(() => '?').join(',')})`); p.push(...String(status).split(',')); }
  if (source) { where.push('r.source = ?'); p.push(source); }
  if (q) {
    where.push(`(r.code LIKE ? OR g.first_name || ' ' || g.last_name LIKE ? OR g.doc_number LIKE ? OR g.phone LIKE ?)`);
    p.push(...Array(4).fill(`%${q}%`));
  }
  res.json(all(
    `SELECT r.*, g.first_name || ' ' || g.last_name AS guest_name, g.phone AS guest_phone,
       (SELECT GROUP_CONCAT(rm.number, ', ') FROM reservation_rooms rr JOIN rooms rm ON rm.id = rr.room_id WHERE rr.reservation_id = r.id) AS rooms,
       (SELECT COALESCE(SUM(CASE WHEN kind='refund' THEN -amount ELSE amount END),0) FROM payments WHERE reservation_id = r.id AND voided = 0) AS paid
     FROM reservations r JOIN guests g ON g.id = r.guest_id WHERE ${where.join(' AND ')}
     ORDER BY r.check_in DESC, r.id DESC LIMIT 300`, ...p,
  ));
}));

router.get('/reservations/timeline', requirePerm('reservations', 'rooms.view'), wrap((req, res) => {
  const from = isDate(req.query.from) ? req.query.from : addDays(today(), -2);
  const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 62);
  const to = addDays(from, days);
  const rooms = all(
    `SELECT r.id, r.number, r.housekeeping, r.out_of_service, rt.name AS type_name FROM rooms r JOIN room_types rt ON rt.id = r.room_type_id
     WHERE r.active = 1 ORDER BY r.sort, r.number`,
  );
  const bookings = all(
    `SELECT rr.room_id, rr.check_in, rr.check_out, r.id, r.code, r.status, r.source, r.adults, r.children,
       g.first_name || ' ' || g.last_name AS guest
     FROM reservation_rooms rr JOIN reservations r ON r.id = rr.reservation_id JOIN guests g ON g.id = r.guest_id
     WHERE rr.check_in < ? AND rr.check_out > ? AND r.status IN ('pending','confirmed','checked_in','checked_out','no_show')`, to, from,
  );
  const blocks = all('SELECT * FROM room_blocks WHERE start_date < ? AND end_date > ?', to, from);
  res.json({ from, to, days, rooms, bookings, blocks, today: today() });
}));

router.get('/reservations/:id', requirePerm('reservations'), wrap((req, res) => res.json(loadReservation(Number(req.params.id)))));

// ---------- crear / modificar ----------
router.post('/reservations', requirePerm('reservations'), wrap((req, res) => {
  const b = req.body;
  const id = tx(() => {
    const guestId = b.guest_id || upsertGuest(b.guest || {}, req.user);
    const rid = createReservation({ ...b, guest_id: guestId, room_ids: b.room_ids || [] }, req.user);
    if (b.advance && Number(b.advance.amount) > 0) {
      addPayment({ ...b.advance, reservation_id: rid, kind: 'advance' }, req.user);
    }
    return rid;
  });
  res.json({ id });
}));

router.put('/reservations/:id', requirePerm('reservations'), wrap((req, res) => {
  const id = Number(req.params.id);
  const r = get('SELECT * FROM reservations WHERE id = ?', id);
  if (!r) fail(404, 'No encontrada');
  if (['checked_out', 'cancelled', 'no_show'].includes(r.status)) fail(400, 'La reserva ya está cerrada');
  const b = req.body;
  tx(() => {
    update('reservations', id, b, ['source', 'source_detail', 'external_ref', 'adults', 'children', 'notes', 'travel_reason', 'origin_city', 'destination_city', 'status']
      .filter((k) => b[k] !== undefined && !(k === 'status' && !['pending', 'confirmed'].includes(b.status))));
    const roomIds = b.room_ids || resvRooms(id).map((x) => x.room_id);
    const checkIn = r.status === 'checked_in' ? r.check_in : b.check_in || r.check_in;
    const checkOut = b.check_out || r.check_out;
    const roomsChanged = b.room_ids && b.room_ids.join() !== resvRooms(id).map((x) => x.room_id).join();
    if (roomsChanged || checkIn !== r.check_in || checkOut !== r.check_out) {
      if (r.status === 'checked_in' && roomsChanged) {
        // Cambio de habitación en casa: la anterior queda para limpieza.
        for (const old of resvRooms(id)) if (!roomIds.includes(old.room_id)) {
          run(`UPDATE rooms SET housekeeping = 'dirty' WHERE id = ?`, old.room_id);
          insert('housekeeping_tasks', { room_id: old.room_id, kind: 'checkout', notes: `Cambio de habitación (${r.code})`, created_by: req.user.id });
        }
      }
      setReservationRooms(id, roomIds, checkIn, checkOut);
      if (r.status === 'checked_in') syncLodgingCharges(id, req.user);
    }
    audit(req.user, 'reservation.update', 'reservation', id, b);
  });
  res.json(loadReservation(id));
}));

router.post('/reservations/:id/cancel', requirePerm('reservations'), wrap((req, res) => {
  const id = Number(req.params.id);
  const r = get('SELECT status FROM reservations WHERE id = ?', id);
  if (!r || !['pending', 'confirmed'].includes(r.status)) fail(400, 'Solo se pueden cancelar reservas pendientes o confirmadas');
  if (!req.body.reason) fail(400, 'Indique el motivo de la cancelación');
  run(`UPDATE reservations SET status = 'cancelled', cancelled_at = datetime('now'), cancelled_by = ?, cancel_reason = ? WHERE id = ?`, req.user.id, req.body.reason, id);
  audit(req.user, 'reservation.cancel', 'reservation', id, { reason: req.body.reason });
  res.json(loadReservation(id));
}));

router.post('/reservations/:id/no-show', requirePerm('reservations'), wrap((req, res) => {
  const id = Number(req.params.id);
  const r = get('SELECT status, check_in FROM reservations WHERE id = ?', id);
  if (!r || !['pending', 'confirmed'].includes(r.status)) fail(400, 'Solo aplica a reservas no ingresadas');
  if (r.check_in > today()) fail(400, 'Aún no llega la fecha de llegada');
  run(`UPDATE reservations SET status = 'no_show', cancelled_at = datetime('now'), cancelled_by = ?, cancel_reason = ? WHERE id = ?`, req.user.id, req.body.reason || 'No show', id);
  if (req.body.penalty > 0) postCharge(id, { category: 'other', description: 'Penalidad por no presentarse', unit_price: Number(req.body.penalty), tax_rate: 0 }, req.user);
  audit(req.user, 'reservation.no_show', 'reservation', id, { penalty: req.body.penalty });
  res.json(loadReservation(id));
}));

// ---------- check-in ----------
router.post('/reservations/:id/checkin', requirePerm('checkin'), wrap((req, res) => {
  const id = Number(req.params.id);
  const b = req.body;
  tx(() => {
    const r = get('SELECT * FROM reservations WHERE id = ?', id);
    if (!r || !['pending', 'confirmed'].includes(r.status)) fail(400, 'La reserva no está lista para check-in');
    const t = today();
    if (r.check_in > t) {
      // Llegada anticipada: mueve la llegada a hoy si las habitaciones están libres.
      const rooms = resvRooms(id);
      if (!rooms.every((x) => isRoomAvailable(x.room_id, t, r.check_out, id))) fail(409, 'La reserva es para una fecha futura y la habitación no está libre hoy');
      setReservationRooms(id, rooms.map((x) => x.room_id), t, r.check_out);
    }
    if (r.check_out <= t) fail(400, 'La fecha de salida ya pasó; modifique la reserva');
    for (const rm of resvRooms(id)) {
      const room = get('SELECT number, housekeeping, out_of_service FROM rooms WHERE id = ?', rm.room_id);
      if (room.out_of_service) fail(409, `La habitación ${room.number} está en mantenimiento`);
      if (room.housekeeping !== 'clean' && !b.ignore_cleaning) fail(409, `La habitación ${room.number} no está limpia. Confirme para continuar.`);
      const other = get(`SELECT r.code FROM reservation_rooms rr JOIN reservations r ON r.id = rr.reservation_id WHERE rr.room_id = ? AND r.status = 'checked_in' AND r.id <> ?`, rm.room_id, id);
      if (other) fail(409, `La habitación ${room.number} sigue ocupada (${other.code})`);
    }
    // Titular
    if (b.guest) upsertGuest({ ...b.guest, id: r.guest_id }, req.user);
    // Acompañantes
    run('DELETE FROM reservation_guests WHERE reservation_id = ?', id);
    for (const c of b.companions || []) {
      const gid = upsertGuest(c, req.user);
      if (gid !== r.guest_id) run('INSERT OR IGNORE INTO reservation_guests (reservation_id, guest_id, relationship) VALUES (?, ?, ?)', id, gid, c.relationship || null);
    }
    // Vehículos
    run('DELETE FROM reservation_vehicles WHERE reservation_id = ?', id);
    for (const v of b.vehicles || []) {
      if (!v.plate) continue;
      if (v.parking_space_id) {
        const busy = get(`SELECT r.code FROM reservation_vehicles v JOIN reservations r ON r.id = v.reservation_id WHERE v.parking_space_id = ? AND r.status = 'checked_in'`, v.parking_space_id);
        if (busy) fail(409, `El parqueadero ya está asignado (${busy.code})`);
      }
      insert('reservation_vehicles', { reservation_id: id, plate: String(v.plate).toUpperCase().replace(/\s/g, ''), kind: v.kind || 'car', color: v.color, brand: v.brand, parking_space_id: v.parking_space_id || null });
    }
    // Exención de IVA
    const guest = get('SELECT nationality, resides_abroad FROM guests WHERE id = ?', r.guest_id);
    const exempt = b.tax_exempt ? 1 : 0;
    if (exempt && (!guest.resides_abroad || guest.nationality === 'CO')) fail(400, 'La exención de IVA solo aplica a extranjeros no residentes en Colombia');
    const companionsCount = (b.companions || []).length;
    run(
      `UPDATE reservations SET status = 'checked_in', checked_in_at = datetime('now'), checked_in_by = ?, tax_exempt = ?,
       travel_reason = ?, origin_city = ?, destination_city = ?, adults = MAX(adults, ?) WHERE id = ?`,
      req.user.id, exempt, b.travel_reason || null, b.origin_city || null, b.destination_city || null, 1 + companionsCount, id,
    );
    syncLodgingCharges(id, req.user);
    if (b.payment && Number(b.payment.amount) > 0) addPayment({ ...b.payment, reservation_id: id, kind: 'payment' }, req.user);
    audit(req.user, 'reservation.checkin', 'reservation', id, { companions: companionsCount, vehicles: (b.vehicles || []).length, tax_exempt: exempt });
  });
  res.json(loadReservation(id));
}));

router.post('/reservations/:id/tax-exempt', requirePerm('checkin'), wrap((req, res) => {
  const id = Number(req.params.id);
  const r = get('SELECT r.*, g.nationality, g.resides_abroad FROM reservations r JOIN guests g ON g.id = r.guest_id WHERE r.id = ?', id);
  if (r.status !== 'checked_in' && r.status !== 'confirmed') fail(400, 'No se puede modificar en este estado');
  const exempt = req.body.tax_exempt ? 1 : 0;
  if (exempt && (!r.resides_abroad || r.nationality === 'CO')) fail(400, 'La exención de IVA solo aplica a extranjeros no residentes en Colombia');
  tx(() => {
    run('UPDATE reservations SET tax_exempt = ? WHERE id = ?', exempt, id);
    if (r.status === 'checked_in') {
      for (const c of all(`SELECT id FROM charges WHERE reservation_id = ? AND category = 'lodging' AND voided = 0`, id)) voidCharge(c.id, 'Cambio de condición tributaria', req.user, true);
      syncLodgingCharges(id, req.user);
    }
    audit(req.user, 'reservation.tax_exempt', 'reservation', id, { tax_exempt: exempt });
  });
  res.json(loadReservation(id));
}));

// ---------- check-out ----------
router.post('/reservations/:id/checkout/preview', requirePerm('checkin'), wrap((req, res) => {
  // Calcula cómo quedaría la cuenta si sale hoy (sin guardar).
  const id = Number(req.params.id);
  const r = get('SELECT * FROM reservations WHERE id = ?', id);
  if (!r || r.status !== 'checked_in') fail(400, 'La reserva no está en casa');
  const t = today();
  const actualOut = t <= r.check_in ? addDays(r.check_in, 1) : t;
  // Re-cotiza con la salida real: al acortar la estadía puede perderse el descuento por estadía larga.
  const s = getSettings();
  const rate = r.tax_exempt && s.taxes.prices_include_tax ? s.taxes.lodging_rate : 0;
  let lodging = 0;
  for (const rm of resvRooms(id)) {
    for (const n of quoteRoom(rm.room_id, r.check_in, actualOut).nights) lodging += rate ? Math.round(n.price / (1 + rate / 100)) : n.price;
  }
  res.json({ planned_check_out: r.check_out, actual_check_out: actualOut, lodging });
}));

router.post('/reservations/:id/checkout', requirePerm('checkin'), wrap((req, res) => {
  const id = Number(req.params.id);
  const b = req.body;
  const out = tx(() => {
    const r = get('SELECT * FROM reservations WHERE id = ?', id);
    if (!r || r.status !== 'checked_in') fail(400, 'La reserva no está en casa');
    const t = today();
    const rooms = resvRooms(id);
    // Ajusta la fecha real de salida (salida anticipada o tardía).
    const actualOut = t <= r.check_in ? addDays(r.check_in, 1) : t;
    if (actualOut !== r.check_out && b.adjust_dates !== false) {
      setReservationRooms(id, rooms.map((x) => x.room_id), r.check_in, actualOut);
      syncLodgingCharges(id, req.user);
    }
    if (b.payment && Number(b.payment.amount) > 0) addPayment({ ...b.payment, reservation_id: id, kind: 'payment' }, req.user);
    const f = folio(id);
    if (f.summary.balance > 0) fail(400, `Hay un saldo pendiente de $${f.summary.balance.toLocaleString('es-CO')}`);
    run(`UPDATE reservations SET status = 'checked_out', checked_out_at = datetime('now'), checked_out_by = ?, estimated_total = ? WHERE id = ?`, req.user.id, f.summary.lodging, id);
    for (const rm of rooms) {
      run(`UPDATE rooms SET housekeeping = 'dirty' WHERE id = ?`, rm.room_id);
      insert('housekeeping_tasks', { room_id: rm.room_id, kind: 'checkout', notes: `Salida ${r.code}`, created_by: req.user.id });
    }
    let survey = get('SELECT * FROM surveys WHERE reservation_id = ?', id);
    if (!survey && getSettings().survey.enabled) {
      insert('surveys', { reservation_id: id, token: crypto.randomBytes(16).toString('hex') });
    }
    audit(req.user, 'reservation.checkout', 'reservation', id, { total: f.summary.total, paid: f.summary.paid });
    return id;
  });
  res.json(loadReservation(out));
}));

// ---------- cargos ----------
router.post('/reservations/:id/charges', requirePerm('checkin', 'sales'), wrap((req, res) => {
  const id = Number(req.params.id);
  const r = get('SELECT status FROM reservations WHERE id = ?', id);
  if (!r || !['checked_in', 'confirmed', 'pending'].includes(r.status)) fail(400, 'Solo se puede cargar a reservas activas');
  const b = req.body;
  let { description, unit_price, tax_rate } = b;
  let category = b.category || 'other';
  if (b.service_id) {
    const s = get('SELECT * FROM services WHERE id = ?', Number(b.service_id));
    if (!s) fail(404, 'Servicio no encontrado');
    description = description || s.name;
    unit_price = unit_price ?? s.price;
    tax_rate = s.tax_rate ?? undefined;
    category = 'service';
  }
  if (!description || !(Number(unit_price) >= 0)) fail(400, 'Descripción y valor son obligatorios');
  if (category === 'lodging') fail(400, 'Los cargos de alojamiento se generan automáticamente');
  const cid = postCharge(id, {
    category, description, quantity: Number(b.quantity) || 1, unit_price: Math.round(Number(unit_price)),
    tax_rate: tax_rate === '' ? undefined : tax_rate, ref_type: b.service_id ? 'service' : null, ref_id: b.service_id || null,
  }, req.user);
  res.json({ id: cid });
}));

router.post('/charges/:id/void', requirePerm('void'), wrap((req, res) => {
  const c = get('SELECT * FROM charges WHERE id = ?', Number(req.params.id));
  if (!c || c.voided) fail(400, 'Cargo no válido');
  if (!req.body.reason) fail(400, 'Indique el motivo de la anulación');
  tx(() => {
    voidCharge(c.id, req.body.reason, req.user);
    if (c.ref_type === 'sale_item') {
      const it = get('SELECT * FROM sale_items WHERE id = ?', c.ref_id);
      if (it) {
        run('UPDATE products SET stock = stock + ? WHERE id = ?', it.quantity, it.product_id);
        insert('stock_movements', { product_id: it.product_id, kind: 'sale_void', quantity: it.quantity, reason: 'Anulación de cargo', ref_type: 'charge', ref_id: c.id, created_by: req.user.id });
      }
    }
  });
  res.json({ ok: true });
}));

// ---------- pagos ----------
router.post('/reservations/:id/payments', requirePerm('payments'), wrap((req, res) => {
  const id = Number(req.params.id);
  const r = get('SELECT status FROM reservations WHERE id = ?', id);
  if (!r) fail(404, 'No encontrada');
  const kind = req.body.kind || (r.status === 'checked_in' ? 'payment' : 'advance');
  if (kind === 'refund' && !can(req.user, 'void')) fail(403, 'Solo un administrador puede registrar devoluciones');
  res.json({ id: addPayment({ ...req.body, kind, reservation_id: id }, req.user) });
}));

router.post('/payments/:id/void', requirePerm('void'), wrap((req, res) => {
  const p = get('SELECT * FROM payments WHERE id = ?', Number(req.params.id));
  if (!p || p.voided) fail(400, 'Pago no válido');
  if (!req.body.reason) fail(400, 'Indique el motivo de la anulación');
  run(`UPDATE payments SET voided = 1, voided_by = ?, voided_at = datetime('now'), void_reason = ? WHERE id = ?`, req.user.id, req.body.reason, p.id);
  audit(req.user, 'payment.void', 'payment', p.id, { reason: req.body.reason, amount: p.amount });
  res.json({ ok: true });
}));

// ---------- recibo PDF ----------
router.get('/reservations/:id/receipt.pdf', requirePerm('reservations'), wrap((req, res) => {
  const r = loadReservation(Number(req.params.id));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="recibo-${r.code}.pdf"`);
  receiptPdf(r, getSettings(), res);
}));
