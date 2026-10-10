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
//   mailIntentoEn la hora real en que empieza, suma un intento y borra el
//   error del anterior): si dos envíos corren a la vez, solo uno la toma, y
//   nadie toma una que se está mandando (hasta DURACION_MAXIMA_ENVIO_MS).
// - Al terminar, anota el resultado solo si la orden sigue tomada por ese
//   intento (mismo mailIntentoEn): si mientras tanto la pidieron de nuevo
//   (reenviar.ts) o la tomó otro envío (este se colgó), no la pisa.
// - Si falla, queda el motivo (sin datos de la persona) y se puede volver a
//   intentar desde mailReintentarDesde: cada vez más espaciado (ESPERAS_MS),
//   hasta MAX_INTENTOS; después, solo con "Reintentar" desde el panel. El
//   límite diario de la cuenta no cuenta como intento: se espera una hora.
// - Si el mail salió pero no se pudo anotar (se cortó la base o la función
//   justo ahí), se puede mandar de nuevo más tarde: mejor dos mails que
//   ninguno.
// - Sin servidor de mail configurado o sin CLAVE_CODIGOS no se intenta nada
//   (no gasta intentos): sale cuando se configure.
// - Cuantos menos mails, mejor: las compras que le faltan a una misma
//   persona (mismo email) en el mismo evento salen juntas en un solo mail
//   (hasta MAX_COMPRAS_POR_MAIL), se toman juntas y, si falla, se reintentan
//   juntas. Por ejemplo, "Reenviar mis entradas" con varias compras.
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { whatsappDeAyuda } from "@/lib/ayuda";
import { hayClaveDeCodigos } from "@/lib/entradas/codigo";
import { type EntradaConQr, entradasConQr } from "@/lib/entradas/imprimir";
import { buscarCompraPorId, type Compra } from "@/lib/ventas/ordenes";

import { type Cartero, configuracionSmtp, describirErrorDeMail, esLimiteDiario } from "./cartero";
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
// Compras de una misma persona que van juntas en un mail, como mucho (las que
// siguen, en otro): así el mail no queda gigante.
export const MAX_COMPRAS_POR_MAIL = 10;

// De cuántas compras salió el mail y de cuántas falló (como la lista del
// panel: un mail puede llevar varias compras).
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

// El mail de las compras pagas `ids` (todas de la misma persona y del mismo
// evento: las junta enviarJuntas), armado desde la base (sin la llave del
// link). null si ninguna tiene algo para mandar; si no, el mail y qué compras
// lleva. Va como reenvío si a todas ya las pidieron de nuevo ("Reenviar mis
// entradas", reenviar.ts): todo mail después del primer reenvío es un reenvío.
async function mailDeOrdenes(db: PrismaClient, ids: string[], ahora: Date) {
  const compras: { compra: Compra; email: string; entradas: EntradaConQr[] }[] = [];
  for (const id of ids) {
    const compra = await buscarCompraPorId(db, id, ahora);
    if (!compra || compra.estado !== "PAGADA" || !compra.email) continue;
    const entradas = entradasConQr(compra);
    if (entradas.length > 0) compras.push({ compra, email: compra.email, entradas });
  }
  if (compras.length === 0) return null;
  compras.sort((a, b) => a.compra.numero - b.compra.numero);
  const [primera] = compras;
  const [ordenes, evento] = await Promise.all([
    db.orden.findMany({ where: { id: { in: compras.map(({ compra }) => compra.id) } }, select: { reenviosCount: true } }),
    db.evento.findUniqueOrThrow({ where: { id: primera.compra.evento.id }, select: { productora: { select: { nombre: true } } } }),
  ]);
  const mensaje = await armarMailEntradas({
    para: primera.email,
    productora: evento.productora,
    ayuda: whatsappDeAyuda(),
    evento: primera.compra.evento,
    compras: compras.map(({ compra, entradas }) => ({ numero: compra.numero, totalEntradas: compra.entradas.length, entradas })),
    reenvio: ordenes.every((orden) => orden.reenviosCount > 0),
  });
  return { mensaje, incluidas: compras.map(({ compra }) => compra.id) };
}

// Manda en un solo mail la compra `ordenId` y las otras que le faltan a la
// misma persona (mismo email) en el mismo evento, hasta MAX_COMPRAS_POR_MAIL.
// Devuelve de cuántas compras salió y de cuántas falló.
// `reloj`: la hora de cada paso (en los tests, una hora inventada que avanza).
async function enviarJuntas(db: PrismaClient, cartero: Cartero, ordenId: string, reloj: () => Date) {
  const ninguna = { enviadas: 0, fallidas: 0 };
  const tomada = reloj();
  const orden = await db.orden.findFirst({ where: { AND: [pendientes(tomada), { id: ordenId }] }, select: { eventoId: true, email: true } });
  if (!orden?.email) return ninguna; // otro envío la tomó (o ya salió)
  const otras = await db.orden.findMany({
    where: { AND: [pendientes(tomada), { id: { not: ordenId }, eventoId: orden.eventoId, email: orden.email }] },
    orderBy: { pagadaEn: "asc" },
    take: MAX_COMPRAS_POR_MAIL - 1,
    select: { id: true },
  });
  // Tomarlas de a una (las que otro envío tomó en el medio, o ya salieron,
  // quedan afuera). De a una a propósito: un UPDATE de varias filas las
  // bloquea en otro orden que "Reintentar" o un reenvío, y se pueden trabar.
  const tomadas: { id: string; mailIntentos: number }[] = [];
  for (const id of [ordenId, ...otras.map((otra) => otra.id)]) {
    const [una] = await db.orden.updateManyAndReturn({
      where: { AND: [pendientes(tomada), { id }] },
      data: { mailIntentoEn: tomada, mailIntentos: { increment: 1 }, mailError: null, mailReintentarDesde: null },
      select: { id: true, mailIntentos: true },
    });
    if (una) tomadas.push(una);
  }
  if (tomadas.length === 0) return ninguna;
  const ids = tomadas.map((tomadaYa) => tomadaYa.id);
  // Lo que se anota al final, solo en las que siguen tomadas por este intento.
  const siguenTomadas = (cuales: string[]) => ({ id: { in: cuales }, mailIntentoEn: tomada });

  let armado: Awaited<ReturnType<typeof mailDeOrdenes>>;
  try {
    armado = await mailDeOrdenes(db, ids, tomada);
    if (armado) await cartero.enviar(armado.mensaje);
  } catch (error) {
    const motivo = describirErrorDeMail(error);
    // Solo los ids y el motivo: nada de la persona en los logs.
    console.error(`[mail] ${ids.length === 1 ? "Compra" : "Compras"} ${ids.join(", ")}: ${motivo}`);
    const limite = esLimiteDiario(error);
    // Se reintentan juntas, con la espera de la que menos intentos lleva: una
    // recién pagada no espera horas por otra que viene fallando.
    const intentos = Math.min(...tomadas.map((tomadaYa) => tomadaYa.mailIntentos));
    const espera = limite ? ESPERA_LIMITE_DIARIO_MS : ESPERAS_MS[Math.min(intentos, ESPERAS_MS.length) - 1];
    await db.orden.updateMany({
      where: siguenTomadas(ids),
      data: {
        mailError: motivo,
        mailReintentarDesde: new Date(reloj().getTime() + espera),
        ...(limite ? { mailIntentos: { decrement: 1 } } : {}),
      },
    });
    return { enviadas: 0, fallidas: ids.length };
  }
  // Primero, anotar las que salieron (si la base se cae después, no salen otra vez).
  const incluidas = armado?.incluidas ?? [];
  if (incluidas.length > 0) {
    await db.orden.updateMany({ where: siguenTomadas(incluidas), data: { mailEnviadoEn: reloj(), mailError: null, mailReintentarDesde: null } });
  }
  // Las que no tenían nada para mandar (por ejemplo, todas sus entradas anuladas) no se reintentan.
  const sinNada = ids.filter((id) => !incluidas.includes(id));
  if (sinNada.length > 0) {
    await db.orden.updateMany({ where: siguenTomadas(sinNada), data: { mailIntentos: MAX_INTENTOS, mailError: NO_HAY_ENTRADAS } });
  }
  return { enviadas: incluidas.length, fallidas: sinNada.length };
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
      const { enviadas, fallidas } = await enviarJuntas(db, cartero, id, reloj);
      resultado.enviados += enviadas;
      resultado.fallidos += fallidas;
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

export type EstadoDelMail = "enviado" | "enviando" | "no_salio" | "nada";

// Para la página de la compra paga: ¿ya salió el mail? "nada" si no hay que
// decir nada: el envío no está configurado, o se pagó antes de que
// existieran los mails y nunca se intentó.
export async function estadoDelMail(db: PrismaClient, ordenId: string): Promise<EstadoDelMail> {
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
