// POST /api/puerta/marcar: marcar el ingreso sin el QR, desde la búsqueda por
// DNI o nombre ({ eventoId, entradaId }). Mismo resultado que el escáner (PASA,
// YA INGRESÓ o NO VÁLIDA) y el mismo UPDATE condicionado
// (src/lib/entradas/escanear.ts). Solo el organizador y el ADMIN: un validador
// recibe 403. Permisos y errores: ../comun.ts.
import type { NextRequest } from "next/server";

import { alcanceDeLaPuerta } from "@/lib/auth/alcance";
import { obtenerDb } from "@/lib/db";
import { marcarEntrada } from "@/lib/entradas/escanear";
import { puedeMarcarSinQr, respuestaPuerta } from "@/lib/entradas/puerta";

import { atenderPuerta, responder, UUID } from "../comun";

export function POST(request: NextRequest) {
  return atenderPuerta(request, "marcar", async (usuario, { eventoId, entradaId }) => {
    if (!puedeMarcarSinQr(usuario.rol)) return responder({ error: "permiso" }, 403);
    if (typeof entradaId !== "string" || !UUID.test(entradaId)) return responder({ error: "pedido" }, 400);
    const ahora = new Date();
    const marcada = await marcarEntrada(obtenerDb(), {
      eventoId,
      alcance: alcanceDeLaPuerta(usuario),
      usuarioId: usuario.id,
      entradaId,
      ahora,
    });
    if (!marcada) return responder({ error: "evento" }, 404);
    return responder(respuestaPuerta(marcada, usuario.id, ahora));
  });
}
