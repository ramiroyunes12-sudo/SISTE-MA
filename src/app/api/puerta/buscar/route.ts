// POST /api/puerta/buscar: buscar entradas por DNI o nombre ({ eventoId,
// texto }), para quien llega sin el QR. Solo mira (src/lib/entradas/buscar.ts).
// El DNI va en el cuerpo, nunca en la dirección. Permisos y errores: ../comun.ts.
import type { NextRequest } from "next/server";

import { alcanceDe } from "@/lib/auth/alcance";
import { obtenerDb } from "@/lib/db";
import { buscarEnLaPuerta } from "@/lib/entradas/buscar";
import { respuestaBusqueda } from "@/lib/entradas/puerta";

import { atenderPuerta, responder } from "../comun";

const LARGO_MAXIMO = 100; // un nombre y apellido entra holgado (en el checkout, hasta 80)

export function POST(request: NextRequest) {
  return atenderPuerta(request, "buscar", async (usuario, { eventoId, texto }) => {
    if (typeof texto !== "string" || texto.length > LARGO_MAXIMO) return responder({ error: "pedido" }, 400);
    const buscado = await buscarEnLaPuerta(obtenerDb(), { eventoId, alcance: alcanceDe(usuario), texto });
    if (!buscado) return responder({ error: "evento" }, 404);
    return responder(respuestaBusqueda(buscado, usuario.id));
  });
}
