// Componentes y utilidades de interfaz compartidos.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { X, AlertTriangle, Info } from 'lucide-react';
import { api } from './api.js';

// ---------- formato ----------
export const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO');
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export function fdate(s, withDay = false) {
  if (!s) return '—';
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return `${withDay ? DAYS[dt.getUTCDay()] + ' ' : ''}${d} ${MONTHS[m - 1]}${y !== new Date().getFullYear() ? ' ' + y : ''}`;
}
/** Fecha-hora UTC de SQLite a hora de Colombia. */
export function fdatetime(s) {
  if (!s) return '—';
  return new Date(s.replace(' ', 'T') + 'Z').toLocaleString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
export const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
export function addDays(s, n) {
  const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
export const nights = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);
export const dayName = (s) => DAYS[new Date(s + 'T12:00:00Z').getUTCDay()];

// ---------- catálogos ----------
export const ROOM_STATUS = {
  available: 'Disponible', occupied: 'Ocupada', reserved: 'Reservada', cleaning: 'Limpieza', maintenance: 'Mantenimiento',
};
export const RES_STATUS = {
  pending: ['Pendiente', 'warn'], confirmed: ['Confirmada', 'info'], checked_in: ['En casa', 'ok'], checked_out: ['Salió', ''],
  cancelled: ['Cancelada', 'danger'], no_show: ['No show', 'danger'],
};
export const HK = { clean: 'Limpia', dirty: 'Sucia', in_progress: 'En limpieza' };
export const ROLES = { admin: 'Administrador', reception: 'Recepción', housekeeping: 'Limpieza' };
export const DOC_TYPES = [
  ['CC', 'Cédula de ciudadanía'], ['CE', 'Cédula de extranjería'], ['PA', 'Pasaporte'], ['TI', 'Tarjeta de identidad'],
  ['PEP', 'Permiso especial de permanencia'], ['PPT', 'Permiso por protección temporal'], ['RC', 'Registro civil'],
  ['DE', 'Documento extranjero'], ['NIT', 'NIT'], ['OTRO', 'Otro'],
];
export const VEHICLE_TYPES = { car: 'Carro', motorcycle: 'Moto', van: 'Camioneta', bicycle: 'Bicicleta', other: 'Otro' };
export const TRAVEL_REASONS = ['Vacaciones / ocio', 'Negocios / trabajo', 'Visita a familiares o amigos', 'Salud', 'Estudios', 'Eventos / congresos', 'Religión', 'Compras', 'Tránsito', 'Otro'];
export const COUNTRIES = [
  ['CO', 'Colombia'], ['AR', 'Argentina'], ['BO', 'Bolivia'], ['BR', 'Brasil'], ['CA', 'Canadá'], ['CL', 'Chile'], ['CR', 'Costa Rica'], ['CU', 'Cuba'],
  ['EC', 'Ecuador'], ['SV', 'El Salvador'], ['US', 'Estados Unidos'], ['GT', 'Guatemala'], ['HN', 'Honduras'], ['MX', 'México'], ['NI', 'Nicaragua'],
  ['PA', 'Panamá'], ['PY', 'Paraguay'], ['PE', 'Perú'], ['PR', 'Puerto Rico'], ['DO', 'República Dominicana'], ['UY', 'Uruguay'], ['VE', 'Venezuela'],
  ['DE', 'Alemania'], ['AT', 'Austria'], ['BE', 'Bélgica'], ['DK', 'Dinamarca'], ['ES', 'España'], ['FI', 'Finlandia'], ['FR', 'Francia'],
  ['GR', 'Grecia'], ['IE', 'Irlanda'], ['IT', 'Italia'], ['NO', 'Noruega'], ['NL', 'Países Bajos'], ['PL', 'Polonia'], ['PT', 'Portugal'],
  ['GB', 'Reino Unido'], ['CZ', 'República Checa'], ['RU', 'Rusia'], ['SE', 'Suecia'], ['CH', 'Suiza'], ['UA', 'Ucrania'], ['TR', 'Turquía'],
  ['AU', 'Australia'], ['NZ', 'Nueva Zelanda'], ['CN', 'China'], ['KR', 'Corea del Sur'], ['IN', 'India'], ['IL', 'Israel'], ['JP', 'Japón'],
  ['ZA', 'Sudáfrica'], ['MA', 'Marruecos'], ['EG', 'Egipto'], ['NG', 'Nigeria'], ['PH', 'Filipinas'], ['AE', 'Emiratos Árabes Unidos'],
];
export const countryName = (c) => COUNTRIES.find((x) => x[0] === c)?.[1] || c;

// ---------- contexto global ----------
export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export function useToast() {
  return useApp().toast;
}

export function ToastHost({ toasts }) {
  return (
    <div className="toast-wrap">
      {toasts.map((t) => <div key={t.id} className={'toast ' + (t.type || '')}>{t.text}</div>)}
    </div>
  );
}

/** Carga datos de la API con estado de carga y recarga. */
export function useData(url, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!url) return;
    const n = ++seq.current;
    setLoading(true);
    try { const d = await api.get(url); if (n === seq.current) { setData(d); setError(null); } }
    catch (e) { if (n === seq.current) setError(e.message); }
    finally { if (n === seq.current) setLoading(false); }
  }, [url]);
  useEffect(() => { load(); }, [load, ...deps]);
  return { data, error, loading, reload: load, setData };
}

/** Ejecuta una acción mostrando errores y mensaje de éxito. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, okMsg) => {
    setBusy(true);
    try { const r = await fn(); if (okMsg) toast(okMsg); return r ?? true; }
    catch (e) { toast(e.message, 'error'); return null; }
    finally { setBusy(false); }
  }, [toast]);
  return [run, busy];
}

// ---------- componentes ----------
export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button>
        </div>
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, style }) {
  return <label className="field" style={style}><span>{label}</span>{children}{hint && <small className="hint">{hint}</small>}</label>;
}

export function Input({ label, hint, value, onChange, type = 'text', ...rest }) {
  const el = (
    <input className="input" type={type} value={value ?? ''} onChange={(e) => onChange?.(type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} {...rest} />
  );
  return label ? <Field label={label} hint={hint}>{el}</Field> : el;
}

export function Select({ label, value, onChange, options, placeholder, hint, ...rest }) {
  const el = (
    <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o} value={o}>{o}</option>)}
    </select>
  );
  return label ? <Field label={label} hint={hint}>{el}</Field> : el;
}

export function Textarea({ label, value, onChange, ...rest }) {
  const el = <textarea className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest} />;
  return label ? <Field label={label}>{el}</Field> : el;
}

export function Check({ label, checked, onChange }) {
  return <label className="check"><input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />{label}</label>;
}

export function MoneyInput({ label, value, onChange, hint, ...rest }) {
  const shown = value === '' || value == null ? '' : Number(value).toLocaleString('es-CO');
  const el = (
    <input className="input mono" inputMode="numeric" value={shown} placeholder="$0"
      onChange={(e) => { const d = e.target.value.replace(/\D/g, ''); onChange(d === '' ? '' : Number(d)); }} {...rest} />
  );
  return label ? <Field label={label} hint={hint}>{el}</Field> : el;
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([k, l]) => <button key={k} className={value === k ? 'active' : ''} onClick={() => onChange(k)}>{l}</button>)}
    </div>
  );
}

export function Badge({ kind = '', children }) { return <span className={'badge ' + kind}>{children}</span>; }
export function ResStatus({ status }) { const [l, k] = RES_STATUS[status] || [status, '']; return <Badge kind={k}>{l}</Badge>; }

export function Empty({ children }) { return <div className="empty">{children}</div>; }
export function Spinner() { return <div className="spinner" />; }
export function Alert({ kind = 'info', children }) {
  return <div className={'alert ' + kind}>{kind === 'info' ? <Info /> : <AlertTriangle />}<div>{children}</div></div>;
}

export function PageHead({ title, sub, children }) {
  return (
    <div className="topbar">
      <div><h1>{title}</h1>{sub && <small>{sub}</small>}</div>
      {children && <div className="actions">{children}</div>}
    </div>
  );
}

export function Loader({ state, children }) {
  if (state.error) return <Alert kind="danger">{state.error}</Alert>;
  if (!state.data) return <Spinner />;
  return children(state.data);
}

/** Diálogo de confirmación con motivo opcional. */
export function Confirm({ title, message, reasonLabel, confirmText = 'Confirmar', danger, onConfirm, onClose, children }) {
  const [reason, setReason] = useState('');
  const [run, busy] = useAction();
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Volver</button>
      <button className={'btn ' + (danger ? 'danger solid' : 'primary')} disabled={busy || (reasonLabel && !reason.trim())}
        onClick={async () => { if (await run(() => onConfirm(reason))) onClose(); }}>{confirmText}</button>
    </>}>
      <div className="stack">
        {message && <p style={{ margin: 0 }}>{message}</p>}
        {children}
        {reasonLabel && <Textarea label={reasonLabel} value={reason} onChange={setReason} autoFocus />}
      </div>
    </Modal>
  );
}

export function Stars({ value, onChange, size }) {
  return (
    <div className={'stars ' + (size || '')}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" className={n <= value ? 'on' : ''} onClick={() => onChange?.(n)} aria-label={`${n} estrellas`}>
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z" /></svg>
        </button>
      ))}
    </div>
  );
}

export function paymentMethodName(settings, code) {
  return settings?.payment_methods?.find((m) => m.code === code)?.name || code;
}
export function sourceName(settings, code) {
  return settings?.reservation_sources?.find((m) => m.code === code)?.name || code;
}
