// Lo común de las rutas de la puerta (/api/puerta/...): escanear, buscar,
// marcar el ingreso sin el QR y el contador.
//
// Son rutas y no acciones del servidor porque Next manda las acciones de a
// una: si en la puerta se corta la señal en medio de un pedido, los
// siguientes quedarían esperando detrás. Con fetch la pantalla corta a los
// pocos segundos y se puede seguir.
//
// Solo gente con cuenta (validadores, organizadores y el ADMIN), solo en los
// eventos de su productora y solo desde este mismo sitio, con JSON por POST
// (el DNI que se busca nunca va en la dirección).
import type { NextRequest } from "next/server";

import type { Rol } from "@/generated/prisma/client";
import { usuarioConPermiso } from "@/lib/auth/actual";
import type { ErrorPuerta } from "@/lib/entradas/puerta";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LARGO_MAXIMO = 1_000; // { eventoId, codigo } y los demás entran holgados

export const ROLES_PUERTA: Rol[] = ["ADMIN", "ORGANIZADOR", "VALIDADOR"];

type Usuario = NonNullable<Awaited<ReturnType<typeof usuarioConPermiso>>>;

// Revisa el pedido y la sesión, y llama a `hacer` con el usuario y el cuerpo
// (con el eventoId ya revisado). Ante cualquier error, { error: "conexion" }:
// la puerta lo muestra como NO VÁLIDA, nunca como PASA.
export async function atenderPuerta(
  request: NextRequest,
  nombre: string,
  hacer: (usuario: Usuario, cuerpo: Record<string, unknown> & { eventoId: string }) => Promise<Response>,
) {
  // Solo desde la pantalla de este mismo sitio (además, la cookie de la
  // sesión es SameSite=Lax y otro sitio no puede mandar JSON sin permiso).
  if (!esMismoSitio(request)) return responder({ error: "pedido" }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return responder({ error: "pedido" }, 415);

  try {
    const usuario = await usuarioConPermiso(ROLES_PUERTA);
    if (!usuario) return responder({ error: "sesion" }, 401);

    const cuerpo = leerCuerpo(await request.text());
    if (!cuerpo) return responder({ error: "pedido" }, 400);
    return await hacer(usuario, cuerpo);
  } catch (error) {
    // Solo el mensaje: nada de la entrada, el código ni lo buscado en los logs.
    console.error(`[${nombre}] Falló:`, error instanceof Error ? error.message : "error desconocido");
    return responder({ error: "conexion" }, 503);
  }
}

function leerCuerpo(texto: string) {
  if (texto.length > LARGO_MAXIMO) return null;
  try {
    const cuerpo: unknown = JSON.parse(texto);
    if (typeof cuerpo !== "object" || cuerpo === null) return null;
    const { eventoId } = cuerpo as Record<string, unknown>;
    if (typeof eventoId !== "string" || !UUID.test(eventoId)) return null;
    return cuerpo as Record<string, unknown> & { eventoId: string };
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

export function responder(cuerpo: object | ErrorPuerta, status = 200) {
  return Response.json(cuerpo, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" },
  });
}
