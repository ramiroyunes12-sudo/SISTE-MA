// POST /api/puerta/escanear: el escáner de la puerta manda lo que leyó la
// cámara ({ eventoId, codigo }) y recibe PASA, YA INGRESÓ o NO VÁLIDA. Si la
// entrada es válida, queda usada (src/lib/entradas/escanear.ts).
// Permisos y errores: ../comun.ts.
import type { NextRequest } from "next/server";

import { alcanceDeLaPuerta } from "@/lib/auth/alcance";
import { obtenerDb } from "@/lib/db";
import { escanearCodigo } from "@/lib/entradas/escanear";
import { respuestaPuerta } from "@/lib/entradas/puerta";

import { atenderPuerta, responder } from "../comun";

export function POST(request: NextRequest) {
  return atenderPuerta(request, "escanear", async (usuario, { eventoId, codigo }) => {
    if (typeof codigo !== "string") return responder({ error: "pedido" }, 400);
    const ahora = new Date();
    const escaneado = await escanearCodigo(obtenerDb(), {
      eventoId,
      alcance: alcanceDeLaPuerta(usuario),
      usuarioId: usuario.id,
      texto: codigo,
      ahora,
    });
    if (!escaneado) return responder({ error: "evento" }, 404);
    return responder(respuestaPuerta(escaneado, usuario.id, ahora));
  });
}
