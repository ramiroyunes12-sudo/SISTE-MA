// POST /api/puerta/contador: cuántos entraron de cuántas entradas pueden
// entrar ({ eventoId } → { ingresaron, total }). La pantalla de la puerta lo
// pide cada tanto y después de cada escaneo. Permisos y errores: ../comun.ts.
import type { NextRequest } from "next/server";

import { alcanceDeLaPuerta } from "@/lib/auth/alcance";
import { obtenerDb } from "@/lib/db";
import { contarIngresos } from "@/lib/entradas/buscar";

import { atenderPuerta, responder } from "../comun";

export function POST(request: NextRequest) {
  return atenderPuerta(request, "contador", async (usuario, { eventoId }) => {
    const contador = await contarIngresos(obtenerDb(), { eventoId, alcance: alcanceDeLaPuerta(usuario) });
    if (!contador) return responder({ error: "evento" }, 404);
    return responder(contador);
  });
}
