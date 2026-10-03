// Dashboard, limpieza y postventa (encuestas, comentarios y reclamos).
import { Router } from 'express';
import { all, get, run, insert, parseJSON } from '../db.js';
import { wrap, fail, requirePerm, audit, today, getSettings, can, verifyPassword, DEMO } from '../lib/core.js';
import { roomBoard } from './rooms.js';

export const router = Router();
export const publicRouter = Router();

// ---------- dashboard ----------
router.get('/dashboard', requirePerm('dashboard', 'housekeeping'), wrap((req, res) => {
  const t = today();
  const board = roomBoard();
  const count = (s) => board.filter((r) => r.status === s).length;
  const sellable = board.filter((r) => r.status !== 'maintenance').length;
  const occupied = count('occupied');
  const guestCols = `r.id, r.code, r.status, r.check_in, r.check_out, r.adults, r.children, r.source,
    g.first_name || ' ' || g.last_name AS guest, g.phone,
    (SELECT GROUP_CONCAT(rm.number, ', ') FROM reservation_rooms rr JOIN rooms rm ON rm.id = rr.room_id WHERE rr.reservation_id = r.id) AS rooms`;
  const arrivals = all(`SELECT ${guestCols} FROM reservations r JOIN guests g ON g.id = r.guest_id WHERE r.check_in = ? AND r.status IN ('pending','confirmed','checked_in') ORDER BY r.status DESC`, t);
  const departures = all(`SELECT ${guestCols} FROM reservations r JOIN guests g ON g.id = r.guest_id WHERE r.check_out <= ? AND r.status = 'checked_in' OR (r.check_out = ? AND r.status = 'checked_out') ORDER BY r.status`, t, t);
  const income = get(
    `SELECT COALESCE(SUM(CASE WHEN kind = 'refund' THEN -amount ELSE amount END), 0) AS total FROM payments WHERE voided = 0 AND date(created_at, '-5 hours') = ?`, t,
  ).total;
  const incomeByMethod = all(
    `SELECT method, SUM(CASE WHEN kind = 'refund' THEN -amount ELSE amount END) AS total FROM payments WHERE voided = 0 AND date(created_at, '-5 hours') = ? GROUP BY method`, t,
  );

  const alerts = [];
  const defaults = [['admin', 'admin123'], ['recepcion', 'recepcion123'], ['limpieza', 'limpieza123']]
    .filter(([u, p]) => { const row = get('SELECT password_hash FROM users WHERE username = ? AND active = 1', u); return row && verifyPassword(p, row.password_hash); });
  if (defaults.length && !DEMO && can(req.user, 'users')) alerts.push({ level: 'warn', text: `Cambie las contraseñas iniciales (${defaults.map((d) => d[0]).join(', ')})`, link: '/configuracion' });
  const overdue = all(`SELECT r.id, r.code FROM reservations r WHERE r.status = 'checked_in' AND r.check_out < ?`, t);
  if (overdue.length) alerts.push({ level: 'warn', text: `${overdue.length} huésped(es) con salida vencida`, link: '/reservas?estado=checked_in' });
  const noShows = all(`SELECT id FROM reservations WHERE status IN ('pending','confirmed') AND check_in < ?`, t);
  if (noShows.length) alerts.push({ level: 'warn', text: `${noShows.length} reserva(s) sin llegada (posible no show)`, link: '/reservas?vencidas=1' });
  const lowStock = all('SELECT name, stock FROM products WHERE active = 1 AND stock <= min_stock');
  if (lowStock.length) alerts.push({ level: 'info', text: `Stock bajo: ${lowStock.map((p) => p.name).slice(0, 4).join(', ')}${lowStock.length > 4 ? '…' : ''}`, link: '/inventario' });
  const openComplaints = get(`SELECT COUNT(*) AS n FROM feedback WHERE kind = 'complaint' AND status IN ('open','in_progress')`).n;
  if (openComplaints) alerts.push({ level: 'warn', text: `${openComplaints} reclamo(s) abiertos`, link: '/postventa' });
  const sireTarget = all(
    `SELECT r.id FROM reservations r JOIN guests g ON g.id = r.guest_id WHERE g.nationality <> 'CO' AND
     ((r.status IN ('checked_in','checked_out') AND r.sire_in_reported_at IS NULL) OR (r.status = 'checked_out' AND r.sire_out_reported_at IS NULL))`,
  );
  if (sireTarget.length) alerts.push({ level: 'info', text: `${sireTarget.length} movimiento(s) de extranjeros sin reportar a SIRE`, link: '/cumplimiento' });
  const unbalanced = all(
    `SELECT r.id FROM reservations r WHERE r.status = 'checked_in' AND r.check_out <= ? AND
     (SELECT COALESCE(SUM(total),0) FROM charges WHERE reservation_id = r.id AND voided = 0) >
     (SELECT COALESCE(SUM(CASE WHEN kind='refund' THEN -amount ELSE amount END),0) FROM payments WHERE reservation_id = r.id AND voided = 0)`, t,
  );
  if (unbalanced.length) alerts.push({ level: 'info', text: `${unbalanced.length} salida(s) de hoy con saldo pendiente`, link: '/reservas?estado=checked_in' });

  res.json({
    today: t,
    rooms: { total: board.length, available: count('available'), occupied, reserved: count('reserved'), cleaning: count('cleaning'), maintenance: count('maintenance') },
    occupancy: sellable ? Math.round((occupied / sellable) * 100) : 0,
    guests_in_house: get(`SELECT COALESCE(SUM(adults + children),0) AS n FROM reservations WHERE status = 'checked_in'`).n,
    arrivals, departures,
    to_clean: board.filter((r) => r.housekeeping !== 'clean' && !r.out_of_service).map((r) => ({ id: r.id, number: r.number, housekeeping: r.housekeeping, occupied: !!r.stay })),
    income, income_by_method: incomeByMethod,
    alerts,
    board: board.map((r) => ({ id: r.id, number: r.number, status: r.status, type_name: r.type_name, guest: r.stay?.guest || r.arrival?.guest || null })),
  });
}));

// ---------- limpieza ----------
router.get('/housekeeping', requirePerm('housekeeping'), wrap((req, res) => {
  const board = roomBoard().map((r) => ({
    id: r.id, number: r.number, type_name: r.type_name, floor: r.floor, status: r.status, housekeeping: r.housekeeping,
    out_of_service: r.out_of_service, out_of_service_reason: r.out_of_service_reason, occupied: !!r.stay,
    departs_today: r.departs_today, arrival_today: !!r.arrival, guest: r.stay?.guest || null,
  }));
  const tasks = all(
    `SELECT t.*, r.number, u.name AS assigned_name, c.name AS completed_by_name FROM housekeeping_tasks t
     JOIN rooms r ON r.id = t.room_id LEFT JOIN users u ON u.id = t.assigned_to LEFT JOIN users c ON c.id = t.completed_by
     WHERE t.status <> 'done' OR date(t.completed_at, '-5 hours') = ? ORDER BY t.status = 'done', t.id`, today(),
  );
  res.json({ rooms: board, tasks });
}));
router.post('/housekeeping/tasks', requirePerm('housekeeping'), wrap((req, res) => {
  const { room_id, kind, notes, assigned_to } = req.body;
  if (!room_id) fail(400, 'Habitación requerida');
  const id = insert('housekeeping_tasks', { room_id, kind: kind || 'daily', notes, assigned_to: assigned_to || null, created_by: req.user.id });
  if ((kind || 'daily') !== 'maintenance') run(`UPDATE rooms SET housekeeping = 'dirty' WHERE id = ? AND housekeeping = 'clean'`, room_id);
  res.json({ id });
}));
router.post('/housekeeping/tasks/:id', requirePerm('housekeeping'), wrap((req, res) => {
  const t = get('SELECT * FROM housekeeping_tasks WHERE id = ?', Number(req.params.id));
  if (!t) fail(404, 'Tarea no encontrada');
  const { status, notes, assigned_to } = req.body;
  if (status && !['pending', 'in_progress', 'done'].includes(status)) fail(400, 'Estado inválido');
  run(
    `UPDATE housekeeping_tasks SET status = COALESCE(?, status), notes = COALESCE(?, notes), assigned_to = COALESCE(?, assigned_to),
     completed_at = CASE WHEN ? = 'done' THEN datetime('now') ELSE completed_at END, completed_by = CASE WHEN ? = 'done' THEN ? ELSE completed_by END WHERE id = ?`,
    status || null, notes ?? null, assigned_to || null, status || '', status || '', req.user.id, t.id,
  );
  if (t.kind !== 'maintenance' && status) {
    const pending = get(`SELECT COUNT(*) AS n FROM housekeeping_tasks WHERE room_id = ? AND status <> 'done' AND kind <> 'maintenance'`, t.room_id).n;
    run('UPDATE rooms SET housekeeping = ? WHERE id = ?', pending ? (status === 'in_progress' ? 'in_progress' : 'dirty') : 'clean', t.room_id);
  }
  audit(req.user, 'housekeeping.task', 'housekeeping_task', t.id, { status });
  res.json({ ok: true });
}));

// ---------- encuestas ----------
router.get('/surveys', requirePerm('feedback'), wrap((req, res) => {
  const rows = all(
    `SELECT s.*, r.code, r.check_out, g.first_name || ' ' || g.last_name AS guest, g.phone, g.email, g.id AS guest_id
     FROM surveys s JOIN reservations r ON r.id = s.reservation_id JOIN guests g ON g.id = r.guest_id ORDER BY s.id DESC LIMIT 200`,
  ).map((s) => ({ ...s, ratings: parseJSON(s.ratings, {}) }));
  const done = rows.filter((s) => s.completed_at);
  const avg = done.length ? Math.round((done.reduce((a, s) => a + s.overall, 0) / done.length) * 10) / 10 : null;
  res.json({ surveys: rows, stats: { sent: rows.filter((s) => s.sent_at).length, completed: done.length, average: avg } });
}));
router.post('/surveys/:id/sent', requirePerm('feedback'), wrap((req, res) => {
  run(`UPDATE surveys SET sent_at = datetime('now'), sent_channel = ? WHERE id = ?`, req.body.channel || 'whatsapp', Number(req.params.id));
  audit(req.user, 'survey.sent', 'survey', Number(req.params.id), { channel: req.body.channel });
  res.json({ ok: true });
}));

publicRouter.get('/public/survey/:token', wrap((req, res) => {
  const s = get(
    `SELECT s.token, s.completed_at, g.first_name, r.check_in, r.check_out FROM surveys s JOIN reservations r ON r.id = s.reservation_id
     JOIN guests g ON g.id = r.guest_id WHERE s.token = ?`, String(req.params.token),
  );
  if (!s) fail(404, 'Encuesta no encontrada');
  const st = getSettings();
  res.json({ ...s, hotel: st.hotel.name, logo: st.hotel.logo });
}));
publicRouter.post('/public/survey/:token', wrap((req, res) => {
  const s = get('SELECT * FROM surveys WHERE token = ?', String(req.params.token));
  if (!s) fail(404, 'Encuesta no encontrada');
  if (s.completed_at) fail(400, 'Esta encuesta ya fue respondida. ¡Gracias!');
  const overall = Math.min(5, Math.max(1, Number(req.body.overall) || 0));
  if (!overall) fail(400, 'Seleccione una calificación');
  const ratings = {};
  for (const k of ['cleanliness', 'service', 'comfort', 'value', 'location']) {
    const v = Number(req.body.ratings?.[k]);
    if (v >= 1 && v <= 5) ratings[k] = v;
  }
  const comment = String(req.body.comment || '').slice(0, 2000);
  run(
    `UPDATE surveys SET completed_at = datetime('now'), overall = ?, ratings = ?, would_return = ?, comment = ? WHERE id = ?`,
    overall, JSON.stringify(ratings), req.body.would_return ? 1 : 0, comment || null, s.id,
  );
  // Calificaciones bajas generan un reclamo para seguimiento.
  if (overall <= 2) {
    const r = get('SELECT guest_id FROM reservations WHERE id = ?', s.reservation_id);
    insert('feedback', { reservation_id: s.reservation_id, guest_id: r.guest_id, kind: 'complaint', subject: `Encuesta con calificación ${overall}/5`, description: comment || null });
  }
  res.json({ ok: true });
}));

// ---------- comentarios y reclamos ----------
router.get('/feedback', requirePerm('feedback'), wrap((req, res) => {
  const items = all(
    `SELECT f.*, g.first_name || ' ' || g.last_name AS guest, r.code, u.name AS created_by_name
     FROM feedback f LEFT JOIN guests g ON g.id = f.guest_id LEFT JOIN reservations r ON r.id = f.reservation_id
     LEFT JOIN users u ON u.id = f.created_by ORDER BY f.status IN ('resolved','closed'), f.id DESC LIMIT 300`,
  );
  const updates = all('SELECT fu.*, u.name AS user_name FROM feedback_updates fu LEFT JOIN users u ON u.id = fu.created_by ORDER BY fu.id');
  res.json(items.map((f) => ({ ...f, updates: updates.filter((u) => u.feedback_id === f.id) })));
}));
router.post('/feedback', requirePerm('feedback'), wrap((req, res) => {
  const { reservation_id, guest_id, kind, subject, description } = req.body;
  if (!subject) fail(400, 'Asunto requerido');
  let gid = guest_id || null;
  if (reservation_id && !gid) gid = get('SELECT guest_id FROM reservations WHERE id = ?', reservation_id)?.guest_id ?? null;
  const id = insert('feedback', { reservation_id: reservation_id || null, guest_id: gid, kind: kind || 'complaint', subject, description, created_by: req.user.id });
  audit(req.user, 'feedback.create', 'feedback', id, { kind });
  res.json({ id });
}));
router.post('/feedback/:id/updates', requirePerm('feedback'), wrap((req, res) => {
  const id = Number(req.params.id);
  const { note, status } = req.body;
  if (!note) fail(400, 'Escriba una nota de seguimiento');
  if (status && !['open', 'in_progress', 'resolved', 'closed'].includes(status)) fail(400, 'Estado inválido');
  insert('feedback_updates', { feedback_id: id, note, status: status || null, created_by: req.user.id });
  if (status) run(`UPDATE feedback SET status = ?, resolved_at = CASE WHEN ? IN ('resolved','closed') THEN datetime('now') ELSE NULL END WHERE id = ?`, status, status, id);
  audit(req.user, 'feedback.update', 'feedback', id, { status });
  res.json({ ok: true });
}));
