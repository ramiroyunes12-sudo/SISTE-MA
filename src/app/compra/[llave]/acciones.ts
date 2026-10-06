"use server";

import { redirect, unstable_rethrow } from "next/navigation";

import { obtenerDb } from "@/lib/db";
import type { DatosCompra, ErroresDatos } from "@/lib/ventas/datos";
import { buscarCompra, cancelarReserva, guardarDatosCompra } from "@/lib/ventas/ordenes";

export type EstadoDatos = { errores?: ErroresDatos; general?: string; listo?: { datos: DatosCompra } };

// Guarda nombre y DNI de cada entrada, y email y celular. Todo se vuelve a
// revisar acá (lo que manda el navegador no es confiable). El pago llega en
// el paso 11.
export async function guardarDatosAccion(llave: string, _anterior: EstadoDatos, formulario: FormData): Promise<EstadoDatos> {
  try {
    const resultado = await guardarDatosCompra(obtenerDb(), String(llave), (campo) => formulario.get(campo));
    if (!resultado.ok) return { errores: resultado.errores, general: resultado.general };
    return { listo: { datos: resultado.datos } };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[guardarDatos] Falló:", error);
    return { general: "No pudimos guardar tus datos: falló la conexión con el sistema. Probá de nuevo." };
  }
}

// "Cambiar entradas": cancela la reserva y vuelve al evento.
export async function cancelarAccion(llave: string): Promise<void> {
  let destino = "/";
  try {
    const compra = await buscarCompra(obtenerDb(), String(llave));
    if (compra) {
      destino = `/e/${compra.evento.slug}`;
      await cancelarReserva(obtenerDb(), String(llave));
    }
  } catch (error) {
    unstable_rethrow(error);
    // Si no se pudo cancelar ahora, la reserva vence sola en 10 minutos.
    console.error("[cancelarReserva] Falló:", error);
  }
  redirect(destino);
}
