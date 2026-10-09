"use server";

import { redirect, unstable_rethrow } from "next/navigation";

import { obtenerDb } from "@/lib/db";
import { esperoDemasiado } from "@/lib/errores-db";
import { mandarMailsDespues } from "@/lib/mails/despues";
import { elegirMercadoPago, elegirTransferencia, type EstadoDeCompra, revisarPagoDeCompra } from "@/lib/pagos/cobros";
import { apiMercadoPago } from "@/lib/pagos/mercadopago";
import { urlPublica } from "@/lib/url";
import type { ErroresDatos } from "@/lib/ventas/datos";
import { buscarCompra, cancelarReserva, guardarDatosCompra } from "@/lib/ventas/ordenes";

export type EstadoDatos = { errores?: ErroresDatos; general?: string };
export type EstadoPago = { error?: string };

const ERROR_CONEXION = "No pudimos conectar con el sistema. Probá de nuevo.";

// Guarda nombre y DNI de cada entrada, y email y celular. Todo se vuelve a
// revisar acá (lo que manda el navegador no es confiable). Si está todo bien,
// la página pasa a elegir cómo pagar.
export async function guardarDatosAccion(llave: string, _anterior: EstadoDatos, formulario: FormData): Promise<EstadoDatos> {
  try {
    const resultado = await guardarDatosCompra(obtenerDb(), String(llave), (campo) => formulario.get(campo));
    // Si mientras corregía entró el pago, se muestra la compra confirmada.
    if (!resultado.ok && !resultado.pagada) return { errores: resultado.errores, general: resultado.general };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[guardarDatos] Falló:", error);
    return { general: "No pudimos guardar tus datos: falló la conexión con el sistema. Probá de nuevo." };
  }
  redirect(`/compra/${llave}`);
}

// "Pagar por transferencia": le da a la orden su monto único y muestra el alias.
export async function transferenciaAccion(llave: string): Promise<EstadoPago> {
  try {
    const resultado = await elegirTransferencia(obtenerDb(), String(llave));
    if (!resultado.ok) return { error: resultado.error };
  } catch (error) {
    unstable_rethrow(error);
    if (esperoDemasiado(error)) return { error: "Hay mucha gente pagando en este momento. Probá de nuevo en unos segundos." };
    console.error("[elegirTransferencia] Falló:", error);
    return { error: ERROR_CONEXION };
  }
  redirect(`/compra/${llave}`);
}

// "Pagar con Mercado Pago": crea el cobro y manda a Mercado Pago (en el celu, a la app).
export async function mercadoPagoAccion(llave: string): Promise<EstadoPago> {
  let link: string;
  try {
    const resultado = await elegirMercadoPago(obtenerDb(), String(llave), apiMercadoPago, await urlPublica());
    if (!resultado.ok) return { error: resultado.error };
    link = resultado.link;
  } catch (error) {
    unstable_rethrow(error);
    console.error("[elegirMercadoPago] Falló:", error);
    return { error: ERROR_CONEXION };
  }
  redirect(link);
}

// La pantalla pregunta cada tanto si ya entró la plata.
export async function revisarPagoAccion(llave: string): Promise<EstadoDeCompra | null> {
  try {
    const estado = await revisarPagoDeCompra(obtenerDb(), String(llave), apiMercadoPago);
    // Se confirmó (esta u otras: la revisión mira todos los pagos de la
    // productora): los mails salen después de responder.
    if (estado?.estado === "PAGADA") mandarMailsDespues();
    return estado;
  } catch (error) {
    console.error("[revisarPago] Falló:", error);
    return null;
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
    // Si no se pudo cancelar ahora, la reserva vence sola en 15 minutos.
    console.error("[cancelarReserva] Falló:", error);
  }
  redirect(destino);
}
