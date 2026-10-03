import { useState } from 'react';
import { Plus, Pencil } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useData, useAction, Loader, PageHead, Modal, Input, MoneyInput, Check, Badge, Empty, money } from '../ui.jsx';

export default function Services() {
  const { can, settings } = useApp();
  const state = useData('/services');
  const [edit, setEdit] = useState(null);
  const manage = can('services');
  return (
    <>
      <PageHead title="Servicios adicionales" sub="Se cargan a la cuenta de la habitación desde la reserva">
        {manage && <button className="btn primary" onClick={() => setEdit({})}><Plus /> Servicio</button>}
      </PageHead>
      <Loader state={state}>{(list) => list.length === 0 ? <div className="card"><Empty>Sin servicios</Empty></div> : (
        <div className="card"><div className="list">{list.map((s) => (
          <div key={s.id} className="list-item" style={{ opacity: s.active ? 1 : 0.5 }}>
            <div className="grow"><b>{s.name}</b> {!s.active && <Badge>Inactivo</Badge>}
              <div className="muted" style={{ fontSize: 13 }}>IVA {s.tax_rate ?? settings.taxes.services_rate}%</div></div>
            <span className="mono">{money(s.price)}</span>
            {manage && <button className="btn sm ghost" onClick={() => setEdit(s)}><Pencil /></button>}
          </div>
        ))}</div></div>
      )}</Loader>
      {edit && <ServiceForm s={edit} onClose={() => setEdit(null)} onSaved={state.reload} />}
    </>
  );
}

function ServiceForm({ s, onClose, onSaved }) {
  const { settings } = useApp();
  const [f, setF] = useState({ name: '', price: '', tax_rate: '', active: 1, ...s, tax_rate: s.tax_rate ?? '' });
  const [run, busy] = useAction();
  return (
    <Modal title={s.id ? 'Editar servicio' : 'Nuevo servicio'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn primary" disabled={busy || !f.name} onClick={async () => {
        const body = { name: f.name, price: Number(f.price) || 0, tax_rate: f.tax_rate, active: f.active ? 1 : 0 };
        if (await run(() => (s.id ? api.put('/services/' + s.id, body) : api.post('/services', body)), 'Servicio guardado')) { onSaved(); onClose(); }
      }}>Guardar</button>
    </>}>
      <div className="stack">
        <Input label="Nombre" value={f.name} onChange={(v) => setF({ ...f, name: v })} placeholder="Ej: Lavandería" />
        <div className="grid g2">
          <MoneyInput label="Precio" value={f.price} onChange={(v) => setF({ ...f, price: v })} />
          <Input label="% IVA" type="number" value={f.tax_rate} onChange={(v) => setF({ ...f, tax_rate: v })} placeholder={`${settings.taxes.services_rate} (por defecto)`} />
        </div>
        <Check label="Activo" checked={f.active} onChange={(v) => setF({ ...f, active: v })} />
      </div>
    </Modal>
  );
}
