// Vista de limpieza pensada para el celular: tarjetas grandes con acciones directas.
import { useState } from 'react';
import { Sparkles, Play, Wrench, RefreshCw, Plus, LogOut, LogIn, User } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useData, useAction, Loader, PageHead, Modal, Select, Textarea, Badge, Empty, Tabs, HK, ROOM_STATUS, fdatetime } from '../ui.jsx';

const KIND = { checkout: 'Salida', daily: 'Diaria', deep: 'Profunda', maintenance: 'Mantenimiento' };
const hkStatus = (r) => (r.out_of_service ? 'maintenance' : r.housekeeping === 'clean' ? 'available' : 'cleaning');

export default function Housekeeping() {
  const state = useData('/housekeeping');
  const { can } = useApp();
  const [run, busy] = useAction();
  const [filter, setFilter] = useState('pending');
  const [maint, setMaint] = useState(null);
  const [task, setTask] = useState(null);

  const setHk = (room, housekeeping) => run(() => api.post(`/rooms/${room.id}/housekeeping`, { housekeeping }), housekeeping === 'clean' ? `Habitación ${room.number} lista ✨` : 'Actualizado').then(state.reload);

  return (
    <>
      <PageHead title="Limpieza">
        <button className="btn icon-btn" onClick={state.reload} aria-label="Actualizar"><RefreshCw /></button>
        {can('housekeeping') && <button className="btn" onClick={() => setTask({ room_id: '', kind: 'daily', notes: '' })}><Plus /> Tarea</button>}
      </PageHead>
      <Loader state={state}>{(d) => {
        const pending = d.rooms.filter((r) => r.housekeeping !== 'clean' || r.out_of_service);
        const rooms = filter === 'pending' ? pending : d.rooms;
        const tasksFor = (id) => d.tasks.filter((t) => t.room_id === id && t.status !== 'done');
        return (
          <>
            <Tabs tabs={[['pending', `Por hacer (${pending.length})`], ['all', 'Todas']]} value={filter} onChange={setFilter} />
            {rooms.length === 0 && <div className="card"><Empty>¡Todo limpio! No hay habitaciones pendientes ✨</Empty></div>}
            <div className="hk-grid">
              {rooms.map((r) => (
                <div key={r.id} className={'card hk-card st-' + hkStatus(r)}>
                  <div className="top">
                    <span className="num">{r.number}</span>
                    <Badge kind={r.out_of_service ? '' : r.housekeeping === 'clean' ? 'ok' : r.housekeeping === 'in_progress' ? 'info' : 'warn'}>
                      {r.out_of_service ? 'Mantenimiento' : HK[r.housekeeping]}
                    </Badge>
                  </div>
                  <div className="row" style={{ fontSize: 13, gap: 10 }}>
                    <span className="muted">{r.type_name}</span>
                    {r.occupied && <span className="row" style={{ gap: 4 }}><User size={14} /> Ocupada</span>}
                    {r.departs_today && <span className="row" style={{ gap: 4, color: 'var(--warn)' }}><LogOut size={14} /> Sale hoy</span>}
                    {r.arrival_today && <span className="row" style={{ gap: 4, color: 'var(--st-reserved)' }}><LogIn size={14} /> Llega hoy</span>}
                  </div>
                  {!!r.out_of_service && <small className="muted">{r.out_of_service_reason}</small>}
                  {tasksFor(r.id).map((t) => <small key={t.id} className="muted">• {KIND[t.kind]}{t.notes ? `: ${t.notes}` : ''}{t.assigned_name ? ` (${t.assigned_name})` : ''}</small>)}
                  {!r.out_of_service && (
                    <div className="hk-actions">
                      {r.housekeeping === 'dirty' && <button className="btn" disabled={busy} onClick={() => setHk(r, 'in_progress')}><Play /> Empezar</button>}
                      {r.housekeeping !== 'clean' && <button className="btn primary" disabled={busy} onClick={() => setHk(r, 'clean')} style={{ gridColumn: r.housekeeping === 'dirty' ? 'auto' : '1 / -1' }}><Sparkles /> Lista</button>}
                      {r.housekeeping === 'clean' && <button className="btn" disabled={busy} onClick={() => setHk(r, 'dirty')}>Marcar sucia</button>}
                      <button className="btn ghost" onClick={() => setMaint(r)} style={{ gridColumn: r.housekeeping === 'clean' ? 'auto' : '1 / -1' }}><Wrench /> Reportar daño</button>
                    </div>
                  )}
                  {!!r.out_of_service && can('rooms.manage') && <button className="btn" disabled={busy} onClick={() => run(() => api.post(`/rooms/${r.id}/maintenance`, { out_of_service: false }), 'Habitación habilitada').then(state.reload)}>Habilitar</button>}
                </div>
              ))}
            </div>
            {d.tasks.some((t) => t.status === 'done') && (
              <div className="card mt">
                <h3 className="mb">Terminadas hoy</h3>
                {d.tasks.filter((t) => t.status === 'done').map((t) => <div key={t.id} className="list-item"><b>{t.number}</b><span className="grow muted">{KIND[t.kind]}</span><small className="muted">{t.completed_by_name} · {fdatetime(t.completed_at)}</small></div>)}
              </div>
            )}
            {task && (
              <Modal title="Nueva tarea" onClose={() => setTask(null)} footer={<>
                <button className="btn" onClick={() => setTask(null)}>Cancelar</button>
                <button className="btn primary" disabled={busy || !task.room_id} onClick={() => run(() => api.post('/housekeeping/tasks', { ...task, room_id: Number(task.room_id) }), 'Tarea creada').then((ok) => { if (ok) { setTask(null); state.reload(); } })}>Crear</button>
              </>}>
                <div className="stack">
                  <Select label="Habitación" value={task.room_id} onChange={(v) => setTask({ ...task, room_id: v })} placeholder="Seleccione…" options={d.rooms.map((r) => [r.id, r.number])} />
                  <Select label="Tipo" value={task.kind} onChange={(v) => setTask({ ...task, kind: v })} options={[['daily', 'Limpieza diaria'], ['deep', 'Limpieza profunda'], ['checkout', 'Limpieza de salida']]} />
                  <Textarea label="Notas" value={task.notes} onChange={(v) => setTask({ ...task, notes: v })} />
                </div>
              </Modal>
            )}
          </>
        );
      }}</Loader>
      {maint && <MaintModal room={maint} onClose={() => setMaint(null)} onSaved={state.reload} />}
    </>
  );
}

function MaintModal({ room, onClose, onSaved }) {
  const [reason, setReason] = useState('');
  const [run, busy] = useAction();
  return (
    <Modal title={`Reportar daño · ${room.number}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn primary" disabled={busy || !reason} onClick={async () => { if (await run(() => api.post(`/rooms/${room.id}/maintenance`, { out_of_service: true, reason }), 'Reporte enviado')) { onSaved(); onClose(); } }}>Enviar</button>
    </>}>
      <Textarea label="¿Qué pasó?" value={reason} onChange={setReason} placeholder="Ej: no funciona el aire acondicionado" autoFocus />
      <small className="muted">La habitación quedará fuera de servicio hasta que se habilite.</small>
    </Modal>
  );
}
