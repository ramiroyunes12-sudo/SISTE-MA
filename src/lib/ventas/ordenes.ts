// La reserva de 15 minutos: al tocar "Continuar" se crea una orden PENDIENTE
// con una entrada por persona (todavía sin nombre ni DNI) y se apartan los
// lugares en los lotes. Si no se paga a tiempo, vence y los lugares vuelven.
//
// - Quien compra entra a su reserva con un link secreto (/compra/<llave>); en
//   la base solo queda la huella de la llave.
// - Límite de reservas abiertas: 3 por navegador y 15 por conexión (muchos
//   celulares comparten la misma IP de la compañía).
// - Si el mismo navegador vuelve a reservar en el mismo evento, la reserva
//   anterior se cancela (cambió lo que quería).
// - Las vencidas se liberan cuando alguien reserva en el evento, cuando se
//   abre la página del evento o el panel (liberarVencidas).
//
// Todo lo que mueve lugares pasa con el turno del evento (ver turno.ts), y
// cada orden se cierra UNA sola vez: el cambio de estado es condicionado y
// solo se liberan los lugares de las órdenes que cambiaron.
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { generarToken, huellaDeToken } from "@/lib/auth/sesiones";

import { type DatosCompra, type ErroresDatos, validarDatosCompra } from "./datos";
import { pedidoDesdeTexto, validarPedido } from "./pedido";
import { ESPERA_COMPRA_MS, liberarReservas, reservarEntradas } from "./reservas";
import { intentarTomarTurnoDelEvento, tomarTurnoDelEvento } from "./turno";

type Tx = Prisma.TransactionClient;

export const MINUTOS_RESERVA = 15; // da tiempo a transferir
export const MAX_ABIERTAS_POR_NAVEGADOR = 3;
export const MAX_ABIERTAS_POR_CONEXION = 15;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LLAVE = /^[A-Za-z0-9_-]{43}$/;

// De dónde sale la reserva: la cookie del navegador y la IP (se guardan solo sus huellas).
export type Origen = { navegador: string; ip: string };

// Un "no" que deshace la transacción (por ejemplo, si la reserva nueva no
// entra, la anterior no se cancela).
class Rechazo extends Error {
  constructor(public mensaje: string) {
    super(mensaje);
  }
}

// Cierra órdenes pendientes (VENCIDA o CANCELADA) y devuelve sus lugares.
// Hay que tener el turno del evento. Devuelve cuántas cerró.
async function cerrarOrdenes(tx: Tx, eventoId: string, ids: string[], estado: "VENCIDA" | "CANCELADA") {
  if (ids.length === 0) return 0;
  // Solo las que siguen pendientes: así ninguna se libera dos veces.
  const cerradas = (
    await tx.orden.updateManyAndReturn({
      where: { id: { in: ids }, eventoId, tipo: "VENTA", estado: "PENDIENTE" },
      data: { estado },
      select: { id: true },
    })
  ).map((orden) => orden.id);
  if (cerradas.length === 0) return 0;
  const porLote = await tx.entrada.groupBy({
    by: ["loteId"],
    where: { ordenId: { in: cerradas }, loteId: { not: null } },
    _count: { _all: true },
  });
  await liberarReservas(
    tx,
    eventoId,
    porLote.map((grupo) => ({ loteId: grupo.loteId!, cantidad: grupo._count._all })),
  );
  await tx.entrada.updateMany({ where: { ordenId: { in: cerradas } }, data: { estado: "ANULADA" } });
  return cerradas.length;
}

async function liberarVencidasEnTurno(tx: Tx, eventoId: string, ahora: Date) {
  const vencidas = await tx.orden.findMany({
    where: { eventoId, tipo: "VENTA", estado: "PENDIENTE", venceEn: { lte: ahora } },
    select: { id: true },
    take: 500,
  });
  return cerrarOrdenes(
    tx,
    eventoId,
    vencidas.map((orden) => orden.id),
    "VENCIDA",
  );
}

// Libera las reservas vencidas de un evento (al abrir una página). Primero
// mira si hay alguna, sin bloquear nada. Si hay y el turno del evento está
// libre, las libera; si está ocupado no espera (no le suma fila a las
// compras, que igual liberan las vencidas antes de reservar). Devuelve
// cuántas liberó.
export async function liberarVencidas(db: PrismaClient, eventoId: string, ahora = new Date()) {
  const hay = await db.orden.findFirst({
    where: { eventoId, tipo: "VENTA", estado: "PENDIENTE", venceEn: { lte: ahora } },
    select: { id: true },
  });
  if (!hay) return 0;
  return db.$transaction(
    async (tx) => ((await intentarTomarTurnoDelEvento(tx, eventoId)) ? liberarVencidasEnTurno(tx, eventoId, ahora) : 0),
    { maxWait: 5_000, timeout: 20_000 },
  );
}

// "Continuar": reserva lo pedido por MINUTOS_RESERVA minutos. Devuelve la
// llave del link de la compra (no se guarda en ningún lado: solo su huella).
export async function crearReserva(
  db: PrismaClient,
  eventoId: string,
  textoPedido: unknown,
  origen: Origen,
  ahora = new Date(),
): Promise<{ ok: true; llave: string; ordenId: string } | { ok: false; error: string }> {
  const pedido = validarPedido(pedidoDesdeTexto(textoPedido));
  if (!pedido.ok) return pedido;
  if (!UUID.test(eventoId)) return { ok: false, error: "Este evento no está a la venta." };

  const compradorHash = huellaDeToken(`navegador:${origen.navegador}`);
  const ipHash = huellaDeToken(`ip:${origen.ip}`);
  const llave = generarToken();
  try {
    const ordenId = await db.$transaction(
      async (tx) => {
        await tomarTurnoDelEvento(tx, eventoId, ESPERA_COMPRA_MS);
        await liberarVencidasEnTurno(tx, eventoId, ahora);

        // El mismo navegador vuelve a elegir en este evento: la reserva anterior se cancela.
        const anteriores = await tx.orden.findMany({
          where: { eventoId, compradorHash, tipo: "VENTA", estado: "PENDIENTE" },
          select: { id: true },
        });
        await cerrarOrdenes(
          tx,
          eventoId,
          anteriores.map((orden) => orden.id),
          "CANCELADA",
        );

        const abiertas = { tipo: "VENTA", estado: "PENDIENTE", venceEn: { gt: ahora } } as const;
        if ((await tx.orden.count({ where: { compradorHash, ...abiertas } })) >= MAX_ABIERTAS_POR_NAVEGADOR) {
          throw new Rechazo(
            `Ya tenés ${MAX_ABIERTAS_POR_NAVEGADOR} reservas abiertas. Terminá alguna o esperá a que venzan (${MINUTOS_RESERVA} minutos).`,
          );
        }
        if ((await tx.orden.count({ where: { ipHash, ...abiertas } })) >= MAX_ABIERTAS_POR_CONEXION) {
          throw new Rechazo("Hay demasiadas reservas abiertas desde esta conexión. Probá de nuevo en unos minutos.");
        }

        const plan = await reservarEntradas(tx, eventoId, pedido.pedido);
        if (!plan.ok) throw new Rechazo(plan.error);

        const orden = await tx.orden.create({
          data: {
            eventoId,
            tipo: "VENTA",
            estado: "PENDIENTE",
            totalCentavos: plan.totalCentavos,
            venceEn: new Date(ahora.getTime() + MINUTOS_RESERVA * 60_000),
            accesoHash: huellaDeToken(llave),
            compradorHash,
            ipHash,
          },
          select: { id: true },
        });
        // Una entrada por persona, con el lote y el precio que le tocó.
        await tx.entrada.createMany({
          data: plan.lineas.flatMap((linea) =>
            Array.from({ length: linea.cantidad }, () => ({
              ordenId: orden.id,
              eventoId,
              tipoEntradaId: linea.tipoId,
              loteId: linea.loteId,
              precioCentavos: linea.precioCentavos,
              codigo: generarToken(), // el del QR se arma en el paso 13
            })),
          ),
        });
        return orden.id;
      },
      { maxWait: 5_000, timeout: 20_000 },
    );
    return { ok: true, llave, ordenId };
  } catch (error) {
    if (error instanceof Rechazo) return { ok: false, error: error.mensaje };
    throw error;
  }
}

// ─── La página de la compra ──────────────────────────────────────────────────

export type EntradaDeCompra = {
  id: string;
  tipo: string;
  lote: string;
  precioCentavos: number;
  titular: string | null;
  dni: string | null;
};

export type Compra = {
  id: string;
  numero: number; // el "N° de orden" que ve la gente
  estado: "PENDIENTE" | "VENCIDA" | "CANCELADA" | "PAGADA" | "REEMBOLSADA";
  vencida: boolean; // pendiente, pero ya se le pasó la hora
  venceEn: Date | null;
  totalCentavos: number;
  email: string | null;
  telefono: string | null;
  evento: { id: string; slug: string; nombre: string };
  entradas: EntradaDeCompra[]; // siempre en el mismo orden: Entrada 1, 2, 3…
};

async function ordenPorLlave(db: PrismaClient | Tx, llave: string) {
  if (typeof llave !== "string" || !LLAVE.test(llave)) return null;
  return db.orden.findUnique({
    where: { accesoHash: huellaDeToken(llave) },
    select: {
      id: true,
      numero: true,
      tipo: true,
      estado: true,
      venceEn: true,
      totalCentavos: true,
      email: true,
      telefono: true,
      evento: { select: { id: true, slug: true, nombre: true } },
      entradas: {
        select: {
          id: true,
          titular: true,
          dni: true,
          precioCentavos: true,
          tipoEntrada: { select: { nombre: true, orden: true } },
          lote: { select: { nombre: true, numero: true } },
        },
      },
    },
  });
}

export async function buscarCompra(db: PrismaClient, llave: string, ahora = new Date()): Promise<Compra | null> {
  const orden = await ordenPorLlave(db, llave);
  if (!orden || orden.tipo !== "VENTA") return null;
  const entradas = [...orden.entradas]
    .sort(
      (a, b) =>
        a.tipoEntrada.orden - b.tipoEntrada.orden ||
        a.tipoEntrada.nombre.localeCompare(b.tipoEntrada.nombre) ||
        (a.lote?.numero ?? 0) - (b.lote?.numero ?? 0) ||
        a.id.localeCompare(b.id),
    )
    .map((entrada) => ({
      id: entrada.id,
      tipo: entrada.tipoEntrada.nombre,
      lote: entrada.lote?.nombre ?? "",
      precioCentavos: entrada.precioCentavos,
      titular: entrada.titular,
      dni: entrada.dni,
    }));
  return {
    id: orden.id,
    numero: orden.numero,
    estado: orden.estado,
    vencida: orden.estado === "PENDIENTE" && (!orden.venceEn || orden.venceEn <= ahora),
    venceEn: orden.venceEn,
    totalCentavos: orden.totalCentavos,
    email: orden.email,
    telefono: orden.telefono,
    evento: orden.evento,
    entradas,
  };
}

// Guarda email, celular y nombre y DNI de cada entrada, mientras la reserva
// esté vigente (se pueden corregir hasta pagar).
export async function guardarDatosCompra(
  db: PrismaClient,
  llave: string,
  leer: (campo: string) => unknown,
  ahora = new Date(),
): Promise<{ ok: true; datos: DatosCompra } | { ok: false; errores?: ErroresDatos; general?: string }> {
  const compra = await buscarCompra(db, llave, ahora);
  if (!compra) return { ok: false, general: "No encontramos tu reserva." };
  if (compra.estado !== "PENDIENTE" || compra.vencida) {
    return { ok: false, general: "Tu reserva ya no está vigente. Volvé al evento para elegir de nuevo." };
  }
  const revision = validarDatosCompra(leer, compra.entradas.length);
  if (!revision.ok) return { ok: false, errores: revision.errores };
  const { datos } = revision;

  const guardo = await db.$transaction(async (tx) => {
    // Solo si sigue pendiente y en hora (si justo venció, no se guarda nada).
    const { count } = await tx.orden.updateMany({
      where: { id: compra.id, estado: "PENDIENTE", venceEn: { gt: ahora } },
      data: { email: datos.email, telefono: datos.telefono },
    });
    if (count !== 1) return false;
    for (const [i, entrada] of compra.entradas.entries()) {
      await tx.entrada.update({
        where: { id: entrada.id },
        data: { titular: datos.entradas[i].nombre, dni: datos.entradas[i].dni },
      });
    }
    return true;
  });
  if (!guardo) return { ok: false, general: "Tu reserva ya no está vigente. Volvé al evento para elegir de nuevo." };
  return { ok: true, datos };
}

// "Cambiar entradas": cancela la reserva y devuelve los lugares.
export async function cancelarReserva(db: PrismaClient, llave: string) {
  const orden = await ordenPorLlave(db, llave);
  if (!orden || orden.tipo !== "VENTA" || orden.estado !== "PENDIENTE") return false;
  return db.$transaction(
    async (tx) => {
      await tomarTurnoDelEvento(tx, orden.evento.id, ESPERA_COMPRA_MS);
      return (await cerrarOrdenes(tx, orden.evento.id, [orden.id], "CANCELADA")) === 1;
    },
    { maxWait: 5_000, timeout: 20_000 },
  );
}
