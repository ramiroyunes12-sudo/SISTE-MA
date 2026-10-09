// Mandar el mail con las entradas de cada compra paga, una sola vez.
//
// No se manda dentro de la transacción que confirma el pago (si el mail
// tarda o falla, no puede trabar ni deshacer la compra): falta mandarlo
// mientras la orden esté PAGADA sin mailEnviadoEn. Lo piden, después de
// responder (src/lib/mails/despues.ts), todos los que pueden haber confirmado
// un pago, la página de la compra paga y el panel; además, una vez por día,
// la tarea programada de Vercel (/api/mails/pendientes).
//
// - Cada envío primero "toma" la orden con un UPDATE condicionado (anota en
//   mailIntentoEn la hora real en que empieza y suma un intento): si dos
//   envíos corren a la vez, solo uno la toma, y nadie toma una que se está
//   mandando (hasta DURACION_MAXIMA_ENVIO_MS).
// - Si falla, queda el motivo (sin datos de la persona) y se puede volver a
//   intentar desde mailReintentarDesde: cada vez más espaciado (ESPERAS_MS),
//   hasta MAX_INTENTOS; después, solo con "Reintentar" desde el panel. El
//   límite diario de la cuenta no cuenta como intento: se espera una hora.
// - Si el mail salió pero no se pudo anotar (se cortó la base o la función
//   justo ahí), se puede mandar de nuevo más tarde: mejor dos mails que
//   ninguno.
// - Sin servidor de mail configurado o sin CLAVE_CODIGOS no se intenta nada
//   (no gasta intentos): sale cuando se configure.
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { hayClaveDeCodigos } from "@/lib/entradas/codigo";
import { entradasConQr } from "@/lib/entradas/imprimir";
import { buscarCompraPorId } from "@/lib/ventas/ordenes";

import { type Cartero, configuracionSmtp, describirErrorDeMail, esLimiteDiario, type Mensaje } from "./cartero";
import { armarMailEntradas } from "./entradas";

const MINUTO = 60_000;
export const MAX_INTENTOS = 5; // (la migración 20261009120000_mails usa el mismo número)
// Lo que puede tardar un intento como mucho: armar el mail y el plazo del
// cartero (PLAZO_ENVIO_MS, 45 s). Mientras tanto nadie más toma la orden.
export const DURACION_MAXIMA_ENVIO_MS = 2 * MINUTO;
// Cuánto esperar después del intento N que falló (el 5.º ya no se reintenta solo).
export const ESPERAS_MS = [5 * MINUTO, 15 * MINUTO, 60 * MINUTO, 4 * 60 * MINUTO];
export const ESPERA_LIMITE_DIARIO_MS = 60 * MINUTO;
// Una vuelta deja de tomar órdenes nuevas pasado este tiempo (lo que quede,
// lo manda el próximo envío): así no se pasa del tiempo de la función.
const TOPE_VUELTA_MS = 25_000;
const POR_CONSULTA = 10;

export type ResultadoEnvio = { enviados: number; fallidos: number; sinConfigurar?: true };

const NO_HAY_ENTRADAS = "No tiene entradas para mandar.";

// Las órdenes a las que les falta el mail y se pueden intentar en `momento`.
function pendientes(momento: Date): Prisma.OrdenWhereInput {
  return {
    tipo: "VENTA",
    estado: "PAGADA",
    mailEnviadoEn: null,
    email: { not: null },
    mailIntentos: { lt: MAX_INTENTOS },
    AND: [
      // Nadie la está mandando ahora.
      { OR: [{ mailIntentoEn: null }, { mailIntentoEn: { lte: new Date(momento.getTime() - DURACION_MAXIMA_ENVIO_MS) } }] },
      // Ya pasó la espera después de un intento que falló.
      { OR: [{ mailReintentarDesde: null }, { mailReintentarDesde: { lte: momento } }] },
    ],
  };
}

// ¿Puede salir algún mail? (Servidor de mail y CLAVE_CODIGOS.)
export function hayEnvioConfigurado() {
  return configuracionSmtp() !== null && hayClaveDeCodigos();
}

// El mail de una compra paga, armado desde la base (sin la llave del link).
// null si no tiene a quién o qué mandar.
export async function mailDeOrden(db: PrismaClient, ordenId: string, ahora = new Date()): Promise<Mensaje | null> {
  const compra = await buscarCompraPorId(db, ordenId, ahora);
  if (!compra || compra.estado !== "PAGADA" || !compra.email) return null;
  const entradas = entradasConQr(compra);
  if (entradas.length === 0) return null;
  const { productora } = await db.evento.findUniqueOrThrow({
    where: { id: compra.evento.id },
    select: { productora: { select: { nombre: true, emailContacto: true } } },
  });
  return armarMailEntradas({
    para: compra.email,
    productora,
    compra: compra.numero,
    totalEntradas: compra.entradas.length,
    evento: compra.evento,
    entradas,
  });
}

// `reloj`: la hora de cada paso (en los tests, una hora inventada que avanza).
async function enviarUno(db: PrismaClient, cartero: Cartero, ordenId: string, reloj: () => Date) {
  // Tomarla: si otro envío la tomó (o ya salió), no hace nada.
  const tomada = reloj();
  const [orden] = await db.orden.updateManyAndReturn({
    where: { id: ordenId, ...pendientes(tomada) },
    data: { mailIntentoEn: tomada, mailIntentos: { increment: 1 } },
    select: { mailIntentos: true },
  });
  if (!orden) return "ocupada" as const;

  let mensaje: Mensaje | null;
  try {
    mensaje = await mailDeOrden(db, ordenId, tomada);
    if (mensaje) await cartero.enviar(mensaje);
  } catch (error) {
    const motivo = describirErrorDeMail(error);
    // Solo el id y el motivo: nada de la persona en los logs.
    console.error(`[mail] Compra ${ordenId}: ${motivo}`);
    const limite = esLimiteDiario(error);
    const espera = limite ? ESPERA_LIMITE_DIARIO_MS : ESPERAS_MS[Math.min(orden.mailIntentos, ESPERAS_MS.length) - 1];
    await db.orden.update({
      where: { id: ordenId },
      data: {
        mailError: motivo,
        mailReintentarDesde: new Date(reloj().getTime() + espera),
        ...(limite ? { mailIntentos: { decrement: 1 } } : {}),
      },
    });
    return "fallo" as const;
  }
  if (!mensaje) {
    await db.orden.update({ where: { id: ordenId }, data: { mailIntentos: MAX_INTENTOS, mailError: NO_HAY_ENTRADAS } });
    return "fallo" as const;
  }
  await db.orden.update({ where: { id: ordenId }, data: { mailEnviadoEn: reloj(), mailError: null, mailReintentarDesde: null } });
  return "enviado" as const;
}

// Manda los mails que faltan (todos, los de un evento o el de una orden).
// Vuelve a buscar mientras queden y no se pase de TOPE_VUELTA_MS: en una
// ráfaga, lo que tomaron otros envíos ya no aparece y sigue con el resto. Se
// puede llamar muchas veces y a la vez: cada mail sale una vez.
export async function enviarMailsPendientes(
  db: PrismaClient,
  cartero: Cartero | null,
  opciones: { ordenId?: string; eventoId?: string; ahora?: Date } = {},
): Promise<ResultadoEnvio> {
  if (!cartero || !hayClaveDeCodigos()) return { enviados: 0, fallidos: 0, sinConfigurar: true };
  const inicio = Date.now();
  const base = (opciones.ahora ?? new Date()).getTime();
  const reloj = () => new Date(base + (Date.now() - inicio));
  const resultado: ResultadoEnvio = { enviados: 0, fallidos: 0 };
  while (Date.now() - inicio < TOPE_VUELTA_MS) {
    const candidatas = await db.orden.findMany({
      where: {
        ...pendientes(reloj()),
        ...(opciones.ordenId ? { id: opciones.ordenId } : {}),
        ...(opciones.eventoId ? { eventoId: opciones.eventoId } : {}),
      },
      orderBy: { pagadaEn: "asc" },
      take: POR_CONSULTA,
      select: { id: true },
    });
    if (candidatas.length === 0) break;
    for (const { id } of candidatas) {
      if (Date.now() - inicio >= TOPE_VUELTA_MS) break;
      const uno = await enviarUno(db, cartero, id, reloj);
      if (uno === "enviado") resultado.enviados++;
      if (uno === "fallo") resultado.fallidos++;
    }
  }
  return resultado;
}

// "Reintentar" del panel: vuelve a intentar ya los mails del evento que no
// salieron, aunque hayan llegado a MAX_INTENTOS o estén esperando. No toca
// uno que se está mandando en este momento.
export async function reintentarMailsDelEvento(
  db: PrismaClient,
  eventoId: string,
  cartero: Cartero | null,
  ahora = new Date(),
): Promise<ResultadoEnvio> {
  if (!cartero || !hayClaveDeCodigos()) return { enviados: 0, fallidos: 0, sinConfigurar: true };
  await db.orden.updateMany({
    where: {
      eventoId,
      tipo: "VENTA",
      estado: "PAGADA",
      mailEnviadoEn: null,
      OR: [{ mailIntentoEn: null }, { mailIntentoEn: { lte: new Date(ahora.getTime() - DURACION_MAXIMA_ENVIO_MS) } }],
    },
    data: { mailIntentos: 0, mailReintentarDesde: null },
  });
  return enviarMailsPendientes(db, cartero, { eventoId, ahora });
}

export type MailSinEnviar = {
  id: string;
  numero: number;
  email: string | null;
  intentos: number;
  error: string | null;
  ultimoIntento: Date | null;
  enCurso: boolean; // se está mandando ahora
  reintentaSolo: boolean; // todavía le quedan intentos automáticos
};

const MOSTRAR_SIN_ENVIAR = 20;

// Para el panel: cuántos mails salieron, cuántos no y los últimos que no.
export async function estadoDeLosMails(db: PrismaClient, eventoId: string, ahora = new Date()) {
  const donde = { eventoId, tipo: "VENTA" as const, estado: "PAGADA" as const };
  const [enviados, cuantosSinEnviar, sinEnviar] = await Promise.all([
    db.orden.count({ where: { ...donde, mailEnviadoEn: { not: null } } }),
    db.orden.count({ where: { ...donde, mailEnviadoEn: null } }),
    db.orden.findMany({
      where: { ...donde, mailEnviadoEn: null },
      orderBy: { pagadaEn: "desc" },
      take: MOSTRAR_SIN_ENVIAR,
      select: { id: true, numero: true, email: true, mailIntentos: true, mailError: true, mailIntentoEn: true },
    }),
  ]);
  return {
    enviados,
    cuantosSinEnviar,
    sinEnviar: sinEnviar.map(
      (orden): MailSinEnviar => ({
        id: orden.id,
        numero: orden.numero,
        email: orden.email,
        intentos: orden.mailIntentos,
        error: orden.mailError,
        ultimoIntento: orden.mailIntentoEn,
        enCurso: orden.mailIntentoEn !== null && orden.mailIntentoEn.getTime() > ahora.getTime() - DURACION_MAXIMA_ENVIO_MS,
        reintentaSolo: orden.mailIntentos < MAX_INTENTOS,
      }),
    ),
  };
}

// Para la página de la compra paga: ¿ya salió el mail? "nada" si no hay que
// decir nada: el envío no está configurado, o se pagó antes de que
// existieran los mails y nunca se intentó.
export async function estadoDelMail(db: PrismaClient, ordenId: string): Promise<"enviado" | "enviando" | "no_salio" | "nada"> {
  const orden = await db.orden.findUnique({
    where: { id: ordenId },
    select: { mailEnviadoEn: true, mailIntentos: true, mailIntentoEn: true },
  });
  if (!orden) return "nada";
  if (orden.mailEnviadoEn) return "enviado";
  if (!hayEnvioConfigurado()) return "nada";
  if (orden.mailIntentos < MAX_INTENTOS) return "enviando";
  return orden.mailIntentoEn ? "no_salio" : "nada";
}
