// Hablar con la API de Mercado Pago. Cada llamada usa el Access Token de la
// cuenta de la productora (nunca se escribe en logs ni en mensajes).
//
// Lo que se usa:
// - /users/me: de quién es el token (al conectar la cuenta).
// - /v1/payments/{id} y /v1/payments/search: los pagos que entraron. Las
//   transferencias a la cuenta aparecen como "account_fund" (desde un banco u
//   otra billetera) o "money_transfer" (desde otra cuenta de Mercado Pago),
//   con el monto exacto y SIN datos de quien mandó. Los cobros con Checkout
//   Pro traen nuestra referencia (external_reference = id de la orden).
// - /checkout/preferences: crear el cobro con Checkout Pro.
//
// Los tests usan una versión de mentira de ApiMercadoPago (no salen a internet).

const API = "https://api.mercadopago.com";
const ESPERA_MS = 10_000;

export class ErrorMercadoPago extends Error {
  constructor(
    mensaje: string,
    public status: number,
  ) {
    super(mensaje);
  }
}

export type PagoMp = {
  id: string;
  estado: string; // approved, pending, rejected, refunded, charged_back…
  tipo: string; // operation_type: account_fund, money_transfer, regular_payment…
  montoCentavos: number;
  comisionCentavos: number;
  moneda: string;
  cobradorId: string; // collector_id: la cuenta que recibe
  referencia: string | null; // external_reference
  creadoEn: Date | null;
};

export type DatosPreferencia = {
  ordenId: string;
  titulo: string;
  totalCentavos: number;
  recargoCentavos: number;
  venceEn: Date; // después de esta hora Mercado Pago no deja pagar
  volverA: string; // a dónde vuelve quien paga
  avisoA: string | null; // a dónde avisa Mercado Pago (webhook); null en la compu (no es https)
};

export interface ApiMercadoPago {
  cuenta(token: string): Promise<{ id: string; nombre: string }>;
  pago(token: string, id: string): Promise<PagoMp | null>;
  // Los pagos desde `desde` (los más nuevos primero), hasta `maximo`.
  pagosRecientes(token: string, desde: Date, maximo?: number): Promise<PagoMp[]>;
  crearPreferencia(token: string, datos: DatosPreferencia): Promise<{ id: string; link: string }>;
}

const texto = (valor: unknown) => (typeof valor === "string" ? valor : "");
const centavos = (valor: unknown) => (typeof valor === "number" && Number.isFinite(valor) ? Math.round(valor * 100) : 0);
const fecha = (valor: unknown) => {
  const d = typeof valor === "string" ? new Date(valor) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

export function leerPagoMp(crudo: Record<string, unknown>): PagoMp {
  const comisiones = Array.isArray(crudo.fee_details) ? (crudo.fee_details as Record<string, unknown>[]) : [];
  const cobrador = crudo.collector_id ?? (crudo.collector as Record<string, unknown> | undefined)?.id;
  return {
    id: String(crudo.id ?? ""),
    estado: texto(crudo.status),
    tipo: texto(crudo.operation_type),
    montoCentavos: centavos(crudo.transaction_amount),
    comisionCentavos: comisiones.reduce((suma, c) => suma + centavos(c.amount), 0),
    moneda: texto(crudo.currency_id),
    cobradorId: cobrador === undefined || cobrador === null ? "" : String(cobrador),
    referencia: texto(crudo.external_reference) || null,
    creadoEn: fecha(crudo.date_created),
  };
}

async function pedir(token: string, ruta: string, opciones: { method?: string; body?: unknown } = {}) {
  let respuesta: Response;
  try {
    respuesta = await fetch(`${API}${ruta}`, {
      method: opciones.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(opciones.body !== undefined
          ? { "Content-Type": "application/json", "X-Idempotency-Key": crypto.randomUUID() }
          : {}),
      },
      body: opciones.body !== undefined ? JSON.stringify(opciones.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(ESPERA_MS),
    });
  } catch {
    throw new ErrorMercadoPago("No pudimos hablar con Mercado Pago (se cortó o tardó demasiado).", 0);
  }
  const datos = (await respuesta.json().catch(() => ({}))) as Record<string, unknown>;
  if (!respuesta.ok) {
    const motivo = texto(datos.message) || texto(datos.error) || "sin detalle";
    throw new ErrorMercadoPago(`Mercado Pago respondió ${respuesta.status}: ${motivo.slice(0, 200)}`, respuesta.status);
  }
  return datos;
}

export const apiMercadoPago: ApiMercadoPago = {
  async cuenta(token) {
    const datos = await pedir(token, "/users/me");
    const id = datos.id;
    if (typeof id !== "number" && typeof id !== "string") throw new ErrorMercadoPago("Mercado Pago no dijo de quién es la cuenta.", 0);
    return { id: String(id), nombre: texto(datos.nickname) || texto(datos.email) || String(id) };
  },

  async pago(token, id) {
    if (!/^\d{1,20}$/.test(id)) return null;
    try {
      return leerPagoMp(await pedir(token, `/v1/payments/${id}`));
    } catch (error) {
      if (error instanceof ErrorMercadoPago && error.status === 404) return null;
      throw error;
    }
  },

  async pagosRecientes(token, desde, maximo = 500) {
    const pagos: PagoMp[] = [];
    const porPagina = 50;
    for (let desplazamiento = 0; desplazamiento < maximo; desplazamiento += porPagina) {
      const datos = await pedir(
        token,
        `/v1/payments/search?sort=date_created&criteria=desc&limit=${porPagina}&offset=${desplazamiento}`,
      );
      const resultados = Array.isArray(datos.results) ? (datos.results as Record<string, unknown>[]) : [];
      for (const crudo of resultados) {
        const pago = leerPagoMp(crudo);
        if (pago.creadoEn && pago.creadoEn < desde) return pagos; // ya llegamos a los viejos
        pagos.push(pago);
      }
      if (resultados.length < porPagina) break;
    }
    return pagos;
  },

  async crearPreferencia(token, datos) {
    const items = [
      { id: datos.ordenId, title: datos.titulo, quantity: 1, unit_price: datos.totalCentavos / 100, currency_id: "ARS" },
    ];
    if (datos.recargoCentavos > 0) {
      items.push({
        id: "cargo-servicio",
        title: "Cargo por servicio",
        quantity: 1,
        unit_price: datos.recargoCentavos / 100,
        currency_id: "ARS",
      });
    }
    const respuesta = await pedir(token, "/checkout/preferences", {
      method: "POST",
      body: {
        items,
        external_reference: datos.ordenId,
        // Aprobado o rechazado en el momento (sin pagos "en proceso"), en una
        // sola cuota y sin efectivo (Rapipago, Pago Fácil: tardan días).
        binary_mode: true,
        payment_methods: { installments: 1, excluded_payment_types: [{ id: "ticket" }, { id: "atm" }] },
        expires: true,
        expiration_date_from: new Date().toISOString(),
        expiration_date_to: datos.venceEn.toISOString(),
        back_urls: { success: datos.volverA, pending: datos.volverA, failure: datos.volverA },
        auto_return: "approved",
        ...(datos.avisoA ? { notification_url: datos.avisoA } : {}),
      },
    });
    const link = texto(respuesta.init_point);
    const id = texto(respuesta.id);
    if (!id || !link.startsWith("https://")) throw new ErrorMercadoPago("Mercado Pago no devolvió el link del cobro.", 0);
    return { id, link };
  },
};
