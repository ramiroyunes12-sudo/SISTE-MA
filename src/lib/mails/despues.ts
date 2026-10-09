// Mandar los mails que faltan DESPUÉS de responder (after() de Next): quien
// pagó no espera al servidor de mail, y si el mail falla la compra ya quedó
// confirmada (se reintenta después, ver pendientes.ts).
//
// Lo llaman donde se puede haber confirmado un pago (el aviso de Mercado
// Pago, la pantalla que espera el pago, el panel) y la página de la compra
// paga y el panel del evento (así lo que falló se reintenta solo).
import { after } from "next/server";

import { obtenerDb } from "@/lib/db";

import { carteroSmtp } from "./cartero";
import { enviarMailsPendientes } from "./pendientes";

export function mandarMailsDespues(opciones: { ordenId?: string; eventoId?: string } = {}) {
  after(async () => {
    try {
      const resultado = await enviarMailsPendientes(obtenerDb(), carteroSmtp(), opciones);
      if (resultado.sinConfigurar) console.warn("[mail] No sale ningún mail: falta configurar SMTP_* o CLAVE_CODIGOS.");
    } catch (error) {
      // Queda pendiente: se reintenta en el próximo envío.
      console.error("[mail] Falló el envío de los pendientes:", error instanceof Error ? error.message : "error desconocido");
    }
  });
}
