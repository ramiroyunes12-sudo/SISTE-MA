// POST /api/puerta/escanear: el escáner de la puerta manda lo que leyó la
// cámara ({ eventoId, codigo }) y recibe PASA, YA INGRESÓ o NO VÁLIDA. Si la
// entrada es válida, queda usada (src/lib/entradas/escanear.ts).
//
// Es una ruta y no una acción del servidor porque Next manda las acciones de
// a una: si en la puerta se corta la señal en medio de un escaneo, los
// siguientes quedarían esperando detrás. Con fetch el escáner corta a los
// pocos segundos y se puede seguir escaneando.
//
// Solo gente con cuenta (validadores, organizadores y el ADMIN) y solo en los
// eventos de su productora. Ante cualquier error, nunca "pasa".
import type { NextRequest } from "next/server";

import { alcanceDe } from "@/lib/auth/alcance";
import { usuarioConPermiso } from "@/lib/auth/actual";
import { obtenerDb } from "@/lib/db";
import { escanearCodigo } from "@/lib/entradas/escanear";
import { type ErrorPuerta, respuestaPuerta, type RespuestaPuerta } from "@/lib/entradas/puerta";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LARGO_MAXIMO = 1_000; // { eventoId, codigo } entra holgado

export async function POST(request: NextRequest) {
  // Solo desde el escáner de este mismo sitio (además, la cookie de la sesión
  // es SameSite=Lax y otro sitio no puede mandar JSON sin permiso).
  if (!esMismoSitio(request)) return responder({ error: "pedido" }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return responder({ error: "pedido" }, 415);

  try {
    const usuario = await usuarioConPermiso(["ADMIN", "ORGANIZADOR", "VALIDADOR"]);
    if (!usuario) return responder({ error: "sesion" }, 401);

    const pedido = leerPedido(await request.text());
    if (!pedido) return responder({ error: "pedido" }, 400);

    const ahora = new Date();
    const escaneado = await escanearCodigo(obtenerDb(), {
      eventoId: pedido.eventoId,
      alcance: alcanceDe(usuario),
      usuarioId: usuario.id,
      texto: pedido.codigo,
      ahora,
    });
    if (!escaneado) return responder({ error: "evento" }, 404);
    return responder(respuestaPuerta(escaneado, usuario.id, ahora));
  } catch (error) {
    // Solo el mensaje: nada de la entrada ni del código en los logs.
    console.error("[escanear] Falló:", error instanceof Error ? error.message : "error desconocido");
    return responder({ error: "conexion" }, 503);
  }
}

function leerPedido(texto: string): { eventoId: string; codigo: string } | null {
  if (texto.length > LARGO_MAXIMO) return null;
  try {
    const { eventoId, codigo } = JSON.parse(texto) as Record<string, unknown>;
    if (typeof eventoId !== "string" || !UUID.test(eventoId) || typeof codigo !== "string") return null;
    return { eventoId, codigo };
  } catch {
    return null;
  }
}

function esMismoSitio(request: NextRequest) {
  const origen = request.headers.get("origin");
  if (!origen) return false;
  try {
    const host = new URL(origen).host;
    return host === request.headers.get("host") || host === request.headers.get("x-forwarded-host");
  } catch {
    return false;
  }
}

function responder(cuerpo: RespuestaPuerta | ErrorPuerta, status = 200) {
  return Response.json(cuerpo, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" },
  });
}
