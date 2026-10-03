import { useEffect, useState } from 'react';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { api, qs } from '../api.js';
import {
  useApp, useData, useAction, Loader, PageHead, Modal, Input, Select, MoneyInput, Check, Badge, Empty, money, fdate, todayStr, addDays, dayName,
} from '../ui.jsx';

const WEEKDAYS = [[1, 'Lun'], [2, 'Mar'], [3, 'Mié'], [4, 'Jue'], [5, 'Vie'], [6, 'Sáb'], [0, 'Dom']];

export default function Rates() {
  const { can } = useApp();
  const state = useData('/rates');
  const types = useData('/room-types');
  const [run, busy] = useAction();
  const [season, setSeason] = useState(null);
  const [rule, setRule] = useState(null);
  const edit = can('rates');

  return (
    <>
      <PageHead title="Tarifas" sub="El precio de cada noche = precio base → temporada → fin de semana → descuento por estadía larga" />
      <Loader state={state}>{(d) => (
        <div className="stack" style={{ gap: 14 }}>
          <div className="card">
            <div className="card-head"><h2>Precios base</h2></div>
            {types.data && <div className="grid g3">{types.data.filter((t) => t.active).map((t) => (
              <div key={t.id} className="stat"><span className="label">{t.name}</span><span className="value" style={{ fontSize: 20 }}>{money(t.base_price)}</span></div>
            ))}</div>}
            <small className="muted">Se editan en Habitaciones → Tipos. Cada habitación puede tener su propio precio.</small>
          </div>

          <div className="card">
            <div className="card-head"><h2>Temporadas</h2>{edit && <button className="btn sm primary" onClick={() => setSeason({ name: '', start_date: todayStr(), end_date: addDays(todayStr(), 30), mode: 'percent', percent: 20, prices: {}, active: 1 })}><Plus /> Temporada</button>}</div>
            {d.seasons.length === 0 ? <Empty>Sin temporadas definidas</Empty> : (
              <div className="list">{d.seasons.map((s) => (
                <div key={s.id} className="list-item">
                  <div className="grow"><b>{s.name}</b> {!s.active && <Badge>Inactiva</Badge>}
                    <div className="muted" style={{ fontSize: 13 }}>{fdate(s.start_date)} → {fdate(s.end_date)} · {s.mode === 'percent' ? `${s.percent > 0 ? '+' : ''}${s.percent}%` : 'precio fijo por tipo'}</div></div>
                  {edit && <><button className="btn sm ghost" onClick={() => setSeason(s)}><Pencil /></button>
                    <button className="btn sm ghost" onClick={() => run(() => api.del('/rates/seasons/' + s.id), 'Temporada eliminada').then(state.reload)}><Trash2 /></button></>}
                </div>
              ))}</div>
            )}
          </div>

          <div className="grid g2">
            <Weekend initial={d.weekend} types={types.data || []} edit={edit} onSaved={state.reload} />
            <div className="card">
              <div className="card-head"><h2>Estadía larga</h2>{edit && <button className="btn sm primary" onClick={() => setRule({ min_nights: 7, discount_percent: 10 })}><Plus /> Regla</button>}</div>
              {d.long_stay.length === 0 ? <Empty>Sin descuentos</Empty> : d.long_stay.map((r) => (
                <div key={r.id} className="list-item"><span className="grow">Desde <b>{r.min_nights} noches</b>: {r.discount_percent}% de descuento</span>
                  {edit && <button className="btn sm ghost" onClick={() => run(() => api.del('/rates/long-stay/' + r.id), 'Regla eliminada').then(state.reload)}><Trash2 /></button>}</div>
              ))}
              <small className="muted">Se aplica la regla de mayor número de noches que cumpla la estadía.</small>
            </div>
          </div>

          <Simulator />
        </div>
      )}</Loader>

      {season && types.data && <SeasonForm season={season} types={types.data} onClose={() => setSeason(null)} onSaved={state.reload} />}
      {rule && (
        <Modal title="Descuento por estadía larga" onClose={() => setRule(null)} footer={<>
          <button className="btn" onClick={() => setRule(null)}>Cancelar</button>
          <button className="btn primary" disabled={busy} onClick={() => run(() => api.post('/rates/long-stay', rule), 'Regla creada').then((ok) => { if (ok) { setRule(null); state.reload(); } })}>Guardar</button>
        </>}>
          <div className="grid g2">
            <Input label="Mínimo de noches" type="number" value={rule.min_nights} onChange={(v) => setRule({ ...rule, min_nights: v })} />
            <Input label="% de descuento" type="number" value={rule.discount_percent} onChange={(v) => setRule({ ...rule, discount_percent: v })} />
          </div>
        </Modal>
      )}
    </>
  );
}

function Weekend({ initial, types, edit, onSaved }) {
  const [w, setW] = useState(initial);
  const [run, busy] = useAction();
  useEffect(() => setW(initial), [initial]);
  const toggle = (d) => setW({ ...w, days: w.days.includes(d) ? w.days.filter((x) => x !== d) : [...w.days, d] });
  return (
    <div className="card stack">
      <div className="card-head" style={{ marginBottom: 0 }}><h2>Fin de semana</h2><Check label="Activo" checked={w.enabled} onChange={(v) => setW({ ...w, enabled: v })} /></div>
      <div className="field"><span>Noches con recargo</span>
        <div className="chips">{WEEKDAYS.map(([d, l]) => <button key={d} className={'chip ' + (w.days.includes(d) ? 'on' : '')} onClick={() => toggle(d)} disabled={!edit}>{l}</button>)}</div>
        <small className="hint">Se cuenta la noche que inicia ese día (ej. viernes = noche de viernes a sábado).</small>
      </div>
      <Select label="Tipo de ajuste" value={w.mode} onChange={(v) => setW({ ...w, mode: v })} options={[['percent', 'Porcentaje sobre el precio'], ['price', 'Precio fijo por tipo']]} disabled={!edit} />
      {w.mode === 'percent'
        ? <Input label="% de recargo" type="number" value={w.percent} onChange={(v) => setW({ ...w, percent: v })} disabled={!edit} />
        : types.map((t) => <MoneyInput key={t.id} label={t.name} value={w.prices?.[t.id] ?? ''} onChange={(v) => setW({ ...w, prices: { ...w.prices, [t.id]: v } })} disabled={!edit} />)}
      {edit && <button className="btn primary" disabled={busy} onClick={() => run(() => api.put('/rates/weekend', w), 'Tarifa de fin de semana guardada').then(onSaved)}>Guardar</button>}
    </div>
  );
}

function SeasonForm({ season, types, onClose, onSaved }) {
  const [f, setF] = useState(season);
  const [run, busy] = useAction();
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const save = async () => {
    const body = { name: f.name, start_date: f.start_date, end_date: f.end_date, mode: f.mode, percent: Number(f.percent) || 0, prices: f.prices, active: f.active ? 1 : 0 };
    if (await run(() => (season.id ? api.put('/rates/seasons/' + season.id, body) : api.post('/rates/seasons', body)), 'Temporada guardada')) { onSaved(); onClose(); }
  };
  return (
    <Modal title={season.id ? 'Editar temporada' : 'Nueva temporada'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !f.name} onClick={save}>Guardar</button>
    </>}>
      <div className="stack">
        <Input label="Nombre" value={f.name} onChange={set('name')} placeholder="Ej: Semana Santa" />
        <div className="grid g2">
          <Input label="Desde" type="date" value={f.start_date} onChange={set('start_date')} />
          <Input label="Hasta (inclusive)" type="date" value={f.end_date} onChange={set('end_date')} />
        </div>
        <Select label="Tipo de ajuste" value={f.mode} onChange={set('mode')} options={[['percent', 'Porcentaje sobre precio base'], ['price', 'Precio fijo por tipo de habitación']]} />
        {f.mode === 'percent'
          ? <Input label="% de ajuste" hint="Positivo sube el precio, negativo lo baja (temporada baja)" type="number" value={f.percent} onChange={set('percent')} />
          : types.map((t) => <MoneyInput key={t.id} label={t.name} value={f.prices?.[t.id] ?? ''} onChange={(v) => setF({ ...f, prices: { ...f.prices, [t.id]: v } })} />)}
        <Check label="Activa" checked={f.active} onChange={set('active')} />
      </div>
    </Modal>
  );
}

function Simulator() {
  const rooms = useData('/rooms');
  const [q, setQ] = useState({ room_id: '', from: todayStr(), to: addDays(todayStr(), 3) });
  const [res, setRes] = useState(null);
  useEffect(() => {
    if (!q.room_id && rooms.data?.[0]) setQ((x) => ({ ...x, room_id: rooms.data[0].id }));
  }, [rooms.data]);
  useEffect(() => {
    if (!q.room_id || q.to <= q.from) return setRes(null);
    api.get('/quote' + qs(q)).then(setRes).catch(() => setRes(null));
  }, [q]);
  return (
    <div className="card">
      <div className="card-head"><h2>Simulador de precio</h2></div>
      <div className="grid g3">
        <Select label="Habitación" value={q.room_id} onChange={(v) => setQ({ ...q, room_id: v })} options={(rooms.data || []).map((r) => [r.id, `${r.number} · ${r.type_name}`])} />
        <Input label="Llegada" type="date" value={q.from} onChange={(v) => setQ({ ...q, from: v })} />
        <Input label="Salida" type="date" value={q.to} onChange={(v) => setQ({ ...q, to: v })} />
      </div>
      {res && (
        <div className="mt">
          <div className="table-wrap"><table className="table">
            <tbody>{res.nights.map((n) => (
              <tr key={n.date}><td>{dayName(n.date)} {fdate(n.date)}</td><td className="muted" style={{ fontSize: 13 }}>{n.rules.join(' · ')}</td><td className="num">{money(n.price)}</td></tr>
            ))}</tbody>
          </table></div>
          <div className="totals mt">
            {res.discount > 0 && <div className="line"><span>Descuento estadía larga</span><span>-{money(res.discount)}</span></div>}
            <div className="line big"><span>Total {res.nights.length} noche(s)</span><span>{money(res.total)}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}
