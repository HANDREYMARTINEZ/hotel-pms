import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { api, qs } from '../api.js';
import {
  useApp, useData, useAction, Loader, PageHead, Modal, Input, Select, Textarea, MoneyInput, Tabs, Empty, ResStatus,
  money, fdate, todayStr, addDays, nights, dayName, sourceName, RES_STATUS,
} from '../ui.jsx';
import GuestForm, { emptyGuest, guestValid } from '../components/GuestForm.jsx';

const COL = 58; const LABEL = 96; const ROW = 46;

export default function Reservations() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get('estado') || params.get('vencidas') ? 'list' : 'calendar');
  const [newRes, setNewRes] = useState(params.get('nueva') ? { room_id: Number(params.get('room')) || null } : null);
  const [version, setVersion] = useState(0);
  return (
    <>
      <PageHead title="Reservas">
        <button className="btn primary" onClick={() => setNewRes({})}><Plus /> Nueva reserva</button>
      </PageHead>
      <Tabs tabs={[['calendar', 'Calendario'], ['list', 'Lista']]} value={tab} onChange={setTab} />
      {tab === 'calendar' ? <Timeline key={version} onNew={setNewRes} /> : <ResList key={version} params={params} />}
      {newRes && <NewReservation initial={newRes} onClose={() => { setNewRes(null); if (params.get('nueva')) setParams({}); }} onCreated={() => setVersion((v) => v + 1)} />}
    </>
  );
}

function Timeline({ onNew }) {
  const nav = useNavigate();
  const [from, setFrom] = useState(addDays(todayStr(), -1));
  const days = typeof window !== 'undefined' && window.innerWidth < 700 ? 10 : 21;
  const state = useData(`/reservations/timeline${qs({ from, days })}`);
  return (
    <>
      <div className="row mb">
        <button className="btn icon-btn" onClick={() => setFrom(addDays(from, -7))} aria-label="Anterior"><ChevronLeft /></button>
        <button className="btn" onClick={() => setFrom(addDays(todayStr(), -1))}>Hoy</button>
        <button className="btn icon-btn" onClick={() => setFrom(addDays(from, 7))} aria-label="Siguiente"><ChevronRight /></button>
        <input type="date" className="input" style={{ width: 160 }} value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        <div className="legend grow" style={{ justifyContent: 'flex-end' }}>
          <span style={{ '--c': 'var(--st-reserved)' }}><i />Confirmada</span>
          <span style={{ '--c': 'var(--st-occupied)' }}><i />En casa</span>
          <span style={{ '--c': '#94a3b8' }}><i />Salió</span>
        </div>
      </div>
      <Loader state={state}>{(d) => {
        const dates = Array.from({ length: d.days }, (_, i) => addDays(d.from, i));
        const idx = (s) => nights(d.from, s);
        return (
          <div className="timeline">
            <div className="tl-grid" style={{ gridTemplateColumns: `${LABEL}px repeat(${d.days}, ${COL}px)` }}>
              <div className="tl-corner" />
              {dates.map((dt) => {
                const wd = new Date(dt + 'T12:00:00Z').getUTCDay();
                return <div key={dt} className={'tl-head' + (dt === d.today ? ' today' : '') + (wd === 0 || wd === 6 ? ' weekend' : '')}><span>{dayName(dt)}</span><b>{Number(dt.slice(8))}</b></div>;
              })}
              {d.rooms.map((r) => (
                <Row key={r.id} room={r} dates={dates} today={d.today} onNew={onNew} />
              ))}
              {d.bookings.map((b) => {
                const row = d.rooms.findIndex((r) => r.id === b.room_id);
                if (row < 0) return null;
                const s = Math.max(idx(b.check_in), -0.5); const e = Math.min(idx(b.check_out), d.days + 0.5);
                const left = LABEL + (s + 0.5) * COL + 2; const width = (e - s) * COL - 4;
                return (
                  <div key={b.id + '-' + b.room_id} className={'tl-bar ' + b.status} style={{ left, width, top: ROW + row * ROW + 6 }}
                    title={`${b.guest} · ${fdate(b.check_in)} → ${fdate(b.check_out)} · ${RES_STATUS[b.status][0]}`}
                    onClick={() => nav('/reservas/' + b.id)}>{b.guest}</div>
                );
              })}
              {d.blocks.map((b) => {
                const row = d.rooms.findIndex((r) => r.id === b.room_id);
                const s = Math.max(idx(b.start_date), -0.5); const e = Math.min(idx(b.end_date), d.days + 0.5);
                return <div key={'b' + b.id} className="tl-bar block" style={{ left: LABEL + (s + 0.5) * COL + 2, width: (e - s) * COL - 4, top: ROW + row * ROW + 6 }} title={b.reason}>{b.reason || 'Bloqueo'}</div>;
              })}
            </div>
          </div>
        );
      }}</Loader>
      <small className="muted">Toque una celda vacía para crear una reserva en esa habitación y fecha.</small>
    </>
  );
}

function Row({ room, dates, today, onNew }) {
  return (
    <>
      <div className="tl-room"><b>{room.number}</b><small className="muted">{room.type_name}</small></div>
      {dates.map((dt) => {
        const wd = new Date(dt + 'T12:00:00Z').getUTCDay();
        return <div key={dt} className={'tl-cell free' + (dt === today ? ' today' : '') + (wd === 0 || wd === 6 ? ' weekend' : '')}
          onClick={() => dt >= today && onNew({ room_id: room.id, check_in: dt, check_out: addDays(dt, 1) })} />;
      })}
    </>
  );
}

function ResList({ params }) {
  const nav = useNavigate();
  const { settings } = useApp();
  const [f, setF] = useState({ q: '', status: params.get('estado') || (params.get('vencidas') ? 'pending,confirmed' : ''), from: params.get('vencidas') ? '' : addDays(todayStr(), -30), to: params.get('vencidas') ? addDays(todayStr(), -1) : '' });
  const state = useData('/reservations' + qs(f));
  return (
    <>
      <div className="grid g4 mb">
        <div className="field" style={{ gridColumn: 'span 2' }}><span>Buscar</span>
          <div style={{ position: 'relative' }}><Search size={16} style={{ position: 'absolute', left: 12, top: 13 }} className="muted" />
            <input className="input" style={{ paddingLeft: 36 }} placeholder="Nombre, documento, código, teléfono" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></div></div>
        <Select label="Estado" value={f.status} onChange={(v) => setF({ ...f, status: v })} placeholder="Todos"
          options={[['pending,confirmed', 'Por llegar'], ...Object.entries(RES_STATUS).map(([k, [l]]) => [k, l])]} />
        <Input label="Desde" type="date" value={f.from} onChange={(v) => setF({ ...f, from: v })} />
      </div>
      <Loader state={state}>{(list) => list.length === 0 ? <div className="card"><Empty>No hay reservas con estos filtros</Empty></div> : (
        <div className="card"><div className="table-wrap"><table className="table">
          <thead><tr><th>Huésped</th><th>Hab.</th><th>Fechas</th><th>Origen</th><th>Estado</th><th className="num">Valor</th><th className="num">Pagado</th></tr></thead>
          <tbody>{list.map((r) => (
            <tr key={r.id} className="click" onClick={() => nav('/reservas/' + r.id)}>
              <td><b>{r.guest_name}</b><div className="muted" style={{ fontSize: 12.5 }}>{r.code}</div></td>
              <td>{r.rooms}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{fdate(r.check_in)} → {fdate(r.check_out)}<div className="muted" style={{ fontSize: 12.5 }}>{nights(r.check_in, r.check_out)} noche(s)</div></td>
              <td>{sourceName(settings, r.source)}</td>
              <td><ResStatus status={r.status} /></td>
              <td className="num">{money(r.estimated_total)}</td>
              <td className="num">{money(r.paid)}</td>
            </tr>
          ))}</tbody>
        </table></div></div>
      )}</Loader>
    </>
  );
}

// ---------- nueva reserva ----------
export function NewReservation({ initial, onClose, onCreated }) {
  const nav = useNavigate();
  const { settings } = useApp();
  const [run, busy] = useAction();
  const [f, setF] = useState({
    check_in: initial.check_in || todayStr(), check_out: initial.check_out || addDays(initial.check_in || todayStr(), 1),
    adults: 1, children: 0, room_ids: initial.room_id ? [initial.room_id] : [], source: 'walk_in', source_detail: '', external_ref: '', notes: '',
    advance: { amount: '', method: 'cash', reference: '' },
  });
  const [guest, setGuest] = useState(emptyGuest());
  const [search, setSearch] = useState('');
  const [found, setFound] = useState([]);
  const valid = f.check_out > f.check_in;
  const avail = useData(valid ? '/availability' + qs({ from: f.check_in, to: f.check_out, guests: 1 }) : null);
  const set = (k) => (v) => setF({ ...f, [k]: v });

  useEffect(() => {
    if (search.length < 2) return setFound([]);
    const t = setTimeout(() => api.get('/guests' + qs({ q: search })).then((l) => setFound(l.slice(0, 6))).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [search]);
  // Quita habitaciones que dejaron de estar disponibles al cambiar fechas
  useEffect(() => {
    if (avail.data) setF((x) => ({ ...x, room_ids: x.room_ids.filter((id) => avail.data.some((r) => r.id === id)) }));
  }, [avail.data]);

  const chosen = (avail.data || []).filter((r) => f.room_ids.includes(r.id));
  const total = chosen.reduce((s, r) => s + r.quote.total, 0);
  const capacity = chosen.reduce((s, r) => s + r.max_guests, 0);
  const people = Number(f.adults) + Number(f.children);
  const sources = settings.reservation_sources.filter((s) => s.active);
  const methods = settings.payment_methods.filter((m) => m.active);
  const suggestedAdvance = Math.round(total * (settings.policies.advance_percent || 0) / 100);

  async function save() {
    const body = { ...f, adults: Number(f.adults), children: Number(f.children), guest: guest.id ? undefined : guest, guest_id: guest.id || undefined };
    if (!body.advance.amount) delete body.advance;
    const r = await run(() => api.post('/reservations', body), 'Reserva creada');
    if (r) { onCreated?.(); onClose(); nav('/reservas/' + r.id); }
  }

  return (
    <Modal title="Nueva reserva" onClose={onClose} wide footer={<>
      <span className="grow muted">{chosen.length > 0 && <>Total estimado <b style={{ color: 'var(--text)' }}>{money(total)}</b></>}</span>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn primary" disabled={busy || !valid || !f.room_ids.length || !guestValid(guest, 'quick')} onClick={save}>Crear reserva</button>
    </>}>
      <div className="stack" style={{ gap: 18 }}>
        <section className="stack">
          <h3>1. Fechas y habitación</h3>
          <div className="grid g4">
            <Input label="Llegada" type="date" value={f.check_in} min={todayStr()} onChange={(v) => setF({ ...f, check_in: v, check_out: f.check_out <= v ? addDays(v, 1) : f.check_out })} />
            <Input label="Salida" type="date" value={f.check_out} min={addDays(f.check_in, 1)} onChange={set('check_out')} hint={valid ? `${nights(f.check_in, f.check_out)} noche(s)` : 'Fecha inválida'} />
            <Input label="Adultos" type="number" min={1} value={f.adults} onChange={set('adults')} />
            <Input label="Niños" type="number" min={0} value={f.children} onChange={set('children')} />
          </div>
          {avail.loading && !avail.data ? <small className="muted">Buscando disponibilidad…</small> : (
            avail.data?.length === 0 ? <Empty>No hay habitaciones disponibles en esas fechas</Empty> : (
              <div className="pill-select">
                {(avail.data || []).map((r) => (
                  <button key={r.id} type="button" className={f.room_ids.includes(r.id) ? 'on' : ''}
                    onClick={() => setF({ ...f, room_ids: f.room_ids.includes(r.id) ? f.room_ids.filter((x) => x !== r.id) : [...f.room_ids, r.id] })}>
                    <div style={{ fontSize: 17, fontWeight: 700 }}>{r.number}</div>
                    <div style={{ fontSize: 12 }} className="muted">{r.type_name} · {r.max_guests}p</div>
                    <div style={{ fontSize: 13, marginTop: 2 }}>{money(r.quote.total)}</div>
                  </button>
                ))}
              </div>
            )
          )}
          {chosen.length > 0 && people > capacity && <small style={{ color: 'var(--danger)' }}>Las habitaciones elegidas son para {capacity} personas.</small>}
        </section>

        <section className="stack">
          <h3>2. Huésped titular</h3>
          {!guest.id && (
            <div style={{ position: 'relative' }}>
              <Input placeholder="Buscar huésped existente por nombre o documento…" value={search} onChange={setSearch} />
              {found.length > 0 && (
                <div className="card" style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, top: 46, padding: 6 }}>
                  {found.map((g) => (
                    <div key={g.id} className="list-item click" style={{ padding: '8px 10px' }} onClick={() => { setGuest({ ...Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v ?? ''])), _existing: true }); setSearch(''); setFound([]); }}>
                      <b>{g.first_name} {g.last_name}</b><span className="muted">{g.doc_type} {g.doc_number}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {guest.id ? (
            <div className="row between card" style={{ boxShadow: 'none', background: 'var(--surface-2)' }}>
              <div><b>{guest.first_name} {guest.last_name}</b><div className="muted">{guest.doc_type} {guest.doc_number} · {guest.phone}</div></div>
              <button className="btn sm" onClick={() => setGuest(emptyGuest())}>Cambiar</button>
            </div>
          ) : <GuestForm value={guest} onChange={setGuest} mode="quick" />}
        </section>

        <section className="stack">
          <h3>3. Origen y anticipo</h3>
          <div className="grid g3">
            <Select label="Origen de la reserva" value={f.source} onChange={set('source')} options={sources.map((s) => [s.code, s.name])} />
            {['agency', 'ota'].includes(f.source) && <Input label={f.source === 'agency' ? 'Agencia' : 'Plataforma'} value={f.source_detail} onChange={set('source_detail')} placeholder={f.source === 'ota' ? 'Booking, Airbnb, Expedia…' : ''} />}
            {['agency', 'ota'].includes(f.source) && <Input label="Código externo" value={f.external_ref} onChange={set('external_ref')} />}
          </div>
          <div className="grid g3">
            <MoneyInput label="Anticipo recibido" value={f.advance.amount} onChange={(v) => setF({ ...f, advance: { ...f.advance, amount: v } })}
              hint={suggestedAdvance ? `Sugerido (${settings.policies.advance_percent}%): ${money(suggestedAdvance)}` : ''} />
            <Select label="Método" value={f.advance.method} onChange={(v) => setF({ ...f, advance: { ...f.advance, method: v } })} options={methods.map((m) => [m.code, m.name])} />
            <Input label="Referencia" value={f.advance.reference} onChange={(v) => setF({ ...f, advance: { ...f.advance, reference: v } })} placeholder="N° transacción" />
          </div>
          <Textarea label="Notas" value={f.notes} onChange={set('notes')} placeholder="Hora estimada de llegada, solicitudes especiales…" />
        </section>
      </div>
    </Modal>
  );
}
