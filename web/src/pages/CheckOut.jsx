// Check-out: cuenta final, cobro, recibo PDF y paso automático a limpieza.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FileText, Plus, CheckCircle2, ArrowLeft } from 'lucide-react';
import { api, openFile } from '../api.js';
import { useApp, useData, useAction, Loader, PageHead, Input, MoneyInput, Alert, money, fdate, todayStr, addDays, nights } from '../ui.jsx';
import { ChargeModal } from './ReservationDetail.jsx';

export default function CheckOut() {
  const { id } = useParams();
  const state = useData('/reservations/' + id);
  return <Loader state={state}>{(r) => <Body r={r} reload={state.reload} />}</Loader>;
}

function Body({ r, reload }) {
  const nav = useNavigate();
  const { settings } = useApp();
  const [run, busy] = useAction();
  const methods = settings.payment_methods.filter((m) => m.active);
  const [charge, setCharge] = useState(false);
  const t = todayStr();
  const actualOut = t <= r.check_in ? addDays(r.check_in, 1) : t;
  const s = r.folio.summary;

  // Proyección de la cuenta si la salida real difiere de la programada.
  const lodging = r.folio.charges.filter((c) => c.category === 'lodging' && !c.voided);
  let adjust = 0;
  if (actualOut < r.check_out) adjust = -lodging.filter((c) => c.service_date >= actualOut).reduce((a, c) => a + c.total, 0);
  if (actualOut > r.check_out) {
    const last = lodging[lodging.length - 1]?.total || 0;
    adjust = last * nights(r.check_out, actualOut);
  }
  const projected = s.total + adjust;
  const due = projected - s.paid;
  const [payment, setPayment] = useState({ amount: due > 0 ? due : '', method: methods[0]?.code, reference: '' });

  if (r.status === 'checked_out') return <Done r={r} />;
  if (r.status !== 'checked_in') return <><PageHead title="Check-out" /><Alert kind="warn">La reserva no está en casa.</Alert></>;

  async function finish() {
    const ok = await run(() => api.post(`/reservations/${r.id}/checkout`, { payment: payment.amount ? payment : undefined }), 'Check-out realizado');
    if (ok) reload();
  }

  return (
    <>
      <PageHead title={`Check-out · ${r.guest.first_name} ${r.guest.last_name}`} sub={`Hab. ${r.rooms.map((x) => x.number).join(', ')} · ingresó ${fdate(r.check_in)}`}>
        <button className="btn ghost" onClick={() => nav(-1)}><ArrowLeft /> Volver</button>
      </PageHead>
      <div className="grid g2" style={{ alignItems: 'start', maxWidth: 980 }}>
        <div className="card">
          <div className="card-head"><h2>Cuenta</h2><button className="btn sm" onClick={() => setCharge(true)}><Plus /> Agregar cargo</button></div>
          {actualOut !== r.check_out && (
            <div className="mb"><Alert kind="warn">
              {actualOut < r.check_out
                ? `Salida anticipada: la reserva era hasta el ${fdate(r.check_out)}. Se descontarán las noches no utilizadas (${money(-adjust)}).`
                : `Salida tardía: estaba prevista el ${fdate(r.check_out)}. Se cargarán ${nights(r.check_out, actualOut)} noche(s) adicional(es) (aprox. ${money(adjust)}).`}
            </Alert></div>
          )}
          <div className="table-wrap"><table className="table"><tbody>
            {r.folio.charges.filter((c) => !c.voided).map((c) => (
              <tr key={c.id} style={{ opacity: actualOut < r.check_out && c.category === 'lodging' && c.service_date >= actualOut ? 0.4 : 1 }}>
                <td>{c.description}{c.quantity !== 1 ? ` ×${c.quantity}` : ''}</td><td className="num">{money(c.total)}</td>
              </tr>
            ))}
          </tbody></table></div>
          <div className="totals mt">
            <div className="line"><span className="muted">Noches</span><span>{money(s.lodging + (adjust || 0))}</span></div>
            {s.services > 0 && <div className="line"><span className="muted">Servicios</span><span>{money(s.services)}</span></div>}
            {s.products > 0 && <div className="line"><span className="muted">Consumos</span><span>{money(s.products)}</span></div>}
            {s.other > 0 && <div className="line"><span className="muted">Otros</span><span>{money(s.other)}</span></div>}
            <div className="line big"><span>Total</span><span>{money(projected)}</span></div>
            <div className="line"><span className="muted">Pagado</span><span>-{money(s.paid)}</span></div>
            <div className="line" style={{ fontWeight: 650, fontSize: 17 }}><span>Por cobrar</span><span style={{ color: due > 0 ? 'var(--danger)' : 'var(--ok)' }}>{money(Math.max(due, 0))}</span></div>
            {due < 0 && <small className="muted">Saldo a favor del huésped: {money(-due)}. Registre la devolución desde la cuenta si aplica.</small>}
          </div>
        </div>

        <div className="card stack">
          <h2>Cobro y salida</h2>
          {due > 0 ? (
            <>
              <MoneyInput label="Monto recibido" value={payment.amount} onChange={(v) => setPayment({ ...payment, amount: v })} />
              <div className="pill-select">{methods.map((m) => <button key={m.code} className={payment.method === m.code ? 'on' : ''} onClick={() => setPayment({ ...payment, method: m.code })}>{m.name}</button>)}</div>
              {payment.method !== 'cash' && <Input label="Referencia / aprobación" value={payment.reference} onChange={(v) => setPayment({ ...payment, reference: v })} />}
              {payment.method === 'cash' && Number(payment.amount) > due && <div className="alert info">Cambio a entregar: <b>{money(payment.amount - due)}</b></div>}
            </>
          ) : <Alert kind="info">La cuenta está saldada.</Alert>}
          <small className="muted">Al confirmar, la habitación pasa a «limpieza» y se genera la encuesta de satisfacción.</small>
          <button className="btn primary lg block" disabled={busy || (due > 0 && Number(payment.amount || 0) < due)} onClick={finish}>
            <CheckCircle2 /> Confirmar check-out
          </button>
          <button className="btn block" onClick={() => openFile(`/reservations/${r.id}/receipt.pdf`)}><FileText /> Ver cuenta en PDF</button>
        </div>
      </div>
      {charge && <ChargeModal r={r} onClose={() => setCharge(false)} onSaved={reload} />}
    </>
  );
}

function Done({ r }) {
  return (
    <div className="card stack" style={{ maxWidth: 560, margin: '20px auto', textAlign: 'center', padding: 28 }}>
      <CheckCircle2 size={48} color="var(--ok)" style={{ margin: '0 auto' }} />
      <h1>Check-out completado</h1>
      <p className="muted" style={{ margin: 0 }}>Habitación {r.rooms.map((x) => x.number).join(', ')} enviada a limpieza. Total {money(r.folio.summary.total)}.</p>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="btn primary" onClick={() => openFile(`/reservations/${r.id}/receipt.pdf`)}><FileText /> Recibo PDF</button>
        <Link className="btn" to={'/reservas/' + r.id}>Encuesta y factura</Link>
        <Link className="btn ghost" to="/">Ir al inicio</Link>
      </div>
    </div>
  );
}
