import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, Search, Upload, Trash2, FileText, ArrowLeft, Pencil } from 'lucide-react';
import { api, qs, openFile } from '../api.js';
import {
  useApp, useData, useAction, Loader, PageHead, Modal, Badge, Empty, ResStatus, Select, Confirm, money, fdate, fdatetime, countryName,
} from '../ui.jsx';
import GuestForm, { emptyGuest, guestValid } from '../components/GuestForm.jsx';

export default function Guests() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 250); return () => clearTimeout(t); }, [q]);
  const state = useData('/guests' + qs({ q: debounced }));
  const nav = useNavigate();
  const [create, setCreate] = useState(false);
  return (
    <>
      <PageHead title="Huéspedes"><button className="btn primary" onClick={() => setCreate(true)}><Plus /> Huésped</button></PageHead>
      <div className="mb" style={{ position: 'relative', maxWidth: 480 }}>
        <Search size={16} style={{ position: 'absolute', left: 12, top: 13 }} className="muted" />
        <input className="input" style={{ paddingLeft: 36 }} placeholder="Buscar por nombre, documento, teléfono o correo" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Loader state={state}>{(list) => list.length === 0 ? <div className="card"><Empty>No se encontraron huéspedes</Empty></div> : (
        <div className="card"><div className="table-wrap"><table className="table">
          <thead><tr><th>Nombre</th><th>Documento</th><th>Nacionalidad</th><th>Contacto</th><th className="num">Estadías</th><th>Última</th></tr></thead>
          <tbody>{list.map((g) => (
            <tr key={g.id} className="click" onClick={() => nav('/huespedes/' + g.id)}>
              <td><b>{g.first_name} {g.last_name} {g.second_last_name || ''}</b>{g.resides_abroad ? <> <Badge kind="info">Exterior</Badge></> : null}</td>
              <td>{g.doc_type} {g.doc_number}</td><td>{countryName(g.nationality)}</td>
              <td className="muted" style={{ fontSize: 13 }}>{g.phone}<br />{g.email}</td>
              <td className="num">{g.stays}</td><td>{fdate(g.last_stay)}</td>
            </tr>
          ))}</tbody>
        </table></div></div>
      )}</Loader>
      {create && <GuestEdit guest={emptyGuest()} onClose={() => setCreate(false)} onSaved={(id) => nav('/huespedes/' + id)} />}
    </>
  );
}

function GuestEdit({ guest, onClose, onSaved }) {
  const [g, setG] = useState(guest);
  const [run, busy] = useAction();
  return (
    <Modal title={guest.id ? 'Editar huésped' : 'Nuevo huésped'} onClose={onClose} wide footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn primary" disabled={busy || !guestValid(g)} onClick={async () => {
        const r = await run(() => (guest.id ? api.put('/guests/' + guest.id, g) : api.post('/guests', g)), 'Huésped guardado');
        if (r) { onSaved(guest.id || r.id); onClose(); }
      }}>Guardar</button>
    </>}>
      <GuestForm value={g} onChange={setG} mode="full" />
    </Modal>
  );
}

export function GuestDetail() {
  const { id } = useParams();
  const state = useData('/guests/' + id);
  const nav = useNavigate();
  const { settings } = useApp();
  const [run, busy] = useAction();
  const [edit, setEdit] = useState(false);
  const [kind, setKind] = useState('pasaporte');
  const [del, setDel] = useState(null);

  async function upload(file) {
    const fd = new FormData(); fd.append('file', file); fd.append('kind', kind);
    if (await run(() => api.upload(`/guests/${id}/documents`, fd), 'Documento cargado')) state.reload();
  }
  return (
    <Loader state={state}>{(g) => (
      <>
        <PageHead title={`${g.first_name} ${g.last_name} ${g.second_last_name || ''}`} sub={`${g.doc_type} ${g.doc_number} · ${countryName(g.nationality)}`}>
          <button className="btn ghost" onClick={() => nav(-1)}><ArrowLeft /> Volver</button>
          <button className="btn" onClick={() => setEdit(true)}><Pencil /> Editar</button>
        </PageHead>
        <div className="grid g2" style={{ alignItems: 'start' }}>
          <div className="stack" style={{ gap: 14 }}>
            <div className="card">
              <h2 className="mb">Datos</h2>
              <div className="grid g2" style={{ fontSize: 14, gap: 10 }}>
                <div><small className="muted">Teléfono</small><div>{g.phone || '—'}</div></div>
                <div><small className="muted">Correo</small><div>{g.email || '—'}</div></div>
                <div><small className="muted">Nacimiento</small><div>{fdate(g.birth_date)}</div></div>
                <div><small className="muted">Residencia</small><div>{[g.residence_city, countryName(g.residence_country)].filter(Boolean).join(', ')} {g.resides_abroad ? <Badge kind="info">Exterior</Badge> : null}</div></div>
                <div><small className="muted">Dirección</small><div>{g.address || '—'}</div></div>
                <div><small className="muted">Ocupación</small><div>{g.occupation || '—'}</div></div>
              </div>
              {g.notes && <div className="alert info mt">{g.notes}</div>}
            </div>
            <div className="card">
              <div className="card-head"><h2>Documentos de soporte</h2></div>
              <small className="muted">Pasaporte, sello o permiso de ingreso (soporte de exención de IVA para no residentes) y otros.</small>
              <div className="row mt">
                <Select value={kind} onChange={setKind} options={[['pasaporte', 'Pasaporte'], ['sello_migratorio', 'Sello / permiso de ingreso'], ['documento_identidad', 'Documento de identidad'], ['otro', 'Otro']]} style={{ width: 'auto' }} />
                <label className="btn"><Upload /> Cargar<input hidden type="file" accept="image/*,application/pdf" disabled={busy} onChange={(e) => e.target.files[0] && upload(e.target.files[0])} /></label>
              </div>
              <div className="list mt">{g.documents.map((d) => (
                <div key={d.id} className="list-item">
                  <FileText size={18} className="muted" />
                  <div className="grow"><b>{d.kind.replace('_', ' ')}</b><div className="muted" style={{ fontSize: 12.5 }}>{d.original_name} · {fdatetime(d.created_at)} · {d.uploaded_by_name}</div></div>
                  <button className="btn sm" onClick={() => openFile('/files/' + d.path)}>Ver</button>
                  <button className="btn sm ghost" onClick={() => setDel(d)}><Trash2 /></button>
                </div>
              ))}</div>
            </div>
            {g.vehicles.length > 0 && <div className="card"><h2 className="mb">Vehículos</h2>{g.vehicles.map((v) => <div key={v.plate} className="list-item"><b>{v.plate}</b><span className="muted">{v.brand} {v.color}</span></div>)}</div>}
          </div>
          <div className="stack" style={{ gap: 14 }}>
            <div className="card">
              <h2 className="mb">Historial de estadías</h2>
              {g.history.length === 0 ? <Empty>Sin estadías</Empty> : (
                <div className="list">{g.history.map((h) => (
                  <Link key={h.id} to={'/reservas/' + h.id} className="list-item click" style={{ color: 'inherit' }}>
                    <div className="grow"><b>{fdate(h.check_in)} → {fdate(h.check_out)}</b><div className="muted" style={{ fontSize: 12.5 }}>Hab. {h.rooms} · {h.code}{!h.is_holder ? ' · como acompañante' : ''}</div></div>
                    <div className="right"><ResStatus status={h.status} /><div className="muted mono" style={{ fontSize: 12.5 }}>{money(h.total)}</div></div>
                  </Link>
                ))}</div>
              )}
            </div>
            {g.feedback.length > 0 && <div className="card"><h2 className="mb">Comentarios y reclamos</h2>{g.feedback.map((f) => <div key={f.id} className="list-item"><span className="grow">{f.subject}</span><Badge>{f.status}</Badge></div>)}</div>}
          </div>
        </div>
        {edit && <GuestEdit guest={Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v ?? '']))} onClose={() => setEdit(false)} onSaved={state.reload} />}
        {del && <Confirm title="Eliminar documento" danger confirmText="Eliminar" message={`¿Eliminar ${del.original_name}?`} onConfirm={() => api.del('/guests/documents/' + del.id).then(state.reload)} onClose={() => setDel(null)} />}
      </>
    )}</Loader>
  );
}
