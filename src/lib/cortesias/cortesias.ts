// Cortesías (paso 19): entradas gratis que da el organizador de un evento (o
// el ADMIN), con un cupo aparte de la venta (eventos.cupo_cortesias, se pone
// en "Evento y lotes"). Decidido por Ramiro, 10/10/2026.
//
// - Cada cortesía es una orden CORTESIA, PAGADA, gratis, con UNA entrada (una
//   persona: su nombre y DNI) ya VALIDA, del tipo elegido y sin lote. No tiene
//   link de compra. Así se anula de a una persona y en la puerta es una
//   entrada como cualquiera (escáner, búsqueda por DNI y contador).
// - El email es opcional: con email, le llega el mail con el QR y el PDF (el
//   envío de siempre, pendientes.ts; las de un mismo email salen juntas); sin
//   email, el organizador baja el PDF desde el panel y se lo pasa.
// - El cupo se descuenta con un UPDATE condicionado (dadas + N <= cupo) en la
//   misma transacción que las crea: dos cargas a la vez no se pasan del cupo,
//   y la base además lo exige (eventos_numeros_validos). Ese UPDATE bloquea
//   la fila del evento hasta el final, así que dos cargas del mismo evento
//   van de a una y el control de DNI repetido ve lo que dio la otra.
// - Un DNI no puede tener dos cortesías válidas en el mismo evento (pegar la
//   misma lista dos veces no da todo dos veces).
// - Anular: la entrada pasa a ANULADA con un UPDATE condicionado (solo si
//   está VALIDA): si justo la escanean, gana uno solo (si entró, no se anula).
//   El lugar vuelve al cupo.
import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { type Alcance, filtroDeEventos, HORAS_EN_LA_PUERTA } from "@/lib/auth/alcance";
import { variantesDni } from "@/lib/entradas/buscar";
import { nuevoCodigo } from "@/lib/entradas/codigo";
import { armarPdfDeCompra, type PdfDeCompra } from "@/lib/entradas/descarga";
import { unicoRepetido } from "@/lib/errores-db";
import { DURACION_MAXIMA_ENVIO_MS, MAX_INTENTOS } from "@/lib/mails/pendientes";
import { errorDeDni, errorDeEmail, errorDeNombre, normalizarDni, normalizarNombre } from "@/lib/ventas/datos";
import { buscarCompraPorId } from "@/lib/ventas/ordenes";

import { aTexto, leerPlanilla, type Planilla } from "./planilla";
import { claveDni, type CortesiaRevisada, MAX_FILAS, revisarFilas, type TipoCortesia } from "./revision";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HORA = 60 * 60 * 1000;
const MAX_LARGO_LISTA = 100_000; // letras (200 filas largas entran de sobra)
const INTENTOS_CODIGO = 3;

export type EventoCortesias = {
  id: string;
  nombre: string;
  fecha: Date;
  productora: string;
  cupo: number;
  dadas: number;
  tipos: TipoCortesia[];
  terminado: boolean; // ya pasó (o está finalizado): no se dan más
};

// El evento, si quien pregunta lo puede ver (null si no).
export async function eventoParaCortesias(
  db: PrismaClient,
  eventoId: unknown,
  alcance: Alcance,
  ahora = new Date(),
): Promise<EventoCortesias | null> {
  if (typeof eventoId !== "string" || !UUID.test(eventoId)) return null;
  const evento = await db.evento.findFirst({
    where: { id: eventoId, ...filtroDeEventos(alcance) },
    select: {
      id: true,
      nombre: true,
      fecha: true,
      estado: true,
      cupoCortesias: true,
      cortesiasEmitidas: true,
      productora: { select: { nombre: true } },
      tipos: { orderBy: [{ orden: "asc" }, { nombre: "asc" }], select: { id: true, nombre: true } },
    },
  });
  if (!evento) return null;
  return {
    id: evento.id,
    nombre: evento.nombre,
    fecha: evento.fecha,
    productora: evento.productora.nombre,
    cupo: evento.cupoCortesias,
    dadas: evento.cortesiasEmitidas,
    tipos: evento.tipos,
    terminado: estaTerminado(evento, ahora),
  };
}

// Se dan cortesías hasta que el evento termina (24 horas después de empezar,
// como la puerta) o lo marcan finalizado.
function estaTerminado(evento: { fecha: Date; estado: string }, ahora: Date) {
  return evento.estado === "FINALIZADO" || evento.fecha.getTime() + HORAS_EN_LA_PUERTA * HORA <= ahora.getTime();
}

const TERMINADO = "El evento ya pasó: no se pueden dar más cortesías.";

// ─── Revisar la lista (carga masiva) ─────────────────────────────────────────

export type RevisionLista =
  | { ok: true; filas: CortesiaRevisada[]; validas: number; quedan: number; planilla: Planilla }
  | { ok: false; error: string };

// Lee y revisa la lista sin guardar nada: cada fila con sus errores (también
// si el DNI ya tiene una cortesía en el evento) y cuántas quedan en el cupo.
export async function revisarLista(
  db: PrismaClient,
  evento: EventoCortesias,
  texto: unknown,
  tipoPorDefectoId: unknown,
): Promise<RevisionLista> {
  if (typeof texto !== "string" || !texto.trim()) {
    return { ok: false, error: "Pegá la lista o elegí un archivo: una persona por fila, con nombre, DNI y (si tiene) email." };
  }
  if (texto.length > MAX_LARGO_LISTA) return { ok: false, error: `La lista es muy larga: cargá hasta ${MAX_FILAS} personas por vez.` };
  const planilla = leerPlanilla(
    texto,
    evento.tipos.map((tipo) => tipo.nombre),
  );
  if (planilla.filas.length === 0) return { ok: false, error: "La lista está vacía (o solo tiene los títulos)." };
  if (planilla.filas.length > MAX_FILAS) {
    return { ok: false, error: `Son ${planilla.filas.length} personas: cargá hasta ${MAX_FILAS} por vez.` };
  }
  const porDefecto = evento.tipos.find((tipo) => tipo.id === tipoPorDefectoId) ?? (evento.tipos.length === 1 ? evento.tipos[0] : null);
  const filas = revisarFilas(planilla.filas, evento.tipos, porDefecto);

  const conDni = filas.filter((fila) => fila.errores.length === 0);
  const yaTienen = await dnisConCortesia(
    db,
    evento.id,
    conDni.map((fila) => fila.dni),
  );
  for (const fila of conDni) {
    if (yaTienen.has(claveDni(fila.dni))) fila.errores.push("Ya tiene una cortesía para este evento.");
  }
  const validas = filas.filter((fila) => fila.errores.length === 0).length;
  return { ok: true, filas, validas, quedan: Math.max(0, evento.cupo - evento.dadas), planilla };
}

// Lo que queda en el cuadro después de dar las que estaban bien: las filas con
// error (con los títulos), para corregirlas.
export function filasParaCorregir(revision: Extract<RevisionLista, { ok: true }>) {
  const conError = new Set(revision.filas.filter((fila) => fila.errores.length > 0).map((fila) => fila.fila));
  return aTexto(
    revision.planilla,
    revision.planilla.filas.filter((fila) => conError.has(fila.fila)),
  );
}

// De estos DNI, los que ya tienen una cortesía válida (o usada) en el evento
// (por su claveDni: sin ceros adelante).
async function dnisConCortesia(db: Pick<PrismaClient, "entrada">, eventoId: string, dnis: string[]) {
  if (dnis.length === 0) return new Set<string>();
  const entradas = await db.entrada.findMany({
    where: {
      eventoId,
      dni: { in: dnis.flatMap(variantesDni) },
      estado: { in: ["VALIDA", "USADA"] },
      orden: { tipo: "CORTESIA" },
    },
    select: { dni: true },
  });
  return new Set(entradas.map((entrada) => claveDni(entrada.dni ?? "")));
}

// ─── Dar cortesías ───────────────────────────────────────────────────────────

export type CortesiaParaDar = { nombre: string; dni: string; email: string | null; tipoId: string };

export type Dadas =
  | { ok: true; ordenes: string[] }
  | { ok: false; error: string; repetidos?: string[] }; // repetidos: DNI que ya tenían una

type Pedido = { eventoId: string; alcance: Alcance; usuarioId: string; ahora?: Date };

class Rechazo extends Error {
  constructor(
    public mensaje: string,
    public repetidos?: string[],
  ) {
    super(mensaje);
  }
}

// Da las cortesías (ya revisadas): todas o ninguna. Después de esto, quien la
// llama pide mandar los mails (mandarMailsDespues).
export async function darCortesias(db: PrismaClient, pedido: Pedido, cortesias: CortesiaParaDar[]): Promise<Dadas> {
  const { eventoId, alcance, usuarioId, ahora = new Date() } = pedido;
  if (cortesias.length === 0) return { ok: false, error: "No hay ninguna cortesía para dar." };
  if (cortesias.length > MAX_FILAS) return { ok: false, error: `Cargá hasta ${MAX_FILAS} por vez.` };
  for (let intento = 1; ; intento++) {
    try {
      return await darEnUnaTransaccion(db, eventoId, alcance, usuarioId, ahora, cortesias);
    } catch (error) {
      if (error instanceof Rechazo) return { ok: false, error: error.mensaje, repetidos: error.repetidos };
      // Dos códigos al azar iguales (casi imposible): otra vez, con otros.
      if (intento < INTENTOS_CODIGO && unicoRepetido(error) === "entradas_codigo_key") continue;
      throw error;
    }
  }
}

async function darEnUnaTransaccion(
  db: PrismaClient,
  eventoId: string,
  alcance: Alcance,
  usuarioId: string,
  ahora: Date,
  cortesias: CortesiaParaDar[],
) {
  return db.$transaction(
    async (tx) => {
      const evento = await tx.evento.findFirst({
        where: { id: eventoId, ...filtroDeEventos(alcance) },
        select: { id: true, fecha: true, estado: true, tipos: { select: { id: true } } },
      });
      if (!evento) throw new Rechazo("Ese evento ya no existe.");
      if (estaTerminado(evento, ahora)) throw new Rechazo(TERMINADO);
      const tipos = new Set(evento.tipos.map((tipo) => tipo.id));
      if (cortesias.some((cortesia) => !tipos.has(cortesia.tipoId))) throw new Rechazo("Un tipo de entrada ya no existe. Recargá la página.");

      // El cupo: solo si alcanza (y desde acá la fila del evento queda
      // bloqueada hasta que termine: otra carga del mismo evento espera).
      const n = cortesias.length;
      const alcanzo = await tx.$executeRaw`
        UPDATE entradas.eventos SET cortesias_emitidas = cortesias_emitidas + ${n}
        WHERE id = ${eventoId}::uuid AND cortesias_emitidas + ${n} <= cupo_cortesias`;
      if (alcanzo !== 1) {
        const { cupoCortesias, cortesiasEmitidas } = await tx.evento.findUniqueOrThrow({
          where: { id: eventoId },
          select: { cupoCortesias: true, cortesiasEmitidas: true },
        });
        const quedan = Math.max(0, cupoCortesias - cortesiasEmitidas);
        throw new Rechazo(
          cupoCortesias === 0
            ? "Este evento no tiene cupo de cortesías. Ponelo en Evento y lotes → Cupo de cortesías."
            : `No alcanza el cupo: ${quedan === 0 ? "no queda ninguna" : quedan === 1 ? "queda 1" : `quedan ${quedan}`} de ${cupoCortesias}${n > 1 ? ` y son ${n}` : ""}. Podés subir el cupo en Evento y lotes.`,
        );
      }

      const yaTienen = await dnisConCortesia(
        tx,
        eventoId,
        cortesias.map((cortesia) => cortesia.dni),
      );
      if (yaTienen.size > 0) {
        const repetidos = cortesias.map((c) => c.dni).filter((dni) => yaTienen.has(claveDni(dni)));
        throw new Rechazo(
          repetidos.length === 1 ? "Ese DNI ya tiene una cortesía para este evento." : "Algunos DNI ya tienen una cortesía para este evento.",
          repetidos,
        );
      }

      // Los ids los pone el código (no la base) para atar cada entrada a su
      // orden con una sola carga de cada una.
      const ordenes = cortesias.map((cortesia) => ({ id: randomUUID(), cortesia }));
      await tx.orden.createMany({
        data: ordenes.map(({ id, cortesia }) => ({
          id,
          eventoId,
          tipo: "CORTESIA" as const,
          estado: "PAGADA" as const,
          email: cortesia.email,
          totalCentavos: 0,
          pagadaEn: ahora,
          emitidaPorId: usuarioId,
        })),
      });
      await tx.entrada.createMany({
        data: ordenes.map(({ id, cortesia }) => ({
          ordenId: id,
          eventoId,
          tipoEntradaId: cortesia.tipoId,
          titular: cortesia.nombre,
          dni: cortesia.dni,
          codigo: nuevoCodigo(),
          precioCentavos: 0,
          estado: "VALIDA" as const,
        })),
      });
      return { ok: true as const, ordenes: ordenes.map(({ id }) => id) };
    },
    { maxWait: 5_000, timeout: 20_000 },
  );
}

export type CamposCortesia = { nombre?: unknown; dni?: unknown; email?: unknown; tipoId?: unknown };
export type ErroresCortesia = { nombre?: string; dni?: string; email?: string; tipoId?: string; general?: string };

// "Dar una cortesía": revisa los campos del formulario.
export function revisarUna(
  evento: EventoCortesias,
  campos: CamposCortesia,
): { ok: true; cortesia: CortesiaParaDar } | { ok: false; errores: ErroresCortesia } {
  const texto = (valor: unknown) => (typeof valor === "string" ? valor : "");
  const nombre = normalizarNombre(texto(campos.nombre));
  const dni = normalizarDni(texto(campos.dni).trim());
  const email = texto(campos.email).trim().toLowerCase();
  const tipo = evento.tipos.find((t) => t.id === campos.tipoId);
  const errores: ErroresCortesia = {
    nombre: errorDeNombre(nombre),
    dni: errorDeDni(dni),
    email: email && errorDeEmail(email) ? "Ese email no parece válido. Revisalo (o dejalo vacío)." : undefined,
    tipoId: tipo ? undefined : "Elegí el tipo de entrada.",
  };
  if (Object.values(errores).some(Boolean)) return { ok: false, errores };
  return { ok: true, cortesia: { nombre, dni, email: email || null, tipoId: tipo!.id } };
}

// ─── Anular ──────────────────────────────────────────────────────────────────

export type Anulada = { ok: true } | { ok: false; error: string };

export async function anularCortesia(db: PrismaClient, pedido: Pedido, ordenId: unknown): Promise<Anulada> {
  const { eventoId, alcance } = pedido;
  if (typeof ordenId !== "string" || !UUID.test(ordenId)) return { ok: false, error: "No encontramos esa cortesía." };
  return db.$transaction(async (tx) => {
    const orden = await tx.orden.findFirst({
      where: { id: ordenId, eventoId, tipo: "CORTESIA", evento: filtroDeEventos(alcance) },
      select: { id: true },
    });
    if (!orden) return { ok: false as const, error: "No encontramos esa cortesía." };
    // Solo si todavía no entró: si la están escaneando justo ahora, gana uno.
    const { count } = await tx.entrada.updateMany({ where: { ordenId, estado: "VALIDA" }, data: { estado: "ANULADA" } });
    if (count === 0) {
      const entro = await tx.entrada.count({ where: { ordenId, estado: "USADA" } });
      return { ok: false as const, error: entro ? "Ya entró: no se puede anular." : "Ya estaba anulada." };
    }
    await tx.orden.updateMany({ where: { id: ordenId, estado: "PAGADA" }, data: { estado: "CANCELADA" } });
    // El lugar vuelve al cupo.
    await tx.$executeRaw`
      UPDATE entradas.eventos SET cortesias_emitidas = cortesias_emitidas - ${count} WHERE id = ${eventoId}::uuid`;
    return { ok: true as const };
  });
}

// ─── La lista del panel ──────────────────────────────────────────────────────

export type EstadoMailCortesia = "enviado" | "enviando" | "no_salio" | "sin_email";

export type CortesiaDada = {
  id: string; // de la orden
  numero: number;
  titular: string;
  dni: string;
  tipo: string;
  email: string | null;
  estado: "sin_usar" | "ingreso" | "anulada";
  usadaEn: Date | null;
  mail: EstadoMailCortesia;
  mailError: string | null;
  mailReintentaSolo: boolean; // si no salió, ¿se vuelve a intentar solo?
  dadaPor: string | null;
  dadaEn: Date;
};

export const MAX_LISTA = 1000;

// Las cortesías del evento, de la última a la primera. Quien pregunta ya
// tiene que poder ver el evento (eventoParaCortesias).
export async function listarCortesias(db: PrismaClient, eventoId: string, ahora = new Date()): Promise<CortesiaDada[]> {
  const ordenes = await db.orden.findMany({
    where: { eventoId, tipo: "CORTESIA" },
    orderBy: { numero: "desc" },
    take: MAX_LISTA,
    select: {
      id: true,
      numero: true,
      estado: true,
      email: true,
      creadoEn: true,
      mailEnviadoEn: true,
      mailIntentos: true,
      mailIntentoEn: true,
      mailError: true,
      emitidaPor: { select: { nombre: true } },
      entradas: { select: { titular: true, dni: true, estado: true, usadaEn: true, tipoEntrada: { select: { nombre: true } } } },
    },
  });
  return ordenes.map((orden) => {
    const entrada = orden.entradas[0];
    const enCurso = orden.mailIntentoEn !== null && orden.mailIntentoEn.getTime() > ahora.getTime() - DURACION_MAXIMA_ENVIO_MS;
    const mail: EstadoMailCortesia = !orden.email
      ? "sin_email"
      : orden.mailEnviadoEn
        ? "enviado"
        : enCurso || (orden.mailIntentos < MAX_INTENTOS && !orden.mailError)
          ? "enviando"
          : "no_salio";
    return {
      id: orden.id,
      numero: orden.numero,
      titular: entrada?.titular ?? "",
      dni: entrada?.dni ?? "",
      tipo: entrada?.tipoEntrada.nombre ?? "",
      email: orden.email,
      estado:
        entrada?.estado === "USADA" ? "ingreso" : entrada?.estado === "VALIDA" && orden.estado === "PAGADA" ? "sin_usar" : "anulada",
      usadaEn: entrada?.usadaEn ?? null,
      mail,
      mailError: orden.mailError,
      mailReintentaSolo: orden.mailIntentos < MAX_INTENTOS,
      dadaPor: orden.emitidaPor?.nombre ?? null,
      dadaEn: orden.creadoEn,
    };
  });
}

// ─── El PDF de una cortesía (para pasarla por WhatsApp) ─────────────────────

export async function pdfDeCortesia(
  db: PrismaClient,
  { eventoId, alcance }: { eventoId: string; alcance: Alcance },
  ordenId: unknown,
): Promise<PdfDeCompra> {
  if (typeof ordenId !== "string" || !UUID.test(ordenId)) return { ok: false, motivo: "no_encontrada" };
  const delAlcance = await db.orden.findFirst({
    where: { id: ordenId, eventoId, tipo: "CORTESIA", evento: filtroDeEventos(alcance) },
    select: { id: true },
  });
  if (!delAlcance) return { ok: false, motivo: "no_encontrada" };
  const compra = await buscarCompraPorId(db, ordenId);
  if (!compra || compra.tipo !== "CORTESIA") return { ok: false, motivo: "no_encontrada" };
  return armarPdfDeCompra(compra, null);
}
