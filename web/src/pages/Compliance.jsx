// Reportes legales: TRA (MinCIT) y SIRE (Migración Colombia).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileSpreadsheet, FileDown, CheckCheck } from 'lucide-react';
import { api, openFile, qs } from '../api.js';
import { useApp, useData, useAction, Loader, PageHead, Input, Tabs, Badge, Empty, Alert, fdate, fdatetime, countryName, money } from '../ui.jsx';

export default function Compliance() {
  const [tab, setTab] = useState('sire');
  const [range, setRange] = useState(() => {
    const t = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    return { from: t.slice(0, 8) + '01', to: t };
  });
  return (
    <>
      <PageHead title="TRA y SIRE" sub="Reportes obligatorios de alojamiento" />
      <Tabs tabs={[['sire', 'SIRE · Migración Colombia'], ['tra', 'TRA · Registro hotelero']]} value={tab} onChange={setTab} />
      <div className="row mb">
        <Input type="date" value={range.from} onChange={(v) => setRange({ ...range, from: v })} style={{ width: 165 }} />
        <Input type="date" value={range.to} onChange={(v) => setRange({ ...range, to: v })} style={{ width: 165 }} />
      </div>
      {tab === 'sire' ? <Sire range={range} /> : <Tra range={range} />}
    </>
  );
}

function Sire({ range }) {
  const { settings } = useApp();
  const state = useData('/compliance/sire' + qs(range));
  const [run, busy] = useAction();
  const configured = settings.compliance.sire_establishment_code;
  return (
    <div className="stack" style={{ gap: 14 }}>
      <Alert kind="info">
        Se deben reportar a Migración Colombia la entrada (E) y salida (S) de todos los huéspedes extranjeros, incluidos acompañantes, dentro del plazo
        legal. Descargue el archivo plano y cárguelo en el portal SIRE, o regístrelos allí manualmente. Después marque los movimientos como reportados.
      </Alert>
      {!configured && <Alert kind="warn">Configure el código de establecimiento y los códigos SIRE de documentos y países en Configuración → Cumplimiento.</Alert>}
      <Loader state={state}>{(rows) => {
        const pending = rows.filter((r) => !r.reported_at);
        return (
          <div className="card">
            <div className="card-head">
              <h2>{rows.length} movimiento(s) · {pending.length} sin reportar</h2>
              <div className="row">
                <button className="btn sm" disabled={busy || !pending.length} onClick={() => run(() => openFile('/compliance/sire.txt' + qs({ ...range, pending: 1 })))}><FileDown /> Archivo SIRE (pendientes)</button>
                <button className="btn sm primary" disabled={busy || !pending.length} onClick={() => run(() => api.post('/compliance/sire/mark', { items: pending.map((r) => ({ reservation_id: r.reservation_id, type: r.type })) }), 'Marcados como reportados').then(state.reload)}><CheckCheck /> Marcar reportados</button>
              </div>
            </div>
            {rows.length === 0 ? <Empty>No hay movimientos de extranjeros en el periodo</Empty> : (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Mov.</th><th>Fecha</th><th>Huésped</th><th>Documento</th><th>Nacionalidad</th><th>Nacimiento</th><th>Estado</th></tr></thead>
                <tbody>{rows.map((r, i) => (
                  <tr key={i}>
                    <td><Badge kind={r.type === 'E' ? 'info' : ''}>{r.type === 'E' ? 'Entrada' : 'Salida'}</Badge></td>
                    <td>{fdate(r.date)}</td>
                    <td><Link to={'/reservas/' + r.reservation_id}>{r.first_name} {r.last_name} {r.second_last_name}</Link></td>
                    <td>{r.doc_type} {r.doc_number}</td><td>{countryName(r.nationality)}</td><td>{fdate(r.birth_date)}</td>
                    <td>{r.reported_at ? <Badge kind="ok">Reportado</Badge> : r.missing.length ? <Badge kind="warn" title={r.missing.join(', ')}>Faltan datos</Badge> : <Badge kind="warn">Pendiente</Badge>}
                      {!r.reported_at && r.missing.length > 0 && <div className="muted" style={{ fontSize: 11.5 }}>{r.missing.join(', ')}</div>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </div>
        );
      }}</Loader>
    </div>
  );
}

function Tra({ range }) {
  const state = useData('/compliance/tra' + qs(range));
  const [run, busy] = useAction();
  return (
    <div className="stack" style={{ gap: 14 }}>
      <Alert kind="info">
        La Tarjeta de Registro Hotelero (TRA) se diligencia en la plataforma del Ministerio de Comercio, Industria y Turismo por cada huésped
        al ingreso. Aquí tiene los datos listos para transcribir o exportar en Excel.
      </Alert>
      <Loader state={state}>{(rows) => {
        const pending = rows.filter((r) => !r.reported_at);
        return (
          <div className="card">
            <div className="card-head">
              <h2>{rows.length} registro(s) · {pending.length} sin reportar</h2>
              <div className="row">
                <button className="btn sm" disabled={busy || !rows.length} onClick={() => run(() => openFile('/compliance/tra.xlsx' + qs(range)))}><FileSpreadsheet /> Excel</button>
                <button className="btn sm primary" disabled={busy || !pending.length} onClick={() => run(() => api.post('/compliance/tra/mark', { ids: pending.map((r) => r.id) }), 'Marcados como reportados').then(state.reload)}><CheckCheck /> Marcar reportados</button>
              </div>
            </div>
            {rows.length === 0 ? <Empty>No hay ingresos en el periodo</Empty> : (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Huésped</th><th>Documento</th><th>Hab.</th><th>Estadía</th><th>Acomp.</th><th>Procedencia → destino</th><th>Motivo</th><th className="num">Alojamiento</th><th>Estado</th></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.id}>
                    <td><Link to={'/reservas/' + r.id}>{r.name}</Link><div className="muted" style={{ fontSize: 12 }}>{countryName(r.nationality)}</div></td>
                    <td>{r.doc_type} {r.doc_number}</td><td>{r.rooms}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fdate(r.check_in)} → {fdate(r.check_out)}</td><td>{r.companions}</td>
                    <td>{r.origin_city || '—'} → {r.destination_city || '—'}</td><td>{r.travel_reason || '—'}</td><td className="num">{money(r.lodging_total)}</td>
                    <td>{r.reported_at ? <Badge kind="ok">Reportado</Badge> : <Badge kind="warn">Pendiente</Badge>}
                      {r.missing.length > 0 && <div className="muted" style={{ fontSize: 11.5 }}>Falta: {r.missing.join(', ')}</div>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </div>
        );
      }}</Loader>
    </div>
  );
}
