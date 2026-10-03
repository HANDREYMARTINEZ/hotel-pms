// Formulario de huésped reutilizable (reserva, check-in, ficha del huésped).
import { api, qs } from '../api.js';
import { Input, Select, Textarea, DOC_TYPES, COUNTRIES, Badge } from '../ui.jsx';

export const emptyGuest = () => ({
  doc_type: 'CC', doc_number: '', first_name: '', last_name: '', second_last_name: '', nationality: 'CO', birth_date: '', gender: '',
  phone: '', email: '', residence_country: 'CO', residence_city: '', address: '', occupation: '', notes: '',
});

/**
 * mode: 'quick' (reserva), 'full' (check-in / ficha), 'companion'
 * Al escribir el documento busca si el huésped ya existe y completa los datos.
 */
export default function GuestForm({ value, onChange, mode = 'full' }) {
  const g = value;
  const set = (k) => (v) => {
    const next = { ...g, [k]: v };
    if (k === 'nationality' && g.residence_country === g.nationality) next.residence_country = v; // por defecto reside donde es nacional
    if (k === 'doc_type' && ['PA', 'CE', 'PEP', 'PPT', 'DE'].includes(v) && g.nationality === 'CO') { next.nationality = ''; next.residence_country = ''; }
    onChange(next);
  };

  async function lookup() {
    if (!g.doc_number || g.id) return;
    try {
      const found = await api.get('/guests/lookup/doc' + qs({ doc_type: g.doc_type, doc_number: g.doc_number }));
      if (found) {
        const clean = Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v ?? '']));
        onChange({ ...g, ...clean, relationship: g.relationship, _existing: true });
      }
    } catch { /* sin coincidencia */ }
  }

  const countries = COUNTRIES.map(([c, n]) => [c, n]);
  const foreign = g.nationality && g.nationality !== 'CO';
  return (
    <div className="stack">
      {g._existing && <div><Badge kind="info">Huésped registrado · datos cargados</Badge></div>}
      <div className="grid g2">
        <Select label="Tipo de documento" value={g.doc_type} onChange={set('doc_type')} options={DOC_TYPES} />
        <Input label="Número de documento" value={g.doc_number} onChange={set('doc_number')} onBlur={lookup} autoComplete="off" />
        <Input label="Nombres" value={g.first_name} onChange={set('first_name')} />
        <div className="grid g2" style={{ gap: 10 }}>
          <Input label="Primer apellido" value={g.last_name} onChange={set('last_name')} />
          <Input label="Segundo apellido" value={g.second_last_name} onChange={set('second_last_name')} />
        </div>
        <Select label="Nacionalidad" value={g.nationality} onChange={set('nationality')} options={countries} placeholder="Seleccione…" />
        {mode !== 'quick' && <Input label="Fecha de nacimiento" type="date" value={g.birth_date} onChange={set('birth_date')} />}
        {mode === 'companion' && <Input label="Parentesco / relación" value={g.relationship} onChange={set('relationship')} placeholder="Ej: esposa, hijo, amigo" />}
        {mode !== 'companion' && <Input label="Celular / WhatsApp" type="tel" value={g.phone} onChange={set('phone')} />}
        {mode !== 'companion' && <Input label="Correo" type="email" value={g.email} onChange={set('email')} />}
        {mode === 'full' && <Select label="Género" value={g.gender} onChange={set('gender')} options={[['F', 'Femenino'], ['M', 'Masculino'], ['X', 'Otro / no informa']]} placeholder="—" />}
        {mode !== 'companion' && (
          <Select label="País de residencia" value={g.residence_country} onChange={set('residence_country')} options={countries} placeholder="Seleccione…"
            hint={g.residence_country && g.residence_country !== 'CO' ? 'Reside en el exterior' : undefined} />
        )}
        {mode !== 'companion' && <Input label="Ciudad de residencia" value={g.residence_city} onChange={set('residence_city')} />}
        {mode === 'full' && <Input label="Dirección" value={g.address} onChange={set('address')} />}
        {mode === 'full' && <Input label="Profesión / ocupación" value={g.occupation} onChange={set('occupation')} />}
      </div>
      {mode === 'full' && <Textarea label="Notas internas" value={g.notes} onChange={set('notes')} placeholder="Preferencias, alergias, observaciones…" />}
      {foreign && mode !== 'quick' && !g.birth_date && <small className="muted">Para el reporte SIRE de extranjeros se requiere la fecha de nacimiento.</small>}
    </div>
  );
}

export const guestValid = (g, mode = 'full') => g.first_name && g.last_name && g.doc_type && g.doc_number && g.nationality && (mode === 'quick' || mode === 'companion' || g.residence_country);
