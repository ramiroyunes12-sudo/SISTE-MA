"use server";

import { refresh } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";

import { requerirUsuario } from "@/lib/auth/actual";
import { alcanceDe, filtroDeEventos } from "@/lib/auth/alcance";
import { obtenerDb } from "@/lib/db";
import { verificarCodigo } from "@/lib/entradas/verificar";
import { formatearFecha } from "@/lib/fechas";
import { carteroSmtp } from "@/lib/mails/cartero";
import { mandarMailsDespues } from "@/lib/mails/despues";
import { reintentarMailsDelEvento } from "@/lib/mails/pendientes";
import { confirmarPagoManual, revisarCobros } from "@/lib/pagos/cobros";
import { apiMercadoPago } from "@/lib/pagos/mercadopago";
import { type Errores, validarEvento } from "@/lib/eventos/editor";
import { guardarEvento } from "@/lib/eventos/guardar";
import { formatearDni } from "@/lib/ventas/datos";
import { type ResultadoSimulacion, simularCompra } from "@/lib/ventas/simulacion";

export type EstadoGuardado = { errores?: Errores };
export type EstadoSimulacion = ResultadoSimulacion;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Guarda el evento (nuevo si eventoId es null) con sus tipos y lotes.
export async function guardarEventoDesdeEditor(
  _anterior: EstadoGuardado,
  envio: { eventoId: string | null; evento: unknown },
): Promise<EstadoGuardado> {
  const usuario = await requerirUsuario(["ADMIN", "ORGANIZADOR"]);

  const eventoId = envio?.eventoId ?? null;
  if (eventoId !== null && (typeof eventoId !== "string" || !UUID.test(eventoId))) {
    return { errores: { general: "Los datos no son válidos. Recargá la página." } };
  }
  const validacion = validarEvento(envio?.evento);
  // El dueño, al crear, tiene que elegir la productora (se avisa junto con lo demás).
  const elegida = (envio?.evento as { productoraId?: unknown } | undefined)?.productoraId;
  const faltaProductora =
    usuario.rol === "ADMIN" && eventoId === null && !(typeof elegida === "string" && UUID.test(elegida));
  if (!validacion.ok || faltaProductora) {
    return {
      errores: {
        ...(validacion.ok ? {} : validacion.errores),
        ...(faltaProductora ? { productoraId: "Elegí una productora." } : {}),
      },
    };
  }

  let id: string;
  try {
    const resultado = await guardarEvento(obtenerDb(), eventoId, validacion.datos, alcanceDe(usuario));
    if (!resultado.ok) return { errores: resultado.errores };
    id = resultado.id;
  } catch (error) {
    unstable_rethrow(error);
    console.error("[guardarEvento] Falló:", error);
    return { errores: { general: "No pudimos guardar: falló la conexión con el sistema. Probá de nuevo." } };
  }
  redirect(`/admin/eventos/${id}?guardado=1`);
}

// "Probar una compra": cómo se repartiría un pedido en los lotes si alguien
// comprara ahora (src/lib/ventas/simulacion.ts). No reserva ni vende nada.
export async function simularCompraAccion(
  eventoId: string,
  _anterior: EstadoSimulacion,
  datos: FormData,
): Promise<EstadoSimulacion> {
  const usuario = await requerirUsuario(["ADMIN", "ORGANIZADOR"]);
  if (!UUID.test(eventoId)) return { error: "Ese evento ya no existe." };
  try {
    return await simularCompra(obtenerDb(), eventoId, alcanceDe(usuario), (tipoId) =>
      String(datos.get(`cantidad-${tipoId}`) ?? ""),
    );
  } catch (error) {
    unstable_rethrow(error);
    console.error("[simularCompra] Falló:", error);
    return { error: "No pudimos hacer la prueba: falló la conexión con el sistema. Probá de nuevo." };
  }
}

// ─── Pagos del evento ────────────────────────────────────────────────────────

export type EstadoPagoManual = { error?: string; listo?: string };

// "Confirmar pago": lo vio en su Mercado Pago (por ejemplo, transfirió sin los
// centavos). Al confirmar, la compra sale de la lista: el aviso se muestra
// arriba de la sección (?pagada=<N° de compra>).
export async function confirmarPagoAccion(eventoId: string, ordenId: string): Promise<EstadoPagoManual> {
  const usuario = await requerirUsuario(["ADMIN", "ORGANIZADOR"]);
  if (!UUID.test(String(eventoId)) || !UUID.test(String(ordenId))) return { error: "Datos no válidos. Recargá la página." };
  const filtro = filtroDeEventos(alcanceDe(usuario));
  let numero: number;
  try {
    const resultado = await confirmarPagoManual(obtenerDb(), ordenId, usuario.id, async (id) =>
      id === eventoId && Boolean(await obtenerDb().evento.findFirst({ where: { id, ...filtro }, select: { id: true } })),
    );
    if (!resultado.ok) return { error: resultado.error };
    // El mail con las entradas sale después de responder.
    mandarMailsDespues({ ordenId });
    numero = (await obtenerDb().orden.findUniqueOrThrow({ where: { id: ordenId }, select: { numero: true } })).numero;
  } catch (error) {
    unstable_rethrow(error);
    console.error("[confirmarPagoManual] Falló:", error);
    return { error: "No pudimos confirmar el pago. Probá de nuevo." };
  }
  redirect(`/admin/eventos/${eventoId}?pagada=${numero}`);
}

// "Buscar pagos ahora": mira los movimientos de la cuenta de Mercado Pago.
export async function buscarPagosAccion(eventoId: string): Promise<EstadoPagoManual> {
  const usuario = await requerirUsuario(["ADMIN", "ORGANIZADOR"]);
  if (!UUID.test(String(eventoId))) return { error: "Datos no válidos. Recargá la página." };
  const evento = await obtenerDb().evento.findFirst({
    where: { id: eventoId, ...filtroDeEventos(alcanceDe(usuario)) },
    select: { productoraId: true },
  });
  if (!evento) return { error: "Ese evento ya no existe." };
  try {
    const { revisado, confirmadas } = await revisarCobros(obtenerDb(), evento.productoraId, apiMercadoPago);
    if (confirmadas > 0) mandarMailsDespues();
    refresh();
    if (!revisado) return { listo: "Recién se revisó (o no hay cuenta de Mercado Pago conectada). Probá en unos segundos." };
    return { listo: confirmadas ? `Se confirmaron ${confirmadas} compras.` : "No entró ningún pago nuevo." };
  } catch (error) {
    unstable_rethrow(error);
    // Puede haber confirmado alguna antes de fallar.
    mandarMailsDespues();
    console.error("[buscarPagos] Falló:", error instanceof Error ? error.message : error);
    return { error: "No pudimos hablar con Mercado Pago. Probá de nuevo en un rato." };
  }
}

// "Reintentar" los mails con las entradas que no salieron (ver
// src/lib/mails/pendientes.ts). Los manda ahora, así se ve cómo fue.
export async function reintentarMailsAccion(eventoId: string): Promise<EstadoPagoManual> {
  const usuario = await requerirUsuario(["ADMIN", "ORGANIZADOR"]);
  if (!UUID.test(String(eventoId))) return { error: "Datos no válidos. Recargá la página." };
  const evento = await obtenerDb().evento.findFirst({
    where: { id: eventoId, ...filtroDeEventos(alcanceDe(usuario)) },
    select: { id: true },
  });
  if (!evento) return { error: "Ese evento ya no existe." };
  try {
    const { enviados, fallidos, sinConfigurar } = await reintentarMailsDelEvento(obtenerDb(), evento.id, carteroSmtp());
    refresh();
    if (sinConfigurar) return { error: "Los mails no salen: falta configurar el servidor de mail (ver abajo)." };
    if (enviados === 0 && fallidos === 0) return { listo: "No había mails para mandar (o se están mandando ahora)." };
    const partes = [
      enviados && `${enviados === 1 ? "Salió 1 mail" : `Salieron ${enviados} mails`}`,
      fallidos && `${fallidos === 1 ? "1 volvió a fallar" : `${fallidos} volvieron a fallar`}`,
    ].filter(Boolean);
    return fallidos ? { error: `${partes.join(". ")}.` } : { listo: `${partes.join(". ")}.` };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[reintentarMails] Falló:", error instanceof Error ? error.message : "error desconocido");
    return { error: "No pudimos mandar los mails: falló la conexión con el sistema. Probá de nuevo." };
  }
}

// ─── Verificar una entrada ───────────────────────────────────────────────────

export type EntradaVerificada = {
  resultado: "valida" | "usada" | "sin_pagar" | "anulada" | "no_valida";
  motivo?: "formato" | "firma" | "no_existe" | "otro_evento";
  titular?: string;
  dni?: string;
  tipo?: string;
  compra?: number;
  usadaEn?: string; // "sáb 21/11/2026 23:40"
};
export type EstadoVerificacion = { error?: string; verificada?: EntradaVerificada };

// "Verificar una entrada": pegar el código (el del QR) y ver si es válida y de
// quién es. Solo mira: no la marca usada (eso es el escáner, paso 17).
export async function verificarEntradaAccion(
  eventoId: string,
  _anterior: EstadoVerificacion,
  datos: FormData,
): Promise<EstadoVerificacion> {
  const usuario = await requerirUsuario(["ADMIN", "ORGANIZADOR"]);
  if (!UUID.test(String(eventoId))) return { error: "Datos no válidos. Recargá la página." };
  const codigo = datos.get("codigo");
  if (typeof codigo !== "string" || !codigo.trim()) return { error: "Pegá el código de la entrada." };
  try {
    const alcance = alcanceDe(usuario);
    const evento = await obtenerDb().evento.findFirst({
      where: { id: eventoId, ...filtroDeEventos(alcance) },
      select: { id: true },
    });
    if (!evento) return { error: "Ese evento ya no existe." };
    const v = await verificarCodigo(obtenerDb(), evento.id, alcance, codigo);
    if (v.resultado === "no_valida") return { verificada: { resultado: "no_valida", motivo: v.motivo } };
    return {
      verificada: {
        resultado: v.resultado,
        titular: v.entrada.titular ?? undefined,
        dni: v.entrada.dni ? formatearDni(v.entrada.dni) : undefined,
        tipo: v.entrada.tipo,
        compra: v.entrada.compra,
        usadaEn: v.entrada.usadaEn ? formatearFecha(v.entrada.usadaEn) : undefined,
      },
    };
  } catch (error) {
    unstable_rethrow(error);
    // Solo el mensaje: nada de datos de la entrada en los logs.
    console.error("[verificarEntrada] Falló:", error instanceof Error ? error.message : "error desconocido");
    return { error: "No pudimos verificarla: falló la conexión con el sistema. Probá de nuevo." };
  }
}
