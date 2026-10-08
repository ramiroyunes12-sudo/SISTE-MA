// Prueba (paso 11): ¿las transferencias que entran a una cuenta de Mercado Pago
// aparecen en su API? ¿Cuánta comisión cobra un cobro con Checkout Pro? Usa el
// Access Token de esa cuenta (variable MERCADOPAGO_ACCESS_TOKEN, solo en Vercel
// o en el .env). Lee los movimientos y crea, si se pide, un cobro de prueba.
import "server-only";

const API = "https://api.mercadopago.com";

export type Movimiento = {
  id: string;
  fecha: Date | null;
  entra: boolean; // true si la cuenta es la que cobra
  estado: string; // "approved", "authorized" (reservado, todavía no cobrado)…
  estadoDetalle: string;
  moneda: string; // "ARS", "USD"…
  tipo: string; // operation_type: "money_transfer", "account_fund", "regular_payment"…
  medio: string; // payment_method_id / payment_type_id: "cvu", "account_money"…
  montoCentavos: number;
  netoCentavos: number | null; // lo que quedó después de comisiones
  totalPagadoCentavos: number | null; // lo que pagó quien pagó (con recargos)
  impuestosCentavos: number; // taxes_amount
  comisionCentavos: number; // suma de fee_details
  liberacion: Date | null; // cuándo queda disponible la plata (money_release_date)
  quien: string; // nombre o email de la otra persona, si viene
  detalle: string; // descripción o referencia, si viene
  remitente: string; // datos del banco de quien transfirió, si vienen
  crudo: string; // el JSON tal cual lo manda Mercado Pago, para revisarlo
};

export type ResultadoMovimientos =
  | { ok: true; cuenta: string; movimientos: Movimiento[] }
  | { ok: false; error: string };

const aCentavos = (valor: unknown) => (typeof valor === "number" && Number.isFinite(valor) ? Math.round(valor * 100) : 0);
const texto = (valor: unknown) => (typeof valor === "string" ? valor : "");
const centavosONull = (valor: unknown) => (typeof valor === "number" && Number.isFinite(valor) ? Math.round(valor * 100) : null);
const objeto = (valor: unknown) => (valor && typeof valor === "object" ? (valor as Record<string, unknown>) : {});

async function pedir(ruta: string, token: string) {
  return fetch(`${API}${ruta}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
}

export async function leerUltimosMovimientos(token: string | undefined): Promise<ResultadoMovimientos> {
  if (!token) return { ok: false, error: "Falta cargar MERCADOPAGO_ACCESS_TOKEN en Vercel (o en el .env)." };
  try {
    const yo = await pedir("/users/me", token);
    if (yo.status === 401 || yo.status === 403) {
      return { ok: false, error: "Mercado Pago no aceptó el Access Token. Revisá que esté bien copiado y que sea el de producción." };
    }
    if (!yo.ok) return { ok: false, error: `Mercado Pago respondió ${yo.status} al pedir los datos de la cuenta.` };
    const cuenta = (await yo.json()) as { id?: number; nickname?: string; email?: string };

    const respuesta = await pedir("/v1/payments/search?sort=date_created&criteria=desc&limit=50", token);
    if (!respuesta.ok) return { ok: false, error: `Mercado Pago respondió ${respuesta.status} al pedir los movimientos.` };
    const { results } = (await respuesta.json()) as { results?: Record<string, unknown>[] };

    const movimientos = (results ?? []).map((pago): Movimiento => {
      const pagador = (pago.payer ?? {}) as Record<string, unknown>;
      const nombre = [texto(pagador.first_name), texto(pagador.last_name)].filter(Boolean).join(" ");
      const detalles = (pago.transaction_details ?? {}) as Record<string, unknown>;
      const comisiones = Array.isArray(pago.fee_details) ? (pago.fee_details as Record<string, unknown>[]) : [];
      const fecha = texto(pago.date_created);
      // En transferencias por CVU, los datos de quien mandó pueden venir acá.
      const banco = objeto(objeto(objeto(pago.point_of_interaction).transaction_data).bank_info);
      const remitente = objeto(banco.payer);
      return {
        id: String(pago.id ?? ""),
        fecha: fecha ? new Date(fecha) : null,
        entra: pago.collector_id === cuenta.id,
        estado: texto(pago.status),
        estadoDetalle: texto(pago.status_detail),
        moneda: texto(pago.currency_id),
        tipo: texto(pago.operation_type),
        medio: [texto(pago.payment_method_id), texto(pago.payment_type_id)].filter(Boolean).join(" / "),
        montoCentavos: aCentavos(pago.transaction_amount),
        netoCentavos: centavosONull(detalles.net_received_amount),
        totalPagadoCentavos: centavosONull(detalles.total_paid_amount),
        impuestosCentavos: aCentavos(pago.taxes_amount),
        comisionCentavos: comisiones.reduce((suma, c) => suma + aCentavos(c.amount), 0),
        liberacion: texto(pago.money_release_date) ? new Date(texto(pago.money_release_date)) : null,
        quien: nombre || texto(pagador.email),
        detalle: texto(pago.description) || texto(pago.external_reference),
        remitente: [texto(remitente.long_name), texto(objeto(remitente.identification).number), texto(remitente.account_id)]
          .filter(Boolean)
          .join(" · "),
        crudo: JSON.stringify(pago, null, 2),
      };
    });
    return { ok: true, cuenta: cuenta.nickname || cuenta.email || String(cuenta.id ?? ""), movimientos };
  } catch {
    return { ok: false, error: "No pudimos hablar con Mercado Pago (se cortó o tardó demasiado). Probá de nuevo." };
  }
}

// Crea un cobro de $100 con Checkout Pro y devuelve el link que abre
// Mercado Pago (en el celular, la app) con el monto ya puesto. Solo deja pagar
// con dinero en cuenta: lo que queremos medir es la comisión de ese medio.
export async function crearCobroDePrueba(
  token: string | undefined,
  volverA: string,
): Promise<{ ok: true; link: string } | { ok: false; error: string }> {
  if (!token) return { ok: false, error: "Falta cargar MERCADOPAGO_ACCESS_TOKEN en Vercel (o en el .env)." };
  try {
    const respuesta = await fetch(`${API}/checkout/preferences`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        items: [{ title: "Prueba sistema de entradas", quantity: 1, unit_price: 100, currency_id: "ARS" }],
        external_reference: `prueba-${Date.now()}`,
        payment_methods: {
          excluded_payment_types: [{ id: "credit_card" }, { id: "debit_card" }, { id: "prepaid_card" }, { id: "ticket" }],
        },
        back_urls: { success: volverA, pending: volverA, failure: volverA },
        auto_return: "approved",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const datos = (await respuesta.json().catch(() => ({}))) as Record<string, unknown>;
    if (!respuesta.ok) {
      const motivo = texto(datos.message) || texto(datos.error) || "sin detalle";
      return { ok: false, error: `Mercado Pago no dejó crear el cobro (${respuesta.status}): ${motivo.slice(0, 200)}` };
    }
    const link = texto(datos.init_point);
    if (!link.startsWith("https://")) return { ok: false, error: "Mercado Pago no devolvió el link del cobro." };
    return { ok: true, link };
  } catch {
    return { ok: false, error: "No pudimos hablar con Mercado Pago (se cortó o tardó demasiado). Probá de nuevo." };
  }
}
