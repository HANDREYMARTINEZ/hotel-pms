import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Input, useToast } from '../ui.jsx';

export default function Login({ onLogin }) {
  const [form, setForm] = useState({ username: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [hotel, setHotel] = useState(null);
  const toast = useToast();
  useEffect(() => { api.get('/public/hotel').then(setHotel).catch(() => {}); }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try { const r = await api.post('/auth/login', form); onLogin(r.token); }
    catch (err) { toast(err.message, 'error'); }
    finally { setBusy(false); }
  }

  return (
    <div className="center-page">
      <form className="card login-card stack" onSubmit={submit} style={{ padding: 28 }}>
        <div className="row" style={{ gap: 12, marginBottom: 6 }}>
          <div className="brand-logo" style={{ width: 44, height: 44 }}>{hotel?.logo ? <img src={hotel.logo} alt="" /> : (hotel?.name || 'H')[0]}</div>
          <div><h1>{hotel?.name || 'Hotel'}</h1><small>Panel de administración</small></div>
        </div>
        <Input label="Usuario" value={form.username} onChange={(v) => setForm({ ...form, username: v })} autoFocus autoComplete="username" autoCapitalize="none" />
        <Input label="Contraseña" type="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} autoComplete="current-password" />
        <button className="btn primary lg block" disabled={busy || !form.username || !form.password}>{busy ? 'Ingresando…' : 'Ingresar'}</button>
      </form>
    </div>
  );
}
