// Check-in por pasos: huésped → acompañantes → vehículo → pago → confirmación.
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2, Upload, Check as CheckIcon, ArrowLeft, ArrowRight } from 'lucide-react';
import { api } from '../api.js';
import {
  useApp, useData, useAction, Loader, PageHead, Input, Select, MoneyInput, Check, Badge, Alert, Empty,
  money, fdate, nights, TRAVEL_REASONS, VEHICLE_TYPES, countryName,
} from '../ui.jsx';
import GuestForm, { emptyGuest, guestValid } from '../components/GuestForm.jsx';

const STEPS = ['Huésped', 'Acompañantes', 'Vehículo', 'Pago', 'Confirmar'];
const blank = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v ?? '']));

export default function CheckIn() {
  const { id } = useParams();
  const state = useData('/reservations/' + id);
  return <Loader state={state}>{(r) => <Wizard r={r} reload={state.reload} />}</Loader>;
}

function Wizard({ r, reload }) {
  const nav = useNavigate();
  const { settings } = useApp();
  const [run, busy] = useAction();
  const [step, setStep] = useState(0);
  const [guest, setGuest] = useState(blank(r.guest));
  const [trip, setTrip] = useState({ travel_reason: r.travel_reason || '', origin_city: r.origin_city || '', destination_city: r.destination_city || '', tax_exempt: !!r.tax_exempt });
  const [companions, setCompanions] = useState(r.companions.map((c) => ({ ...blank(c), _existing: true })));
  const [hasVehicle, setHasVehicle] = useState(r.vehicles.length > 0);
  const [vehicles, setVehicles] = useState(r.vehicles.length ? r.vehicles.map(blank) : [{ plate: '', kind: 'car', color: '', brand: '', parking_space_id: '' }]);
  const methods = settings.payment_methods.filter((m) => m.active);
  const [payment, setPayment] = useState({ amount: '', method: methods[0]?.code, reference: '' });
  const [ignoreCleaning, setIgnoreCleaning] = useState(false);
  const parking = useData('/parking');
  const rooms = useData('/rooms');
  const [docs, setDocs] = useState(r.guest.documents);

  if (!['pending', 'confirmed'].includes(r.status)) {
    return <><PageHead title="Check-in" /><Alert kind="warn">Esta reserva ya no admite check-in (estado: {r.status}).</Alert><button className="btn mt" onClick={() => nav('/reservas/' + r.id)}>Ver reserva</button></>;
  }

  const foreign = guest.nationality && guest.nationality !== 'CO';
  const abroad = guest.residence_country && guest.residence_country !== 'CO';
  const canExempt = foreign && abroad;
  const dirtyRooms = (rooms.data || []).filter((x) => r.rooms.some((rr) => rr.room_id === x.id) && x.housekeeping !== 'clean');
  const balance = r.estimate.balance;

  const stepValid = [
    guestValid(guest) && trip.travel_reason,
    companions.every((c) => guestValid(c, 'companion')),
    !hasVehicle || vehicles.every((v) => v.plate),
    true,
    !dirtyRooms.length || ignoreCleaning,
  ];

  async function uploadDoc(file, kind) {
    const fd = new FormData(); fd.append('file', file); fd.append('kind', kind);
    if (await run(() => api.upload(`/guests/${r.guest.id}/documents`, fd), 'Documento cargado')) setDocs((await api.get('/guests/' + r.guest.id)).documents);
  }

  async function finish() {
    const body = {
      guest: { ...guest, id: r.guest.id },
      companions: companions.map((c) => ({ ...c, id: c.id || undefined })),
      vehicles: hasVehicle ? vehicles.map((v) => ({ ...v, parking_space_id: v.parking_space_id ? Number(v.parking_space_id) : null })) : [],
      ...trip, tax_exempt: canExempt && trip.tax_exempt,
      payment: payment.amount ? payment : undefined,
      ignore_cleaning: ignoreCleaning,
    };
    if (await run(() => api.post(`/reservations/${r.id}/checkin`, body), 'Check-in realizado')) nav('/reservas/' + r.id);
  }

  const busySpaces = new Set((parking.data?.spaces || []).filter((s) => s.vehicle && s.vehicle.reservation_id !== r.id).map((s) => s.id));
  return (
    <>
      <PageHead title={`Check-in · ${r.guest.first_name} ${r.guest.last_name}`} sub={`Hab. ${r.rooms.map((x) => x.number).join(', ')} · ${fdate(r.check_in)} → ${fdate(r.check_out)} · ${nights(r.check_in, r.check_out)} noche(s)`} />
      <div className="steps">
        {STEPS.map((s, i) => <div key={s} className={'step ' + (i < step ? 'done' : i === step ? 'current' : '')}><div className="bar" />{s}</div>)}
      </div>

      <div className="card" style={{ maxWidth: 860 }}>
        {step === 0 && (
          <div className="stack">
            <h2>Datos del huésped titular</h2>
            <GuestForm value={guest} onChange={setGuest} mode="full" />
            <hr style={{ margin: '4px 0' }} />
            <h3>Datos del viaje (Tarjeta de Registro Hotelero)</h3>
            <div className="grid g3">
              <Select label="Motivo del viaje" value={trip.travel_reason} onChange={(v) => setTrip({ ...trip, travel_reason: v })} options={TRAVEL_REASONS} placeholder="Seleccione…" />
              <Input label="Ciudad de procedencia" value={trip.origin_city} onChange={(v) => setTrip({ ...trip, origin_city: v })} />
              <Input label="Ciudad de destino" value={trip.destination_city} onChange={(v) => setTrip({ ...trip, destination_city: v })} />
            </div>
            {canExempt && (
              <div className="card" style={{ background: 'var(--surface-2)', boxShadow: 'none' }}>
                <Check label="Extranjero no residente: aplicar exención de IVA en alojamiento" checked={trip.tax_exempt} onChange={(v) => setTrip({ ...trip, tax_exempt: v })} />
                <small className="muted" style={{ display: 'block', marginTop: 6 }}>Conserve copia del pasaporte y del sello de ingreso o permiso de turista como soporte.</small>
                <div className="row mt">
                  {docs.map((d) => <Badge key={d.id} kind="ok">{d.kind}</Badge>)}
                  <label className="btn sm"><Upload /> Pasaporte<input hidden type="file" accept="image/*,application/pdf" onChange={(e) => e.target.files[0] && uploadDoc(e.target.files[0], 'pasaporte')} /></label>
                  <label className="btn sm"><Upload /> Sello / permiso de ingreso<input hidden type="file" accept="image/*,application/pdf" onChange={(e) => e.target.files[0] && uploadDoc(e.target.files[0], 'sello_migratorio')} /></label>
                </div>
                {trip.tax_exempt && docs.length === 0 && <small style={{ color: 'var(--warn)' }}>Aún no se han cargado documentos de soporte.</small>}
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="stack">
            <div className="row between"><h2>Acompañantes</h2>
              <button className="btn sm" onClick={() => setCompanions([...companions, { ...emptyGuest(), nationality: guest.nationality, relationship: '' }])}><Plus /> Agregar</button></div>
            {companions.length === 0 && <Empty>Sin acompañantes. Toque «Agregar» si viaja con más personas.</Empty>}
            {companions.map((c, i) => (
              <div key={i} className="card" style={{ boxShadow: 'none' }}>
                <div className="row between mb"><b>Acompañante {i + 1}</b><button className="btn sm ghost" onClick={() => setCompanions(companions.filter((_, j) => j !== i))}><Trash2 /></button></div>
                <GuestForm value={c} onChange={(v) => setCompanions(companions.map((x, j) => (j === i ? v : x)))} mode="companion" />
              </div>
            ))}
            <small className="muted">Todos los huéspedes, incluidos menores, deben quedar registrados. Los extranjeros se incluyen en el reporte SIRE.</small>
          </div>
        )}

        {step === 2 && (
          <div className="stack">
            <h2>Vehículo y parqueadero</h2>
            <div className="pill-select" style={{ maxWidth: 320 }}>
              <button className={!hasVehicle ? 'on' : ''} onClick={() => setHasVehicle(false)}>No trae vehículo</button>
              <button className={hasVehicle ? 'on' : ''} onClick={() => setHasVehicle(true)}>Sí trae</button>
            </div>
            {hasVehicle && vehicles.map((v, i) => (
              <div key={i} className="grid g3">
                <Input label="Placa" value={v.plate} onChange={(x) => setVehicles(vehicles.map((y, j) => (j === i ? { ...y, plate: x.toUpperCase() } : y)))} placeholder="ABC123" />
                <Select label="Tipo" value={v.kind} onChange={(x) => setVehicles(vehicles.map((y, j) => (j === i ? { ...y, kind: x } : y)))} options={Object.entries(VEHICLE_TYPES)} />
                <Input label="Color" value={v.color} onChange={(x) => setVehicles(vehicles.map((y, j) => (j === i ? { ...y, color: x } : y)))} />
                <Input label="Marca / modelo" value={v.brand} onChange={(x) => setVehicles(vehicles.map((y, j) => (j === i ? { ...y, brand: x } : y)))} />
                <Select label="Espacio asignado" value={v.parking_space_id} placeholder="Sin asignar"
                  onChange={(x) => setVehicles(vehicles.map((y, j) => (j === i ? { ...y, parking_space_id: x } : y)))}
                  options={(parking.data?.spaces || []).filter((s) => !busySpaces.has(s.id) && !vehicles.some((o, k) => k !== i && Number(o.parking_space_id) === s.id)).map((s) => [s.id, `${s.code} (${VEHICLE_TYPES[s.kind] || s.kind})`])} />
                <div className="field" style={{ justifyContent: 'flex-end' }}>
                  {vehicles.length > 1 && <button className="btn ghost" onClick={() => setVehicles(vehicles.filter((_, j) => j !== i))}><Trash2 /> Quitar</button>}
                </div>
              </div>
            ))}
            {hasVehicle && <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setVehicles([...vehicles, { plate: '', kind: 'car', color: '', brand: '', parking_space_id: '' }])}><Plus /> Otro vehículo</button>}
          </div>
        )}

        {step === 3 && (
          <div className="stack">
            <h2>Pago</h2>
            <div className="totals">
              <div className="line"><span>Alojamiento ({nights(r.check_in, r.check_out)} noches){trip.tax_exempt && canExempt ? ' · sin IVA' : ''}</span><span>{money(r.estimated_total)}</span></div>
              {r.folio.summary.total > 0 && <div className="line"><span>Otros cargos</span><span>{money(r.folio.summary.total)}</span></div>}
              <div className="line"><span>Anticipos recibidos</span><span>-{money(r.folio.summary.paid)}</span></div>
              <div className="line big"><span>Saldo estimado</span><span>{money(balance)}</span></div>
            </div>
            {trip.tax_exempt && canExempt && <small className="muted">El valor final del alojamiento se recalcula sin IVA al confirmar.</small>}
            <div className="grid g2">
              <MoneyInput label="Monto a cobrar ahora (opcional)" value={payment.amount} onChange={(v) => setPayment({ ...payment, amount: v })} />
              {payment.method !== 'cash' && <Input label="Referencia" value={payment.reference} onChange={(v) => setPayment({ ...payment, reference: v })} />}
            </div>
            <div className="row">
              <button className="btn sm" onClick={() => setPayment({ ...payment, amount: balance > 0 ? balance : '' })}>Cobrar todo ({money(balance)})</button>
              <button className="btn sm ghost" onClick={() => setPayment({ ...payment, amount: '' })}>Cobrar a la salida</button>
            </div>
            <div className="pill-select">{methods.map((m) => <button key={m.code} className={payment.method === m.code ? 'on' : ''} onClick={() => setPayment({ ...payment, method: m.code })}>{m.name}</button>)}</div>
          </div>
        )}

        {step === 4 && (
          <div className="stack">
            <h2>Confirmar ingreso</h2>
            <div className="grid g2">
              <div><small className="muted">Titular</small><div><b>{guest.first_name} {guest.last_name}</b></div><div className="muted">{guest.doc_type} {guest.doc_number} · {countryName(guest.nationality)}</div></div>
              <div><small className="muted">Habitación</small><div><b>{r.rooms.map((x) => `${x.number} (${x.type_name})`).join(', ')}</b></div><div className="muted">{fdate(r.check_in)} → {fdate(r.check_out)}</div></div>
              <div><small className="muted">Acompañantes</small><div>{companions.length ? companions.map((c) => `${c.first_name} ${c.last_name}`).join(', ') : 'Ninguno'}</div></div>
              <div><small className="muted">Vehículo</small><div>{hasVehicle ? vehicles.map((v) => v.plate).join(', ') : 'No'}</div></div>
              <div><small className="muted">Pago ahora</small><div>{payment.amount ? `${money(payment.amount)} · ${methods.find((m) => m.code === payment.method)?.name}` : 'Al salir'}</div></div>
              <div><small className="muted">Motivo del viaje</small><div>{trip.travel_reason}</div></div>
            </div>
            {dirtyRooms.length > 0 && (
              <Alert kind="warn">
                La habitación {dirtyRooms.map((x) => x.number).join(', ')} no está marcada como limpia.
                <div className="mt"><Check label="Entregar de todas formas" checked={ignoreCleaning} onChange={setIgnoreCleaning} /></div>
              </Alert>
            )}
          </div>
        )}

        <div className="row between mt" style={{ marginTop: 22 }}>
          <button className="btn" onClick={() => (step ? setStep(step - 1) : nav(-1))}><ArrowLeft /> {step ? 'Atrás' : 'Cancelar'}</button>
          {step < STEPS.length - 1
            ? <button className="btn primary" disabled={!stepValid[step]} onClick={() => setStep(step + 1)}>Siguiente <ArrowRight /></button>
            : <button className="btn primary lg" disabled={busy || !stepValid[step]} onClick={finish}><CheckIcon /> Confirmar check-in</button>}
        </div>
        {!stepValid[step] && step === 0 && <small className="muted">Complete nombre, documento, nacionalidad, país de residencia y motivo del viaje.</small>}
      </div>
    </>
  );
}
