"use server";

import { redirect, unstable_rethrow } from "next/navigation";

import { obtenerDb } from "@/lib/db";
import { esperoDemasiado } from "@/lib/errores-db";
import { mandarMailsDespues } from "@/lib/mails/despues";
import { MAX_REENVIOS_POR_DIA, reenviarDeCompra } from "@/lib/mails/reenviar";
import { elegirMercadoPago, elegirTransferencia, type EstadoDeCompra, revisarPagoDeCompra } from "@/lib/pagos/cobros";
import { apiMercadoPago } from "@/lib/pagos/mercadopago";
import { urlPublica } from "@/lib/url";
import type { ErroresDatos } from "@/lib/ventas/datos";
import { buscarCompra, cancelarReserva, guardarDatosCompra } from "@/lib/ventas/ordenes";

export type EstadoDatos = { errores?: ErroresDatos; general?: string };
export type EstadoPago = { error?: string };
export type EstadoReenvio = { tipo?: "ok" | "aviso" | "error"; mensaje?: string };

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
    const revision = await revisarPagoDeCompra(obtenerDb(), String(llave), apiMercadoPago);
    if (!revision) return null;
    // Si se confirmó esta u otra compra (la revisión mira todos los pagos de
    // la productora), los mails salen después de responder.
    if (revision.confirmoAlgo || revision.estado === "PAGADA") mandarMailsDespues();
    return { estado: revision.estado, aDevolver: revision.aDevolver };
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

// "Reenviar el mail" de la compra paga: la llave del link es el permiso. Sale
// al email de la compra, después de responder (src/lib/mails/reenviar.ts).
export async function reenviarMailAccion(llave: string): Promise<EstadoReenvio> {
  try {
    const resultado = await reenviarDeCompra(obtenerDb(), String(llave));
    if (resultado.ok) {
      mandarMailsDespues({ ordenId: resultado.ordenId });
      return {
        tipo: "ok",
        mensaje: `Listo: te lo mandamos de nuevo a ${resultado.email}, con el asunto "Te reenviamos tus entradas…". Puede tardar unos minutos; si no lo ves, revisá en spam o promociones.`,
      };
    }
    switch (resultado.motivo) {
      case "ya_sale":
        mandarMailsDespues({ ordenId: resultado.ordenId });
        return { tipo: "aviso", mensaje: "Ya te lo estamos mandando: puede tardar unos minutos. Si no lo ves, revisá en spam o promociones." };
      case "limite":
        return {
          tipo: "aviso",
          mensaje: `Ya te lo reenviamos ${MAX_REENVIOS_POR_DIA} veces hoy: probá mañana. Tus entradas están igual en esta página.`,
        };
      case "sin_configurar":
        return { tipo: "error", mensaje: "Ahora no podemos mandar mails. Tus entradas están en esta página: descargalas en PDF." };
      default:
        return { tipo: "error", mensaje: "No encontramos tu compra paga." };
    }
  } catch (error) {
    // Solo qué falló: nada de la compra en los logs.
    console.error("[reenviarMail] Falló:", error instanceof Error ? error.message : "error desconocido");
    return { tipo: "error", mensaje: ERROR_CONEXION };
  }
}
