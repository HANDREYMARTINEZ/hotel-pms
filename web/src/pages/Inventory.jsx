import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Minus, Pencil, PackagePlus, Ban, AlertTriangle } from 'lucide-react';
import { api, qs } from '../api.js';
import {
  useApp, useData, useAction, Loader, PageHead, Modal, Input, Select, MoneyInput, Tabs, Badge, Empty, Confirm, Check,
  money, fdatetime, todayStr, addDays, paymentMethodName,
} from '../ui.jsx';

export default function Inventory() {
  const { can } = useApp();
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') || 'pos');
  const tabs = [['pos', 'Vender'], ['products', 'Productos'], ['sales', 'Ventas'], ['moves', 'Movimientos']];
  return (
    <>
      <PageHead title="Inventario y ventas" />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'pos' && <Pos />}
      {tab === 'products' && <Products manage={can('inventory')} />}
      {tab === 'sales' && <Sales />}
      {tab === 'moves' && <Moves />}
    </>
  );
}

function Pos() {
  const { settings } = useApp();
  const products = useData('/products');
  const inHouse = useData('/reservations?status=checked_in');
  const [run, busy] = useAction();
  const [cart, setCart] = useState({});
  const [dest, setDest] = useState('direct');
  const [resId, setResId] = useState('');
  const methods = settings.payment_methods.filter((m) => m.active);
  const [method, setMethod] = useState(methods[0]?.code);
  const [reference, setReference] = useState('');
  const list = (products.data || []).filter((p) => p.active);
  const items = Object.entries(cart).filter(([, q]) => q > 0).map(([id, q]) => ({ product_id: Number(id), quantity: q, p: list.find((x) => x.id === Number(id)) }));
  const total = items.reduce((s, it) => s + (it.p?.price || 0) * it.quantity, 0);
  const add = (p, n) => setCart({ ...cart, [p.id]: Math.min(p.stock, Math.max(0, (cart[p.id] || 0) + n)) });

  async function sell() {
    const body = { items: items.map(({ product_id, quantity }) => ({ product_id, quantity })) };
    if (dest === 'room') body.reservation_id = Number(resId);
    else body.payment = { method, reference };
    if (await run(() => api.post('/sales', body), dest === 'room' ? 'Cargado a la habitación' : 'Venta registrada')) { setCart({}); setReference(''); products.reload(); }
  }

  return (
    <div className="grid g2" style={{ alignItems: 'start' }}>
      <Loader state={products}>{() => (
        <div className="pill-select" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
          {list.map((p) => (
            <button key={p.id} className={cart[p.id] ? 'on' : ''} disabled={p.stock <= 0} onClick={() => add(p, 1)} style={{ textAlign: 'left', opacity: p.stock <= 0 ? 0.5 : 1 }}>
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              <div className="row between" style={{ fontSize: 12.5, marginTop: 4 }}><span>{money(p.price)}</span><span className="muted">{p.stock} und</span></div>
              {cart[p.id] ? <div style={{ fontSize: 12, marginTop: 2 }}>En venta: {cart[p.id]}</div> : null}
            </button>
          ))}
          {list.length === 0 && <Empty>No hay productos</Empty>}
        </div>
      )}</Loader>
      <div className="card stack" style={{ position: 'sticky', top: 16 }}>
        <h2>Venta</h2>
        {items.length === 0 ? <Empty>Toque los productos para agregarlos</Empty> : items.map((it) => (
          <div key={it.product_id} className="row">
            <span className="grow">{it.p?.name}</span>
            <button className="btn sm icon-btn" onClick={() => add(it.p, -1)}><Minus size={14} /></button>
            <span style={{ width: 22, textAlign: 'center' }}>{it.quantity}</span>
            <button className="btn sm icon-btn" onClick={() => add(it.p, 1)}><Plus size={14} /></button>
            <span className="mono" style={{ width: 80, textAlign: 'right' }}>{money(it.p.price * it.quantity)}</span>
          </div>
        ))}
        <div className="totals"><div className="line big"><span>Total</span><span>{money(total)}</span></div></div>
        <div className="pill-select" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <button className={dest === 'direct' ? 'on' : ''} onClick={() => setDest('direct')}>Pago directo</button>
          <button className={dest === 'room' ? 'on' : ''} onClick={() => setDest('room')}>Cargar a habitación</button>
        </div>
        {dest === 'room' ? (
          <Select label="Habitación" value={resId} onChange={setResId} placeholder="Seleccione…" options={(inHouse.data || []).map((r) => [r.id, `${r.rooms} · ${r.guest_name}`])} />
        ) : (
          <>
            <div className="pill-select">{methods.map((m) => <button key={m.code} className={method === m.code ? 'on' : ''} onClick={() => setMethod(m.code)}>{m.name}</button>)}</div>
            {method !== 'cash' && <Input label="Referencia" value={reference} onChange={setReference} />}
          </>
        )}
        <button className="btn primary lg block" disabled={busy || !items.length || (dest === 'room' && !resId)} onClick={sell}>
          {dest === 'room' ? 'Cargar a la cuenta' : `Cobrar ${money(total)}`}
        </button>
      </div>
    </div>
  );
}

function Products({ manage }) {
  const state = useData('/products');
  const [edit, setEdit] = useState(null);
  const [move, setMove] = useState(null);
  return (
    <>
      {manage && <div className="row mb"><button className="btn primary" onClick={() => setEdit({})}><Plus /> Producto</button></div>}
      <Loader state={state}>{(list) => (
        <div className="card"><div className="table-wrap"><table className="table">
          <thead><tr><th>Producto</th><th>Categoría</th><th className="num">Precio</th><th className="num">Costo</th><th className="num">Stock</th><th /></tr></thead>
          <tbody>{list.map((p) => (
            <tr key={p.id} style={{ opacity: p.active ? 1 : 0.5 }}>
              <td><b>{p.name}</b>{p.sku && <div className="muted" style={{ fontSize: 12 }}>{p.sku}</div>}</td>
              <td>{p.category}</td><td className="num">{money(p.price)}</td><td className="num">{money(p.cost)}</td>
              <td className="num">{p.low ? <Badge kind="warn"><AlertTriangle size={12} /> {p.stock}</Badge> : p.stock}<div className="muted" style={{ fontSize: 11 }}>mín. {p.min_stock}</div></td>
              <td style={{ whiteSpace: 'nowrap' }}>{manage && <>
                <button className="btn sm" onClick={() => setMove(p)}><PackagePlus /> Stock</button>
                <button className="btn sm ghost" onClick={() => setEdit(p)}><Pencil /></button></>}</td>
            </tr>
          ))}</tbody>
        </table></div></div>
      )}</Loader>
      {edit && <ProductForm p={edit} onClose={() => setEdit(null)} onSaved={state.reload} />}
      {move && <MoveForm p={move} onClose={() => setMove(null)} onSaved={state.reload} />}
    </>
  );
}

function ProductForm({ p, onClose, onSaved }) {
  const { settings } = useApp();
  const [f, setF] = useState({ name: '', sku: '', category: '', price: '', cost: '', stock: '', min_stock: 3, tax_rate: '', active: 1, ...p, tax_rate: p.tax_rate ?? '' });
  const [run, busy] = useAction();
  const set = (k) => (v) => setF({ ...f, [k]: v });
  return (
    <Modal title={p.id ? 'Editar producto' : 'Nuevo producto'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn primary" disabled={busy || !f.name} onClick={async () => {
        const body = { ...f, active: f.active ? 1 : 0 }; if (p.id) delete body.stock;
        if (await run(() => (p.id ? api.put('/products/' + p.id, body) : api.post('/products', body)), 'Producto guardado')) { onSaved(); onClose(); }
      }}>Guardar</button>
    </>}>
      <div className="grid g2">
        <Input label="Nombre" value={f.name} onChange={set('name')} />
        <Input label="Categoría" value={f.category} onChange={set('category')} placeholder="Bebidas, snacks…" />
        <MoneyInput label="Precio de venta" value={f.price} onChange={set('price')} hint={settings.taxes.prices_include_tax ? 'IVA incluido' : 'Antes de IVA'} />
        <MoneyInput label="Costo" value={f.cost} onChange={set('cost')} />
        {!p.id && <Input label="Stock inicial" type="number" value={f.stock} onChange={set('stock')} />}
        <Input label="Stock mínimo (alerta)" type="number" value={f.min_stock} onChange={set('min_stock')} />
        <Input label="Código / SKU" value={f.sku} onChange={set('sku')} />
        <Input label="% IVA" type="number" value={f.tax_rate} onChange={set('tax_rate')} placeholder={`${settings.taxes.products_rate} (por defecto)`} />
        <Check label="Activo" checked={f.active} onChange={set('active')} />
      </div>
    </Modal>
  );
}

function MoveForm({ p, onClose, onSaved }) {
  const [f, setF] = useState({ kind: 'in', quantity: '', reason: '' });
  const [run, busy] = useAction();
  return (
    <Modal title={`Movimiento · ${p.name}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn primary" disabled={busy || f.quantity === ''} onClick={async () => {
        if (await run(() => api.post(`/products/${p.id}/movements`, f), 'Inventario actualizado')) { onSaved(); onClose(); }
      }}>Guardar</button>
    </>}>
      <div className="stack">
        <div className="pill-select">
          {[['in', 'Entrada (compra)'], ['out', 'Salida (daño, consumo interno)'], ['adjust', 'Ajuste por conteo']].map(([k, l]) => <button key={k} className={f.kind === k ? 'on' : ''} onClick={() => setF({ ...f, kind: k })}>{l}</button>)}
        </div>
        <Input label={f.kind === 'adjust' ? `Cantidad contada (actual en sistema: ${p.stock})` : 'Cantidad'} type="number" value={f.quantity} onChange={(v) => setF({ ...f, quantity: v })} autoFocus />
        <Input label="Motivo / proveedor" value={f.reason} onChange={(v) => setF({ ...f, reason: v })} />
      </div>
    </Modal>
  );
}

function Sales() {
  const { can, settings } = useApp();
  const [range, setRange] = useState({ from: addDays(todayStr(), -7), to: todayStr() });
  const state = useData('/sales' + qs(range));
  const [voiding, setVoiding] = useState(null);
  return (
    <>
      <div className="row mb">
        <Input type="date" value={range.from} onChange={(v) => setRange({ ...range, from: v })} style={{ width: 170 }} />
        <Input type="date" value={range.to} onChange={(v) => setRange({ ...range, to: v })} style={{ width: 170 }} />
      </div>
      <Loader state={state}>{(list) => list.length === 0 ? <div className="card"><Empty>Sin ventas en el periodo</Empty></div> : (
        <div className="card"><div className="table-wrap"><table className="table">
          <thead><tr><th>Fecha</th><th>Detalle</th><th>Destino</th><th>Vendió</th><th className="num">Total</th><th /></tr></thead>
          <tbody>{list.map((s) => (
            <tr key={s.id} className={s.voided ? 'voided' : ''} title={s.voided ? `Anulada: ${s.void_reason}` : ''}>
              <td style={{ whiteSpace: 'nowrap' }}>{fdatetime(s.created_at)}</td>
              <td style={{ fontSize: 13 }}>{s.items.map((i) => `${i.quantity}× ${i.description}`).join(', ')}</td>
              <td>{s.reservation_id ? `Hab. ${s.rooms}` : paymentMethodName(settings, s.method)}</td>
              <td>{s.user_name}</td><td className="num">{money(s.total)}</td>
              <td>{!s.voided && can('void') && <button className="btn sm ghost icon-btn" onClick={() => setVoiding(s)} title="Anular"><Ban size={15} /></button>}</td>
            </tr>
          ))}</tbody>
        </table></div></div>
      )}</Loader>
      {voiding && <Confirm title="Anular venta" danger confirmText="Anular venta" reasonLabel="Motivo" message={`Se devolverá el stock y se anulará el cobro de ${money(voiding.total)}.`}
        onConfirm={(reason) => api.post(`/sales/${voiding.id}/void`, { reason }).then(state.reload)} onClose={() => setVoiding(null)} />}
    </>
  );
}

const MOVE_KIND = { in: 'Entrada', out: 'Salida', adjust: 'Ajuste', sale: 'Venta', sale_void: 'Anulación' };
function Moves() {
  const state = useData('/stock-movements');
  return (
    <Loader state={state}>{(list) => list.length === 0 ? <div className="card"><Empty>Sin movimientos</Empty></div> : (
      <div className="card"><div className="table-wrap"><table className="table">
        <thead><tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th className="num">Cantidad</th><th>Motivo</th><th>Usuario</th></tr></thead>
        <tbody>{list.map((m) => (
          <tr key={m.id}><td style={{ whiteSpace: 'nowrap' }}>{fdatetime(m.created_at)}</td><td>{m.product}</td><td>{MOVE_KIND[m.kind]}</td>
            <td className="num" style={{ color: m.quantity < 0 ? 'var(--danger)' : 'var(--ok)' }}>{m.quantity > 0 ? '+' : ''}{m.quantity}</td><td className="muted">{m.reason}</td><td>{m.user_name}</td></tr>
        ))}</tbody>
      </table></div></div>
    )}</Loader>
  );
}
