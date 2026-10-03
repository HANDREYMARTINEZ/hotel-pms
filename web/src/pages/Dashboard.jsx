import { Link, useNavigate } from 'react-router-dom';
import { Plus, LogIn, LogOut, AlertTriangle, Info, Sparkles } from 'lucide-react';
import { useApp, useData, Loader, PageHead, money, fdate, ROOM_STATUS, HK, Empty, paymentMethodName, todayStr } from '../ui.jsx';

export default function Dashboard() {
  const state = useData('/dashboard');
  const { settings, user } = useApp();
  const nav = useNavigate();
  const hour = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota', hour: 'numeric', hour12: false }));
  const greet = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';

  return (
    <>
      <PageHead title={`${greet}, ${user.name.split(' ')[0]}`} sub={fdate(todayStr(), true)}>
        <Link className="btn primary" to="/reservas?nueva=1"><Plus /> Nueva reserva</Link>
      </PageHead>
      <Loader state={state}>{(d) => (
        <div className="stack" style={{ gap: 14 }}>
          {d.alerts.length > 0 && (
            <div className="stack" style={{ gap: 8 }}>
              {d.alerts.map((a, i) => (
                <Link key={i} to={a.link} className={'alert ' + (a.level === 'warn' ? 'warn' : 'info')}>
                  {a.level === 'warn' ? <AlertTriangle /> : <Info />}<div>{a.text}</div>
                </Link>
              ))}
            </div>
          )}

          <div className="grid g4">
            <div className="card stat"><span className="label">Ocupación hoy</span><span className="value">{d.occupancy}%</span><span className="sub">{d.rooms.occupied} de {d.rooms.total - d.rooms.maintenance} hab. · {d.guests_in_house} huésp.</span></div>
            <div className="card stat"><span className="label">Llegadas</span><span className="value">{d.arrivals.length}</span><span className="sub">{d.arrivals.filter((a) => a.status === 'checked_in').length} ya ingresaron</span></div>
            <div className="card stat"><span className="label">Salidas</span><span className="value">{d.departures.length}</span><span className="sub">{d.departures.filter((a) => a.status === 'checked_out').length} ya salieron</span></div>
            <div className="card stat"><span className="label">Ingresos del día</span><span className="value">{money(d.income)}</span>
              <span className="sub">{d.income_by_method.map((m) => `${paymentMethodName(settings, m.method)} ${money(m.total)}`).join(' · ') || 'Sin pagos aún'}</span></div>
          </div>

          <div className="grid g2">
            <div className="card">
              <div className="card-head"><h2><LogIn size={17} style={{ verticalAlign: -3 }} /> Llegadas de hoy</h2></div>
              {d.arrivals.length === 0 ? <Empty>No hay llegadas programadas</Empty> : (
                <div className="list">{d.arrivals.map((r) => (
                  <div key={r.id} className="list-item click" onClick={() => nav('/reservas/' + r.id)}>
                    <div className="grow"><b>{r.guest}</b><div className="muted" style={{ fontSize: 13 }}>Hab. {r.rooms} · hasta {fdate(r.check_out)} · {r.adults + r.children} pers.</div></div>
                    {r.status === 'checked_in' ? <span className="badge ok">Ingresó</span>
                      : <Link className="btn sm primary" to={`/reservas/${r.id}/checkin`} onClick={(e) => e.stopPropagation()}>Check-in</Link>}
                  </div>
                ))}</div>
              )}
            </div>
            <div className="card">
              <div className="card-head"><h2><LogOut size={17} style={{ verticalAlign: -3 }} /> Salidas de hoy</h2></div>
              {d.departures.length === 0 ? <Empty>No hay salidas pendientes</Empty> : (
                <div className="list">{d.departures.map((r) => (
                  <div key={r.id} className="list-item click" onClick={() => nav('/reservas/' + r.id)}>
                    <div className="grow"><b>{r.guest}</b><div className="muted" style={{ fontSize: 13 }}>Hab. {r.rooms}{r.check_out < d.today ? ` · debía salir ${fdate(r.check_out)}` : ''}</div></div>
                    {r.status === 'checked_out' ? <span className="badge">Salió</span>
                      : <Link className="btn sm" to={`/reservas/${r.id}/checkout`} onClick={(e) => e.stopPropagation()}>Check-out</Link>}
                  </div>
                ))}</div>
              )}
            </div>
          </div>

          <div className="grid g2">
            <div className="card">
              <div className="card-head"><h2>Habitaciones</h2><Link to="/habitaciones" className="btn sm ghost">Ver todas</Link></div>
              <div className="rooms-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 8 }}>
                {d.board.map((r) => (
                  <div key={r.id} className={'room-tile st-' + r.status} style={{ minHeight: 64, padding: 10 }} onClick={() => nav('/habitaciones?id=' + r.id)} title={r.guest || ''}>
                    <span className="num" style={{ fontSize: 18 }}>{r.number}</span>
                    <span className="st">{ROOM_STATUS[r.status]}</span>
                  </div>
                ))}
              </div>
              <div className="legend mt">
                {Object.entries(ROOM_STATUS).map(([k, l]) => <span key={k} className={'st-' + k}><i />{l} {d.rooms[k === 'cleaning' ? 'cleaning' : k]}</span>)}
              </div>
            </div>
            <div className="card">
              <div className="card-head"><h2><Sparkles size={17} style={{ verticalAlign: -3 }} /> Por limpiar</h2><Link to="/limpieza" className="btn sm ghost">Abrir limpieza</Link></div>
              {d.to_clean.length === 0 ? <Empty>Todas las habitaciones están limpias ✨</Empty> : (
                <div className="list">{d.to_clean.map((r) => (
                  <div key={r.id} className="list-item"><b style={{ width: 48 }}>{r.number}</b><span className="grow muted">{HK[r.housekeeping]}{r.occupied ? ' · ocupada' : ''}</span></div>
                ))}</div>
              )}
            </div>
          </div>
        </div>
      )}</Loader>
    </>
  );
}
