import { timingSafeEqual } from "node:crypto";

import { obtenerDb } from "@/lib/db";
import { carteroSmtp } from "@/lib/mails/cartero";
import { enviarMailsPendientes } from "@/lib/mails/pendientes";

// Lo que puede durar: la vuelta de envíos deja de tomar compras a los 25
// segundos, pero el último mail que tomó todavía se arma y tiene hasta 45 s
// para salir (PLAZO_ENVIO_MS). Si la cortaran en el medio, ese mail podría
// salir dos veces. (Con Fluid compute, Vercel deja hasta 300 s.)
export const maxDuration = 120;

// GET /api/mails/pendientes: la tarea programada de Vercel (una vez por día,
// ver vercel.json) manda los mails con las entradas que hayan quedado sin
// salir (src/lib/mails/pendientes.ts). Vercel la llama con la clave
// CRON_SECRET en el encabezado Authorization; sin esa variable cargada no
// hace nada. Nunca dice a quién se mandó: solo de cuántas compras.
export async function GET(request: Request) {
  const clave = process.env.CRON_SECRET;
  if (!clave || clave.length < 16) return Response.json({ ok: false }, { status: 503 });
  if (!coincide(request.headers.get("authorization") ?? "", `Bearer ${clave}`)) {
    return Response.json({ ok: false }, { status: 401 });
  }
  try {
    const { enviados, fallidos, sinConfigurar } = await enviarMailsPendientes(obtenerDb(), carteroSmtp());
    return Response.json({ ok: true, enviados, fallidos, ...(sinConfigurar ? { sinConfigurar } : {}) });
  } catch (error) {
    console.error("[mails pendientes] Falló:", error instanceof Error ? error.message : "error desconocido");
    return Response.json({ ok: false }, { status: 500 });
  }
}

// Compara sin dar pistas por el tiempo que tarda.
function coincide(recibido: string, esperado: string) {
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}
