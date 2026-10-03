// Servicios adicionales, productos, inventario y ventas.
import { Router } from 'express';
import { all, get, run, insert, update, tx } from '../db.js';
import { wrap, fail, requirePerm, audit, getSettings, lineTax } from '../lib/core.js';
import { postCharge, addPayment, voidCharge } from '../lib/booking.js';

export const router = Router();

// ---------- servicios ----------
router.get('/services', requirePerm('services.view', 'services'), wrap((req, res) => res.json(all('SELECT * FROM services ORDER BY active DESC, name'))));
router.post('/services', requirePerm('services'), wrap((req, res) => {
  const { name, price, tax_rate } = req.body;
  if (!name) fail(400, 'Nombre requerido');
  const id = insert('services', { name, price: Math.round(price || 0), tax_rate: tax_rate === '' ? null : tax_rate });
  audit(req.user, 'service.create', 'service', id, { name, price });
  res.json({ id });
}));
router.put('/services/:id', requirePerm('services'), wrap((req, res) => {
  const b = { ...req.body };
  if (b.tax_rate === '') b.tax_rate = null;
  update('services', Number(req.params.id), b, ['name', 'price', 'tax_rate', 'active']);
  audit(req.user, 'service.update', 'service', Number(req.params.id), b);
  res.json({ ok: true });
}));

// ---------- productos ----------
router.get('/products', requirePerm('inventory.view', 'inventory'), wrap((req, res) => {
  res.json(all('SELECT *, stock <= min_stock AS low FROM products ORDER BY active DESC, category, name'));
}));
const PRODUCT_FIELDS = ['name', 'sku', 'category', 'price', 'cost', 'min_stock', 'tax_rate', 'active'];
router.post('/products', requirePerm('inventory'), wrap((req, res) => {
  const b = req.body;
  if (!b.name) fail(400, 'Nombre requerido');
  const id = tx(() => {
    const pid = insert('products', {
      name: b.name, sku: b.sku || null, category: b.category || null, price: Math.round(b.price || 0), cost: Math.round(b.cost || 0),
      min_stock: b.min_stock || 0, tax_rate: b.tax_rate === '' || b.tax_rate == null ? null : b.tax_rate, stock: 0,
    });
    if (Number(b.stock) > 0) moveStock(pid, 'in', Number(b.stock), 'Inventario inicial', req.user);
    return pid;
  });
  audit(req.user, 'product.create', 'product', id, { name: b.name });
  res.json({ id });
}));
router.put('/products/:id', requirePerm('inventory'), wrap((req, res) => {
  const b = { ...req.body };
  if (b.tax_rate === '') b.tax_rate = null;
  update('products', Number(req.params.id), b, PRODUCT_FIELDS);
  audit(req.user, 'product.update', 'product', Number(req.params.id), b);
  res.json({ ok: true });
}));

function moveStock(productId, kind, qty, reason, user, ref = {}) {
  const signed = kind === 'in' || kind === 'sale_void' ? Math.abs(qty) : kind === 'adjust' ? qty : -Math.abs(qty);
  run('UPDATE products SET stock = stock + ? WHERE id = ?', signed, productId);
  insert('stock_movements', { product_id: productId, kind, quantity: signed, reason: reason || null, ref_type: ref.type || null, ref_id: ref.id || null, created_by: user.id });
}

router.post('/products/:id/movements', requirePerm('inventory'), wrap((req, res) => {
  const { kind, quantity, reason } = req.body;
  if (!['in', 'out', 'adjust'].includes(kind)) fail(400, 'Tipo inválido');
  const q = Number(quantity);
  if (!q) fail(400, 'Cantidad inválida');
  if (kind === 'adjust') {
    // "adjust" recibe el conteo físico y registra la diferencia.
    const p = get('SELECT stock FROM products WHERE id = ?', Number(req.params.id));
    tx(() => moveStock(Number(req.params.id), 'adjust', q - p.stock, reason || 'Ajuste por conteo', req.user));
  } else tx(() => moveStock(Number(req.params.id), kind, q, reason, req.user));
  audit(req.user, 'inventory.' + kind, 'product', Number(req.params.id), { quantity: q, reason });
  res.json({ ok: true });
}));
router.get('/stock-movements', requirePerm('inventory.view', 'inventory'), wrap((req, res) => {
  const pid = req.query.product_id ? Number(req.query.product_id) : null;
  res.json(all(
    `SELECT m.*, p.name AS product, u.name AS user_name FROM stock_movements m JOIN products p ON p.id = m.product_id
     LEFT JOIN users u ON u.id = m.created_by ${pid ? 'WHERE m.product_id = ?' : ''} ORDER BY m.id DESC LIMIT 200`, ...(pid ? [pid] : []),
  ));
}));

// ---------- ventas ----------
// items: [{product_id, quantity}], reservation_id opcional (cargo a habitación), payment para venta directa.
router.post('/sales', requirePerm('sales'), wrap((req, res) => {
  const { items, reservation_id, payment, customer_name } = req.body;
  if (!Array.isArray(items) || !items.length) fail(400, 'Agregue productos a la venta');
  const settings = getSettings();
  const id = tx(() => {
    if (reservation_id) {
      const r = get('SELECT status FROM reservations WHERE id = ?', reservation_id);
      if (!r || r.status !== 'checked_in') fail(400, 'Solo se puede cargar a habitaciones con huésped en casa');
    }
    const saleId = insert('sales', { reservation_id: reservation_id || null, customer_name: customer_name || null, created_by: req.user.id });
    let total = 0; let taxTotal = 0;
    for (const it of items) {
      const p = get('SELECT * FROM products WHERE id = ? AND active = 1', Number(it.product_id));
      if (!p) fail(404, 'Producto no encontrado');
      const qty = Number(it.quantity) || 1;
      if (p.stock < qty) fail(409, `Stock insuficiente de ${p.name} (disponible: ${p.stock})`);
      const rate = p.tax_rate ?? settings.taxes.products_rate;
      const { total: lineTotal, tax } = lineTax(p.price * qty, rate, settings);
      const itemId = insert('sale_items', { sale_id: saleId, product_id: p.id, description: p.name, quantity: qty, unit_price: p.price, total: lineTotal, tax_rate: rate, tax_amount: tax });
      moveStock(p.id, 'sale', qty, null, req.user, { type: 'sale', id: saleId });
      if (reservation_id) {
        postCharge(reservation_id, { category: 'product', description: p.name, quantity: qty, unit_price: p.price, tax_rate: rate, ref_type: 'sale_item', ref_id: itemId }, req.user, { silent: true });
      }
      total += lineTotal; taxTotal += tax;
    }
    run('UPDATE sales SET total = ?, tax_amount = ? WHERE id = ?', total, taxTotal, saleId);
    if (!reservation_id) {
      if (!payment?.method) fail(400, 'Seleccione el método de pago');
      addPayment({ sale_id: saleId, method: payment.method, amount: total, reference: payment.reference }, req.user);
    }
    audit(req.user, 'sale.create', 'sale', saleId, { total, reservation_id: reservation_id || null });
    return saleId;
  });
  res.json({ id });
}));

router.get('/sales', requirePerm('sales'), wrap((req, res) => {
  const { from, to } = req.query;
  const where = ['1=1']; const p = [];
  if (from) { where.push("date(s.created_at, '-5 hours') >= ?"); p.push(from); }
  if (to) { where.push("date(s.created_at, '-5 hours') <= ?"); p.push(to); }
  const sales = all(
    `SELECT s.*, u.name AS user_name, r.code AS reservation_code,
       (SELECT GROUP_CONCAT(rm.number) FROM reservation_rooms rr JOIN rooms rm ON rm.id = rr.room_id WHERE rr.reservation_id = s.reservation_id) AS rooms,
       (SELECT method FROM payments WHERE sale_id = s.id LIMIT 1) AS method
     FROM sales s LEFT JOIN users u ON u.id = s.created_by LEFT JOIN reservations r ON r.id = s.reservation_id
     WHERE ${where.join(' AND ')} ORDER BY s.id DESC LIMIT 200`, ...p,
  );
  const items = sales.length ? all(`SELECT * FROM sale_items WHERE sale_id IN (${sales.map(() => '?').join(',')})`, ...sales.map((s) => s.id)) : [];
  res.json(sales.map((s) => ({ ...s, items: items.filter((i) => i.sale_id === s.id) })));
}));

router.post('/sales/:id/void', requirePerm('void'), wrap((req, res) => {
  const s = get('SELECT * FROM sales WHERE id = ?', Number(req.params.id));
  if (!s || s.voided) fail(400, 'Venta no válida');
  if (!req.body.reason) fail(400, 'Indique el motivo');
  tx(() => {
    run(`UPDATE sales SET voided = 1, voided_by = ?, voided_at = datetime('now'), void_reason = ? WHERE id = ?`, req.user.id, req.body.reason, s.id);
    for (const it of all('SELECT * FROM sale_items WHERE sale_id = ?', s.id)) {
      moveStock(it.product_id, 'sale_void', it.quantity, 'Anulación de venta', req.user, { type: 'sale', id: s.id });
      const c = get(`SELECT id FROM charges WHERE ref_type = 'sale_item' AND ref_id = ? AND voided = 0`, it.id);
      if (c) voidCharge(c.id, 'Anulación de venta', req.user, true);
    }
    run(`UPDATE payments SET voided = 1, voided_by = ?, voided_at = datetime('now'), void_reason = ? WHERE sale_id = ? AND voided = 0`, req.user.id, 'Anulación de venta', s.id);
    audit(req.user, 'sale.void', 'sale', s.id, { reason: req.body.reason, total: s.total });
  });
  res.json({ ok: true });
}));
