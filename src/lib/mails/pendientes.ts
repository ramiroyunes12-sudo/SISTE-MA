// Mandar el mail con las entradas de cada compra paga, una sola vez.
//
// No se manda dentro de la transacción que confirma el pago (si el mail
// tarda o falla, no puede trabar ni deshacer la compra): falta mandarlo
// mientras la orden esté PAGADA sin mailEnviadoEn. Después de confirmar,
// quien confirmó lo pide con after() (src/lib/mails/despues.ts) y también lo
// piden la página de la compra paga y el panel, así lo que falló se reintenta.
//
// - Cada envío primero "toma" la orden con un UPDATE condicionado (anota
//   cuándo empezó en mailIntentoEn y suma un intento): si dos envíos corren a
//   la vez, solo uno la toma. Si falla, queda el motivo (sin datos de la
//   persona) y se reintenta pasados ESPERA_ENTRE_INTENTOS_MS, hasta
//   MAX_INTENTOS. Después, solo con "Reintentar" desde el panel.
// - Si el mail salió pero no se pudo anotar (se cortó la base justo ahí), se
//   puede mandar de nuevo más tarde: mejor dos mails que ninguno.
// - Sin servidor de mail configurado o sin CLAVE_CODIGOS no se intenta nada
//   (no gasta intentos): sale cuando se configure.
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { hayClaveDeCodigos } from "@/lib/entradas/codigo";
import { entradasConQr } from "@/lib/entradas/imprimir";
import { buscarCompraPorId } from "@/lib/ventas/ordenes";

import { type Cartero, describirErrorDeMail, type Mensaje } from "./cartero";
import { armarMailEntradas } from "./entradas";

export const MAX_INTENTOS = 5; // (la migración 20261009120000_mails usa el mismo número)
// Lo que puede tardar un envío como mucho (los plazos del cartero suman ~40 s).
export const DURACION_MAXIMA_ENVIO_MS = 2 * 60_000;
// Entre un intento y el siguiente (también evita tomar uno que sigue en curso).
export const ESPERA_ENTRE_INTENTOS_MS = 5 * 60_000;
const POR_VUELTA = 10; // así una vuelta no tarda demasiado

export type ResultadoEnvio = { enviados: number; fallidos: number; sinConfigurar?: true };

const NO_HAY_ENTRADAS = "No tiene entradas para mandar.";

// Las órdenes a las que les falta el mail y se pueden intentar ahora.
function pendientes(ahora: Date): Prisma.OrdenWhereInput {
  return {
    tipo: "VENTA",
    estado: "PAGADA",
    mailEnviadoEn: null,
    email: { not: null },
    mailIntentos: { lt: MAX_INTENTOS },
    OR: [{ mailIntentoEn: null }, { mailIntentoEn: { lte: new Date(ahora.getTime() - ESPERA_ENTRE_INTENTOS_MS) } }],
  };
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

async function enviarUno(db: PrismaClient, cartero: Cartero, ordenId: string, ahora: Date) {
  // Tomarla: si otro envío la tomó (o ya salió), no hace nada.
  const { count } = await db.orden.updateMany({
    where: { id: ordenId, ...pendientes(ahora) },
    data: { mailIntentoEn: ahora, mailIntentos: { increment: 1 } },
  });
  if (count !== 1) return "ocupada" as const;

  let mensaje: Mensaje | null;
  try {
    mensaje = await mailDeOrden(db, ordenId, ahora);
    if (mensaje) await cartero.enviar(mensaje);
  } catch (error) {
    const motivo = describirErrorDeMail(error);
    // Solo el id y el motivo: nada de la persona en los logs.
    console.error(`[mail] Compra ${ordenId}: ${motivo}`);
    await db.orden.update({ where: { id: ordenId }, data: { mailError: motivo } });
    return "fallo" as const;
  }
  if (!mensaje) {
    await db.orden.update({ where: { id: ordenId }, data: { mailIntentos: MAX_INTENTOS, mailError: NO_HAY_ENTRADAS } });
    return "fallo" as const;
  }
  await db.orden.update({ where: { id: ordenId }, data: { mailEnviadoEn: ahora, mailError: null } });
  return "enviado" as const;
}

// Manda los mails que faltan (todos, los de un evento o el de una orden), de
// a POR_VUELTA. Se puede llamar muchas veces y a la vez: cada mail sale una vez.
export async function enviarMailsPendientes(
  db: PrismaClient,
  cartero: Cartero | null,
  opciones: { ordenId?: string; eventoId?: string; ahora?: Date } = {},
): Promise<ResultadoEnvio> {
  if (!cartero || !hayClaveDeCodigos()) return { enviados: 0, fallidos: 0, sinConfigurar: true };
  const ahora = opciones.ahora ?? new Date();
  const candidatas = await db.orden.findMany({
    where: {
      ...pendientes(ahora),
      ...(opciones.ordenId ? { id: opciones.ordenId } : {}),
      ...(opciones.eventoId ? { eventoId: opciones.eventoId } : {}),
    },
    orderBy: { pagadaEn: "asc" },
    take: POR_VUELTA,
    select: { id: true },
  });
  const resultado: ResultadoEnvio = { enviados: 0, fallidos: 0 };
  for (const { id } of candidatas) {
    const uno = await enviarUno(db, cartero, id, ahora);
    if (uno === "enviado") resultado.enviados++;
    if (uno === "fallo") resultado.fallidos++;
  }
  return resultado;
}

// "Reintentar" del panel: vuelve a intentar ya los mails del evento que no
// salieron, aunque hayan llegado a MAX_INTENTOS. No toca uno que se está
// mandando en este momento.
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
    data: { mailIntentos: 0, mailIntentoEn: null },
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
  reintentaSolo: boolean; // todavía le quedan intentos automáticos
};

// Para el panel: cuántos mails salieron y cuáles no (todavía).
export async function estadoDeLosMails(db: PrismaClient, eventoId: string) {
  const donde = { eventoId, tipo: "VENTA" as const, estado: "PAGADA" as const };
  const [enviados, sinEnviar] = await Promise.all([
    db.orden.count({ where: { ...donde, mailEnviadoEn: { not: null } } }),
    db.orden.findMany({
      where: { ...donde, mailEnviadoEn: null },
      orderBy: { pagadaEn: "desc" },
      take: 100,
      select: { id: true, numero: true, email: true, mailIntentos: true, mailError: true, mailIntentoEn: true },
    }),
  ]);
  return {
    enviados,
    sinEnviar: sinEnviar.map(
      (orden): MailSinEnviar => ({
        id: orden.id,
        numero: orden.numero,
        email: orden.email,
        intentos: orden.mailIntentos,
        error: orden.mailError,
        ultimoIntento: orden.mailIntentoEn,
        reintentaSolo: orden.mailIntentos < MAX_INTENTOS,
      }),
    ),
  };
}

// Para la página de la compra paga: ¿ya salió el mail?
export async function estadoDelMail(db: PrismaClient, ordenId: string): Promise<"enviado" | "enviando" | "no_salio"> {
  const orden = await db.orden.findUnique({ where: { id: ordenId }, select: { mailEnviadoEn: true, mailIntentos: true } });
  if (orden?.mailEnviadoEn) return "enviado";
  return orden && orden.mailIntentos < MAX_INTENTOS ? "enviando" : "no_salio";
}
