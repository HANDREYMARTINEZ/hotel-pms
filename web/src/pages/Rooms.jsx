import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Pencil, Trash2, Wrench, Sparkles, Upload } from 'lucide-react';
import { api } from '../api.js';
import {
  useApp, useData, useAction, Loader, PageHead, Modal, Input, Select, Textarea, Check, MoneyInput, Tabs, Badge, Empty,
  ROOM_STATUS, HK, money, fdate, ResStatus, todayStr, addDays,
} from '../ui.jsx';

const AMENITIES = ['Wi-Fi', 'TV', 'Baño privado', 'Agua caliente', 'Aire acondicionado', 'Ventilador', 'Minibar', 'Balcón', 'Vista', 'Escritorio', 'Caja fuerte', 'Nevera', 'Cocineta', 'Jacuzzi'];

export default function Rooms() {
  const { can } = useApp();
  const [tab, setTab] = useState('board');
  const rooms = useData('/rooms');
  const types = useData('/room-types');
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState('');
  const openId = Number(params.get('id')) || null;
  const [edit, setEdit] = useState(null);
  const manage = can('rooms.manage');
  const reload = () => { rooms.reload(); types.reload(); };

  return (
    <>
      <PageHead title="Habitaciones" sub={rooms.data ? `${rooms.data.length} habitaciones` : ''}>
        {manage && tab === 'board' && <button className="btn primary" onClick={() => setEdit({})}><Plus /> Habitación</button>}
        {manage && tab === 'types' && <button className="btn primary" onClick={() => setEdit({ _type: true })}><Plus /> Tipo</button>}
      </PageHead>
      {manage && <Tabs tabs={[['board', 'Estado'], ['types', 'Tipos de habitación']]} value={tab} onChange={setTab} />}

      {tab === 'board' && (
        <Loader state={rooms}>{(list) => {
          const shown = filter ? list.filter((r) => r.status === filter) : list;
          return (
            <>
              <div className="chips mb">
                <button className={'chip ' + (!filter ? 'on' : '')} onClick={() => setFilter('')}>Todas ({list.length})</button>
                {Object.entries(ROOM_STATUS).map(([k, l]) => {
                  const n = list.filter((r) => r.status === k).length;
                  return <button key={k} className={'chip ' + (filter === k ? 'on' : '')} onClick={() => setFilter(k)}><span className={'dot st-' + k} style={{ background: 'var(--c)', marginRight: 6 }} />{l} ({n})</button>;
                })}
              </div>
              <div className="rooms-grid">
                {shown.map((r) => (
                  <div key={r.id} className={'room-tile st-' + r.status} onClick={() => setParams({ id: r.id })}>
                    <div className="row between"><span className="num">{r.number}</span>{r.housekeeping !== 'clean' && r.status !== 'cleaning' && <Badge kind="warn">{HK[r.housekeeping]}</Badge>}</div>
                    <span className="st">{ROOM_STATUS[r.status]}{r.departs_today ? ' · sale hoy' : ''}</span>
                    <span className="muted" style={{ fontSize: 12.5 }}>{r.type_name} · {r.max_guests} pers.</span>
                    <span className="who">{r.stay?.guest || r.arrival?.guest || (r.status === 'maintenance' ? r.out_of_service_reason || r.block?.reason || '' : money(r.price))}</span>
                  </div>
                ))}
              </div>
              {shown.length === 0 && <Empty>No hay habitaciones en este estado</Empty>}
            </>
          );
        }}</Loader>
      )}

      {tab === 'types' && (
        <Loader state={types}>{(list) => (
          <div className="card"><div className="table-wrap"><table className="table">
            <thead><tr><th>Tipo</th><th>Capacidad</th><th className="num">Precio base</th><th>Comodidades</th><th /></tr></thead>
            <tbody>{list.map((t) => (
              <tr key={t.id}>
                <td><b>{t.name}</b>{!t.active && <Badge>Inactivo</Badge>}<div className="muted" style={{ fontSize: 13 }}>{t.description}</div></td>
                <td>{t.capacity} pers.</td><td className="num">{money(t.base_price)}</td>
                <td className="muted" style={{ fontSize: 13 }}>{t.amenities.join(', ')}</td>
                <td><button className="btn sm ghost" onClick={() => setEdit({ ...t, _type: true })}><Pencil /></button></td>
              </tr>
            ))}</tbody>
          </table></div></div>
        )}</Loader>
      )}

      {openId && <RoomDetail id={openId} onClose={() => setParams({})} onChanged={reload} onEdit={(r) => setEdit(r)} />}
      {edit && edit._type && <TypeForm type={edit} onClose={() => setEdit(null)} onSaved={reload} />}
      {edit && !edit._type && types.data && <RoomForm room={edit} types={types.data} onClose={() => setEdit(null)} onSaved={reload} />}
    </>
  );
}

function RoomDetail({ id, onClose, onChanged, onEdit }) {
  const { can } = useApp();
  const state = useData('/rooms/' + id);
  const [run, busy] = useAction();
  const [maint, setMaint] = useState(null);
  const [block, setBlock] = useState(null);
  const refresh = () => { state.reload(); onChanged(); };

  const hk = (v) => run(() => api.post(`/rooms/${id}/housekeeping`, { housekeeping: v }), 'Estado actualizado').then(refresh);
  return (
    <Modal title={state.data ? `Habitación ${state.data.number}` : 'Habitación'} onClose={onClose} wide>
      <Loader state={state}>{(r) => (
        <div className="stack">
          <div className="row">
            <span className={'badge st-' + r.status} style={{ background: 'var(--c)', color: '#fff' }}>{ROOM_STATUS[r.status]}</span>
            <Badge>{HK[r.housekeeping]}</Badge>
            <span className="muted">{r.type_name} · {r.max_guests} personas · piso {r.floor || '—'} · {money(r.price)}/noche</span>
          </div>
          {r.photo_list?.length > 0 && <div className="photos">{r.photo_list.map((p) => <div className="ph" key={p.id}><img src={p.path} alt="" /></div>)}</div>}
          {r.amenities?.length > 0 && <div className="chips">{r.amenities.map((a) => <span key={a} className="chip">{a}</span>)}</div>}
          {r.description && <p className="muted" style={{ margin: 0 }}>{r.description}</p>}
          {r.out_of_service ? <div className="alert warn"><Wrench /><div>En mantenimiento: {r.out_of_service_reason || 'sin detalle'}</div></div> : null}

          {r.stay && can('reservations') && (
            <div className="card" style={{ background: 'var(--surface-2)', boxShadow: 'none' }}>
              <div className="row between"><div><b>{r.stay.guest}</b><div className="muted">Hasta {fdate(r.stay.check_out)} · {r.stay.code}</div></div>
                <div className="row"><Link className="btn sm" to={'/reservas/' + r.stay.id}>Ver cuenta</Link><Link className="btn sm primary" to={`/reservas/${r.stay.id}/checkout`}>Check-out</Link></div></div>
            </div>
          )}
          {!r.stay && r.arrival && can('reservations') && (
            <div className="card" style={{ background: 'var(--surface-2)', boxShadow: 'none' }}>
              <div className="row between"><div><b>Llega hoy: {r.arrival.guest}</b><div className="muted">{r.arrival.code}</div></div>
                <Link className="btn sm primary" to={`/reservas/${r.arrival.id}/checkin`}>Check-in</Link></div>
            </div>
          )}

          <div className="row">
            {can('housekeeping') && r.housekeeping !== 'clean' && <button className="btn" disabled={busy} onClick={() => hk('clean')}><Sparkles /> Marcar limpia</button>}
            {can('housekeeping') && r.housekeeping === 'clean' && <button className="btn" disabled={busy} onClick={() => hk('dirty')}>Marcar sucia</button>}
            {r.out_of_service
              ? <button className="btn" disabled={busy} onClick={() => run(() => api.post(`/rooms/${id}/maintenance`, { out_of_service: false }), 'Habitación habilitada').then(refresh)}>Quitar mantenimiento</button>
              : <button className="btn" onClick={() => setMaint('')}><Wrench /> Mantenimiento</button>}
            {can('rooms.manage') && <button className="btn" onClick={() => setBlock({ start_date: todayStr(), end_date: addDays(todayStr(), 1), reason: '' })}>Bloquear fechas</button>}
            {can('rooms.manage') && <button className="btn ghost" onClick={() => { onEdit(r); }}><Pencil /> Editar</button>}
            {!r.stay && can('reservations') && <Link className="btn primary" to={`/reservas?nueva=1&room=${r.id}`}><Plus /> Reservar</Link>}
          </div>

          <div>
            {can('reservations') && <h3 className="mb">Próximas reservas</h3>}
            {!can('reservations') ? null : r.upcoming.length === 0 ? <Empty>Sin reservas próximas</Empty> : (
              <div className="list">{r.upcoming.map((u) => (
                <Link key={u.id} to={'/reservas/' + u.id} className="list-item click" style={{ color: 'inherit' }}>
                  <div className="grow"><b>{u.guest}</b><div className="muted" style={{ fontSize: 13 }}>{fdate(u.check_in)} → {fdate(u.check_out)}</div></div><ResStatus status={u.status} />
                </Link>
              ))}</div>
            )}
          </div>
          {r.blocks.length > 0 && (
            <div>
              <h3 className="mb">Bloqueos</h3>
              {r.blocks.map((b) => (
                <div key={b.id} className="list-item"><span className="grow">{fdate(b.start_date)} → {fdate(b.end_date)} · {b.reason}</span>
                  {can('rooms.manage') && <button className="btn sm ghost" onClick={() => run(() => api.del('/rooms/blocks/' + b.id), 'Bloqueo eliminado').then(refresh)}><Trash2 /></button>}</div>
              ))}
            </div>
          )}

          {maint !== null && (
            <Modal title="Poner en mantenimiento" onClose={() => setMaint(null)} footer={<>
              <button className="btn" onClick={() => setMaint(null)}>Cancelar</button>
              <button className="btn primary" disabled={busy} onClick={() => run(() => api.post(`/rooms/${id}/maintenance`, { out_of_service: true, reason: maint }), 'Habitación en mantenimiento').then((ok) => { if (ok) { setMaint(null); refresh(); } })}>Guardar</button>
            </>}>
              <Textarea label="Motivo" value={maint} onChange={setMaint} placeholder="Ej: daño en la ducha" autoFocus />
            </Modal>
          )}
          {block && (
            <Modal title="Bloquear fechas" onClose={() => setBlock(null)} footer={<>
              <button className="btn" onClick={() => setBlock(null)}>Cancelar</button>
              <button className="btn primary" disabled={busy} onClick={() => run(() => api.post(`/rooms/${id}/blocks`, block), 'Fechas bloqueadas').then((ok) => { if (ok) { setBlock(null); refresh(); } })}>Bloquear</button>
            </>}>
              <div className="grid g2">
                <Input label="Desde" type="date" value={block.start_date} onChange={(v) => setBlock({ ...block, start_date: v })} />
                <Input label="Hasta (libre desde)" type="date" value={block.end_date} onChange={(v) => setBlock({ ...block, end_date: v })} />
              </div>
              <div className="mt"><Input label="Motivo" value={block.reason} onChange={(v) => setBlock({ ...block, reason: v })} /></div>
            </Modal>
          )}
        </div>
      )}</Loader>
    </Modal>
  );
}

function AmenityPicker({ value, onChange }) {
  const [custom, setCustom] = useState('');
  const all = [...new Set([...AMENITIES, ...value])];
  const toggle = (a) => onChange(value.includes(a) ? value.filter((x) => x !== a) : [...value, a]);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="chips">{all.map((a) => <button type="button" key={a} className={'chip ' + (value.includes(a) ? 'on' : '')} onClick={() => toggle(a)}>{a}</button>)}</div>
      <div className="row"><input className="input grow" placeholder="Otra comodidad" value={custom} onChange={(e) => setCustom(e.target.value)} />
        <button type="button" className="btn" onClick={() => { if (custom.trim()) { onChange([...value, custom.trim()]); setCustom(''); } }}>Agregar</button></div>
    </div>
  );
}

function RoomForm({ room, types, onClose, onSaved }) {
  const [f, setF] = useState({ number: '', room_type_id: types[0]?.id, floor: '', capacity: '', price_override: '', amenities: [], description: '', online_bookable: 1, active: 1, ...room });
  const [run, busy] = useAction();
  const [photos, setPhotos] = useState(null);
  useEffect(() => { if (room.id) api.get('/rooms/' + room.id).then((r) => setPhotos(r.photo_list)); }, [room.id]);
  const set = (k) => (v) => setF({ ...f, [k]: v });
  async function save() {
    const body = { number: f.number, room_type_id: Number(f.room_type_id), floor: f.floor, capacity: f.capacity, price_override: f.price_override, amenities: f.amenities, description: f.description, online_bookable: f.online_bookable ? 1 : 0, active: f.active ? 1 : 0 };
    const ok = await run(() => (room.id ? api.put('/rooms/' + room.id, body) : api.post('/rooms', body)), 'Habitación guardada');
    if (ok) { onSaved(); onClose(); }
  }
  async function upload(files) {
    const fd = new FormData();
    [...files].forEach((x) => fd.append('files', x));
    if (await run(() => api.upload(`/rooms/${room.id}/photos`, fd), 'Fotos subidas')) setPhotos((await api.get('/rooms/' + room.id)).photo_list);
  }
  const type = types.find((t) => t.id === Number(f.room_type_id));
  return (
    <Modal title={room.id ? `Editar habitación ${room.number}` : 'Nueva habitación'} onClose={onClose} wide footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !f.number} onClick={save}>Guardar</button>
    </>}>
      <div className="stack">
        <div className="grid g3">
          <Input label="Número" value={f.number} onChange={set('number')} />
          <Select label="Tipo" value={f.room_type_id} onChange={set('room_type_id')} options={types.map((t) => [t.id, t.name])} />
          <Input label="Piso" value={f.floor} onChange={set('floor')} />
          <Input label="Capacidad" type="number" value={f.capacity} onChange={set('capacity')} placeholder={type ? `${type.capacity} (del tipo)` : ''} />
          <MoneyInput label="Precio por noche" value={f.price_override} onChange={set('price_override')} hint={type ? `Vacío = ${money(type.base_price)} del tipo` : ''} />
        </div>
        <Textarea label="Descripción" value={f.description} onChange={set('description')} />
        <div className="field"><span>Comodidades</span><AmenityPicker value={f.amenities || []} onChange={set('amenities')} /></div>
        <div className="row" style={{ gap: 20 }}>
          <Check label="Activa" checked={f.active} onChange={set('active')} />
          <Check label="Publicable en reservas en línea (futuro)" checked={f.online_bookable} onChange={set('online_bookable')} />
        </div>
        {room.id && (
          <div className="field"><span>Fotos</span>
            <div className="photos">
              {(photos || []).map((p) => (
                <div className="ph" key={p.id}><img src={p.path} alt="" />
                  <button className="btn sm icon-btn" onClick={() => run(() => api.del('/rooms/photos/' + p.id)).then(() => setPhotos(photos.filter((x) => x.id !== p.id)))}><Trash2 /></button></div>
              ))}
              <label className="ph" style={{ display: 'grid', placeItems: 'center', cursor: 'pointer', border: '1px dashed var(--border)' }}>
                <Upload className="muted" /><input type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} />
              </label>
            </div>
          </div>
        )}
        {!room.id && <small className="muted">Podrá agregar fotos después de guardar.</small>}
      </div>
    </Modal>
  );
}

function TypeForm({ type, onClose, onSaved }) {
  const [f, setF] = useState({ name: '', description: '', capacity: 2, base_price: '', amenities: [], active: 1, ...type });
  const [run, busy] = useAction();
  const set = (k) => (v) => setF({ ...f, [k]: v });
  async function save() {
    const body = { name: f.name, description: f.description, capacity: Number(f.capacity) || 1, base_price: Number(f.base_price) || 0, amenities: f.amenities, active: f.active ? 1 : 0 };
    if (await run(() => (type.id ? api.put('/room-types/' + type.id, body) : api.post('/room-types', body)), 'Tipo guardado')) { onSaved(); onClose(); }
  }
  return (
    <Modal title={type.id ? 'Editar tipo' : 'Nuevo tipo de habitación'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !f.name} onClick={save}>Guardar</button>
    </>}>
      <div className="stack">
        <Input label="Nombre" value={f.name} onChange={set('name')} />
        <div className="grid g2">
          <Input label="Capacidad" type="number" value={f.capacity} onChange={set('capacity')} />
          <MoneyInput label="Precio base por noche" value={f.base_price} onChange={set('base_price')} />
        </div>
        <Textarea label="Descripción" value={f.description} onChange={set('description')} />
        <div className="field"><span>Comodidades</span><AmenityPicker value={f.amenities || []} onChange={set('amenities')} /></div>
        <Check label="Activo" checked={f.active} onChange={set('active')} />
      </div>
    </Modal>
  );
}
