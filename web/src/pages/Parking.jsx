import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Car } from 'lucide-react';
import { api, qs } from '../api.js';
import { useData, Loader, PageHead, Empty, ResStatus, fdate, VEHICLE_TYPES } from '../ui.jsx';

export default function Parking() {
  const state = useData('/parking');
  const [plate, setPlate] = useState('');
  const [results, setResults] = useState(null);
  async function search(e) {
    e.preventDefault();
    if (plate.trim()) setResults(await api.get('/parking/search' + qs({ plate })));
  }
  return (
    <>
      <PageHead title="Parqueadero" />
      <Loader state={state}>{(d) => (
        <div className="stack" style={{ gap: 14 }}>
          <div className="rooms-grid">
            {d.spaces.map((s) => (
              <div key={s.id} className={'room-tile ' + (s.vehicle ? 'st-occupied' : 'st-available')} style={{ cursor: 'default' }}>
                <div className="row between"><span className="num">{s.code}</span><span className="muted" style={{ fontSize: 12 }}>{VEHICLE_TYPES[s.kind]}</span></div>
                {s.vehicle ? <>
                  <span className="st">{s.vehicle.plate}</span>
                  <Link to={'/reservas/' + s.vehicle.reservation_id} className="who">Hab. {s.vehicle.rooms} · {s.vehicle.guest}</Link>
                </> : <span className="st">Libre</span>}
              </div>
            ))}
          </div>
          {d.spaces.length === 0 && <Empty>No hay espacios configurados. Agréguelos en Configuración → Parqueadero.</Empty>}
          <div className="card">
            <h2 className="mb"><Car size={17} style={{ verticalAlign: -3 }} /> Vehículos en el hotel</h2>
            {d.vehicles.length === 0 ? <Empty>No hay vehículos registrados de huéspedes en casa</Empty> : (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Placa</th><th>Vehículo</th><th>Huésped</th><th>Hab.</th><th>Espacio</th><th>Sale</th></tr></thead>
                <tbody>{d.vehicles.map((v) => (
                  <tr key={v.id}><td><b>{v.plate}</b></td><td>{VEHICLE_TYPES[v.kind]} {v.brand} {v.color}</td>
                    <td><Link to={'/reservas/' + v.reservation_id}>{v.guest}</Link></td><td>{v.rooms}</td>
                    <td>{d.spaces.find((s) => s.id === v.parking_space_id)?.code || '—'}</td><td>{fdate(v.check_out)}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </div>
          <div className="card">
            <h2 className="mb">Buscar por placa</h2>
            <form className="row" onSubmit={search}>
              <input className="input" style={{ maxWidth: 220 }} placeholder="ABC123" value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} />
              <button className="btn"><Search /> Buscar</button>
            </form>
            {results && (results.length === 0 ? <Empty>Sin resultados</Empty> : (
              <div className="list mt">{results.map((v) => (
                <Link key={v.id} to={'/reservas/' + v.reservation_id} className="list-item click" style={{ color: 'inherit' }}>
                  <b>{v.plate}</b><span className="grow">{v.guest}</span><span className="muted">{fdate(v.check_in)} → {fdate(v.check_out)}</span><ResStatus status={v.status} />
                </Link>
              ))}</div>
            ))}
          </div>
        </div>
      )}</Loader>
    </>
  );
}
