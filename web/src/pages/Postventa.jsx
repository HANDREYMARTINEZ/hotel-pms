import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, MessageCircle, Mail } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useData, useAction, Loader, PageHead, Modal, Input, Select, Textarea, Tabs, Badge, Empty, Stars, fdate, fdatetime } from '../ui.jsx';

const KIND = { complaint: ['Reclamo', 'danger'], comment: ['Comentario', ''], suggestion: ['Sugerencia', 'info'], compliment: ['Felicitación', 'ok'] };
const STATUS = { open: ['Abierto', 'warn'], in_progress: ['En gestión', 'info'], resolved: ['Resuelto', 'ok'], closed: ['Cerrado', ''] };
const ASPECTS = { cleanliness: 'Limpieza', service: 'Atención', comfort: 'Comodidad', value: 'Precio/calidad', location: 'Ubicación' };

export default function Postventa() {
  const [tab, setTab] = useState('feedback');
  return (
    <>
      <PageHead title="Postventa" sub="Encuestas de satisfacción, comentarios y reclamos" />
      <Tabs tabs={[['feedback', 'Comentarios y reclamos'], ['surveys', 'Encuestas']]} value={tab} onChange={setTab} />
      {tab === 'feedback' ? <Feedback /> : <Surveys />}
    </>
  );
}

function Feedback() {
  const state = useData('/feedback');
  const [run, busy] = useAction();
  const [open, setOpen] = useState(null);
  const [create, setCreate] = useState(null);
  const [filter, setFilter] = useState('active');
  return (
    <>
      <div className="row mb between">
        <div className="chips">
          {[['active', 'Pendientes'], ['all', 'Todos']].map(([k, l]) => <button key={k} className={'chip ' + (filter === k ? 'on' : '')} onClick={() => setFilter(k)}>{l}</button>)}
        </div>
        <button className="btn primary" onClick={() => setCreate({ kind: 'complaint', subject: '', description: '' })}><Plus /> Registrar</button>
      </div>
      <Loader state={state}>{(list) => {
        const shown = filter === 'active' ? list.filter((f) => ['open', 'in_progress'].includes(f.status)) : list;
        return shown.length === 0 ? <div className="card"><Empty>No hay casos pendientes</Empty></div> : (
          <div className="card"><div className="list">{shown.map((f) => (
            <div key={f.id} className="list-item click" onClick={() => setOpen(f)}>
              <div className="grow"><div className="row" style={{ gap: 6 }}><Badge kind={KIND[f.kind][1]}>{KIND[f.kind][0]}</Badge><b>{f.subject}</b></div>
                <div className="muted" style={{ fontSize: 13 }}>{f.guest || 'Sin huésped'}{f.code ? ` · ${f.code}` : ''} · {fdatetime(f.created_at)} · {f.updates.length} seguimiento(s)</div></div>
              <Badge kind={STATUS[f.status][1]}>{STATUS[f.status][0]}</Badge>
            </div>
          ))}</div></div>
        );
      }}</Loader>
      {open && <FeedbackDetail f={state.data.find((x) => x.id === open.id) || open} onClose={() => setOpen(null)} onSaved={state.reload} />}
      {create && (
        <Modal title="Registrar comentario o reclamo" onClose={() => setCreate(null)} footer={<>
          <button className="btn" onClick={() => setCreate(null)}>Cancelar</button>
          <button className="btn primary" disabled={busy || !create.subject} onClick={() => run(() => api.post('/feedback', create), 'Registrado').then((ok) => { if (ok) { setCreate(null); state.reload(); } })}>Guardar</button>
        </>}>
          <div className="stack">
            <Select label="Tipo" value={create.kind} onChange={(v) => setCreate({ ...create, kind: v })} options={Object.entries(KIND).map(([k, [l]]) => [k, l])} />
            <Input label="Asunto" value={create.subject} onChange={(v) => setCreate({ ...create, subject: v })} />
            <Textarea label="Detalle" value={create.description} onChange={(v) => setCreate({ ...create, description: v })} />
            <small className="muted">Para asociarlo a un huésped, regístrelo desde la reserva.</small>
          </div>
        </Modal>
      )}
    </>
  );
}

function FeedbackDetail({ f, onClose, onSaved }) {
  const [run, busy] = useAction();
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('');
  return (
    <Modal title={f.subject} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cerrar</button>
      <button className="btn primary" disabled={busy || !note} onClick={async () => {
        if (await run(() => api.post(`/feedback/${f.id}/updates`, { note, status: status || undefined }), 'Seguimiento registrado')) { setNote(''); setStatus(''); onSaved(); }
      }}>Agregar seguimiento</button>
    </>}>
      <div className="stack">
        <div className="row"><Badge kind={KIND[f.kind][1]}>{KIND[f.kind][0]}</Badge><Badge kind={STATUS[f.status][1]}>{STATUS[f.status][0]}</Badge>
          {f.reservation_id && <Link to={'/reservas/' + f.reservation_id}>{f.guest} · {f.code}</Link>}</div>
        {f.description && <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{f.description}</p>}
        <small className="muted">Registrado {f.created_by_name ? `por ${f.created_by_name}` : 'desde encuesta'} · {fdatetime(f.created_at)}</small>
        <hr style={{ margin: 0 }} />
        {f.updates.map((u) => (
          <div key={u.id} style={{ fontSize: 14 }}><b>{u.user_name}</b> <span className="muted">· {fdatetime(u.created_at)}{u.status ? ` · → ${STATUS[u.status][0]}` : ''}</span><div style={{ whiteSpace: 'pre-wrap' }}>{u.note}</div></div>
        ))}
        <Textarea label="Nueva nota de seguimiento" value={note} onChange={setNote} placeholder="Acción tomada, contacto con el huésped…" />
        <Select label="Cambiar estado" value={status} onChange={setStatus} placeholder="Sin cambio" options={Object.entries(STATUS).map(([k, [l]]) => [k, l])} />
      </div>
    </Modal>
  );
}

function Surveys() {
  const state = useData('/surveys');
  const { settings } = useApp();
  const [run] = useAction();
  return (
    <Loader state={state}>{({ surveys, stats }) => (
      <>
        <div className="grid g3 mb">
          <div className="card stat"><span className="label">Promedio</span><span className="value">{stats.average ?? '—'}<small style={{ fontSize: 15 }}> / 5</small></span></div>
          <div className="card stat"><span className="label">Respondidas</span><span className="value">{stats.completed}</span></div>
          <div className="card stat"><span className="label">Enviadas</span><span className="value">{stats.sent}</span><span className="sub">{surveys.length} generadas</span></div>
        </div>
        {surveys.length === 0 ? <div className="card"><Empty>Las encuestas se generan al hacer check-out</Empty></div> : (
          <div className="card"><div className="list">{surveys.map((s) => {
            const link = `${window.location.origin}/encuesta/${s.token}`;
            const msg = (settings.survey.message || '').replace('{nombre}', s.guest.split(' ')[0]).replace('{hotel}', settings.hotel.name).replace('{enlace}', link);
            const phone = (s.phone || '').replace(/\D/g, '');
            const mark = (channel) => run(() => api.post(`/surveys/${s.id}/sent`, { channel })).then(state.reload);
            return (
              <div key={s.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                <div className="grow">
                  <Link to={'/reservas/' + s.reservation_id}><b>{s.guest}</b></Link> <span className="muted" style={{ fontSize: 13 }}>· salió {fdate(s.check_out)}</span>
                  {s.completed_at ? (
                    <div className="stack" style={{ gap: 4, marginTop: 4 }}>
                      <Stars size="sm" value={s.overall} />
                      {Object.keys(s.ratings).length > 0 && <small className="muted">{Object.entries(s.ratings).map(([k, v]) => `${ASPECTS[k]} ${v}`).join(' · ')}</small>}
                      {s.comment && <div style={{ fontSize: 14 }}>“{s.comment}”</div>}
                    </div>
                  ) : <div className="muted" style={{ fontSize: 13 }}>{s.sent_at ? `Enviada por ${s.sent_channel} · ${fdatetime(s.sent_at)}` : 'Sin enviar'}</div>}
                </div>
                {!s.completed_at && (
                  <div className="row" style={{ gap: 4 }}>
                    {phone && <a className="btn sm" target="_blank" rel="noreferrer" href={`https://wa.me/${phone.length === 10 ? '57' + phone : phone}?text=${encodeURIComponent(msg)}`} onClick={() => mark('whatsapp')}><MessageCircle /></a>}
                    {s.email && <a className="btn sm" href={`mailto:${s.email}?subject=${encodeURIComponent('Encuesta - ' + settings.hotel.name)}&body=${encodeURIComponent(msg)}`} onClick={() => mark('email')}><Mail /></a>}
                  </div>
                )}
              </div>
            );
          })}</div></div>
        )}
      </>
    )}</Loader>
  );
}
