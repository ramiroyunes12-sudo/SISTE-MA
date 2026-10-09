// "Reenviar mis entradas": volver a mandar el mail con las entradas de una
// compra paga. Siempre al email de la compra (nunca a otro) y como mucho
// MAX_REENVIOS_POR_DIA veces por compra en 24 horas: así nadie lo usa para
// llenarle la casilla a otra persona.
//
// Se pide de dos formas:
// - Desde el link de la compra paga: la llave del link es el permiso
//   (reenviarDeCompra).
// - Desde la página del evento, con email y DNI, para quien perdió el mail y
//   el link (reenviarPorEmailYDni). La respuesta es siempre la misma, haya o
//   no una compra con esos datos.
//
// Acá no se manda nada: la orden queda como "falta el mail" (igual que recién
// pagada) y el envío de siempre (pendientes.ts) la manda una sola vez, con
// sus reintentos si falla. Quien lo pide llama a mandarMailsDespues.
//
// - Cada reenvío es un UPDATE condicionado: dos pedidos a la vez no pasan el
//   límite ni lo cuentan dos veces.
// - No se reenvía un mail que se está mandando o que está por salir solo (ya
//   va): solo uno que ya salió, o uno cuyo último intento falló.
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { errorDeDni, errorDeEmail, normalizarDni } from "@/lib/ventas/datos";
import { buscarCompra } from "@/lib/ventas/ordenes";

import { DURACION_MAXIMA_ENVIO_MS, hayEnvioConfigurado, MAX_INTENTOS } from "./pendientes";

export const MAX_REENVIOS_POR_DIA = 3; // por compra (la columna reenvios_count)
const DIA_MS = 24 * 60 * 60_000;

// Compras pagas cuyo mail se puede volver a mandar ahora.
function sePuedeReenviar(ahora: Date): Prisma.OrdenWhereInput {
  return {
    tipo: "VENTA",
    estado: "PAGADA",
    email: { not: null },
    OR: [
      // Ya salió.
      { mailEnviadoEn: { not: null } },
      // No salió: el último intento falló (o se dejó de intentar, como las
      // compras de antes de los mails) y nadie lo está mandando ahora.
      {
        mailEnviadoEn: null,
        AND: [
          { OR: [{ mailError: { not: null } }, { mailIntentos: { gte: MAX_INTENTOS } }] },
          { OR: [{ mailIntentoEn: null }, { mailIntentoEn: { lte: new Date(ahora.getTime() - DURACION_MAXIMA_ENVIO_MS) } }] },
        ],
      },
    ],
  };
}

// Como recién pagada: el próximo envío la toma enseguida.
const FALTA_EL_MAIL = {
  mailEnviadoEn: null,
  mailIntentoEn: null,
  mailIntentos: 0,
  mailReintentarDesde: null,
  mailError: null,
} as const;

// Marca para reenviar las compras de `donde` que se puedan y no hayan llegado
// al límite. Devuelve sus ids. Siempre hace las mismas dos consultas, haya o
// no compras.
async function marcarParaReenviar(db: PrismaClient, donde: Prisma.OrdenWhereInput, ahora: Date) {
  const haceUnDia = new Date(ahora.getTime() - DIA_MS);
  const base: Prisma.OrdenWhereInput[] = [donde, sePuedeReenviar(ahora)];
  // Primer reenvío en 24 horas: la cuenta arranca de nuevo.
  const primeras = await db.orden.updateManyAndReturn({
    where: { AND: [...base, { OR: [{ reenviosDesde: null }, { reenviosDesde: { lte: haceUnDia } }] }] },
    data: { ...FALTA_EL_MAIL, reenviosCount: 1, reenviosDesde: ahora },
    select: { id: true },
  });
  // Ya hubo reenvíos en estas 24 horas: solo si no llegó al límite. (Las que
  // marcó la consulta anterior ya no entran: quedaron "por salir".)
  const otras = await db.orden.updateManyAndReturn({
    where: { AND: [...base, { reenviosDesde: { gt: haceUnDia }, reenviosCount: { lt: MAX_REENVIOS_POR_DIA } }] },
    data: { ...FALTA_EL_MAIL, reenviosCount: { increment: 1 } },
    select: { id: true },
  });
  return [...primeras, ...otras].map((orden) => orden.id);
}

export type ReenvioDeCompra =
  | { ok: true; ordenId: string; email: string }
  | { ok: false; motivo: "ya_sale" | "limite"; ordenId: string }
  | { ok: false; motivo: "no_encontrada" | "sin_configurar" };

// "Reenviar el mail" desde el link de la compra paga.
export async function reenviarDeCompra(db: PrismaClient, llave: string, ahora = new Date()): Promise<ReenvioDeCompra> {
  const compra = await buscarCompra(db, llave, ahora);
  if (!compra || compra.estado !== "PAGADA" || !compra.email) return { ok: false, motivo: "no_encontrada" };
  // Sin servidor de mail no se gasta ningún reenvío.
  if (!hayEnvioConfigurado()) return { ok: false, motivo: "sin_configurar" };
  const [marcada] = await marcarParaReenviar(db, { id: compra.id }, ahora);
  if (marcada) return { ok: true, ordenId: compra.id, email: compra.email };
  // ¿Por qué no? Si se podía, es que llegó al límite; si no, el mail se está mandando (o está por salir).
  const sePodia = await db.orden.count({ where: { AND: [{ id: compra.id }, sePuedeReenviar(ahora)] } });
  return { ok: false, motivo: sePodia ? "limite" : "ya_sale", ordenId: compra.id };
}

export type ErroresReenvio = { email?: string; dni?: string };

export type ReenvioPorDatos =
  | { ok: true; reenviadas: string[] } // ids de las órdenes (nunca se le dicen a quien pregunta)
  | { ok: false; errores: ErroresReenvio }
  | { ok: false; sinConfigurar: true };

// "Reenviar mis entradas" de la página del evento: las compras pagas de ese
// evento con ese email y con alguna entrada (válida o usada) de ese DNI.
export async function reenviarPorEmailYDni(
  db: PrismaClient,
  eventoId: string,
  emailEscrito: unknown,
  dniEscrito: unknown,
  ahora = new Date(),
): Promise<ReenvioPorDatos> {
  const email = typeof emailEscrito === "string" ? emailEscrito.trim().toLowerCase() : "";
  const dni = typeof dniEscrito === "string" ? normalizarDni(dniEscrito) : "";
  const errores: ErroresReenvio = { email: errorDeEmail(email), dni: errorDeDni(dni) };
  if (errores.email || errores.dni) return { ok: false, errores };
  if (!hayEnvioConfigurado()) return { ok: false, sinConfigurar: true };
  const reenviadas = await marcarParaReenviar(
    db,
    { eventoId, email, entradas: { some: { dni, estado: { in: ["VALIDA", "USADA"] } } } },
    ahora,
  );
  return { ok: true, reenviadas };
}
