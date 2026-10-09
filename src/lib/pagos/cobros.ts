// Cobrar una reserva: quien compra elige transferencia (sin recargo) o
// Mercado Pago (con cargo por servicio), y acá se ve si la plata entró.
//
// - Las dos formas necesitan la cuenta de Mercado Pago de la productora
//   conectada: es la que se revisa para ver si entró la plata.
// - Transferencia: la orden recibe un monto único (el total + desde $0,01) y
//   quien compra lo transfiere al alias de la productora. Como la
//   transferencia no dice quién la mandó, el monto exacto es lo que la ata a
//   la orden.
// - Mercado Pago: se crea un cobro con Checkout Pro que lleva el id de la
//   orden (external_reference) y vence 2 minutos antes que la reserva (así el
//   aviso llega antes de que se liberen los lugares).
// - Para ver si la plata entró se revisan los movimientos de la cuenta:
//   mientras quien compra espera en la pantalla (como mucho una consulta cada
//   5 segundos por productora, pidiendo solo lo nuevo), cuando Mercado Pago
//   avisa (webhook) y cuando vuelve del cobro. Lo que se toma de Mercado Pago
//   siempre se pide con el token de la productora: un aviso trucho no puede
//   confirmar nada.
// - Lo raro (montos mal puestos, pagos repetidos) se resuelve a mano desde el
//   panel: confirmarPagoManual y los pagos "a devolver".
import type { PrismaClient } from "@/generated/prisma/client";
import { huellaDeToken } from "@/lib/auth/sesiones";
import { formatearPesos } from "@/lib/dinero";
import { MAX_ABIERTAS_POR_CONEXION } from "@/lib/ventas/ordenes";

import { NoSePuedeConfirmar, registrarPago, type ResultadoPago } from "./confirmar";
import { type CuentaMp, cuentaMpDe } from "./cuenta";
import { type ApiMercadoPago, ErrorMercadoPago, type PagoMp } from "./mercadopago";
import { EXTRA_MAXIMO_CENTAVOS, recargoMercadoPago } from "./montos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LLAVE = /^[A-Za-z0-9_-]{43}$/;
const MINUTO = 60_000;
const HORA = 60 * MINUTO;

export const ESPACIO_ENTRE_REVISIONES_MS = 5_000;
// Cuánto sigue atado el monto de transferencia a su orden después de cerrada:
// por si la plata llega tarde (vencida o cancelada) o llega dos veces (pagada).
export const HORAS_MONTO_SIN_PAGO = 2;
export const HORAS_MONTO_PAGADA = 6;
const TOLERANCIA_RELOJ_MS = 2 * MINUTO; // diferencia de reloj con Mercado Pago
const MARGEN_REVISION_MS = 5 * MINUTO; // se vuelve a pedir un poco de lo ya revisado
const VENTANA_MAXIMA_MS = 48 * HORA;
const ESPERA_SI_LIMITE_MS = 60_000; // si Mercado Pago dice "demasiadas consultas"
const MARGEN_COBRO_MP_MS = 2 * MINUTO; // el cobro vence antes que la reserva
const MINIMO_PARA_PAGAR_MP_MS = 5 * MINUTO;

const NO_VIGENTE = "Tu reserva ya no está vigente. Volvé al evento para elegir de nuevo.";

// La orden de un link de compra, con lo que hace falta para cobrarla.
async function ordenParaCobrar(db: PrismaClient, llave: string) {
  if (typeof llave !== "string" || !LLAVE.test(llave)) return null;
  const orden = await db.orden.findUnique({
    where: { accesoHash: huellaDeToken(llave) },
    select: {
      id: true,
      tipo: true,
      estado: true,
      venceEn: true,
      totalCentavos: true,
      recargoCentavos: true,
      metodoPago: true,
      mpPreferenciaId: true,
      email: true,
      ipHash: true,
      entradas: { select: { titular: true, dni: true } },
      montoTransferencia: { select: { montoCentavos: true } },
      pagos: { where: { aDevolver: true }, select: { montoCentavos: true } },
      evento: {
        select: {
          nombre: true,
          productora: {
            select: {
              id: true,
              aliasTransferencia: true,
              titularTransferencia: true,
              recargoMpBps: true,
              mpUsuarioId: true,
              mpTokenCifrado: true,
            },
          },
        },
      },
    },
  });
  return orden && orden.tipo === "VENTA" ? orden : null;
}

type OrdenParaCobrar = NonNullable<Awaited<ReturnType<typeof ordenParaCobrar>>>;

function datosCompletos(orden: OrdenParaCobrar) {
  return Boolean(orden.email) && orden.entradas.every((entrada) => entrada.titular && entrada.dni);
}

function vigente(orden: OrdenParaCobrar, ahora: Date) {
  return orden.estado === "PENDIENTE" && orden.venceEn !== null && orden.venceEn > ahora;
}

// Con cuenta conectada y token legible (si cambió CLAVE_CIFRADO, no se ofrece
// pagar hasta volver a conectarla: no se podría confirmar nada).
function conectada(productora: OrdenParaCobrar["evento"]["productora"]) {
  return cuentaMpDe(productora) !== null;
}

// El cargo por servicio de la orden: el que quedó fijo al crear el primer
// cobro (aunque sea 0), o el de la productora si todavía no eligió Mercado Pago.
function recargoDe(orden: OrdenParaCobrar) {
  return orden.mpPreferenciaId ? orden.recargoCentavos : recargoMercadoPago(orden.totalCentavos, orden.evento.productora.recargoMpBps);
}

// Lo que la pantalla de la compra necesita para mostrar el pago.
export type OpcionesDePago = {
  datosCompletos: boolean;
  metodo: "TRANSFERENCIA" | "MERCADOPAGO" | "MANUAL" | null;
  transferencia: { alias: string; titular: string; montoCentavos: number | null } | null; // null: no se ofrece
  mercadoPago: { totalCentavos: number; recargoCentavos: number } | null; // null: no se ofrece
  aDevolverCentavos: number; // pagos que entraron pero no dieron entradas (se devuelven)
};

export async function opcionesDePago(db: PrismaClient, llave: string): Promise<OpcionesDePago | null> {
  const orden = await ordenParaCobrar(db, llave);
  if (!orden) return null;
  const { productora } = orden.evento;
  const hayCuenta = conectada(productora);
  const recargo = recargoDe(orden);
  return {
    datosCompletos: datosCompletos(orden),
    metodo: orden.metodoPago,
    transferencia:
      hayCuenta && productora.aliasTransferencia && productora.titularTransferencia
        ? {
            alias: productora.aliasTransferencia,
            titular: productora.titularTransferencia,
            montoCentavos: orden.montoTransferencia?.montoCentavos ?? null,
          }
        : null,
    mercadoPago: hayCuenta ? { totalCentavos: orden.totalCentavos + recargo, recargoCentavos: recargo } : null,
    aDevolverCentavos: orden.pagos.reduce((suma, pago) => suma + pago.montoCentavos, 0),
  };
}

// ─── Elegir cómo pagar ──────────────────────────────────────────────────────

// Le da a la orden su monto único (si no tenía): el total más los centavos
// libres más chicos. Las asignaciones de una misma productora pasan de a una
// (un bloqueo propio, que no es el turno de ningún evento), así dos órdenes
// nunca eligen el mismo monto; igual la base no lo deja repetir (índice
// único). De paso libera los montos que ya no hacen falta. Para que nadie
// ocupe todos los montos a propósito, una misma conexión (IP) puede tener
// como mucho MAX_ABIERTAS_POR_CONEXION montos de órdenes sin pagar.
async function asignarMontoTransferencia(
  db: PrismaClient,
  orden: { id: string; totalCentavos: number; ipHash: string | null },
  productoraId: string,
  ahora: Date,
): Promise<number | "ocupados" | "demasiados"> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('lock_timeout', '8000ms', true)`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`montos:${productoraId}`}, 0))`;
      const ya = await tx.montoTransferencia.findUnique({ where: { ordenId: orden.id }, select: { montoCentavos: true } });
      if (ya) return ya.montoCentavos;
      await tx.$executeRaw`
        DELETE FROM entradas.montos_transferencia m USING entradas.ordenes o
        WHERE m.orden_id = o.id AND m.productora_id = ${productoraId}::uuid
          AND (
            (o.estado = 'PAGADA' AND o.pagada_en < ${new Date(ahora.getTime() - HORAS_MONTO_PAGADA * HORA)})
            OR (o.estado NOT IN ('PENDIENTE', 'PAGADA')
                AND COALESCE(o.vence_en, o.actualizado_en) < ${new Date(ahora.getTime() - HORAS_MONTO_SIN_PAGO * HORA)})
          )`;
      if (orden.ipHash) {
        const [{ cuantos }] = await tx.$queryRaw<{ cuantos: number }[]>`
          SELECT count(*)::int AS cuantos
          FROM entradas.montos_transferencia m JOIN entradas.ordenes o ON o.id = m.orden_id
          WHERE m.productora_id = ${productoraId}::uuid AND o.ip_hash = ${orden.ipHash} AND o.estado <> 'PAGADA'`;
        if (cuantos >= MAX_ABIERTAS_POR_CONEXION) return "demasiados";
      }
      const [nuevo] = await tx.$queryRaw<{ montoCentavos: number }[]>`
        INSERT INTO entradas.montos_transferencia (orden_id, productora_id, monto_centavos)
        SELECT ${orden.id}::uuid, ${productoraId}::uuid, ${orden.totalCentavos}::int + extra
        FROM generate_series(1, ${EXTRA_MAXIMO_CENTAVOS}::int) AS extra
        WHERE NOT EXISTS (
          SELECT 1 FROM entradas.montos_transferencia m
          WHERE m.productora_id = ${productoraId}::uuid AND m.monto_centavos = ${orden.totalCentavos}::int + extra
        )
        ORDER BY extra
        LIMIT 1
        RETURNING monto_centavos AS "montoCentavos"`;
      return nuevo?.montoCentavos ?? "ocupados";
    },
    { maxWait: 5_000, timeout: 15_000 },
  );
}

async function revisarParaElegir(db: PrismaClient, llave: string, ahora: Date) {
  const orden = await ordenParaCobrar(db, llave);
  if (!orden) return { ok: false as const, error: "No encontramos tu reserva." };
  if (orden.estado === "PAGADA") return { ok: false as const, error: "Esta compra ya está paga." };
  if (!vigente(orden, ahora)) return { ok: false as const, error: NO_VIGENTE };
  if (!datosCompletos(orden)) return { ok: false as const, error: "Primero completá los datos de cada entrada." };
  return { ok: true as const, orden };
}

export async function elegirTransferencia(
  db: PrismaClient,
  llave: string,
  ahora = new Date(),
): Promise<{ ok: true; montoCentavos: number } | { ok: false; error: string }> {
  const revision = await revisarParaElegir(db, llave, ahora);
  if (!revision.ok) return revision;
  const { orden } = revision;
  const { productora } = orden.evento;
  if (!conectada(productora) || !productora.aliasTransferencia || !productora.titularTransferencia) {
    return { ok: false, error: "Este evento no tiene pago por transferencia." };
  }
  const monto = await asignarMontoTransferencia(db, orden, productora.id, ahora);
  if (monto === "demasiados") {
    return { ok: false, error: "Hay demasiadas compras sin pagar desde esta conexión. Pagá alguna o esperá a que venzan." };
  }
  if (monto === "ocupados") {
    return { ok: false, error: "Hay mucha gente pagando por transferencia en este momento. Pagá con Mercado Pago o probá en un rato." };
  }
  const { count } = await db.orden.updateMany({
    where: { id: orden.id, estado: "PENDIENTE", venceEn: { gt: ahora } },
    data: { metodoPago: "TRANSFERENCIA" },
  });
  if (count !== 1) return { ok: false, error: NO_VIGENTE };
  return { ok: true, montoCentavos: monto };
}

// Crea el cobro con Checkout Pro y devuelve el link (abre la app de Mercado
// Pago con todo cargado). El cargo por servicio queda fijo en la orden desde
// el primer cobro. Si a la reserva le quedan menos de 5 minutos, se estira
// una sola vez (al crear el primer cobro) para que dé el tiempo de pagar.
export async function elegirMercadoPago(
  db: PrismaClient,
  llave: string,
  api: ApiMercadoPago,
  urlPublica: string,
  ahora = new Date(),
): Promise<{ ok: true; link: string } | { ok: false; error: string }> {
  const revision = await revisarParaElegir(db, llave, ahora);
  if (!revision.ok) return revision;
  const { orden } = revision;
  const cuenta = cuentaMpDe(orden.evento.productora);
  if (!cuenta) return { ok: false, error: "Este evento no tiene pago con Mercado Pago." };

  const recargoCentavos = recargoDe(orden);
  let venceEn = orden.venceEn!;
  if (!orden.mpPreferenciaId && venceEn.getTime() - ahora.getTime() < MINIMO_PARA_PAGAR_MP_MS) {
    const nuevo = new Date(ahora.getTime() + MINIMO_PARA_PAGAR_MP_MS);
    const { count } = await db.orden.updateMany({
      where: { id: orden.id, estado: "PENDIENTE", venceEn: { gt: ahora }, mpPreferenciaId: null },
      data: { venceEn: nuevo },
    });
    if (count === 1) venceEn = nuevo;
  }
  const venceCobro = new Date(venceEn.getTime() - MARGEN_COBRO_MP_MS);
  if (venceCobro <= ahora) return { ok: false, error: "Ya casi no queda tiempo de tu reserva: pagá por transferencia o elegí de nuevo." };

  let preferencia: { id: string; link: string };
  try {
    preferencia = await api.crearPreferencia(cuenta.token, {
      ordenId: orden.id,
      titulo: `Entradas · ${orden.evento.nombre}`.slice(0, 250),
      totalCentavos: orden.totalCentavos,
      recargoCentavos,
      venceEn: venceCobro,
      volverA: `${urlPublica}/compra/${llave}`,
      avisoA: urlPublica.startsWith("https://") ? `${urlPublica}/api/mercadopago/aviso?p=${cuenta.productoraId}` : null,
    });
  } catch (error) {
    console.error("[elegirMercadoPago] Mercado Pago falló:", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pudimos abrir Mercado Pago. Probá de nuevo o pagá por transferencia." };
  }
  const { count } = await db.orden.updateMany({
    where: { id: orden.id, estado: "PENDIENTE", venceEn: { gt: ahora } },
    data: { metodoPago: "MERCADOPAGO", recargoCentavos, mpPreferenciaId: preferencia.id },
  });
  if (count !== 1) return { ok: false, error: NO_VIGENTE };
  return { ok: true, link: preferencia.link };
}

// ─── Ver si la plata entró ──────────────────────────────────────────────────

export type Procesado = ResultadoPago | "ignorado";

// Un pago de la cuenta de la productora: ¿de qué orden es? Si es de una,
// se registra (registrarPago decide si da las entradas).
export async function procesarPagoMp(db: PrismaClient, cuenta: CuentaMp, pago: PagoMp, ahora = new Date()): Promise<Procesado> {
  if (!pago.id || pago.cobradorId !== cuenta.mpUsuarioId || pago.moneda !== "ARS") return "ignorado";
  if (pago.estado !== "approved") {
    // Si ya estaba registrado (por ejemplo, después se devolvió), se anota el estado nuevo.
    await db.pago.updateMany({ where: { mpPagoId: pago.id }, data: { estadoMp: pago.estado } });
    return "ignorado";
  }
  const recibido = {
    mpPagoId: pago.id,
    estadoMp: pago.estado,
    montoCentavos: pago.montoCentavos,
    comisionCentavos: pago.comisionCentavos,
  };

  // Checkout Pro: trae el id de la orden.
  if (pago.referencia) {
    if (!UUID.test(pago.referencia)) return "ignorado";
    const orden = await db.orden.findFirst({
      where: { id: pago.referencia, tipo: "VENTA", evento: { productoraId: cuenta.productoraId } },
      select: { id: true, totalCentavos: true, recargoCentavos: true },
    });
    if (!orden) return "ignorado";
    const esperado = orden.totalCentavos + orden.recargoCentavos;
    return registrarPago(
      db,
      orden.id,
      { ...recibido, metodo: "MERCADOPAGO" },
      {
        ahora,
        aDevolverPor:
          pago.montoCentavos === esperado
            ? undefined
            : `Pagó ${formatearPesos(pago.montoCentavos)} y la orden era de ${formatearPesos(esperado)}.`,
      },
    );
  }

  // Transferencia: el monto exacto dice de qué orden es.
  if (pago.tipo === "account_fund" || pago.tipo === "money_transfer") {
    const monto = await db.montoTransferencia.findUnique({
      where: { productoraId_montoCentavos: { productoraId: cuenta.productoraId, montoCentavos: pago.montoCentavos } },
      select: { ordenId: true, creadoEn: true },
    });
    if (!monto) return "ignorado";
    // Una transferencia de antes de que existiera ese monto no es de esta orden.
    if (pago.creadoEn && pago.creadoEn.getTime() < monto.creadoEn.getTime() - TOLERANCIA_RELOJ_MS) return "ignorado";
    return registrarPago(db, monto.ordenId, { ...recibido, metodo: "TRANSFERENCIA" }, { ahora });
  }
  return "ignorado";
}

// Mira los movimientos de la cuenta de la productora y registra los pagos de
// sus órdenes. Si alguien ya miró hace menos de ESPACIO_ENTRE_REVISIONES_MS,
// no hace nada (así 100 personas esperando no hacen 100 consultas). Pide solo
// lo nuevo desde la última revisión que terminó bien (con 5 minutos de
// margen); si no hay ningún monto ni cobro que pueda coincidir, no consulta.
export async function revisarCobros(
  db: PrismaClient,
  productoraId: string,
  api: ApiMercadoPago,
  ahora = new Date(),
): Promise<{ revisado: boolean; confirmadas: number }> {
  if (!UUID.test(productoraId)) return { revisado: false, confirmadas: 0 };
  const [productora] = await db.$queryRaw<
    { id: string; mpUsuarioId: string | null; mpTokenCifrado: string | null; mpRevisadoHasta: Date | null }[]
  >`
    UPDATE entradas.productoras SET mp_revisado_en = ${ahora}
    WHERE id = ${productoraId}::uuid AND mp_token_cifrado IS NOT NULL
      AND (mp_revisado_en IS NULL OR mp_revisado_en <= ${new Date(ahora.getTime() - ESPACIO_ENTRE_REVISIONES_MS)})
    RETURNING id, mp_usuario_id AS "mpUsuarioId", mp_token_cifrado AS "mpTokenCifrado", mp_revisado_hasta AS "mpRevisadoHasta"`;
  if (!productora) return { revisado: false, confirmadas: 0 };
  const cuenta = cuentaMpDe(productora);
  if (!cuenta) return { revisado: false, confirmadas: 0 };

  // ¿Hay algo que pueda coincidir? Montos de transferencia vivos, o cobros de
  // Mercado Pago de órdenes sin pagar (pendientes o cerradas hace poco).
  const [transferencias, conMercadoPago] = await Promise.all([
    db.montoTransferencia.aggregate({ where: { productoraId }, _min: { creadoEn: true } }),
    db.orden.aggregate({
      where: {
        tipo: "VENTA",
        metodoPago: "MERCADOPAGO",
        evento: { productoraId },
        OR: [
          { estado: "PENDIENTE" },
          { estado: { in: ["VENCIDA", "CANCELADA"] }, venceEn: { gt: new Date(ahora.getTime() - HORAS_MONTO_SIN_PAGO * HORA) } },
        ],
      },
      _min: { creadoEn: true },
    }),
  ]);
  const fechas = [transferencias._min.creadoEn, conMercadoPago._min.creadoEn].filter((fecha): fecha is Date => fecha !== null);
  if (fechas.length === 0) {
    await db.productora.update({ where: { id: productoraId }, data: { mpRevisadoHasta: ahora } });
    return { revisado: true, confirmadas: 0 };
  }
  const masVieja = Math.min(...fechas.map((fecha) => fecha.getTime())) - TOLERANCIA_RELOJ_MS;
  const desde = new Date(
    Math.max(
      productora.mpRevisadoHasta ? Math.max(productora.mpRevisadoHasta.getTime() - MARGEN_REVISION_MS, masVieja) : masVieja,
      ahora.getTime() - VENTANA_MAXIMA_MS,
    ),
  );

  let pagos: PagoMp[];
  try {
    pagos = await api.pagosRecientes(cuenta.token, desde);
  } catch (error) {
    if (error instanceof ErrorMercadoPago && error.status === 429) {
      // "Demasiadas consultas": nadie vuelve a consultar por un minuto.
      await db.productora.update({ where: { id: productoraId }, data: { mpRevisadoEn: new Date(ahora.getTime() + ESPERA_SI_LIMITE_MS) } });
    }
    throw error;
  }
  pagos = pagos.filter((pago) => pago.estado === "approved" && pago.cobradorId === cuenta.mpUsuarioId);
  const vistos = new Set(
    pagos.length
      ? (await db.pago.findMany({ where: { mpPagoId: { in: pagos.map((pago) => pago.id) } }, select: { mpPagoId: true } })).map(
          (pago) => pago.mpPagoId,
        )
      : [],
  );
  let confirmadas = 0;
  for (const pago of pagos) {
    if (vistos.has(pago.id)) continue;
    const resultado = await procesarPagoMp(db, cuenta, pago, ahora);
    if (resultado === "confirmada" || resultado === "confirmada_tarde") confirmadas++;
  }
  // Recién ahora (si todo anduvo) queda revisado hasta acá.
  await db.productora.update({ where: { id: productoraId }, data: { mpRevisadoHasta: ahora } });
  return { revisado: true, confirmadas };
}

// Mercado Pago avisó (webhook) que hay novedades de un pago. El aviso solo
// dice el número: el pago se pide a Mercado Pago con el token de la
// productora (un aviso inventado no confirma nada). La productora sale del
// link del aviso (?p=), que solo conoce Mercado Pago.
export async function procesarAviso(
  db: PrismaClient,
  aviso: { productoraId: string | null; pagoId: string },
  api: ApiMercadoPago,
  ahora = new Date(),
): Promise<Procesado> {
  if (!/^\d{1,20}$/.test(aviso.pagoId) || !aviso.productoraId || !UUID.test(aviso.productoraId)) return "ignorado";
  const productora = await db.productora.findUnique({
    where: { id: aviso.productoraId },
    select: { id: true, mpUsuarioId: true, mpTokenCifrado: true },
  });
  const cuenta = productora ? cuentaMpDe(productora) : null;
  if (!cuenta) return "ignorado";
  const pago = await api.pago(cuenta.token, aviso.pagoId);
  if (!pago) return "ignorado";
  return procesarPagoMp(db, cuenta, pago, ahora);
}

export type EstadoDeCompra = { estado: string; aDevolver: boolean };

// La pantalla de la compra pregunta si ya entró la plata. Si vuelve de
// Mercado Pago con el número del pago (y no estaba registrado), se mira ese;
// si no, se revisan los movimientos (con el límite de una consulta cada 5
// segundos por productora).
export async function revisarPagoDeCompra(
  db: PrismaClient,
  llave: string,
  api: ApiMercadoPago,
  pagoId: string | null = null,
  ahora = new Date(),
): Promise<EstadoDeCompra | null> {
  const orden = await ordenParaCobrar(db, llave);
  if (!orden) return null;
  const esperando = orden.estado !== "PAGADA" && orden.metodoPago !== null && orden.pagos.length === 0;
  if (esperando) {
    const { productora } = orden.evento;
    try {
      if (pagoId && /^\d{1,20}$/.test(pagoId)) {
        const ya = await db.pago.findUnique({ where: { mpPagoId: pagoId }, select: { id: true } });
        if (!ya) await procesarAviso(db, { productoraId: productora.id, pagoId }, api, ahora);
      } else {
        await revisarCobros(db, productora.id, api, ahora);
      }
    } catch (error) {
      // Si Mercado Pago no responde, se vuelve a mirar en la próxima consulta.
      console.error("[revisarPagoDeCompra] Falló:", error instanceof Error ? error.message : error);
    }
  }
  const actual = await db.orden.findUnique({
    where: { id: orden.id },
    select: { estado: true, pagos: { where: { aDevolver: true }, select: { id: true } } },
  });
  return actual ? { estado: actual.estado, aDevolver: actual.pagos.length > 0 } : null;
}

// ─── Confirmar a mano (panel) ───────────────────────────────────────────────

// Para los casos raros (transfirió sin los centavos, o la plata entró y el
// sistema no la vio, o llegó tarde sin lugar y después se hizo lugar): alguien
// del panel lo vio en su Mercado Pago y confirma. Si la orden ya tiene un pago
// "a devolver", se usa ese (ver registrarPago).
// `puedeVer`: si quien confirma puede tocar ese evento (ver alcance.ts).
export async function confirmarPagoManual(
  db: PrismaClient,
  ordenId: string,
  usuarioId: string,
  puedeVer: (eventoId: string) => Promise<boolean>,
  ahora = new Date(),
): Promise<{ ok: true; resultado: ResultadoPago } | { ok: false; error: string }> {
  if (!UUID.test(ordenId)) return { ok: false, error: "No encontramos esa compra." };
  const orden = await db.orden.findUnique({
    where: { id: ordenId },
    select: {
      tipo: true,
      estado: true,
      eventoId: true,
      totalCentavos: true,
      recargoCentavos: true,
      metodoPago: true,
      montoTransferencia: { select: { montoCentavos: true } },
    },
  });
  if (!orden || orden.tipo !== "VENTA" || !(await puedeVer(orden.eventoId))) {
    return { ok: false, error: "No encontramos esa compra." };
  }
  if (orden.estado === "PAGADA") return { ok: false, error: "Esa compra ya está paga." };
  if (orden.estado === "REEMBOLSADA") return { ok: false, error: "Esa compra fue reembolsada." };
  const montoCentavos =
    orden.metodoPago === "MERCADOPAGO"
      ? orden.totalCentavos + orden.recargoCentavos
      : (orden.montoTransferencia?.montoCentavos ?? orden.totalCentavos);
  try {
    const resultado = await registrarPago(
      db,
      ordenId,
      { mpPagoId: `manual:${ordenId}`, metodo: "MANUAL", estadoMp: "approved", montoCentavos, registradoPorId: usuarioId },
      { ahora },
    );
    if (resultado === "ya_registrado") return { ok: false, error: "Esa compra ya se había confirmado a mano." };
    return { ok: true, resultado };
  } catch (error) {
    if (error instanceof NoSePuedeConfirmar) return { ok: false, error: error.message };
    throw error;
  }
}
