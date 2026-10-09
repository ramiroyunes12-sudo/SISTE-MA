"use server";

import { unstable_rethrow } from "next/navigation";

import { obtenerDb } from "@/lib/db";
import { mandarMailsDespues } from "@/lib/mails/despues";
import { type ErroresReenvio, reenviarPorEmailYDni } from "@/lib/mails/reenviar";

import { cargarEventoParaMostrar } from "../cargar";

export type EstadoMisEntradas = { errores?: ErroresReenvio; general?: string; listo?: true };

// "Reenviar mis entradas": email y DNI por POST (nunca en la URL). La
// respuesta es la misma haya o no una compra con esos datos, y el mail sale
// después de responder (si saliera antes, por lo que tarda se sabría si hay
// una compra).
export async function reenviarEntradasAccion(
  slug: string,
  _anterior: EstadoMisEntradas,
  formulario: FormData,
): Promise<EstadoMisEntradas> {
  try {
    const cargado = await cargarEventoParaMostrar(String(slug));
    if (!cargado) return { general: "Este evento ya no está disponible." };
    const eventoId = cargado.evento.id;
    const resultado = await reenviarPorEmailYDni(obtenerDb(), eventoId, formulario.get("email"), formulario.get("dni"));
    if (!resultado.ok) {
      if ("errores" in resultado) return { errores: resultado.errores };
      return { general: "Ahora no podemos mandar mails. Probá de nuevo más tarde." };
    }
    if (resultado.reenviadas.length > 0) mandarMailsDespues({ eventoId });
    return { listo: true };
  } catch (error) {
    unstable_rethrow(error);
    // Solo el tipo de error: el mensaje de Prisma puede citar la consulta, con
    // el email y el DNI que escribió la persona.
    const codigo = error instanceof Error && "code" in error ? ` ${String(error.code)}` : "";
    console.error("[reenviarEntradas] Falló:", error instanceof Error ? `${error.name}${codigo}` : "error desconocido");
    return { general: "No pudimos conectar con el sistema. Probá de nuevo." };
  }
}
