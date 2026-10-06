"use server";

import { unstable_rethrow } from "next/navigation";

import { obtenerDb } from "@/lib/db";
import { planearCompraDelEvento } from "@/lib/ventas/compra";
import { type DatosCompra, type ErroresDatos, validarDatosCompra } from "@/lib/ventas/datos";
import type { PlanCompra } from "@/lib/ventas/pedido";

import { cargarEventoParaMostrar } from "../cargar";

export type EstadoDatos = { errores?: ErroresDatos; general?: string; listo?: { datos: DatosCompra; plan: PlanCompra } };

// Revisa los datos del checkout. Todo se vuelve a calcular acá (el evento, el
// reparto en lotes y los datos): lo que manda el navegador no es confiable.
// Todavía no reserva ni cobra: eso llega con los pasos 10 a 12.
export async function enviarDatosAccion(
  slug: string,
  textoPedido: string,
  _anterior: EstadoDatos,
  formulario: FormData,
): Promise<EstadoDatos> {
  try {
    const cargado = await cargarEventoParaMostrar(String(slug));
    if (!cargado) return { general: "Este evento ya no está disponible." };
    if (cargado.evento.estado === "FINALIZADO") return { general: "La venta de este evento está cerrada." };
    const plan = await planearCompraDelEvento(obtenerDb(), cargado.evento, textoPedido);
    if (!plan.ok) return { general: plan.error };
    const datos = validarDatosCompra((campo) => formulario.get(campo), plan.cantidad);
    if (!datos.ok) return { errores: datos.errores };
    return { listo: { datos: datos.datos, plan } };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[enviarDatos] Falló:", error);
    return { general: "No pudimos revisar tus datos: falló la conexión con el sistema. Probá de nuevo." };
  }
}
