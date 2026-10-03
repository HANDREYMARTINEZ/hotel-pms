// Integración con proveedor tecnológico de facturación electrónica (DIAN).
// Cada proveedor implementa `send(invoice, settings)` y devuelve
// { status, provider_ref, cufe, number, response }. Para conectar un proveedor
// real (p. ej. Siigo, Alegra, Facture, Carvajal, The Factory HKA) se agrega aquí un adaptador
// que traduzca el JSON interno al formato de su API.

const providers = {
  // Sin proveedor: la factura queda registrada como borrador para emitirla manualmente.
  none: {
    label: 'Ninguno (emisión manual)',
    async send() {
      return { status: 'draft', response: { message: 'Sin proveedor configurado. Emita la factura en el portal de su proveedor o de la DIAN.' } };
    },
  },
  // Adaptador REST genérico: envía el JSON interno a la URL configurada.
  generic_rest: {
    label: 'API REST genérica',
    async send(invoice, cfg) {
      if (!cfg.api_url) throw new Error('Configure la URL de la API del proveedor');
      const resp = await fetch(cfg.api_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.api_key}` },
        body: JSON.stringify({ environment: cfg.environment, resolution: cfg.resolution, prefix: cfg.prefix, invoice }),
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) return { status: 'error', response: body };
      return { status: body.status || 'sent', provider_ref: body.id || null, cufe: body.cufe || null, number: body.number || null, response: body };
    },
  },
};

export const listProviders = () => Object.entries(providers).map(([code, p]) => ({ code, label: p.label }));

export async function sendInvoice(invoice, settings) {
  const cfg = settings.einvoice;
  const p = providers[cfg.enabled ? cfg.provider : 'none'] || providers.none;
  return p.send(invoice, cfg);
}

/** Construye las líneas de factura a partir de la cuenta de una reserva. */
export function linesFromFolio(folio, exempt) {
  return folio.charges.filter((c) => !c.voided).map((c) => ({
    description: c.description,
    quantity: c.quantity,
    total: c.total,
    base: c.total - c.tax_amount,
    tax_rate: c.tax_rate,
    tax_amount: c.tax_amount,
    // Art. 481 lit. d) E.T.: servicios hoteleros a residentes en el exterior.
    tax_note: c.category === 'lodging' && exempt ? 'Exento - Art. 481 lit. d) E.T.' : null,
  }));
}
