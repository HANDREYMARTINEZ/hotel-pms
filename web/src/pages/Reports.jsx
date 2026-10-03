import { useState } from 'react';
import { FileSpreadsheet, FileText } from 'lucide-react';
import { openFile, qs } from '../api.js';
import { useData, useAction, Loader, PageHead, Input, Empty, money, fdate, todayStr, addDays } from '../ui.jsx';

const PRESETS = [
  ['7 días', () => [addDays(todayStr(), -6), todayStr()]],
  ['30 días', () => [addDays(todayStr(), -29), todayStr()]],
  ['Este mes', () => [todayStr().slice(0, 8) + '01', todayStr()]],
  ['Mes anterior', () => { const first = todayStr().slice(0, 8) + '01'; const end = addDays(first, -1); return [end.slice(0, 8) + '01', end]; }],
  ['Este año', () => [todayStr().slice(0, 4) + '-01-01', todayStr()]],
];

function HBars({ rows, label, value, fmt = money }) {
  const max = Math.max(1, ...rows.map((r) => r[value]));
  if (!rows.length) return <Empty>Sin datos</Empty>;
  return rows.map((r, i) => (
    <div key={i} className="hbar">
      <span className="lbl" title={r[label]}>{r[label]}</span>
      <span className="track"><span className="fill" style={{ width: `${(r[value] / max) * 100}%`, display: 'block' }} /></span>
      <span className="val">{fmt(r[value])}</span>
    </div>
  ));
}

export default function Reports() {
  const [range, setRange] = useState({ from: addDays(todayStr(), -29), to: todayStr() });
  const state = useData('/reports/summary' + qs(range));
  const [run, busy] = useAction();
  const exp = (format) => run(() => openFile('/reports/export' + qs({ ...range, format })));
  return (
    <>
      <PageHead title="Reportes" sub={`${fdate(range.from)} – ${fdate(range.to)}`}>
        <button className="btn" disabled={busy} onClick={() => exp('xlsx')}><FileSpreadsheet /> Excel</button>
        <button className="btn" disabled={busy} onClick={() => exp('pdf')}><FileText /> PDF</button>
      </PageHead>
      <div className="row mb">
        <div className="chips">{PRESETS.map(([l, fn]) => { const [from, to] = fn(); return <button key={l} className={'chip ' + (range.from === from && range.to === to ? 'on' : '')} onClick={() => setRange({ from, to })}>{l}</button>; })}</div>
        <Input type="date" value={range.from} onChange={(v) => setRange({ ...range, from: v })} style={{ width: 160 }} />
        <Input type="date" value={range.to} onChange={(v) => setRange({ ...range, to: v })} style={{ width: 160 }} />
      </div>
      <Loader state={state}>{(d) => {
        const k = d.kpis;
        return (
          <div className="stack" style={{ gap: 14 }}>
            <div className="grid g4">
              <div className="card stat"><span className="label">Ocupación</span><span className="value">{k.occupancy}%</span><span className="sub">{k.rooms_sold} hab.-noche vendidas</span></div>
              <div className="card stat"><span className="label">Tarifa promedio (ADR)</span><span className="value">{money(k.adr)}</span><span className="sub">RevPAR {money(k.revpar)}</span></div>
              <div className="card stat"><span className="label">Ingresos causados</span><span className="value">{money(k.revenue)}</span><span className="sub">Recaudado {money(k.collected)}</span></div>
              <div className="card stat"><span className="label">Cancelaciones / no show</span><span className="value">{k.cancellations} / {k.no_shows}</span></div>
            </div>
            <div className="card">
              <h2 className="mb">Ocupación diaria</h2>
              <div className="bar-chart" role="img" aria-label="Porcentaje de ocupación por día">
                {d.occupancy.map((o) => <div key={o.date} className="b" style={{ height: `${Math.max(o.percent, 1)}%` }} title={`${fdate(o.date)}: ${o.percent}% (${o.rooms_sold} hab.) · ${money(o.lodging)}`} />)}
              </div>
              <div className="row between muted" style={{ fontSize: 12, marginTop: 6 }}><span>{fdate(d.from)}</span><span>{fdate(d.to)}</span></div>
            </div>
            <div className="grid g2">
              <div className="card"><h2 className="mb">Ingresos por categoría</h2><HBars rows={d.revenueByCategory} label="name" value="total" /></div>
              <div className="card"><h2 className="mb">Recaudo por método de pago</h2><HBars rows={d.paymentsByMethod} label="name" value="total" /></div>
              <div className="card"><h2 className="mb">Reservas por origen</h2><HBars rows={d.bySource} label="name" value="reservations" fmt={(v) => `${v} reserva(s)`} /></div>
              <div className="card">
                <h2 className="mb">Ventas por producto</h2>
                {d.productSales.length === 0 ? <Empty>Sin ventas</Empty> : (
                  <div className="table-wrap"><table className="table">
                    <thead><tr><th>Producto</th><th className="num">Cant.</th><th className="num">Ventas</th><th className="num">Margen</th></tr></thead>
                    <tbody>{d.productSales.map((p) => <tr key={p.product}><td>{p.product}</td><td className="num">{p.quantity}</td><td className="num">{money(p.total)}</td><td className="num">{money(p.margin)}</td></tr>)}</tbody>
                  </table></div>
                )}
              </div>
            </div>
          </div>
        );
      }}</Loader>
    </>
  );
}
