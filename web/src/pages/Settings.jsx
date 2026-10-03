import { useEffect, useState } from 'react';
import { Plus, Upload, Pencil, Globe, Lock } from 'lucide-react';
import { api, qs } from '../api.js';
import {
  useApp, useData, useAction, Loader, PageHead, Modal, Input, Select, Textarea, Check, Tabs, Badge, Empty, Alert,
  ROLES, fdatetime, COUNTRIES, DOC_TYPES, VEHICLE_TYPES,
} from '../ui.jsx';

const TABS = [
  ['hotel', 'Hotel'], ['operation', 'Operación'], ['taxes', 'Impuestos'], ['payments', 'Pagos y orígenes'], ['users', 'Usuarios'],
  ['parking', 'Parqueadero'], ['compliance', 'Cumplimiento'], ['einvoice', 'Facturación'], ['online', 'Reservas en línea'], ['audit', 'Auditoría'], ['account', 'Mi cuenta'],
];

export default function Settings() {
  const { can } = useApp();
  const tabs = can('settings') ? TABS : TABS.filter(([k]) => k === 'account');
  const [tab, setTab] = useState(tabs[0][0]);
  return (
    <>
      <PageHead title="Configuración" />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <div style={{ maxWidth: 860 }}>
        {tab === 'hotel' && <HotelTab />}
        {tab === 'operation' && <OperationTab />}
        {tab === 'taxes' && <TaxesTab />}
        {tab === 'payments' && <PaymentsTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'parking' && <ParkingTab />}
        {tab === 'compliance' && <ComplianceTab />}
        {tab === 'einvoice' && <EinvoiceTab />}
        {tab === 'online' && <OnlineTab />}
        {tab === 'audit' && <AuditTab />}
        {tab === 'account' && <AccountTab />}
      </div>
    </>
  );
}

/** Edita una sección de configuración y la guarda con PUT /settings/:key */
function useSection(key) {
  const { settings, reloadSettings } = useApp();
  const [v, setV] = useState(structuredClone(settings[key]));
  const [run, busy] = useAction();
  useEffect(() => setV(structuredClone(settings[key])), [settings, key]);
  const save = (val = v) => run(() => api.put('/settings/' + key, val), 'Configuración guardada').then((ok) => ok && reloadSettings());
  return [v, setV, save, busy];
}
const SaveBar = ({ onSave, busy }) => <div className="row mt" style={{ justifyContent: 'flex-end' }}><button className="btn primary" disabled={busy} onClick={() => onSave()}>Guardar cambios</button></div>;

function HotelTab() {
  const [h, setH, save, busy] = useSection('hotel');
  const { reloadSettings } = useApp();
  const [run] = useAction();
  const set = (k) => (x) => setH({ ...h, [k]: x });
  async function logo(file) {
    const fd = new FormData(); fd.append('file', file);
    if (await run(() => api.upload('/settings/logo', fd), 'Logo actualizado')) reloadSettings();
  }
  return (
    <div className="card">
      <div className="row mb" style={{ gap: 14 }}>
        <div className="brand-logo" style={{ width: 64, height: 64, fontSize: 24 }}>{h.logo ? <img src={h.logo} alt="" /> : (h.name || 'H')[0]}</div>
        <label className="btn"><Upload /> Cambiar logo<input hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => e.target.files[0] && logo(e.target.files[0])} /></label>
      </div>
      <div className="grid g2">
        <Input label="Nombre comercial" value={h.name} onChange={set('name')} />
        <Input label="Razón social" value={h.legal_name} onChange={set('legal_name')} />
        <Input label="NIT" value={h.nit} onChange={set('nit')} />
        <Input label="RNT (Registro Nacional de Turismo)" value={h.rnt} onChange={set('rnt')} />
        <Input label="Dirección" value={h.address} onChange={set('address')} />
        <Input label="Ciudad" value={h.city} onChange={set('city')} />
        <Input label="Departamento" value={h.department} onChange={set('department')} />
        <Input label="Código DIVIPOLA del municipio" value={h.city_code} onChange={set('city_code')} hint="Ej: 11001 Bogotá, 05001 Medellín" />
        <Input label="Teléfono" value={h.phone} onChange={set('phone')} />
        <Input label="WhatsApp" value={h.whatsapp} onChange={set('whatsapp')} />
        <Input label="Correo" value={h.email} onChange={set('email')} />
        <Input label="Sitio web" value={h.website} onChange={set('website')} />
      </div>
      <SaveBar onSave={save} busy={busy} />
    </div>
  );
}

function OperationTab() {
  const [sch, setSch, saveSch, b1] = useSection('schedule');
  const [pol, setPol, savePol, b2] = useSection('policies');
  const [sv, setSv, saveSv, b3] = useSection('survey');
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="card">
        <h2 className="mb">Horarios</h2>
        <div className="grid g2">
          <Input label="Hora de check-in" type="time" value={sch.check_in_time} onChange={(x) => setSch({ ...sch, check_in_time: x })} />
          <Input label="Hora de check-out" type="time" value={sch.check_out_time} onChange={(x) => setSch({ ...sch, check_out_time: x })} />
        </div>
        <SaveBar onSave={saveSch} busy={b1} />
      </div>
      <div className="card">
        <h2 className="mb">Políticas</h2>
        <div className="stack">
          <Textarea label="Política de cancelación" value={pol.cancellation} onChange={(x) => setPol({ ...pol, cancellation: x })} />
          <Input label="% de anticipo sugerido" type="number" value={pol.advance_percent} onChange={(x) => setPol({ ...pol, advance_percent: x })} />
          <Textarea label="Normas de la casa" value={pol.house_rules} onChange={(x) => setPol({ ...pol, house_rules: x })} />
        </div>
        <SaveBar onSave={savePol} busy={b2} />
      </div>
      <div className="card">
        <h2 className="mb">Encuesta postventa</h2>
        <div className="stack">
          <Check label="Generar encuesta al hacer check-out" checked={sv.enabled} onChange={(x) => setSv({ ...sv, enabled: x })} />
          <Textarea label="Mensaje (WhatsApp / correo)" value={sv.message} onChange={(x) => setSv({ ...sv, message: x })} />
          <small className="muted">Variables: {'{nombre}'}, {'{hotel}'}, {'{enlace}'}</small>
        </div>
        <SaveBar onSave={saveSv} busy={b3} />
      </div>
    </div>
  );
}

function TaxesTab() {
  const [t, setT, save, busy] = useSection('taxes');
  return (
    <div className="card stack">
      <Check label="Los precios configurados ya incluyen IVA" checked={t.prices_include_tax} onChange={(x) => setT({ ...t, prices_include_tax: x })} />
      <div className="grid g3">
        <Input label="% IVA alojamiento" type="number" value={t.lodging_rate} onChange={(x) => setT({ ...t, lodging_rate: x })} />
        <Input label="% IVA servicios" type="number" value={t.services_rate} onChange={(x) => setT({ ...t, services_rate: x })} />
        <Input label="% IVA productos" type="number" value={t.products_rate} onChange={(x) => setT({ ...t, products_rate: x })} />
      </div>
      <Alert kind="info">Los extranjeros no residentes en Colombia pueden quedar exentos de IVA en el alojamiento (art. 481 lit. d E.T.). La exención se aplica por reserva desde el check-in y exige conservar copia del pasaporte y del sello o permiso de ingreso. Consulte con su contador las tarifas y la exención aplicables a su establecimiento.</Alert>
      <SaveBar onSave={save} busy={busy} />
    </div>
  );
}

function ListEditor({ title, items, onChange, codeLabel }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  return (
    <div className="card">
      <h2 className="mb">{title}</h2>
      {items.map((m, i) => (
        <div key={m.code} className="list-item">
          <Check label={m.name} checked={m.active} onChange={(x) => onChange(items.map((y, j) => (j === i ? { ...y, active: x } : y)))} />
          <span className="grow" /><small className="muted">{m.code}</small>
        </div>
      ))}
      <div className="row mt">
        <input className="input" style={{ maxWidth: 150 }} placeholder={codeLabel} value={code} onChange={(e) => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} />
        <input className="input grow" placeholder="Nombre visible" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn" disabled={!code || !name || items.some((m) => m.code === code)} onClick={() => { onChange([...items, { code, name, active: true }]); setCode(''); setName(''); }}><Plus /> Agregar</button>
      </div>
    </div>
  );
}

function PaymentsTab() {
  const [pm, setPm, savePm, b1] = useSection('payment_methods');
  const [src, setSrc, saveSrc, b2] = useSection('reservation_sources');
  return (
    <div className="stack" style={{ gap: 14 }}>
      <ListEditor title="Métodos de pago" items={pm} onChange={(x) => { setPm(x); savePm(x); }} codeLabel="código (ej. bold)" />
      <ListEditor title="Orígenes de reserva" items={src} onChange={(x) => { setSrc(x); saveSrc(x); }} codeLabel="código" />
      {(b1 || b2) && <small className="muted">Guardando…</small>}
    </div>
  );
}

function UsersTab() {
  const { user: me } = useApp();
  const state = useData('/users');
  const [edit, setEdit] = useState(null);
  const [run, busy] = useAction();
  async function save() {
    const body = { name: edit.name, role: edit.role, active: !!edit.active, password: edit.password || undefined };
    const ok = await run(() => (edit.id ? api.put('/users/' + edit.id, body) : api.post('/users', { ...body, username: edit.username })), 'Usuario guardado');
    if (ok) { setEdit(null); state.reload(); }
  }
  return (
    <>
      <div className="row mb"><button className="btn primary" onClick={() => setEdit({ name: '', username: '', role: 'reception', active: 1, password: '' })}><Plus /> Usuario</button></div>
      <Loader state={state}>{(list) => (
        <div className="card"><div className="list">{list.map((u) => (
          <div key={u.id} className="list-item" style={{ opacity: u.active ? 1 : 0.5 }}>
            <div className="grow"><b>{u.name}</b> {u.id === me.id && <Badge kind="info">Tú</Badge>}<div className="muted" style={{ fontSize: 13 }}>@{u.username}</div></div>
            <Badge>{ROLES[u.role]}</Badge>{!u.active && <Badge kind="danger">Inactivo</Badge>}
            <button className="btn sm ghost" onClick={() => setEdit({ ...u, password: '' })}><Pencil /></button>
          </div>
        ))}</div></div>
      )}</Loader>
      <div className="card mt">
        <h3 className="mb">Permisos por rol</h3>
        <div className="stack muted" style={{ fontSize: 14, gap: 6 }}>
          <div><b>Administrador:</b> acceso total — precios, reportes, usuarios, configuración y anulaciones.</div>
          <div><b>Recepción:</b> reservas, huéspedes, check-in/out, cobros, ventas, limpieza, parqueadero, postventa y reportes legales.</div>
          <div><b>Limpieza:</b> solo ver y actualizar el estado de las habitaciones.</div>
        </div>
      </div>
      {edit && (
        <Modal title={edit.id ? 'Editar usuario' : 'Nuevo usuario'} onClose={() => setEdit(null)} footer={<>
          <button className="btn" onClick={() => setEdit(null)}>Cancelar</button><button className="btn primary" disabled={busy || !edit.name || (!edit.id && (!edit.username || edit.password.length < 6))} onClick={save}>Guardar</button>
        </>}>
          <div className="stack">
            <Input label="Nombre" value={edit.name} onChange={(x) => setEdit({ ...edit, name: x })} />
            <Input label="Usuario" value={edit.username} disabled={!!edit.id} onChange={(x) => setEdit({ ...edit, username: x.toLowerCase().replace(/\s/g, '') })} autoCapitalize="none" />
            <Select label="Rol" value={edit.role} onChange={(x) => setEdit({ ...edit, role: x })} options={Object.entries(ROLES)} />
            <Input label={edit.id ? 'Nueva contraseña (opcional)' : 'Contraseña'} type="password" value={edit.password} onChange={(x) => setEdit({ ...edit, password: x })} hint="Mínimo 6 caracteres" autoComplete="new-password" />
            {edit.id && <Check label="Activo" checked={edit.active} onChange={(x) => setEdit({ ...edit, active: x })} />}
          </div>
        </Modal>
      )}
    </>
  );
}

function ParkingTab() {
  const state = useData('/parking-spaces');
  const [run, busy] = useAction();
  const [f, setF] = useState({ code: '', kind: 'car' });
  return (
    <div className="card">
      <h2 className="mb">Espacios de parqueadero</h2>
      <Loader state={state}>{(list) => list.length === 0 ? <Empty>Sin espacios</Empty> : list.map((s) => (
        <div key={s.id} className="list-item">
          <b style={{ width: 60 }}>{s.code}</b><span className="grow muted">{VEHICLE_TYPES[s.kind]}</span>
          <Check label="Activo" checked={s.active} onChange={(x) => run(() => api.put('/parking-spaces/' + s.id, { active: x ? 1 : 0 })).then(state.reload)} />
        </div>
      ))}</Loader>
      <div className="row mt">
        <input className="input" style={{ maxWidth: 120 }} placeholder="Código" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
        <Select value={f.kind} onChange={(x) => setF({ ...f, kind: x })} options={Object.entries(VEHICLE_TYPES)} style={{ maxWidth: 160 }} />
        <button className="btn" disabled={busy || !f.code} onClick={() => run(() => api.post('/parking-spaces', f), 'Espacio agregado').then((ok) => { if (ok) { setF({ code: '', kind: 'car' }); state.reload(); } })}><Plus /> Agregar</button>
      </div>
    </div>
  );
}

function ComplianceTab() {
  const [c, setC, save, busy] = useSection('compliance');
  const [country, setCountry] = useState('US');
  const docOpts = DOC_TYPES.filter(([k]) => !['CC', 'TI', 'RC', 'NIT'].includes(k));
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="card stack">
        <h2>SIRE · Migración Colombia</h2>
        <div className="grid g2">
          <Input label="Código del establecimiento en SIRE" value={c.sire_establishment_code} onChange={(x) => setC({ ...c, sire_establishment_code: x })} />
          <Input label="Código de ciudad (SIRE)" value={c.sire_city_code} onChange={(x) => setC({ ...c, sire_city_code: x })} hint="Si se deja vacío se usa el código DIVIPOLA del hotel" />
        </div>
        <Alert kind="warn">Los códigos de tipo de documento y de nacionalidad son tablas propias de Migración Colombia. Verifíquelos con la guía de cargue vigente del portal SIRE antes del primer reporte.</Alert>
        <h3>Códigos de tipo de documento</h3>
        <div className="grid g3">
          {docOpts.map(([k, l]) => <Input key={k} label={l} value={c.sire_doc_codes?.[k] ?? ''} onChange={(x) => setC({ ...c, sire_doc_codes: { ...c.sire_doc_codes, [k]: x } })} />)}
        </div>
        <h3>Códigos de nacionalidad</h3>
        <div className="row">
          <Select value={country} onChange={setCountry} options={COUNTRIES.filter(([k]) => k !== 'CO')} style={{ maxWidth: 240 }} />
          <input className="input" style={{ maxWidth: 140 }} placeholder="Código SIRE" value={c.sire_country_codes?.[country] ?? ''} onChange={(e) => setC({ ...c, sire_country_codes: { ...c.sire_country_codes, [country]: e.target.value } })} />
        </div>
        <div className="chips">{Object.entries(c.sire_country_codes || {}).filter(([, v]) => v).map(([k, v]) => <span key={k} className="chip">{k} → {v}</span>)}</div>
      </div>
      <SaveBar onSave={save} busy={busy} />
    </div>
  );
}

function EinvoiceTab() {
  const [e, setE, save, busy] = useSection('einvoice');
  const providers = useData('/einvoice/providers');
  const invoices = useData('/invoices');
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="card stack">
        <h2>Proveedor tecnológico de facturación electrónica</h2>
        <small className="muted">La integración está preparada mediante adaptadores. Seleccione «API REST genérica» si su proveedor recibe JSON, o pida a su desarrollador agregar un adaptador específico en <code>server/lib/einvoice.js</code>.</small>
        <Check label="Activar envío automático al proveedor" checked={e.enabled} onChange={(x) => setE({ ...e, enabled: x })} />
        <div className="grid g2">
          <Select label="Proveedor" value={e.provider} onChange={(x) => setE({ ...e, provider: x })} options={(providers.data || []).map((p) => [p.code, p.label])} />
          <Select label="Ambiente" value={e.environment} onChange={(x) => setE({ ...e, environment: x })} options={[['test', 'Habilitación / pruebas'], ['production', 'Producción']]} />
          <Input label="URL de la API" value={e.api_url} onChange={(x) => setE({ ...e, api_url: x })} />
          <Input label="Token / API key" type="password" value={e.api_key} onChange={(x) => setE({ ...e, api_key: x })} autoComplete="off" />
          <Input label="Resolución de facturación DIAN" value={e.resolution} onChange={(x) => setE({ ...e, resolution: x })} />
          <Input label="Prefijo" value={e.prefix} onChange={(x) => setE({ ...e, prefix: x })} />
        </div>
        <SaveBar onSave={save} busy={busy} />
      </div>
      <div className="card">
        <h2 className="mb">Facturas registradas</h2>
        <Loader state={invoices}>{(list) => list.length === 0 ? <Empty>Aún no hay facturas</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Fecha</th><th>Reserva</th><th>Cliente</th><th>Estado</th><th className="num">Total</th></tr></thead>
            <tbody>{list.map((i) => <tr key={i.id}><td>{fdatetime(i.created_at)}</td><td>{i.reservation_code}</td><td>{i.customer.name}</td><td><Badge>{i.status}</Badge></td><td className="num">${i.total.toLocaleString('es-CO')}</td></tr>)}</tbody>
          </table></div>
        )}</Loader>
      </div>
    </div>
  );
}

function OnlineTab() {
  const { settings } = useApp();
  return (
    <div className="card stack">
      <div className="row between">
        <div className="row"><Globe /><h2>Módulo de reservas en línea</h2></div>
        <label className="check" style={{ opacity: 0.6, cursor: 'not-allowed' }}><input type="checkbox" checked={!!settings.online_booking.enabled} disabled readOnly /> Activado</label>
      </div>
      <Alert kind="info">
        Próximamente. Cuando se instale, los huéspedes podrán reservar desde la web del hotel. El sistema ya está preparado: usa el mismo motor de
        disponibilidad y tarifas, el origen «Web propia», reservas pendientes con retención de inventario por tiempo limitado y la opción por habitación
        «Publicable en reservas en línea».
      </Alert>
      <div className="row muted"><Lock size={16} /> Este interruptor se habilitará al instalar el módulo.</div>
    </div>
  );
}

function AuditTab() {
  const users = useData('/users/lookup');
  const [f, setF] = useState({ action: '', user_id: '' });
  const state = useData('/audit' + qs(f));
  const ACTIONS = [['', 'Todas'], ['payment', 'Pagos'], ['charge', 'Cargos'], ['reservation.cancel', 'Cancelaciones'], ['reservation.no_show', 'No show'], ['reservation.check', 'Check-in/out'], ['sale', 'Ventas'], ['inventory', 'Inventario'], ['settings', 'Configuración'], ['user', 'Usuarios'], ['auth', 'Ingresos']];
  return (
    <>
      <div className="row mb">
        <Select value={f.action} onChange={(x) => setF({ ...f, action: x })} options={ACTIONS} style={{ maxWidth: 200 }} />
        <Select value={f.user_id} onChange={(x) => setF({ ...f, user_id: x })} placeholder="Todos los usuarios" options={(users.data || []).map((u) => [u.id, u.name])} style={{ maxWidth: 220 }} />
      </div>
      <Loader state={state}>{(list) => list.length === 0 ? <div className="card"><Empty>Sin registros</Empty></div> : (
        <div className="card"><div className="table-wrap"><table className="table">
          <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Detalle</th></tr></thead>
          <tbody>{list.map((a) => (
            <tr key={a.id}><td style={{ whiteSpace: 'nowrap' }}>{fdatetime(a.created_at)}</td><td>{a.user_name || '—'}</td><td><code style={{ fontSize: 12.5 }}>{a.action}</code></td>
              <td className="muted" style={{ fontSize: 12.5, maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.details || ''}>{a.entity}{a.entity_id ? ' #' + a.entity_id : ''} {a.details}</td></tr>
          ))}</tbody>
        </table></div></div>
      )}</Loader>
    </>
  );
}

function AccountTab() {
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [run, busy] = useAction();
  return (
    <div className="card stack" style={{ maxWidth: 420 }}>
      <h2>Cambiar contraseña</h2>
      <Input label="Contraseña actual" type="password" value={f.current} onChange={(x) => setF({ ...f, current: x })} autoComplete="current-password" />
      <Input label="Nueva contraseña" type="password" value={f.next} onChange={(x) => setF({ ...f, next: x })} autoComplete="new-password" />
      <Input label="Confirmar nueva contraseña" type="password" value={f.confirm} onChange={(x) => setF({ ...f, confirm: x })} autoComplete="new-password" />
      <button className="btn primary" disabled={busy || f.next.length < 6 || f.next !== f.confirm} onClick={() => run(() => api.post('/auth/password', f), 'Contraseña actualizada').then((ok) => ok && setF({ current: '', next: '', confirm: '' }))}>Actualizar</button>
    </div>
  );
}
