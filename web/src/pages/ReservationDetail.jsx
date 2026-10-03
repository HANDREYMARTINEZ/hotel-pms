import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LogIn, LogOut, Pencil, XCircle, UserX, FileText, Plus, Ban, MessageCircle, Mail, Receipt, Car, Users, ArrowLeft } from 'lucide-react';
import { api, qs, openFile } from '../api.js';
import {
  useApp, useData, useAction, Loader, PageHead, Modal, Input, Select, Textarea, MoneyInput, Confirm, Badge, Empty, ResStatus, Alert,
  money, fdate, fdatetime, nights, addDays, todayStr, sourceName, paymentMethodName, countryName, VEHICLE_TYPES,
} from '../ui.jsx';

const CAT = { lodging: 'Alojamiento', service: 'Servicio', product: 'Producto', other: 'Otro' };

export default function ReservationDetail() {
  const { id } = useParams();
  const state = useData('/reservations/' + id);
  const { can, settings } = useApp();
  const nav = useNavigate();
  const [modal, setModal] = useState(null);
  const reload = state.reload;

  return (
    <Loader state={state}>{(r) => {
      const active = ['pending', 'confirmed'].includes(r.status);
      const inHouse = r.status === 'checked_in';
      const s = r.folio.summary;
      const balance = inHouse || r.status === 'checked_out' ? s.balance : r.estimate.balance;
      return (
        <>
          <PageHead title={`${r.guest.first_name} ${r.guest.last_name}`} sub={<>{r.code} · <ResStatus status={r.status} /></>}>
            <button className="btn ghost" onClick={() => nav(-1)}><ArrowLeft /> Volver</button>
            {active && can('checkin') && <Link className="btn primary" to={`/reservas/${r.id}/checkin`}><LogIn /> Check-in</Link>}
            {inHouse && can('checkin') && <Link className="btn primary" to={`/reservas/${r.id}/checkout`}><LogOut /> Check-out</Link>}
            {(active || inHouse) && <button className="btn" onClick={() => setModal('edit')}><Pencil /> Modificar</button>}
            <button className="btn" onClick={() => openFile(`/reservations/${r.id}/receipt.pdf`)}><FileText /> Recibo PDF</button>
          </PageHead>

          {r.status === 'cancelled' && <div className="mb"><Alert kind="danger">Cancelada por {r.cancelled_by_name} el {fdatetime(r.cancelled_at)}: {r.cancel_reason}</Alert></div>}
          {r.status === 'no_show' && <div className="mb"><Alert kind="danger">No show registrado por {r.cancelled_by_name} el {fdatetime(r.cancelled_at)}</Alert></div>}
          {active && r.check_in < todayStr() && <div className="mb"><Alert kind="warn">La fecha de llegada ya pasó. Haga el check-in, modifique las fechas o marque como no show.</Alert></div>}
          {inHouse && r.check_out < todayStr() && <div className="mb"><Alert kind="warn">La salida estaba prevista para el {fdate(r.check_out)}.</Alert></div>}

          <div className="grid g3 mb">
            <div className="card stat"><span className="label">Estadía</span><span className="value" style={{ fontSize: 19 }}>{fdate(r.check_in)} → {fdate(r.check_out)}</span>
              <span className="sub">{nights(r.check_in, r.check_out)} noche(s) · hab. {r.rooms.map((x) => x.number).join(', ')} · {r.adults} adulto(s){r.children ? `, ${r.children} niño(s)` : ''}</span></div>
            <div className="card stat"><span className="label">{inHouse || r.status === 'checked_out' ? 'Total cuenta' : 'Total estimado'}</span>
              <span className="value" style={{ fontSize: 22 }}>{money(inHouse || r.status === 'checked_out' ? s.total : r.estimate.total)}</span><span className="sub">Pagado {money(s.paid)}</span></div>
            <div className="card stat"><span className="label">Saldo</span><span className="value" style={{ fontSize: 22, color: balance > 0 ? 'var(--danger)' : 'var(--ok)' }}>{money(balance)}</span>
              <span className="sub">{sourceName(settings, r.source)}{r.source_detail ? ` · ${r.source_detail}` : ''}{r.external_ref ? ` · ${r.external_ref}` : ''}</span></div>
          </div>

          <div className="grid g2" style={{ alignItems: 'start' }}>
            <div className="stack" style={{ gap: 14 }}>
              <Folio r={r} reload={reload} onModal={setModal} />
              {r.status === 'checked_out' && r.survey && <SurveyShare r={r} reload={reload} />}
            </div>
            <div className="stack" style={{ gap: 14 }}>
              <div className="card">
                <div className="card-head"><h2>Huésped</h2><Link className="btn sm ghost" to={'/huespedes/' + r.guest.id}>Ver ficha</Link></div>
                <div className="stack" style={{ gap: 4, fontSize: 14 }}>
                  <div>{r.guest.doc_type} {r.guest.doc_number} · {countryName(r.guest.nationality)}</div>
                  {r.guest.phone && <div>{r.guest.phone}</div>}
                  {r.guest.email && <div>{r.guest.email}</div>}
                  <div className="muted">Reside en {[r.guest.residence_city, countryName(r.guest.residence_country)].filter(Boolean).join(', ')}</div>
                  {r.tax_exempt ? <div><Badge kind="ok">Exento de IVA en alojamiento</Badge></div> : null}
                  {r.guest.resides_abroad && r.guest.nationality !== 'CO' && (inHouse || active) ? (
                    <TaxExempt r={r} reload={reload} />
                  ) : null}
                  {r.guest.notes && <div className="alert info" style={{ marginTop: 6 }}>{r.guest.notes}</div>}
                </div>
              </div>
              {(r.companions.length > 0 || r.vehicles.length > 0 || r.travel_reason) && (
                <div className="card">
                  {r.companions.length > 0 && <>
                    <h3 className="mb"><Users size={15} style={{ verticalAlign: -2 }} /> Acompañantes</h3>
                    {r.companions.map((c) => <div key={c.id} className="list-item" style={{ padding: '8px 0' }}><span className="grow">{c.first_name} {c.last_name}</span><span className="muted">{c.doc_type} {c.doc_number}{c.relationship ? ' · ' + c.relationship : ''}</span></div>)}
                  </>}
                  {r.vehicles.length > 0 && <>
                    <h3 className="mb mt"><Car size={15} style={{ verticalAlign: -2 }} /> Vehículos</h3>
                    {r.vehicles.map((v) => <div key={v.id} className="list-item" style={{ padding: '8px 0' }}><b className="grow">{v.plate}</b><span className="muted">{VEHICLE_TYPES[v.kind]} {v.brand} {v.color}{v.parking_code ? ' · espacio ' + v.parking_code : ''}</span></div>)}
                  </>}
                  {r.travel_reason && <><h3 className={'mb' + (r.companions.length || r.vehicles.length ? ' mt' : '')}>Datos del viaje</h3><div className="muted" style={{ fontSize: 13 }}>Motivo: {r.travel_reason} · Procedencia: {r.origin_city || '—'} · Destino: {r.destination_city || '—'}</div></>}
                </div>
              )}
              {r.notes && <div className="card"><h3 className="mb">Notas</h3><div style={{ whiteSpace: 'pre-wrap' }}>{r.notes}</div></div>}
              <div className="card">
                <h3 className="mb">Historial</h3>
                <div className="stack muted" style={{ gap: 4, fontSize: 13 }}>
                  <div>Creada por {r.created_by_name || 'sistema'} · {fdatetime(r.created_at)}</div>
                  {r.checked_in_at && <div>Check-in por {r.checked_in_by_name} · {fdatetime(r.checked_in_at)}</div>}
                  {r.checked_out_at && <div>Check-out por {r.checked_out_by_name} · {fdatetime(r.checked_out_at)}</div>}
                </div>
                <div className="row mt">
                  {active && <button className="btn sm danger" onClick={() => setModal('cancel')}><XCircle /> Cancelar</button>}
                  {active && r.check_in <= todayStr() && <button className="btn sm danger" onClick={() => setModal('noshow')}><UserX /> No show</button>}
                  {can('feedback') && <button className="btn sm" onClick={() => setModal('feedback')}><MessageCircle /> Registrar comentario/reclamo</button>}
                  {r.status === 'checked_out' && can('payments') && <button className="btn sm" onClick={() => setModal('invoice')}><Receipt /> Factura electrónica</button>}
                </div>
                {r.invoices.length > 0 && <div className="mt">{r.invoices.map((i) => <div key={i.id} className="muted" style={{ fontSize: 13 }}>Factura {i.number || '#' + i.id} · {i.status} · {money(i.total)}</div>)}</div>}
              </div>
            </div>
          </div>

          {modal === 'edit' && <EditReservation r={r} onClose={() => setModal(null)} onSaved={reload} />}
          {modal === 'cancel' && <Confirm title="Cancelar reserva" danger confirmText="Cancelar reserva" reasonLabel="Motivo de la cancelación"
            message={<><span className="muted">Política: {settings.policies.cancellation}</span>{s.paid > 0 && <><br /><br />Hay {money(s.paid)} en anticipos. Registre la devolución o retención desde la cuenta si aplica.</>}</>}
            onConfirm={(reason) => api.post(`/reservations/${r.id}/cancel`, { reason }).then(reload)} onClose={() => setModal(null)} />}
          {modal === 'noshow' && <NoShow r={r} onClose={() => setModal(null)} onSaved={reload} />}
          {modal === 'charge' && <ChargeModal r={r} onClose={() => setModal(null)} onSaved={reload} />}
          {modal === 'product' && <ProductModal r={r} onClose={() => setModal(null)} onSaved={reload} />}
          {modal === 'payment' && <PaymentModal r={r} balance={balance} onClose={() => setModal(null)} onSaved={reload} />}
          {modal === 'feedback' && <FeedbackModal r={r} onClose={() => setModal(null)} />}
          {modal === 'invoice' && <InvoiceModal r={r} onClose={() => setModal(null)} onSaved={reload} />}
        </>
      );
    }}</Loader>
  );
}

function Folio({ r, reload, onModal }) {
  const { can, settings } = useApp();
  const [voiding, setVoiding] = useState(null);
  const s = r.folio.summary;
  const open = ['checked_in', 'confirmed', 'pending'].includes(r.status);
  const projected = r.status !== 'checked_in' && r.status !== 'checked_out';
  return (
    <div className="card">
      <div className="card-head"><h2>Cuenta</h2>
        <div className="row">
          {open && can('checkin') && <button className="btn sm" onClick={() => onModal('charge')}><Plus /> Servicio</button>}
          {r.status === 'checked_in' && can('sales') && <button className="btn sm" onClick={() => onModal('product')}><Plus /> Producto</button>}
          {can('payments') && r.status !== 'cancelled' && <button className="btn sm primary" onClick={() => onModal('payment')}><Plus /> Pago</button>}
        </div>
      </div>
      {projected && r.rooms.length > 0 && (
        <div className="mb">
          <small className="muted">Alojamiento (se carga al hacer check-in)</small>
          {r.rooms.map((rm) => <div key={rm.id} className="row between" style={{ fontSize: 14, padding: '6px 0' }}><span>Hab. {rm.number} · {rm.nightly.length} noche(s)</span><span className="mono">{money(rm.total)}</span></div>)}
        </div>
      )}
      {r.folio.charges.length === 0 && !projected ? <Empty>Sin cargos</Empty> : r.folio.charges.length > 0 && (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Concepto</th><th className="num">Valor</th><th /></tr></thead>
          <tbody>{r.folio.charges.map((c) => (
            <tr key={c.id} className={c.voided ? 'voided' : ''} title={c.voided ? `Anulado por ${c.voided_by_name}: ${c.void_reason}` : `Registrado por ${c.created_by_name || 'sistema'}`}>
              <td>{c.description}{c.quantity !== 1 ? ` ×${c.quantity}` : ''}<div className="muted" style={{ fontSize: 12 }}>{CAT[c.category]} · {fdate(c.service_date)}{c.tax_amount ? ` · IVA ${money(c.tax_amount)}` : ''}</div></td>
              <td className="num">{money(c.total)}</td>
              <td style={{ width: 40 }}>{!c.voided && can('void') && c.category !== 'lodging' && <button className="btn sm ghost icon-btn" title="Anular" onClick={() => setVoiding({ type: 'charge', item: c })}><Ban size={15} /></button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <hr />
      <h3 className="mb">Pagos</h3>
      {r.folio.payments.length === 0 ? <small className="muted">Sin pagos registrados</small> : (
        <div className="table-wrap"><table className="table"><tbody>{r.folio.payments.map((p) => (
          <tr key={p.id} className={p.voided ? 'voided' : ''} title={p.voided ? `Anulado por ${p.voided_by_name}: ${p.void_reason}` : ''}>
            <td>{p.kind === 'advance' ? 'Anticipo' : p.kind === 'refund' ? 'Devolución' : 'Pago'} · {paymentMethodName(settings, p.method)}{p.reference ? ` (${p.reference})` : ''}
              <div className="muted" style={{ fontSize: 12 }}>{fdatetime(p.created_at)} · recibió {p.created_by_name}</div></td>
            <td className="num">{p.kind === 'refund' ? '-' : ''}{money(p.amount)}</td>
            <td style={{ width: 40 }}>{!p.voided && can('void') && <button className="btn sm ghost icon-btn" title="Anular" onClick={() => setVoiding({ type: 'payment', item: p })}><Ban size={15} /></button>}</td>
          </tr>
        ))}</tbody></table></div>
      )}
      {!projected && (
        <div className="totals mt">
          <div className="line"><span className="muted">Alojamiento</span><span>{money(s.lodging)}</span></div>
          {s.services > 0 && <div className="line"><span className="muted">Servicios</span><span>{money(s.services)}</span></div>}
          {s.products > 0 && <div className="line"><span className="muted">Consumos</span><span>{money(s.products)}</span></div>}
          {s.other > 0 && <div className="line"><span className="muted">Otros</span><span>{money(s.other)}</span></div>}
          <div className="line"><span className="muted">Impuestos incluidos</span><span>{money(s.tax)}</span></div>
          <div className="line big"><span>Total</span><span>{money(s.total)}</span></div>
          <div className="line"><span className="muted">Pagado</span><span>{money(s.paid)}</span></div>
          <div className="line" style={{ fontWeight: 650, color: s.balance > 0 ? 'var(--danger)' : 'inherit' }}><span>Saldo</span><span>{money(s.balance)}</span></div>
        </div>
      )}
      {voiding && <Confirm title={voiding.type === 'charge' ? 'Anular cargo' : 'Anular pago'} danger confirmText="Anular" reasonLabel="Motivo de la anulación"
        message={`${voiding.item.description || paymentMethodName(settings, voiding.item.method)} · ${money(voiding.item.total ?? voiding.item.amount)}. Quedará registrado quién la anuló.`}
        onConfirm={(reason) => api.post(`/${voiding.type === 'charge' ? 'charges' : 'payments'}/${voiding.item.id}/void`, { reason }).then(reload)} onClose={() => setVoiding(null)} />}
    </div>
  );
}

function TaxExempt({ r, reload }) {
  const [run, busy] = useAction();
  const hasDocs = r.guest.documents.length > 0;
  return (
    <div className="stack mt" style={{ gap: 6 }}>
      {!r.tax_exempt && !hasDocs && <small className="muted">Para aplicar la exención, cargue en la ficha del huésped copia del pasaporte y del sello o permiso de ingreso.</small>}
      <button className="btn sm" disabled={busy} onClick={() => run(() => api.post(`/reservations/${r.id}/tax-exempt`, { tax_exempt: !r.tax_exempt }), r.tax_exempt ? 'Exención retirada' : 'Exención aplicada').then(reload)}>
        {r.tax_exempt ? 'Quitar exención de IVA' : 'Aplicar exención de IVA (no residente)'}
      </button>
    </div>
  );
}

function EditReservation({ r, onClose, onSaved }) {
  const { settings } = useApp();
  const [run, busy] = useAction();
  const inHouse = r.status === 'checked_in';
  const [f, setF] = useState({
    check_in: r.check_in, check_out: r.check_out, room_ids: r.rooms.map((x) => x.room_id), adults: r.adults, children: r.children,
    source: r.source, source_detail: r.source_detail || '', external_ref: r.external_ref || '', notes: r.notes || '', status: r.status,
  });
  const avail = useData(f.check_out > f.check_in ? '/availability' + qs({ from: f.check_in, to: f.check_out, exclude: r.id }) : null);
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const total = (avail.data || []).filter((x) => f.room_ids.includes(x.id)).reduce((a, x) => a + x.quote.total, 0);
  return (
    <Modal title="Modificar reserva" onClose={onClose} wide footer={<>
      <span className="grow muted">Nuevo total alojamiento: <b>{money(total)}</b></span>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn primary" disabled={busy || !f.room_ids.length} onClick={async () => {
        const body = { ...f }; if (r.status === 'checked_in') delete body.status;
        if (await run(() => api.put('/reservations/' + r.id, body), 'Reserva actualizada')) { onSaved(); onClose(); }
      }}>Guardar cambios</button>
    </>}>
      <div className="stack">
        <div className="grid g4">
          <Input label="Llegada" type="date" value={f.check_in} disabled={inHouse} onChange={(v) => setF({ ...f, check_in: v, check_out: f.check_out <= v ? addDays(v, 1) : f.check_out })} />
          <Input label="Salida" type="date" value={f.check_out} min={addDays(f.check_in, 1)} onChange={set('check_out')} />
          <Input label="Adultos" type="number" value={f.adults} onChange={set('adults')} />
          <Input label="Niños" type="number" value={f.children} onChange={set('children')} />
        </div>
        <div className="field"><span>Habitación(es) {inHouse && '— al cambiar, la anterior pasa a limpieza'}</span>
          <div className="pill-select">{(avail.data || []).map((x) => (
            <button key={x.id} className={f.room_ids.includes(x.id) ? 'on' : ''} onClick={() => setF({ ...f, room_ids: f.room_ids.includes(x.id) ? f.room_ids.filter((y) => y !== x.id) : [...f.room_ids, x.id] })}>
              <b>{x.number}</b><div className="muted" style={{ fontSize: 12 }}>{x.type_name} · {money(x.quote.total)}</div></button>
          ))}</div>
        </div>
        <div className="grid g3">
          <Select label="Origen" value={f.source} onChange={set('source')} options={settings.reservation_sources.map((s) => [s.code, s.name])} />
          <Input label="Detalle (agencia / plataforma)" value={f.source_detail} onChange={set('source_detail')} />
          {!inHouse && <Select label="Estado" value={f.status} onChange={set('status')} options={[['confirmed', 'Confirmada'], ['pending', 'Pendiente']]} />}
        </div>
        <Textarea label="Notas" value={f.notes} onChange={set('notes')} />
      </div>
    </Modal>
  );
}

function NoShow({ r, onClose, onSaved }) {
  const [penalty, setPenalty] = useState(r.rooms[0]?.nightly[0]?.price || '');
  return (
    <Confirm title="Marcar no show" danger confirmText="Marcar no show" onClose={onClose}
      message="El huésped no se presentó. Las habitaciones quedarán libres."
      onConfirm={() => api.post(`/reservations/${r.id}/no-show`, { penalty: Number(penalty) || 0 }).then(onSaved)}>
      <MoneyInput label="Penalidad a cobrar (opcional)" value={penalty} onChange={setPenalty} hint="Se carga a la cuenta; puede cobrarse del anticipo." />
    </Confirm>
  );
}

export function ChargeModal({ r, onClose, onSaved }) {
  const services = useData('/services');
  const [run, busy] = useAction();
  const [f, setF] = useState({ service_id: '', description: '', quantity: 1, unit_price: '' });
  const svc = services.data?.find((s) => s.id === Number(f.service_id));
  return (
    <Modal title="Cargar servicio a la habitación" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn primary" disabled={busy || (!f.service_id && (!f.description || f.unit_price === ''))} onClick={async () => {
        const body = f.service_id ? { service_id: Number(f.service_id), quantity: f.quantity, unit_price: f.unit_price === '' ? undefined : f.unit_price } : { category: 'other', ...f, service_id: undefined };
        if (await run(() => api.post(`/reservations/${r.id}/charges`, body), 'Cargo registrado')) { onSaved(); onClose(); }
      }}>Cargar</button>
    </>}>
      <div className="stack">
        <div className="pill-select">
          {(services.data || []).filter((s) => s.active).map((s) => (
            <button key={s.id} className={f.service_id == s.id ? 'on' : ''} onClick={() => setF({ ...f, service_id: s.id, unit_price: s.price, description: '' })}>{s.name}<div className="muted" style={{ fontSize: 12 }}>{money(s.price)}</div></button>
          ))}
          <button className={!f.service_id ? 'on' : ''} onClick={() => setF({ ...f, service_id: '', unit_price: '' })}>Otro concepto</button>
        </div>
        {!f.service_id && <Input label="Descripción" value={f.description} onChange={(v) => setF({ ...f, description: v })} />}
        <div className="grid g2">
          <Input label="Cantidad" type="number" min={1} value={f.quantity} onChange={(v) => setF({ ...f, quantity: v })} />
          <MoneyInput label="Valor unitario" value={f.unit_price} onChange={(v) => setF({ ...f, unit_price: v })} />
        </div>
        <div className="row between"><span className="muted">Total</span><b>{money((Number(f.unit_price) || svc?.price || 0) * (Number(f.quantity) || 1))}</b></div>
      </div>
    </Modal>
  );
}

function ProductModal({ r, onClose, onSaved }) {
  const products = useData('/products');
  const [run, busy] = useAction();
  const [cart, setCart] = useState({});
  const items = Object.entries(cart).filter(([, q]) => q > 0).map(([id, q]) => ({ product_id: Number(id), quantity: q }));
  const total = items.reduce((s, it) => s + (products.data?.find((p) => p.id === it.product_id)?.price || 0) * it.quantity, 0);
  return (
    <Modal title="Cargar consumo a la habitación" onClose={onClose} footer={<>
      <span className="grow">Total <b>{money(total)}</b></span>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn primary" disabled={busy || !items.length} onClick={async () => {
        if (await run(() => api.post('/sales', { items, reservation_id: r.id }), 'Consumo cargado')) { onSaved(); onClose(); }
      }}>Cargar</button>
    </>}>
      <Loader state={products}>{(list) => (
        <div className="list">{list.filter((p) => p.active).map((p) => (
          <div key={p.id} className="list-item">
            <div className="grow"><b>{p.name}</b><div className="muted" style={{ fontSize: 12.5 }}>{money(p.price)} · stock {p.stock}</div></div>
            <div className="row" style={{ gap: 4 }}>
              <button className="btn sm icon-btn" onClick={() => setCart({ ...cart, [p.id]: Math.max(0, (cart[p.id] || 0) - 1) })}>−</button>
              <span style={{ width: 24, textAlign: 'center' }}>{cart[p.id] || 0}</span>
              <button className="btn sm icon-btn" disabled={(cart[p.id] || 0) >= p.stock} onClick={() => setCart({ ...cart, [p.id]: (cart[p.id] || 0) + 1 })}>+</button>
            </div>
          </div>
        ))}</div>
      )}</Loader>
    </Modal>
  );
}

export function PaymentModal({ r, balance, onClose, onSaved }) {
  const { settings, can } = useApp();
  const [run, busy] = useAction();
  const methods = settings.payment_methods.filter((m) => m.active);
  const [f, setF] = useState({ amount: balance > 0 ? balance : '', method: methods[0]?.code, reference: '', kind: '' });
  return (
    <Modal title="Registrar pago" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn primary" disabled={busy || !f.amount} onClick={async () => {
        if (await run(() => api.post(`/reservations/${r.id}/payments`, { ...f, kind: f.kind || undefined }), 'Pago registrado')) { onSaved(); onClose(); }
      }}>Registrar</button>
    </>}>
      <div className="stack">
        <MoneyInput label="Monto" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} hint={balance > 0 ? `Saldo pendiente ${money(balance)}` : undefined} autoFocus />
        <div className="field"><span>Método</span>
          <div className="pill-select">{methods.map((m) => <button key={m.code} className={f.method === m.code ? 'on' : ''} onClick={() => setF({ ...f, method: m.code })}>{m.name}</button>)}</div>
        </div>
        {f.method !== 'cash' && <Input label="Referencia / N° de aprobación" value={f.reference} onChange={(v) => setF({ ...f, reference: v })} />}
        {can('void') && <Select label="Tipo" value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={[['', 'Automático'], ['advance', 'Anticipo'], ['payment', 'Pago'], ['refund', 'Devolución al huésped']]} />}
      </div>
    </Modal>
  );
}

function FeedbackModal({ r, onClose }) {
  const [run, busy] = useAction();
  const [f, setF] = useState({ kind: 'complaint', subject: '', description: '' });
  return (
    <Modal title="Comentario o reclamo" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn primary" disabled={busy || !f.subject} onClick={async () => { if (await run(() => api.post('/feedback', { ...f, reservation_id: r.id }), 'Registrado')) onClose(); }}>Guardar</button>
    </>}>
      <div className="stack">
        <Select label="Tipo" value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={[['complaint', 'Reclamo'], ['comment', 'Comentario'], ['suggestion', 'Sugerencia'], ['compliment', 'Felicitación']]} />
        <Input label="Asunto" value={f.subject} onChange={(v) => setF({ ...f, subject: v })} />
        <Textarea label="Detalle" value={f.description} onChange={(v) => setF({ ...f, description: v })} />
      </div>
    </Modal>
  );
}

function SurveyShare({ r, reload }) {
  const { settings } = useApp();
  const [run] = useAction();
  const link = `${window.location.origin}/encuesta/${r.survey.token}`;
  const msg = (settings.survey.message || '').replace('{nombre}', r.guest.first_name).replace('{hotel}', settings.hotel.name).replace('{enlace}', link);
  const phone = (r.guest.phone || '').replace(/\D/g, '');
  const wa = `https://wa.me/${phone.length === 10 ? '57' + phone : phone}?text=${encodeURIComponent(msg)}`;
  const mail = `mailto:${r.guest.email || ''}?subject=${encodeURIComponent('Encuesta de satisfacción - ' + settings.hotel.name)}&body=${encodeURIComponent(msg)}`;
  const mark = (channel) => run(() => api.post(`/surveys/${r.survey.id}/sent`, { channel })).then(reload);
  return (
    <div className="card">
      <div className="card-head"><h2>Encuesta de satisfacción</h2>
        {r.survey.completed_at ? <Badge kind="ok">Respondida · {r.survey.overall}/5</Badge> : r.survey.sent_at ? <Badge kind="info">Enviada</Badge> : <Badge>Sin enviar</Badge>}</div>
      {r.survey.completed_at ? <p style={{ margin: 0 }}>{r.survey.comment || <span className="muted">Sin comentario</span>}</p> : (
        <div className="row">
          {phone && <a className="btn" href={wa} target="_blank" rel="noreferrer" onClick={() => mark('whatsapp')}><MessageCircle /> WhatsApp</a>}
          {r.guest.email && <a className="btn" href={mail} onClick={() => mark('email')}><Mail /> Correo</a>}
          <button className="btn ghost" onClick={() => { navigator.clipboard?.writeText(link); mark('link'); }}>Copiar enlace</button>
        </div>
      )}
    </div>
  );
}

function InvoiceModal({ r, onClose, onSaved }) {
  const { settings } = useApp();
  const [run, busy] = useAction();
  const [other, setOther] = useState(false);
  const [c, setC] = useState({ name: '', doc_type: 'NIT', doc_number: '', email: '', address: '', phone: '' });
  return (
    <Modal title="Factura electrónica" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cerrar</button>
      <button className="btn primary" disabled={busy || (other && (!c.name || !c.doc_number))} onClick={async () => {
        const res = await run(() => api.post('/invoices', { reservation_id: r.id, customer: other ? c : undefined }));
        if (res) { onSaved(); onClose(); }
      }}>{settings.einvoice.enabled ? 'Enviar al proveedor' : 'Registrar borrador'}</button>
    </>}>
      <div className="stack">
        {!settings.einvoice.enabled && <Alert kind="info">No hay proveedor de facturación electrónica conectado. Se guardará la información de la factura como borrador para emitirla en el portal de su proveedor. Configúrelo en Configuración → Facturación.</Alert>}
        <div className="totals"><div className="line"><span>Subtotal</span><span>{money(r.folio.summary.subtotal)}</span></div><div className="line"><span>Impuestos</span><span>{money(r.folio.summary.tax)}</span></div><div className="line big"><span>Total</span><span>{money(r.folio.summary.total)}</span></div></div>
        <label className="check"><input type="checkbox" checked={other} onChange={(e) => setOther(e.target.checked)} />Facturar a otra persona o empresa</label>
        {!other && <small className="muted">Se factura a {r.guest.first_name} {r.guest.last_name} ({r.guest.doc_type} {r.guest.doc_number}).</small>}
        {other && <div className="grid g2">
          <Input label="Razón social / nombre" value={c.name} onChange={(v) => setC({ ...c, name: v })} />
          <Select label="Tipo doc." value={c.doc_type} onChange={(v) => setC({ ...c, doc_type: v })} options={[['NIT', 'NIT'], ['CC', 'Cédula'], ['CE', 'C. extranjería'], ['PA', 'Pasaporte']]} />
          <Input label="Número (NIT con DV)" value={c.doc_number} onChange={(v) => setC({ ...c, doc_number: v })} />
          <Input label="Correo para la factura" value={c.email} onChange={(v) => setC({ ...c, email: v })} />
          <Input label="Dirección" value={c.address} onChange={(v) => setC({ ...c, address: v })} />
          <Input label="Teléfono" value={c.phone} onChange={(v) => setC({ ...c, phone: v })} />
        </div>}
      </div>
    </Modal>
  );
}
