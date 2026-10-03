import { useCallback, useEffect, useMemo, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, BedDouble, CalendarRange, Users, Car, ShoppingCart, Sparkles, MessageSquareHeart, BarChart3,
  Settings as SettingsIcon, Tags, ShieldCheck, ConciergeBell, LogOut, MoreHorizontal,
} from 'lucide-react';
import { api, getToken, setToken, setUnauthorizedHandler } from './api.js';
import { AppCtx, ToastHost, Modal, Spinner, ROLES, useApp } from './ui.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Rooms from './pages/Rooms.jsx';
import Rates from './pages/Rates.jsx';
import Reservations from './pages/Reservations.jsx';
import ReservationDetail from './pages/ReservationDetail.jsx';
import CheckIn from './pages/CheckIn.jsx';
import CheckOut from './pages/CheckOut.jsx';
import Guests, { GuestDetail } from './pages/Guests.jsx';
import Parking from './pages/Parking.jsx';
import Inventory from './pages/Inventory.jsx';
import Services from './pages/Services.jsx';
import Housekeeping from './pages/Housekeeping.jsx';
import Postventa from './pages/Postventa.jsx';
import Reports from './pages/Reports.jsx';
import Compliance from './pages/Compliance.jsx';
import Settings from './pages/Settings.jsx';
import Survey from './pages/Survey.jsx';

// Menú: [ruta, etiqueta, icono, permiso, en barra móvil]
const NAV = [
  ['Operación'],
  ['/', 'Inicio', LayoutDashboard, 'dashboard', true],
  ['/reservas', 'Reservas', CalendarRange, 'reservations', true],
  ['/habitaciones', 'Habitaciones', BedDouble, 'rooms.view', true],
  ['/limpieza', 'Limpieza', Sparkles, 'housekeeping', true],
  ['/huespedes', 'Huéspedes', Users, 'guests'],
  ['/parqueadero', 'Parqueadero', Car, 'parking'],
  ['Ventas'],
  ['/ventas', 'Inventario y ventas', ShoppingCart, 'sales', true],
  ['/servicios', 'Servicios', ConciergeBell, 'services.view'],
  ['/tarifas', 'Tarifas', Tags, 'rates.view'],
  ['Gestión'],
  ['/postventa', 'Postventa', MessageSquareHeart, 'feedback'],
  ['/cumplimiento', 'TRA y SIRE', ShieldCheck, 'compliance'],
  ['/reportes', 'Reportes', BarChart3, 'reports'],
  ['/configuracion', 'Configuración', SettingsIcon, 'settings'],
];

export default function App() {
  const [user, setUser] = useState(null);
  const [perms, setPerms] = useState([]);
  const [demo, setDemo] = useState(false);
  const [settings, setSettings] = useState(null);
  const [booting, setBooting] = useState(!!getToken());
  const [toasts, setToasts] = useState([]);
  const location = useLocation();

  const toast = useCallback((text, type) => {
    const id = Math.random();
    setToasts((t) => [...t, { id, text, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'error' ? 5000 : 2800);
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* sesión ya inválida */ }
    setToken(null); setUser(null);
  }, []);

  const loadSession = useCallback(async () => {
    try {
      const me = await api.get('/auth/me');
      setUser(me.user); setPerms(me.permissions); setDemo(!!me.demo);
      setSettings(await api.get('/settings'));
    } catch { setToken(null); setUser(null); }
    finally { setBooting(false); }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => { setToken(null); setUser(null); });
    if (getToken()) loadSession();
  }, [loadSession]);

  const can = useCallback((p) => perms.includes('*') || perms.includes(p), [perms]);
  const ctx = useMemo(() => ({
    user, can, settings, toast, logout, demo,
    reloadSettings: async () => setSettings(await api.get('/settings')),
  }), [user, can, settings, toast, logout, demo]);

  // Página pública de encuesta (sin sesión)
  if (location.pathname.startsWith('/encuesta/')) {
    return <AppCtx.Provider value={ctx}><Routes><Route path="/encuesta/:token" element={<Survey />} /></Routes><ToastHost toasts={toasts} /></AppCtx.Provider>;
  }
  if (booting) return <Spinner />;
  if (!user) {
    return (
      <AppCtx.Provider value={ctx}>
        <Login onLogin={(token) => { setToken(token); setBooting(true); loadSession(); }} />
        <ToastHost toasts={toasts} />
      </AppCtx.Provider>
    );
  }
  if (!settings) return <Spinner />;

  const home = can('dashboard') ? '/' : '/limpieza';
  return (
    <AppCtx.Provider value={ctx}>
      <Layout>
        <Routes>
          <Route path="/" element={can('dashboard') ? <Dashboard /> : <Navigate to={home} />} />
          <Route path="/habitaciones" element={<Rooms />} />
          <Route path="/tarifas" element={<Rates />} />
          <Route path="/reservas" element={<Reservations />} />
          <Route path="/reservas/:id" element={<ReservationDetail />} />
          <Route path="/reservas/:id/checkin" element={<CheckIn />} />
          <Route path="/reservas/:id/checkout" element={<CheckOut />} />
          <Route path="/huespedes" element={<Guests />} />
          <Route path="/huespedes/:id" element={<GuestDetail />} />
          <Route path="/parqueadero" element={<Parking />} />
          <Route path="/ventas" element={<Inventory />} />
          <Route path="/inventario" element={<Navigate to="/ventas?tab=products" />} />
          <Route path="/servicios" element={<Services />} />
          <Route path="/limpieza" element={<Housekeeping />} />
          <Route path="/postventa" element={<Postventa />} />
          <Route path="/reportes" element={<Reports />} />
          <Route path="/cumplimiento" element={<Compliance />} />
          <Route path="/configuracion" element={<Settings />} />
          <Route path="*" element={<Navigate to={home} />} />
        </Routes>
      </Layout>
      <ToastHost toasts={toasts} />
    </AppCtx.Provider>
  );
}

function Layout({ children }) {
  const { user, can, settings, logout, demo } = useApp();
  const location = useLocation();
  const [more, setMore] = useState(false);
  const nav = useNavigate();
  const items = NAV.filter((n) => n.length === 1 || can(n[3]));
  const sections = items.filter((n, i) => n.length > 1 || (items[i + 1] && items[i + 1].length > 1));
  const mobile = items.filter((n) => n[4]).slice(0, 4);
  const rest = items.filter((n) => n.length > 1 && !mobile.includes(n));
  useEffect(() => setMore(false), [location.pathname]);
  const initial = (settings.hotel.name || 'H')[0].toUpperCase();
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">{settings.hotel.logo ? <img src={settings.hotel.logo} alt="" /> : initial}</div>
          <div style={{ minWidth: 0 }}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{settings.hotel.name}</div></div>
        </div>
        {sections.map((n, i) => n.length === 1
          ? <div key={'s' + i} className="nav-section">{n[0]}</div>
          : <NavLink key={n[0]} to={n[0]} end={n[0] === '/'} className="navlink">{(() => { const I = n[2]; return <I />; })()}{n[1]}</NavLink>)}
        <div className="user">
          <div style={{ fontWeight: 600 }}>{user.name}</div>
          <div className="muted">{ROLES[user.role]}</div>
          <div className="row mt" style={{ gap: 4 }}>
            <NavLink to="/configuracion" className="btn sm ghost">Mi cuenta</NavLink>
            <button className="btn sm ghost" onClick={logout}><LogOut /> Salir</button>
          </div>
        </div>
      </aside>
      <main className="main">{demo && <div className="demo-banner">Demostración con datos ficticios · los cambios se reinician periódicamente</div>}{children}</main>
      <nav className="bottomnav">
        {mobile.map(([to, label, I]) => <NavLink key={to} to={to} end={to === '/'}><I size={22} />{label}</NavLink>)}
        <button onClick={() => setMore(true)}><MoreHorizontal size={22} />Más</button>
      </nav>
      {more && (
        <Modal title="Menú" onClose={() => setMore(false)}>
          <div className="sheet-menu">
            {rest.map(([to, label, I]) => <a key={to} href={to} onClick={(e) => { e.preventDefault(); nav(to); }}><I size={22} />{label}</a>)}
          </div>
          <hr />
          <div className="row between">
            <div><b>{user.name}</b><div className="muted">{ROLES[user.role]}</div></div>
            <div className="row"><button className="btn" onClick={() => nav('/configuracion')}>Mi cuenta</button><button className="btn" onClick={logout}><LogOut /> Salir</button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
