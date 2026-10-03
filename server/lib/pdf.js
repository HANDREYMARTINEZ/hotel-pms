// Generación de PDF: recibo de cuenta y reportes tabulares.
import PDFDocument from 'pdfkit';
import path from 'node:path';
import fs from 'node:fs';
import { UPLOAD_DIR } from '../db.js';

export const cop = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO');
const METHODS = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', nequi: 'Nequi', daviplata: 'Daviplata' };

function header(doc, s, title) {
  const logo = s.hotel.logo && path.join(UPLOAD_DIR, 'public', path.basename(s.hotel.logo));
  let x = 50;
  if (logo && fs.existsSync(logo) && /\.(png|jpe?g)$/i.test(logo)) {
    try { doc.image(logo, 50, 45, { fit: [60, 60] }); x = 120; } catch { /* imagen no soportada */ }
  }
  doc.font('Helvetica-Bold').fontSize(15).fillColor('#111').text(s.hotel.name || 'Hotel', x, 50);
  doc.font('Helvetica').fontSize(8.5).fillColor('#555');
  const lines = [
    s.hotel.legal_name, s.hotel.nit && `NIT ${s.hotel.nit}`, s.hotel.rnt && `RNT ${s.hotel.rnt}`,
    [s.hotel.address, s.hotel.city].filter(Boolean).join(', '), [s.hotel.phone, s.hotel.email].filter(Boolean).join(' · '),
  ].filter(Boolean);
  doc.text(lines.join('\n'), x, 70);
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#111').text(title, 350, 50, { width: 195, align: 'right' });
  doc.moveTo(50, 125).lineTo(545, 125).strokeColor('#ddd').stroke();
  doc.y = 140;
}

export function receiptPdf(r, s, stream) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
  doc.pipe(stream);
  header(doc, s, 'RECIBO DE CUENTA');
  doc.font('Helvetica').fontSize(9).fillColor('#555').text(`Reserva ${r.code}`, 350, 68, { width: 195, align: 'right' });
  doc.text(new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' }), 350, 80, { width: 195, align: 'right' });

  const g = r.guest;
  doc.y = 140;
  doc.fillColor('#111').font('Helvetica-Bold').fontSize(10).text('Huésped', 50);
  doc.font('Helvetica').fontSize(9).fillColor('#333')
    .text(`${g.first_name} ${g.last_name} ${g.second_last_name || ''}`.trim())
    .text(`${g.doc_type} ${g.doc_number}${g.phone ? ' · ' + g.phone : ''}`)
    .text(`Habitación(es): ${r.rooms.map((x) => x.number).join(', ')}   ·   Llegada: ${r.check_in}   ·   Salida: ${r.check_out}`);
  if (r.tax_exempt) doc.text('Huésped extranjero no residente — alojamiento exento de IVA');
  doc.moveDown();

  // Tabla de cargos
  const cols = [50, 120, 370, 410, 480];
  const rowY = () => doc.y;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#666');
  let y = rowY();
  ['Fecha', 'Concepto', 'Cant.', 'IVA', 'Total'].forEach((h, i) => doc.text(h, cols[i], y, { width: i === 4 ? 65 : cols[i + 1] - cols[i] - 5, align: i >= 2 ? 'right' : 'left' }));
  doc.moveTo(50, y + 12).lineTo(545, y + 12).strokeColor('#e5e5e5').stroke();
  doc.y = y + 18;
  doc.font('Helvetica').fillColor('#222');
  for (const c of r.folio.charges.filter((c) => !c.voided)) {
    if (doc.y > 680) { doc.addPage(); doc.y = 50; }
    y = rowY();
    doc.text(c.service_date || '', cols[0], y, { width: 65 });
    doc.text(c.description, cols[1], y, { width: 245 });
    const h = doc.y;
    doc.text(String(c.quantity), cols[2], y, { width: 35, align: 'right' });
    doc.text(c.tax_rate ? `${c.tax_rate}%` : '—', cols[3], y, { width: 65, align: 'right' });
    doc.text(cop(c.total), cols[4], y, { width: 65, align: 'right' });
    doc.y = Math.max(h, y + 12) + 3;
  }
  doc.moveTo(50, doc.y + 2).lineTo(545, doc.y + 2).strokeColor('#e5e5e5').stroke();
  doc.moveDown();

  const s1 = r.folio.summary;
  const tot = [['Subtotal (sin impuestos)', s1.subtotal], ['Impuestos', s1.tax], ['Total', s1.total], ['Pagado', s1.paid], ['Saldo', s1.balance]];
  for (const [k, v] of tot) {
    y = doc.y;
    doc.font(k === 'Total' || k === 'Saldo' ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).fillColor('#111');
    doc.text(k, 330, y, { width: 140, align: 'right' });
    doc.text(cop(v), 480, y, { width: 65, align: 'right' });
    doc.moveDown(0.3);
  }

  const pays = r.folio.payments.filter((p) => !p.voided);
  if (pays.length) {
    doc.moveDown();
    doc.font('Helvetica-Bold').fontSize(10).text('Pagos', 50);
    doc.font('Helvetica').fontSize(8.5).fillColor('#333');
    for (const p of pays) {
      doc.text(`${p.created_at.slice(0, 16)}  ·  ${METHODS[p.method] || p.method}${p.reference ? ' (' + p.reference + ')' : ''}  ·  ${p.kind === 'refund' ? '-' : ''}${cop(p.amount)}  ·  recibió ${p.created_by_name || ''}`);
    }
  }
  doc.moveDown(2);
  doc.fontSize(7.5).fillColor('#888').text('Este documento es un recibo de cuenta y no reemplaza la factura electrónica de venta.', 50, doc.y, { align: 'center', width: 495 });
  doc.end();
}

/** PDF genérico de reporte con secciones de tablas. sections: [{title, columns:[{key,label,money?}], rows}] */
export function reportPdf(title, subtitle, sections, s, stream) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
  doc.pipe(stream);
  header(doc, s, title);
  doc.font('Helvetica').fontSize(9).fillColor('#555').text(subtitle, 350, 68, { width: 195, align: 'right' });
  doc.y = 140;
  for (const sec of sections) {
    if (doc.y > 640) { doc.addPage(); doc.y = 50; }
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111').text(sec.title, 50);
    doc.moveDown(0.4);
    const w = 495 / sec.columns.length;
    let y = doc.y;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#666');
    sec.columns.forEach((c, i) => doc.text(c.label, 50 + i * w, y, { width: w - 4, align: i ? 'right' : 'left' }));
    doc.y = y + 14;
    doc.font('Helvetica').fillColor('#222');
    for (const row of sec.rows) {
      if (doc.y > 700) { doc.addPage(); doc.y = 50; }
      y = doc.y;
      sec.columns.forEach((c, i) => doc.text(c.money ? cop(row[c.key]) : String(row[c.key] ?? ''), 50 + i * w, y, { width: w - 4, align: i ? 'right' : 'left' }));
      doc.y = y + 13;
    }
    doc.moveDown();
  }
  doc.end();
}
