// Datos iniciales. Se ejecuta automáticamente si la base está vacía.
// `node server/seed.js --demo` agrega además huéspedes y reservas de ejemplo.
import { get, run, insert, tx } from './db.js';
import { hashPassword, today, addDays } from './lib/core.js';
import { createReservation, syncLodgingCharges, addPayment } from './lib/booking.js';

export function seedIfEmpty({ demo = false } = {}) {
  if (get('SELECT COUNT(*) AS n FROM users').n > 0) return false;
  tx(() => {
    insert('users', { name: 'Administrador', username: 'admin', role: 'admin', password_hash: hashPassword('admin123') });
    insert('users', { name: 'Recepción', username: 'recepcion', role: 'reception', password_hash: hashPassword('recepcion123') });
    insert('users', { name: 'Limpieza', username: 'limpieza', role: 'housekeeping', password_hash: hashPassword('limpieza123') });

    const std = insert('room_types', { name: 'Estándar', capacity: 2, base_price: 150000, description: 'Cama doble, baño privado', amenities: ['Wi-Fi', 'TV', 'Baño privado', 'Agua caliente'] });
    const fam = insert('room_types', { name: 'Familiar', capacity: 4, base_price: 240000, description: 'Cama doble + 2 sencillas', amenities: ['Wi-Fi', 'TV', 'Baño privado', 'Agua caliente', 'Aire acondicionado'] });
    const sui = insert('room_types', { name: 'Suite', capacity: 2, base_price: 320000, description: 'Cama king, balcón', amenities: ['Wi-Fi', 'TV', 'Baño privado', 'Agua caliente', 'Aire acondicionado', 'Minibar', 'Balcón'] });
    const plan = [['101', std, '1'], ['102', std, '1'], ['103', std, '1'], ['104', fam, '1'], ['201', std, '2'], ['202', std, '2'], ['203', fam, '2'], ['204', fam, '2'], ['301', sui, '3'], ['302', sui, '3']];
    plan.forEach(([number, type, floor], i) => insert('rooms', { number, room_type_id: type, floor, sort: i }));

    ['P1', 'P2', 'P3', 'P4'].forEach((code) => insert('parking_spaces', { code, kind: 'car' }));
    ['M1', 'M2'].forEach((code) => insert('parking_spaces', { code, kind: 'motorcycle' }));

    [['Desayuno', 18000], ['Lavandería (por prenda)', 5000], ['Transporte aeropuerto', 60000], ['Late check-out', 50000], ['Cama adicional', 40000]]
      .forEach(([name, price]) => insert('services', { name, price }));

    [['Agua 600 ml', 'Bebidas', 3500, 1500, 24, 6], ['Gaseosa 400 ml', 'Bebidas', 4500, 2000, 24, 6], ['Cerveza nacional', 'Bebidas', 6000, 3000, 24, 6],
      ['Papas fritas', 'Snacks', 4000, 2000, 12, 4], ['Chocolatina', 'Snacks', 3000, 1300, 3, 5], ['Kit de aseo', 'Aseo', 8000, 3500, 10, 3]]
      .forEach(([name, category, price, cost, stock, min_stock]) => insert('products', { name, category, price, cost, stock, min_stock }));

    insert('long_stay_rules', { min_nights: 7, discount_percent: 10 });
    insert('long_stay_rules', { min_nights: 30, discount_percent: 25 });
    const y = today().slice(0, 4);
    insert('seasons', { name: 'Temporada alta fin de año', start_date: `${y}-12-15`, end_date: `${Number(y) + 1}-01-15`, mode: 'percent', percent: 25 });
  });
  if (demo) seedDemo();
  return true;
}

function seedDemo() {
  const admin = get("SELECT id, name, role FROM users WHERE username = 'admin'");
  const t = today();
  const g1 = insert('guests', { first_name: 'Laura', last_name: 'Gómez', second_last_name: 'Ríos', doc_type: 'CC', doc_number: '1020304050', nationality: 'CO', birth_date: '1990-04-12', phone: '3001234567', email: 'laura@example.com', residence_country: 'CO', residence_city: 'Medellín' });
  const g2 = insert('guests', { first_name: 'John', last_name: 'Smith', doc_type: 'PA', doc_number: 'X1234567', nationality: 'US', birth_date: '1985-09-30', phone: '+15551234567', email: 'john@example.com', residence_country: 'US', residence_city: 'Austin', resides_abroad: 1 });
  const g3 = insert('guests', { first_name: 'Carlos', last_name: 'Pérez', doc_type: 'CC', doc_number: '79888777', nationality: 'CO', phone: '3109876543', residence_country: 'CO', residence_city: 'Bogotá' });
  const room = (n) => get('SELECT id FROM rooms WHERE number = ?', n).id;

  const r1 = createReservation({ guest_id: g1, room_ids: [room('101')], check_in: addDays(t, -1), check_out: addDays(t, 2), adults: 2, source: 'whatsapp' }, admin);
  const r2 = createReservation({ guest_id: g2, room_ids: [room('301')], check_in: addDays(t, -2), check_out: t, adults: 1, source: 'ota', source_detail: 'Booking.com' }, admin);
  createReservation({ guest_id: g3, room_ids: [room('104')], check_in: t, check_out: addDays(t, 3), adults: 3, source: 'phone' }, admin);
  createReservation({ guest_id: g3, room_ids: [room('202')], check_in: addDays(t, 4), check_out: addDays(t, 6), adults: 2, source: 'walk_in' }, admin);
  tx(() => {
    insert('reservation_guests', { reservation_id: r1, guest_id: g3, relationship: 'Amigo' });
    for (const [id, ex] of [[r1, 0], [r2, 1]]) {
      run(`UPDATE reservations SET status = 'checked_in', checked_in_at = datetime('now','-1 day'), checked_in_by = ?, tax_exempt = ?,
           travel_reason = 'Vacaciones', origin_city = 'Bogotá', destination_city = 'Cartagena' WHERE id = ?`, admin.id, ex, id);
      syncLodgingCharges(id, admin);
    }
    addPayment({ reservation_id: r1, method: 'transfer', amount: 150000, kind: 'advance' }, admin);
  });
}

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  const done = seedIfEmpty({ demo: process.argv.includes('--demo') });
  console.log(done ? 'Datos iniciales creados.' : 'La base ya tenía datos; no se modificó.');
}
