// "Reenviar mis entradas": volver a mandar el mail con las entradas de una
// compra paga. Siempre al email de la compra (nunca a otro) y como mucho
// MAX_REENVIOS_POR_DIA seguidos por compra; para volver a pedir hacen falta 24
// horas sin reenvíos: así nadie lo usa para llenarle la casilla a otra persona.
//
// Se pide de tres formas:
// - Desde el link de la compra paga: la llave del link es el permiso
//   (reenviarDeCompra).
// - Desde la página del evento, con email y DNI, para quien perdió el mail y
//   el link (reenviarPorEmailYDni). La respuesta es siempre la misma, haya o
//   no una compra con esos datos. También sirve para una cortesía con email.
// - Una cortesía, desde el panel (reenviarCortesia), con el mismo límite.
//
// Acá no se manda nada: la orden queda como "falta el mail" (igual que recién
// pagada) y el envío de siempre (pendientes.ts) la manda una sola vez, con
// sus reintentos si falla. Quien lo pide llama a mandarMailsDespues.
//
// - Cada reenvío es un UPDATE condicionado: dos pedidos a la vez no pasan el
//   límite ni lo cuentan dos veces.
// - No se reenvía un mail que se está mandando o que está por salir solo (ya
//   va): solo uno que ya salió, o uno cuyo último intento terminó y falló (el
//   envío borra el error al empezar cada intento: con error, no hay ninguno en
//   curso).
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { errorDeDni, errorDeEmail, normalizarDni } from "@/lib/ventas/datos";
import { buscarCompra } from "@/lib/ventas/ordenes";

import { DURACION_MAXIMA_ENVIO_MS, hayEnvioConfigurado, MAX_INTENTOS } from "./pendientes";

export const MAX_REENVIOS_POR_DIA = 3; // seguidos, por compra (la columna reenvios_count)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DIA_MS = 24 * 60 * 60_000;

// Compras pagas (o cortesías) cuyo mail se puede volver a mandar ahora.
function sePuedeReenviar(ahora: Date): Prisma.OrdenWhereInput {
  return {
    estado: "PAGADA",
    email: { not: null },
    OR: [
      // Ya salió.
      { mailEnviadoEn: { not: null } },
      // No salió y el último intento terminó con un error (también las compras
      // de antes de los mails): al empezar un intento el error se borra.
      { mailEnviadoEn: null, mailError: { not: null } },
      // Se dejó de intentar sin error anotado (el último intento se cortó), y
      // ya pasó lo que puede durar un intento.
      {
        mailEnviadoEn: null,
        mailIntentos: { gte: MAX_INTENTOS },
        OR: [{ mailIntentoEn: null }, { mailIntentoEn: { lte: new Date(ahora.getTime() - DURACION_MAXIMA_ENVIO_MS) } }],
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
// no compras. reenviosDesde guarda el último reenvío: la cuenta vuelve a
// empezar recién después de 24 horas sin reenviar.
async function marcarParaReenviar(db: PrismaClient, donde: Prisma.OrdenWhereInput, ahora: Date) {
  const haceUnDia = new Date(ahora.getTime() - DIA_MS);
  const base: Prisma.OrdenWhereInput[] = [donde, sePuedeReenviar(ahora)];
  // Primero las que tuvieron un reenvío en las últimas 24 horas: solo si no
  // llegaron al límite. Van primero a propósito: una que marca esta consulta
  // queda con reenviosDesde = ahora y la de abajo ya no la toma, aunque en el
  // medio el mail salga entero (al revés, un pedido podría contar dos veces).
  const seguidas = await db.orden.updateManyAndReturn({
    where: { AND: [...base, { reenviosDesde: { gt: haceUnDia }, reenviosCount: { lt: MAX_REENVIOS_POR_DIA } }] },
    data: { ...FALTA_EL_MAIL, reenviosCount: { increment: 1 }, reenviosDesde: ahora },
    select: { id: true },
  });
  // Después, el primer reenvío en 24 horas: la cuenta arranca de nuevo.
  const primeras = await db.orden.updateManyAndReturn({
    where: { AND: [...base, { OR: [{ reenviosDesde: null }, { reenviosDesde: { lte: haceUnDia } }] }] },
    data: { ...FALTA_EL_MAIL, reenviosCount: 1, reenviosDesde: ahora },
    select: { id: true },
  });
  return [...seguidas, ...primeras].map((orden) => orden.id);
}

export type ReenvioDeCompra =
  | { ok: true; ordenId: string; email: string }
  | { ok: false; motivo: "ya_sale" | "limite"; ordenId: string }
  | { ok: false; motivo: "no_encontrada" | "sin_configurar" };

// "Reenviar el mail" desde el link de la compra paga.
export async function reenviarDeCompra(db: PrismaClient, llave: string, ahora = new Date()): Promise<ReenvioDeCompra> {
  const compra = await buscarCompra(db, llave, ahora);
  if (!compra || compra.estado !== "PAGADA" || !compra.email) return { ok: false, motivo: "no_encontrada" };
  return reenviarOrden(db, compra.id, compra.email, ahora);
}

// "Reenviar" de una cortesía desde el panel. Quien la pide ya tiene que poder
// ver el evento; acá se mira que la cortesía sea de ese evento.
export async function reenviarCortesia(db: PrismaClient, eventoId: string, ordenId: unknown, ahora = new Date()): Promise<ReenvioDeCompra> {
  if (typeof ordenId !== "string" || !UUID.test(ordenId)) return { ok: false, motivo: "no_encontrada" };
  const orden = await db.orden.findFirst({
    where: { id: ordenId, eventoId, tipo: "CORTESIA", estado: "PAGADA", email: { not: null } },
    select: { id: true, email: true },
  });
  if (!orden?.email) return { ok: false, motivo: "no_encontrada" };
  return reenviarOrden(db, orden.id, orden.email, ahora);
}

async function reenviarOrden(db: PrismaClient, ordenId: string, email: string, ahora: Date): Promise<ReenvioDeCompra> {
  // Sin servidor de mail no se gasta ningún reenvío.
  if (!hayEnvioConfigurado()) return { ok: false, motivo: "sin_configurar" };
  const [marcada] = await marcarParaReenviar(db, { id: ordenId }, ahora);
  if (marcada) return { ok: true, ordenId, email };
  // ¿Por qué no? Si se podía, es que llegó al límite; si no, el mail se está mandando (o está por salir).
  const sePodia = await db.orden.count({ where: { AND: [{ id: ordenId }, sePuedeReenviar(ahora)] } });
  return { ok: false, motivo: sePodia ? "limite" : "ya_sale", ordenId };
}

export type ErroresReenvio = { email?: string; dni?: string };

export type ReenvioPorDatos =
  | { ok: true; reenviadas: string[] } // ids de las órdenes (nunca se le dicen a quien pregunta)
  | { ok: false; errores: ErroresReenvio }
  | { ok: false; sinConfigurar: true };

// "Reenviar mis entradas" de la página del evento: las compras pagas (y las
// cortesías) de ese evento con ese email y con alguna entrada (válida o
// usada) de ese DNI.
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
