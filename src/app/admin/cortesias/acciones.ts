"use server";
// Acciones de la pantalla "Cortesías" (paso 19). El organizador, en los
// eventos de su productora; el ADMIN, en todos (decidido por Ramiro,
// 10/10/2026). Cada una vuelve a mirar el usuario y el evento.
import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { requerirUsuario } from "@/lib/auth/actual";
import { alcanceDe } from "@/lib/auth/alcance";
import {
  anularCortesia,
  darCortesias,
  type ErroresCortesia,
  eventoParaCortesias,
  filasParaCorregir,
  revisarLista,
  revisarUna,
} from "@/lib/cortesias/cortesias";
import { obtenerDb } from "@/lib/db";
import { carteroSmtp } from "@/lib/mails/cartero";
import { mandarMailsDespues } from "@/lib/mails/despues";
import { reintentarMailsDelEvento } from "@/lib/mails/pendientes";
import { reenviarCortesia } from "@/lib/mails/reenviar";
import { formatearDni } from "@/lib/ventas/datos";

const ERROR_CONEXION = "No pudimos conectar con el sistema. Probá de nuevo en un rato.";
const SIN_EVENTO = "Ese evento ya no existe (o no es tuyo). Recargá la página.";

async function contexto(eventoId: unknown) {
  const usuario = await requerirUsuario(["ADMIN", "ORGANIZADOR"]);
  const alcance = alcanceDe(usuario);
  const evento = await eventoParaCortesias(obtenerDb(), eventoId, alcance);
  return { usuario, alcance, evento };
}

// Solo el motivo: nada de nombres, DNI ni emails en los logs.
function registrar(donde: string, error: unknown) {
  console.error(`[${donde}] Falló:`, error instanceof Error ? error.message : "error desconocido");
}

// ─── Dar una ─────────────────────────────────────────────────────────────────

export type EstadoUna = { errores?: ErroresCortesia; dada?: { nombre: string; email: string | null } };

export async function darUnaAccion(eventoId: string, _anterior: EstadoUna, datos: FormData): Promise<EstadoUna> {
  try {
    const { usuario, alcance, evento } = await contexto(eventoId);
    if (!evento) return { errores: { general: SIN_EVENTO } };
    const revisada = revisarUna(evento, {
      nombre: datos.get("nombre"),
      dni: datos.get("dni"),
      email: datos.get("email"),
      tipoId: datos.get("tipoId"),
    });
    if (!revisada.ok) return { errores: revisada.errores };
    const dadas = await darCortesias(obtenerDb(), { eventoId: evento.id, alcance, usuarioId: usuario.id }, [revisada.cortesia]);
    if (!dadas.ok) return { errores: dadas.repetidos ? { dni: dadas.error } : { general: dadas.error } };
    if (revisada.cortesia.email) mandarMailsDespues({ eventoId: evento.id });
    refresh();
    return { dada: { nombre: revisada.cortesia.nombre, email: revisada.cortesia.email } };
  } catch (error) {
    unstable_rethrow(error);
    registrar("darCortesia", error);
    return { errores: { general: ERROR_CONEXION } };
  }
}

// ─── Cargar varias ───────────────────────────────────────────────────────────

export type FilaVista = { fila: number; nombre: string; dni: string; email: string | null; tipo: string; errores: string[] };
export type VistaPrevia = { filas: FilaVista[]; validas: number; quedan: number };
export type EstadoLista = {
  error?: string;
  vista?: VistaPrevia; // lo revisado, para confirmar
  dadas?: { cantidad: number; conEmail: number; restante: string }; // restante: las filas con error, para corregir
};

function vistaPrevia(revision: Extract<Awaited<ReturnType<typeof revisarLista>>, { ok: true }>): VistaPrevia {
  return {
    filas: revision.filas.map((fila) => ({
      fila: fila.fila,
      nombre: fila.nombre,
      dni: /^\d{6,8}$/.test(fila.dni) ? formatearDni(fila.dni) : fila.dni,
      email: fila.email,
      tipo: fila.tipo,
      errores: fila.errores,
    })),
    validas: revision.validas,
    quedan: revision.quedan,
  };
}

// Revisa la lista sin dar nada.
export async function revisarListaAccion(eventoId: string, pedido: { texto: unknown; tipoId: unknown }): Promise<EstadoLista> {
  try {
    const { evento } = await contexto(eventoId);
    if (!evento) return { error: SIN_EVENTO };
    const revision = await revisarLista(obtenerDb(), evento, pedido?.texto, pedido?.tipoId);
    if (!revision.ok) return { error: revision.error };
    return { vista: vistaPrevia(revision) };
  } catch (error) {
    unstable_rethrow(error);
    registrar("revisarListaCortesias", error);
    return { error: ERROR_CONEXION };
  }
}

// Da las filas que están bien. `esperadas`: cuántas mostró la vista previa;
// si la lista cambió desde entonces (otra persona dio cortesías, se editó el
// cuadro), no da nada y la muestra revisada de nuevo.
export async function darListaAccion(
  eventoId: string,
  pedido: { texto: unknown; tipoId: unknown; esperadas: unknown },
): Promise<EstadoLista> {
  try {
    const { usuario, alcance, evento } = await contexto(eventoId);
    if (!evento) return { error: SIN_EVENTO };
    const revision = await revisarLista(obtenerDb(), evento, pedido?.texto, pedido?.tipoId);
    if (!revision.ok) return { error: revision.error };
    if (revision.validas !== pedido?.esperadas) {
      return { error: "La lista cambió desde que la revisaste: mirala de nuevo antes de confirmar.", vista: vistaPrevia(revision) };
    }
    const buenas = revision.filas.filter((fila) => fila.errores.length === 0);
    const dadas = await darCortesias(
      obtenerDb(),
      { eventoId: evento.id, alcance, usuarioId: usuario.id },
      buenas.map((fila) => ({ nombre: fila.nombre, dni: fila.dni, email: fila.email, tipoId: fila.tipoId! })),
    );
    if (!dadas.ok) return { error: dadas.error, vista: vistaPrevia(revision) };
    const conEmail = buenas.filter((fila) => fila.email).length;
    if (conEmail > 0) mandarMailsDespues({ eventoId: evento.id });
    refresh();
    return { dadas: { cantidad: buenas.length, conEmail, restante: filasParaCorregir(revision) } };
  } catch (error) {
    unstable_rethrow(error);
    registrar("darListaCortesias", error);
    return { error: ERROR_CONEXION };
  }
}

// ─── Cada cortesía de la lista ───────────────────────────────────────────────

export type EstadoFila = { error?: string; listo?: string };

export async function anularAccion(eventoId: string, ordenId: string): Promise<EstadoFila> {
  try {
    const { usuario, alcance, evento } = await contexto(eventoId);
    if (!evento) return { error: SIN_EVENTO };
    const anulada = await anularCortesia(obtenerDb(), { eventoId: evento.id, alcance, usuarioId: usuario.id }, ordenId);
    if (!anulada.ok) return { error: anulada.error };
    refresh();
    return { listo: "Anulada: su QR ya no entra." };
  } catch (error) {
    unstable_rethrow(error);
    registrar("anularCortesia", error);
    return { error: ERROR_CONEXION };
  }
}

export async function reenviarAccion(eventoId: string, ordenId: string): Promise<EstadoFila> {
  try {
    const { evento } = await contexto(eventoId);
    if (!evento) return { error: SIN_EVENTO };
    const reenvio = await reenviarCortesia(obtenerDb(), evento.id, ordenId);
    if (reenvio.ok) {
      mandarMailsDespues({ ordenId: reenvio.ordenId });
      refresh();
      return { listo: "Listo: el mail sale en un momento." };
    }
    if (reenvio.motivo === "limite") return { error: "Ya se reenvió 3 veces: se puede de nuevo mañana." };
    if (reenvio.motivo === "ya_sale") return { error: "El mail ya está saliendo." };
    if (reenvio.motivo === "sin_configurar") return { error: "Los mails no salen: falta configurar el servidor de mail." };
    return { error: "No encontramos esa cortesía (o no tiene email)." };
  } catch (error) {
    unstable_rethrow(error);
    registrar("reenviarCortesia", error);
    return { error: ERROR_CONEXION };
  }
}

// "Reintentar ahora" los mails de las cortesías que no salieron.
export async function reintentarMailsCortesiasAccion(eventoId: string): Promise<EstadoFila> {
  try {
    const { evento } = await contexto(eventoId);
    if (!evento) return { error: SIN_EVENTO };
    const { enviados, fallidos, sinConfigurar } = await reintentarMailsDelEvento(obtenerDb(), evento.id, carteroSmtp(), new Date(), "CORTESIA");
    refresh();
    if (sinConfigurar) return { error: "Los mails no salen: falta configurar el servidor de mail." };
    if (enviados === 0 && fallidos === 0) return { listo: "Ya se están mandando (o no había ninguno): recargá la página en un minuto." };
    const partes = [
      enviados && (enviados === 1 ? "Salió el mail de 1 cortesía" : `Salieron los mails de ${enviados} cortesías`),
      fallidos && (fallidos === 1 ? "El de 1 cortesía volvió a fallar" : `Los de ${fallidos} cortesías volvieron a fallar`),
    ].filter(Boolean);
    return fallidos ? { error: `${partes.join(". ")}.` } : { listo: `${partes.join(". ")}.` };
  } catch (error) {
    unstable_rethrow(error);
    registrar("reintentarMailsCortesias", error);
    return { error: "No pudimos mandar los mails: falló la conexión con el sistema. Probá de nuevo." };
  }
}
