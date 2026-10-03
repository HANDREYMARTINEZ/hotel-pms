// Reportes, exportaciones, cumplimiento legal (TRA / SIRE) y facturación electrónica.
import { Router } from 'express';
import ExcelJS from 'exceljs';
import { all, get, run, insert, parseJSON } from '../db.js';
import { wrap, fail, requirePerm, audit, today, addDays, eachNight, getSettings, isDate } from '../lib/core.js';
import { folio } from '../lib/booking.js';
import { reportPdf } from '../lib/pdf.js';
import { sendInvoice, linesFromFolio, listProviders } from '../lib/einvoice.js';

export const router = Router();

function range(q) {
  const to = isDate(q.to) ? q.to : today();
  const from = isDate(q.from) ? q.from : addDays(to, -29);
  if (to < from) fail(400, 'Rango inválido');
  return { from, to };
}
const SOURCE_NAMES = () => Object.fromEntries(getSettings().reservation_sources.map((s) => [s.code, s.name]));
const METHOD_NAMES = () => Object.fromEntries(getSettings().payment_methods.map((s) => [s.code, s.name]));
const CAT = { lodging: 'Alojamiento', service: 'Servicios', product: 'Productos', other: 'Otros' };

export function buildReport(from, to) {
  const roomCount = get('SELECT COUNT(*) AS n FROM rooms WHERE active = 1').n;
  const nights = eachNight(from, addDays(to, 1));
  // Ocupación: noches vendidas por día (reservas en casa o ya salidas).
  const sold = all(
    `SELECT rr.check_in, rr.check_out FROM reservation_rooms rr JOIN reservations r ON r.id = rr.reservation_id
     WHERE r.status IN ('checked_in','checked_out','confirmed','pending') AND rr.check_in <= ? AND rr.check_out > ?`, to, from,
  );
  const lodgingByDay = Object.fromEntries(all(
    `SELECT service_date AS d, SUM(total) AS t FROM charges WHERE voided = 0 AND category = 'lodging' AND service_date BETWEEN ? AND ? GROUP BY service_date`, from, to,
  ).map((r) => [r.d, r.t]));
  const occupancy = nights.map((d) => {
    const occ = sold.filter((s) => s.check_in <= d && s.check_out > d).length;
    return { date: d, rooms_sold: occ, rooms_total: roomCount, percent: roomCount ? Math.round((occ / roomCount) * 100) : 0, lodging: lodgingByDay[d] || 0 };
  });
  const totalSold = occupancy.reduce((a, o) => a + o.rooms_sold, 0);
  const lodgingRevenue = occupancy.reduce((a, o) => a + o.lodging, 0);

  const revenueByCategory = all(
    `SELECT category, SUM(total) AS total, SUM(tax_amount) AS tax FROM charges WHERE voided = 0 AND service_date BETWEEN ? AND ? GROUP BY category`, from, to,
  ).map((r) => ({ ...r, name: CAT[r.category] || r.category }));
  const directSales = get(
    `SELECT COALESCE(SUM(total),0) AS total, COALESCE(SUM(tax_amount),0) AS tax FROM sales WHERE voided = 0 AND reservation_id IS NULL AND date(created_at,'-5 hours') BETWEEN ? AND ?`, from, to,
  );
  if (directSales.total) revenueByCategory.push({ category: 'direct_sales', name: 'Ventas directas', total: directSales.total, tax: directSales.tax });

  const methods = METHOD_NAMES();
  const paymentsByMethod = all(
    `SELECT method, SUM(CASE WHEN kind='refund' THEN -amount ELSE amount END) AS total, COUNT(*) AS count FROM payments
     WHERE voided = 0 AND date(created_at,'-5 hours') BETWEEN ? AND ? GROUP BY method ORDER BY total DESC`, from, to,
  ).map((r) => ({ ...r, name: methods[r.method] || r.method }));

  const productSales = all(
    `SELECT si.description AS product, SUM(si.quantity) AS quantity, SUM(si.total) AS total,
       SUM(si.quantity * p.cost) AS cost
     FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
     WHERE s.voided = 0 AND date(s.created_at,'-5 hours') BETWEEN ? AND ? GROUP BY si.product_id ORDER BY total DESC`, from, to,
  ).map((r) => ({ ...r, margin: r.total - r.cost }));

  const sources = SOURCE_NAMES();
  const bySource = all(
    `SELECT source, COUNT(*) AS reservations, SUM(julianday(check_out) - julianday(check_in)) AS nights, SUM(estimated_total) AS amount
     FROM reservations WHERE status NOT IN ('cancelled') AND check_in BETWEEN ? AND ? GROUP BY source ORDER BY reservations DESC`, from, to,
  ).map((r) => ({ ...r, nights: Math.round(r.nights), name: sources[r.source] || r.source }));

  const statusCounts = all(`SELECT status, COUNT(*) AS n FROM reservations WHERE check_in BETWEEN ? AND ? GROUP BY status`, from, to);

  const avail = roomCount * nights.length;
  return {
    from, to,
    kpis: {
      occupancy: avail ? Math.round((totalSold / avail) * 100) : 0,
      rooms_sold: totalSold,
      adr: totalSold ? Math.round(lodgingRevenue / totalSold) : 0,
      revpar: avail ? Math.round(lodgingRevenue / avail) : 0,
      revenue: revenueByCategory.reduce((a, r) => a + r.total, 0),
      collected: paymentsByMethod.reduce((a, r) => a + r.total, 0),
      cancellations: statusCounts.find((s) => s.status === 'cancelled')?.n || 0,
      no_shows: statusCounts.find((s) => s.status === 'no_show')?.n || 0,
    },
    occupancy, revenueByCategory, paymentsByMethod, productSales, bySource,
  };
}

router.get('/reports/summary', requirePerm('reports'), wrap((req, res) => {
  const { from, to } = range(req.query);
  res.json(buildReport(from, to));
}));

const SECTIONS = (r) => [
  { title: 'Ocupación diaria', columns: [{ key: 'date', label: 'Fecha' }, { key: 'rooms_sold', label: 'Hab. vendidas' }, { key: 'percent', label: '% Ocupación' }, { key: 'lodging', label: 'Alojamiento', money: true }], rows: r.occupancy },
  { title: 'Ingresos por categoría', columns: [{ key: 'name', label: 'Categoría' }, { key: 'tax', label: 'Impuestos', money: true }, { key: 'total', label: 'Total', money: true }], rows: r.revenueByCategory },
  { title: 'Recaudo por método de pago', columns: [{ key: 'name', label: 'Método' }, { key: 'count', label: 'Transacciones' }, { key: 'total', label: 'Total', money: true }], rows: r.paymentsByMethod },
  { title: 'Ventas por producto', columns: [{ key: 'product', label: 'Producto' }, { key: 'quantity', label: 'Cantidad' }, { key: 'total', label: 'Ventas', money: true }, { key: 'margin', label: 'Margen', money: true }], rows: r.productSales },
  { title: 'Reservas por origen', columns: [{ key: 'name', label: 'Origen' }, { key: 'reservations', label: 'Reservas' }, { key: 'nights', label: 'Noches' }, { key: 'amount', label: 'Valor', money: true }], rows: r.bySource },
];

router.get('/reports/export', requirePerm('reports'), wrap(async (req, res) => {
  const { from, to } = range(req.query);
  const r = buildReport(from, to);
  const sections = SECTIONS(r);
  const k = r.kpis;
  const kpiRows = [
    { k: 'Ocupación promedio', v: k.occupancy + '%' }, { k: 'Habitaciones-noche vendidas', v: k.rooms_sold },
    { k: 'Tarifa promedio (ADR)', v: k.adr, money: true }, { k: 'RevPAR', v: k.revpar, money: true },
    { k: 'Ingresos causados', v: k.revenue, money: true }, { k: 'Recaudo', v: k.collected, money: true },
    { k: 'Cancelaciones', v: k.cancellations }, { k: 'No show', v: k.no_shows },
  ];
  audit(req.user, 'report.export', 'report', null, { from, to, format: req.query.format });
  if (req.query.format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="reporte-${from}-${to}.pdf"`);
    const s = getSettings();
    return reportPdf('REPORTE DE GESTIÓN', `${from} a ${to}`, [
      { title: 'Indicadores', columns: [{ key: 'k', label: 'Indicador' }, { key: 'vf', label: 'Valor' }], rows: kpiRows.map((x) => ({ k: x.k, vf: x.money ? '$' + Number(x.v).toLocaleString('es-CO') : x.v })) },
      ...sections,
    ], s, res);
  }
  const wb = new ExcelJS.Workbook();
  const ws0 = wb.addWorksheet('Indicadores');
  ws0.columns = [{ header: 'Indicador', key: 'k', width: 32 }, { header: 'Valor', key: 'v', width: 18 }];
  kpiRows.forEach((x) => { const row = ws0.addRow(x); if (x.money) row.getCell(2).numFmt = '"$"#,##0'; });
  ws0.getRow(1).font = { bold: true };
  for (const sec of sections) {
    const ws = wb.addWorksheet(sec.title.slice(0, 31));
    ws.columns = sec.columns.map((c) => ({ header: c.label, key: c.key, width: c.key === 'product' || c.key === 'name' ? 28 : 16, style: c.money ? { numFmt: '"$"#,##0' } : {} }));
    sec.rows.forEach((row) => ws.addRow(row));
    ws.getRow(1).font = { bold: true };
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="reporte-${from}-${to}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

// ==================== CUMPLIMIENTO ====================
// TRA (Tarjeta de Registro Hotelero / MinCIT) y SIRE (Migración Colombia).

const fullName = (g) => [g.first_name, g.last_name, g.second_last_name].filter(Boolean).join(' ');

function traRows(from, to) {
  const s = getSettings();
  const rs = all(
    `SELECT r.*, (SELECT GROUP_CONCAT(rm.number, ', ') FROM reservation_rooms rr JOIN rooms rm ON rm.id = rr.room_id WHERE rr.reservation_id = r.id) AS rooms
     FROM reservations r WHERE r.status IN ('checked_in','checked_out') AND date(r.checked_in_at, '-5 hours') BETWEEN ? AND ? ORDER BY r.checked_in_at`, from, to,
  );
  return rs.map((r) => {
    const g = get('SELECT * FROM guests WHERE id = ?', r.guest_id);
    const companions = all('SELECT g.*, rg.relationship FROM reservation_guests rg JOIN guests g ON g.id = rg.guest_id WHERE rg.reservation_id = ?', r.id);
    const f = folio(r.id);
    const missing = [];
    if (!g.birth_date) missing.push('fecha de nacimiento');
    if (!g.residence_city) missing.push('ciudad de residencia');
    if (!r.origin_city) missing.push('procedencia');
    if (!r.destination_city) missing.push('destino');
    if (!r.travel_reason) missing.push('motivo de viaje');
    if (!s.hotel.rnt) missing.push('RNT del hotel');
    return {
      id: r.id, code: r.code, rnt: s.hotel.rnt, rooms: r.rooms,
      doc_type: g.doc_type, doc_number: g.doc_number, name: fullName(g), first_name: g.first_name,
      last_name: [g.last_name, g.second_last_name].filter(Boolean).join(' '), nationality: g.nationality, birth_date: g.birth_date,
      gender: g.gender, phone: g.phone, email: g.email, residence_country: g.residence_country, residence_city: g.residence_city,
      origin_city: r.origin_city, destination_city: r.destination_city, travel_reason: r.travel_reason,
      check_in: r.check_in, check_out: r.check_out, companions: companions.length,
      companions_list: companions.map((c) => `${fullName(c)} (${c.doc_type} ${c.doc_number})`).join('; '),
      lodging_total: f.summary.lodging, status: r.status, reported_at: r.tra_reported_at, missing,
    };
  });
}

router.get('/compliance/tra', requirePerm('compliance'), wrap((req, res) => {
  const { from, to } = range(req.query);
  res.json(traRows(from, to));
}));

router.get('/compliance/tra.xlsx', requirePerm('compliance'), wrap(async (req, res) => {
  const { from, to } = range(req.query);
  const rows = traRows(from, to);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('TRA');
  ws.columns = [
    ['RNT', 'rnt'], ['Reserva', 'code'], ['Habitación', 'rooms'], ['Tipo doc.', 'doc_type'], ['Número doc.', 'doc_number'],
    ['Nombres', 'first_name'], ['Apellidos', 'last_name'], ['Nacionalidad', 'nationality'], ['Fecha nacimiento', 'birth_date'], ['Género', 'gender'],
    ['País residencia', 'residence_country'], ['Ciudad residencia', 'residence_city'], ['Procedencia', 'origin_city'], ['Destino', 'destination_city'],
    ['Motivo de viaje', 'travel_reason'], ['Check-in', 'check_in'], ['Check-out', 'check_out'], ['N° acompañantes', 'companions'],
    ['Acompañantes', 'companions_list'], ['Valor alojamiento', 'lodging_total'], ['Teléfono', 'phone'], ['Correo', 'email'],
  ].map(([header, key]) => ({ header, key, width: Math.max(12, header.length + 2) }));
  rows.forEach((r) => ws.addRow(r));
  ws.getRow(1).font = { bold: true };
  audit(req.user, 'compliance.tra_export', 'report', null, { from, to, count: rows.length });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="TRA-${from}-${to}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

router.post('/compliance/tra/mark', requirePerm('compliance'), wrap((req, res) => {
  const ids = (req.body.ids || []).map(Number);
  for (const id of ids) run(`UPDATE reservations SET tra_reported_at = datetime('now') WHERE id = ?`, id);
  audit(req.user, 'compliance.tra_mark', 'reservation', null, { ids });
  res.json({ ok: true });
}));

// ---------- SIRE: movimientos (entrada / salida) de extranjeros, incluidos acompañantes ----------
function sireRows(from, to) {
  const s = getSettings();
  const docMap = s.compliance.sire_doc_codes || {};
  const countryMap = s.compliance.sire_country_codes || {};
  const rs = all(
    `SELECT * FROM reservations WHERE status IN ('checked_in','checked_out') AND (
       date(checked_in_at,'-5 hours') BETWEEN ? AND ? OR date(checked_out_at,'-5 hours') BETWEEN ? AND ?)`, from, to, from, to,
  );
  const out = [];
  for (const r of rs) {
    const people = [get('SELECT * FROM guests WHERE id = ?', r.guest_id),
      ...all('SELECT g.* FROM reservation_guests rg JOIN guests g ON g.id = rg.guest_id WHERE rg.reservation_id = ?', r.id)];
    const moves = [];
    const inDate = r.checked_in_at && new Date(r.checked_in_at + 'Z').toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    const outDate = r.checked_out_at && new Date(r.checked_out_at + 'Z').toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    if (inDate && inDate >= from && inDate <= to) moves.push({ type: 'E', date: inDate, reported: r.sire_in_reported_at });
    if (outDate && outDate >= from && outDate <= to) moves.push({ type: 'S', date: outDate, reported: r.sire_out_reported_at });
    for (const g of people.filter((p) => p && p.nationality !== 'CO')) {
      for (const m of moves) {
        const missing = [];
        if (!g.birth_date) missing.push('fecha de nacimiento');
        if (!docMap[g.doc_type]) missing.push(`código SIRE para documento ${g.doc_type}`);
        if (!countryMap[g.nationality]) missing.push(`código SIRE para país ${g.nationality}`);
        if (!s.compliance.sire_establishment_code) missing.push('código de establecimiento SIRE');
        out.push({
          reservation_id: r.id, code: r.code, guest_id: g.id, type: m.type, date: m.date, reported_at: m.reported,
          doc_type: g.doc_type, doc_number: g.doc_number, nationality: g.nationality,
          first_name: g.first_name, last_name: g.last_name, second_last_name: g.second_last_name || '', birth_date: g.birth_date,
          origin: r.origin_city || '', destination: r.destination_city || '', missing,
          sire: {
            doc: docMap[g.doc_type] || '', country: countryMap[g.nationality] || '',
          },
        });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

router.get('/compliance/sire', requirePerm('compliance'), wrap((req, res) => {
  const { from, to } = range(req.query);
  res.json(sireRows(from, to));
}));

// Archivo plano para cargue masivo en SIRE. Verifique el orden de campos con la
// guía vigente de Migración Colombia; el orden está centralizado en SIRE_FIELDS.
const dmy = (d) => (d ? d.split('-').reverse().join('/') : '');
const SIRE_FIELDS = [
  (r, s) => s.compliance.sire_establishment_code,
  (r, s) => s.compliance.sire_city_code || s.hotel.city_code,
  (r) => r.sire.doc,
  (r) => r.doc_number,
  (r) => r.sire.country,
  (r) => r.last_name,
  (r) => r.second_last_name,
  (r) => r.first_name,
  (r) => r.type,
  (r) => dmy(r.date),
  (r) => r.origin,
  (r) => r.destination,
  (r) => dmy(r.birth_date),
];
router.get('/compliance/sire.txt', requirePerm('compliance'), wrap((req, res) => {
  const { from, to } = range(req.query);
  const s = getSettings();
  const only = req.query.pending === '1';
  const rows = sireRows(from, to).filter((r) => !only || !r.reported_at);
  const txt = rows.map((r) => SIRE_FIELDS.map((f) => String(f(r, s) ?? '').replace(/[\t\r\n]/g, ' ').toUpperCase()).join('\t')).join('\r\n');
  audit(req.user, 'compliance.sire_export', 'report', null, { from, to, count: rows.length });
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="SIRE-${from}-${to}.txt"`);
  res.send(txt);
}));

router.post('/compliance/sire/mark', requirePerm('compliance'), wrap((req, res) => {
  for (const it of req.body.items || []) {
    const col = it.type === 'S' ? 'sire_out_reported_at' : 'sire_in_reported_at';
    run(`UPDATE reservations SET ${col} = datetime('now') WHERE id = ?`, Number(it.reservation_id));
  }
  audit(req.user, 'compliance.sire_mark', 'reservation', null, { items: req.body.items });
  res.json({ ok: true });
}));

// ==================== FACTURACIÓN ELECTRÓNICA ====================
router.get('/einvoice/providers', requirePerm('settings'), wrap((req, res) => res.json(listProviders())));

router.get('/invoices', requirePerm('payments'), wrap((req, res) => {
  res.json(all(
    `SELECT i.*, r.code AS reservation_code, u.name AS created_by_name FROM invoices i LEFT JOIN reservations r ON r.id = i.reservation_id
     LEFT JOIN users u ON u.id = i.created_by ORDER BY i.id DESC LIMIT 200`,
  ).map((i) => ({ ...i, customer: parseJSON(i.customer, {}), lines: parseJSON(i.lines, []) })));
}));

router.post('/invoices', requirePerm('payments'), wrap(async (req, res) => {
  const { reservation_id, customer } = req.body;
  const r = get('SELECT * FROM reservations WHERE id = ?', Number(reservation_id));
  if (!r) fail(404, 'Reserva no encontrada');
  if (get(`SELECT 1 FROM invoices WHERE reservation_id = ? AND status IN ('sent','accepted')`, r.id)) fail(409, 'Esta reserva ya tiene factura emitida');
  const g = get('SELECT * FROM guests WHERE id = ?', r.guest_id);
  const f = folio(r.id);
  const lines = linesFromFolio(f, !!r.tax_exempt);
  if (!lines.length) fail(400, 'La cuenta no tiene cargos');
  const cust = customer?.doc_number ? customer : {
    name: fullName(g), doc_type: g.doc_type, doc_number: g.doc_number, email: g.email, phone: g.phone, address: g.address, country: g.residence_country,
  };
  const id = insert('invoices', {
    reservation_id: r.id, customer: cust, lines, subtotal: f.summary.subtotal, tax_amount: f.summary.tax, total: f.summary.total,
    status: 'queued', provider: getSettings().einvoice.provider, created_by: req.user.id,
  });
  const result = await trySend(id);
  audit(req.user, 'invoice.create', 'invoice', id, { reservation_id: r.id, total: f.summary.total, status: result.status });
  res.json({ id, ...result });
}));

router.post('/invoices/:id/send', requirePerm('payments'), wrap(async (req, res) => {
  const result = await trySend(Number(req.params.id));
  audit(req.user, 'invoice.send', 'invoice', Number(req.params.id), { status: result.status });
  res.json(result);
}));

async function trySend(id) {
  const inv = get('SELECT * FROM invoices WHERE id = ?', id);
  const payload = { ...inv, customer: parseJSON(inv.customer, {}), lines: parseJSON(inv.lines, []) };
  let result;
  try { result = await sendInvoice(payload, getSettings()); } catch (e) { result = { status: 'error', response: { message: e.message } }; }
  run(
    `UPDATE invoices SET status = ?, provider_ref = COALESCE(?, provider_ref), cufe = COALESCE(?, cufe), number = COALESCE(?, number), response = ? WHERE id = ?`,
    result.status, result.provider_ref || null, result.cufe || null, result.number || null, JSON.stringify(result.response || {}), id,
  );
  return result;
}
