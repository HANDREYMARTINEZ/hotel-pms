// Encuesta pública de satisfacción (enlace enviado por WhatsApp o correo).
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Stars, Textarea, Check, Spinner, Alert } from '../ui.jsx';

const ASPECTS = [['cleanliness', 'Limpieza'], ['service', 'Atención'], ['comfort', 'Comodidad'], ['value', 'Precio / calidad'], ['location', 'Ubicación']];

export default function Survey() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ overall: 0, ratings: {}, comment: '', would_return: true });
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get('/public/survey/' + token).then(setInfo).catch((e) => setError(e.message)); }, [token]);

  async function submit() {
    setBusy(true);
    try { await api.post('/public/survey/' + token, form); setDone(true); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  if (error) return <div className="center-page"><div className="card login-card"><Alert kind="warn">{error}</Alert></div></div>;
  if (!info) return <Spinner />;
  if (done || info.completed_at) {
    return <div className="center-page"><div className="card login-card" style={{ textAlign: 'center', padding: 32 }}><h1>¡Gracias!</h1><p className="muted">Tu opinión nos ayuda a mejorar. Esperamos verte pronto en {info.hotel}.</p></div></div>;
  }
  return (
    <div className="center-page">
      <div className="card stack" style={{ width: 'min(480px, 100%)', padding: 24 }}>
        <div className="row">
          {info.logo && <img src={info.logo} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover' }} />}
          <div><h1>{info.hotel}</h1><small>Encuesta de satisfacción</small></div>
        </div>
        <p style={{ margin: 0 }}>Hola {info.first_name}, ¿cómo fue tu estadía?</p>
        <Stars value={form.overall} onChange={(v) => setForm({ ...form, overall: v })} />
        {ASPECTS.map(([k, l]) => (
          <div key={k} className="row between">
            <span>{l}</span>
            <Stars size="sm" value={form.ratings[k] || 0} onChange={(v) => setForm({ ...form, ratings: { ...form.ratings, [k]: v } })} />
          </div>
        ))}
        <Textarea label="¿Algo que quieras contarnos?" value={form.comment} onChange={(v) => setForm({ ...form, comment: v })} />
        <Check label="Volvería a hospedarme aquí" checked={form.would_return} onChange={(v) => setForm({ ...form, would_return: v })} />
        <button className="btn primary lg block" disabled={!form.overall || busy} onClick={submit}>Enviar</button>
      </div>
    </div>
  );
}
