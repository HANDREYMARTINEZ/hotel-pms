// Motor de disponibilidad, tarifas y cuenta (folio).
// Está aislado de las rutas para que el futuro módulo de reservas en línea
// use exactamente la misma lógica que recepción.
import { all, get, run, insert, parseJSON, tx } from '../db.js';
import { getSettings, eachNight, dow, today, fail, lineTax, nightsBetween, isDate, newCode, audit } from './core.js';

// Estados de reserva que ocupan inventario.
export const BLOCKING_STATUSES = ['pending', 'confirmed', 'checked_in'];

function blockingClause(alias = 'r') {
  // Las reservas "pending" con retención vencida (pagos web no completados) dejan de bloquear.
  return `(${alias}.status IN ('confirmed','checked_in') OR (${alias}.status = 'pending' AND (${alias}.hold_expires_at IS NULL OR ${alias}.hold_expires_at > datetime('now'))))`;
}

/** Conflictos de una habitación en [from, to). */
export function roomConflicts(roomId, from, to, excludeReservationId = 0) {
  const res = all(
    `SELECT r.id, r.code, r.status, rr.check_in, rr.check_out FROM reservation_rooms rr
     JOIN reservations r ON r.id = rr.reservation_id
     WHERE rr.room_id = ? AND rr.check_in < ? AND rr.check_out > ? AND r.id <> ? AND ${blockingClause()}`,
    roomId, to, from, excludeReservationId,
  );
  const blocks = all(
    `SELECT id, start_date, end_date, reason FROM room_blocks WHERE room_id = ? AND start_date < ? AND end_date > ?`,
    roomId, to, from,
  );
  return { reservations: res, blocks };
}

export function isRoomAvailable(roomId, from, to, excludeReservationId = 0) {
  const room = get('SELECT active, out_of_service FROM rooms WHERE id = ?', roomId);
  if (!room || !room.active) return false;
  if (room.out_of_service && from <= today()) return false;
  const c = roomConflicts(roomId, from, to, excludeReservationId);
  return c.reservations.length === 0 && c.blocks.length === 0;
}

/** Habitaciones disponibles con cotización. `onlineOnly` filtra las publicables en la web. */
export function availableRooms({ from, to, guests = 1, excludeReservationId = 0, onlineOnly = false }) {
  validateRange(from, to);
  const rooms = all(
    `SELECT r.*, t.name AS type_name, COALESCE(r.capacity, t.capacity) AS max_guests
     FROM rooms r JOIN room_types t ON t.id = r.room_type_id
     WHERE r.active = 1 ${onlineOnly ? 'AND r.online_bookable = 1' : ''} ORDER BY r.sort, r.number`,
  );
  return rooms
    .filter((r) => r.max_guests >= guests && isRoomAvailable(r.id, from, to, excludeReservationId))
    .map((r) => ({ id: r.id, number: r.number, type_name: r.type_name, max_guests: r.max_guests, quote: quoteRoom(r.id, from, to) }));
}

export function validateRange(from, to) {
  if (!isDate(from) || !isDate(to)) fail(400, 'Fechas inválidas');
  if (to <= from) fail(400, 'La fecha de salida debe ser posterior a la llegada');
  if (nightsBetween(from, to) > 365) fail(400, 'Estadía demasiado larga');
}

/** Cotiza una habitación noche a noche aplicando temporada, fin de semana y estadía larga. */
export function quoteRoom(roomId, from, to) {
  const room = get(
    `SELECT r.id, r.price_override, t.id AS type_id, t.base_price FROM rooms r JOIN room_types t ON t.id = r.room_type_id WHERE r.id = ?`,
    roomId,
  );
  if (!room) fail(404, 'Habitación no encontrada');
  const settings = getSettings();
  const seasons = all('SELECT * FROM seasons WHERE active = 1 AND start_date <= ? AND end_date >= ? ORDER BY start_date', to, from);
  const base = room.price_override ?? room.base_price;
  const wk = settings.weekend || {};

  const nights = eachNight(from, to).map((date) => {
    let price = base;
    const rules = [];
    const season = seasons.find((s) => s.start_date <= date && s.end_date >= date);
    if (season) {
      const prices = parseJSON(season.prices, {});
      if (season.mode === 'price' && prices[room.type_id] != null) price = Number(prices[room.type_id]);
      else if (season.mode === 'percent') price = price * (1 + season.percent / 100);
      rules.push(season.name);
    }
    if (wk.enabled && (wk.days || []).includes(dow(date))) {
      const wp = (wk.prices || {})[room.type_id];
      if (wk.mode === 'price' && wp != null && !season) price = Number(wp);
      else if (wk.mode !== 'price') price = price * (1 + (Number(wk.percent) || 0) / 100);
      rules.push('Fin de semana');
    }
    return { date, price: Math.round(price), rules };
  });

  const subtotal = nights.reduce((s, n) => s + n.price, 0);
  const rule = get('SELECT * FROM long_stay_rules WHERE active = 1 AND min_nights <= ? ORDER BY min_nights DESC LIMIT 1', nights.length);
  let discount = 0;
  if (rule) {
    discount = Math.round(subtotal * rule.discount_percent / 100);
    // Reparte el descuento en las noches para que cada noche quede con su precio final
    let left = discount;
    nights.forEach((n, i) => {
      const d = i === nights.length - 1 ? left : Math.round(n.price * rule.discount_percent / 100);
      n.price -= d; left -= d;
      n.rules.push(`Estadía larga -${rule.discount_percent}%`);
    });
  }
  return {
    nights, subtotal, discount,
    long_stay: rule ? { min_nights: rule.min_nights, percent: rule.discount_percent } : null,
    total: subtotal - discount,
  };
}

// ---------- reservas ----------
/** Crea o actualiza las habitaciones de una reserva validando disponibilidad. */
export function setReservationRooms(reservationId, roomIds, from, to) {
  validateRange(from, to);
  if (!roomIds.length) fail(400, 'Seleccione al menos una habitación');
  for (const rid of roomIds) {
    if (!isRoomAvailable(rid, from, to, reservationId)) {
      const n = get('SELECT number FROM rooms WHERE id = ?', rid)?.number;
      fail(409, `La habitación ${n ?? rid} no está disponible en esas fechas`);
    }
  }
  run('DELETE FROM reservation_rooms WHERE reservation_id = ?', reservationId);
  let total = 0;
  for (const rid of roomIds) {
    const q = quoteRoom(rid, from, to);
    total += q.total;
    insert('reservation_rooms', { reservation_id: reservationId, room_id: rid, check_in: from, check_out: to, nightly: q.nights, total: q.total });
  }
  run('UPDATE reservations SET check_in = ?, check_out = ?, estimated_total = ? WHERE id = ?', from, to, total, reservationId);
  return total;
}

export function createReservation(data, user) {
  return tx(() => {
    const id = insert('reservations', {
      code: newCode('R'),
      guest_id: data.guest_id,
      source: data.source || 'walk_in',
      source_detail: data.source_detail || null,
      external_ref: data.external_ref || null,
      status: data.status || 'confirmed',
      check_in: data.check_in,
      check_out: data.check_out,
      adults: data.adults || 1,
      children: data.children || 0,
      notes: data.notes || null,
      hold_expires_at: data.hold_expires_at || null,
      created_by: user?.id ?? null,
    });
    setReservationRooms(id, data.room_ids, data.check_in, data.check_out);
    audit(user, 'reservation.create', 'reservation', id, { source: data.source });
    return id;
  });
}

// ---------- cuenta / folio ----------
export function postCharge(reservationId, { category, description, quantity = 1, unit_price, tax_rate, service_date, ref_type, ref_id }, user, opts = {}) {
  const settings = getSettings();
  const resv = get('SELECT tax_exempt FROM reservations WHERE id = ?', reservationId);
  const defaultRate = { lodging: settings.taxes.lodging_rate, service: settings.taxes.services_rate, product: settings.taxes.products_rate, other: 0 }[category];
  let rate = tax_rate ?? defaultRate ?? 0;
  let amount = Math.round(unit_price * quantity);
  // Exención de IVA en alojamiento para residentes en el exterior.
  if (category === 'lodging' && resv?.tax_exempt) {
    if (settings.taxes.prices_include_tax && rate) amount = Math.round(amount / (1 + rate / 100));
    rate = 0;
  }
  const { total, tax } = lineTax(amount, rate, settings);
  const id = insert('charges', {
    reservation_id: reservationId, category, description, quantity, unit_price, total,
    tax_rate: rate, tax_amount: tax, service_date: service_date || today(), ref_type: ref_type || null, ref_id: ref_id || null,
    created_by: user?.id ?? null,
  });
  if (!opts.silent) audit(user, 'charge.create', 'charge', id, { reservation_id: reservationId, description, total });
  return id;
}

/** Sincroniza los cargos de alojamiento con las noches vigentes de la reserva. */
export function syncLodgingCharges(reservationId, user) {
  const rooms = all(
    `SELECT rr.*, r.number FROM reservation_rooms rr JOIN rooms r ON r.id = rr.room_id WHERE rr.reservation_id = ?`, reservationId,
  );
  const wanted = [];
  for (const rr of rooms) {
    for (const n of parseJSON(rr.nightly, [])) {
      wanted.push({ key: `${rr.room_id}|${n.date}`, room_id: rr.room_id, number: rr.number, date: n.date, price: n.price });
    }
  }
  const existing = all(`SELECT * FROM charges WHERE reservation_id = ? AND category = 'lodging' AND voided = 0`, reservationId);
  const byKey = new Map(existing.map((c) => [`${c.ref_id}|${c.service_date}`, c]));
  for (const w of wanted) {
    const c = byKey.get(w.key);
    if (c && c.unit_price === w.price) { byKey.delete(w.key); continue; }
    if (c) { voidCharge(c.id, 'Reajuste de tarifa', user, true); byKey.delete(w.key); }
    postCharge(reservationId, {
      category: 'lodging', description: `Alojamiento hab. ${w.number} · noche ${w.date}`, unit_price: w.price,
      service_date: w.date, ref_type: 'room', ref_id: w.room_id,
    }, user, { silent: true });
  }
  for (const c of byKey.values()) voidCharge(c.id, 'Noche no utilizada', user, true);
}

export function voidCharge(chargeId, reason, user, silent = false) {
  run(`UPDATE charges SET voided = 1, voided_by = ?, voided_at = datetime('now'), void_reason = ? WHERE id = ?`, user?.id ?? null, reason || null, chargeId);
  if (!silent) audit(user, 'charge.void', 'charge', chargeId, { reason });
}

export function folio(reservationId) {
  const charges = all(
    `SELECT c.*, u.name AS created_by_name, v.name AS voided_by_name FROM charges c
     LEFT JOIN users u ON u.id = c.created_by LEFT JOIN users v ON v.id = c.voided_by
     WHERE c.reservation_id = ? ORDER BY c.service_date, c.id`, reservationId,
  );
  const payments = all(
    `SELECT p.*, u.name AS created_by_name, v.name AS voided_by_name FROM payments p
     LEFT JOIN users u ON u.id = p.created_by LEFT JOIN users v ON v.id = p.voided_by
     WHERE p.reservation_id = ? ORDER BY p.id`, reservationId,
  );
  const active = charges.filter((c) => !c.voided);
  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  const byCat = (cat) => sum(active.filter((c) => c.category === cat), (c) => c.total);
  const totalCharges = sum(active, (c) => c.total);
  const tax = sum(active, (c) => c.tax_amount);
  const paid = sum(payments.filter((p) => !p.voided), (p) => (p.kind === 'refund' ? -p.amount : p.amount));
  return {
    charges, payments,
    summary: {
      lodging: byCat('lodging'), services: byCat('service'), products: byCat('product'), other: byCat('other'),
      tax, subtotal: totalCharges - tax, total: totalCharges, paid, balance: totalCharges - paid,
    },
  };
}

/** Saldo estimado antes del check-in (aún sin cargos de alojamiento). */
export function estimatedBalance(reservationId) {
  const r = get('SELECT estimated_total, status FROM reservations WHERE id = ?', reservationId);
  const f = folio(reservationId);
  const hasLodging = f.charges.some((c) => c.category === 'lodging' && !c.voided);
  const total = hasLodging ? f.summary.total : f.summary.total + (r?.estimated_total || 0);
  return { total, paid: f.summary.paid, balance: total - f.summary.paid };
}

export function addPayment(data, user) {
  const settings = getSettings();
  const amount = Math.round(Number(data.amount));
  if (!(amount > 0)) fail(400, 'Monto inválido');
  if (!settings.payment_methods.some((m) => m.code === data.method && m.active)) fail(400, 'Método de pago no válido');
  const id = insert('payments', {
    reservation_id: data.reservation_id ?? null, sale_id: data.sale_id ?? null, kind: data.kind || 'payment',
    method: data.method, amount, reference: data.reference || null, created_by: user.id,
  });
  audit(user, 'payment.create', 'payment', id, { reservation_id: data.reservation_id, sale_id: data.sale_id, amount, method: data.method, kind: data.kind });
  return id;
}
