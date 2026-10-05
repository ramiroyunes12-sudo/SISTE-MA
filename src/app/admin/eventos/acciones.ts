"use server";

import { redirect, unstable_rethrow } from "next/navigation";

import { requerirUsuario } from "@/lib/auth/actual";
import { obtenerDb } from "@/lib/db";
import { type Errores, validarEvento } from "@/lib/eventos/editor";
import { guardarEvento } from "@/lib/eventos/guardar";

export type EstadoGuardado = { errores?: Errores };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Guarda el evento (nuevo si eventoId es null) con sus tipos y lotes.
export async function guardarEventoDesdeEditor(
  _anterior: EstadoGuardado,
  envio: { eventoId: string | null; evento: unknown },
): Promise<EstadoGuardado> {
  await requerirUsuario(["ADMIN"]);

  const eventoId = envio?.eventoId ?? null;
  if (eventoId !== null && (typeof eventoId !== "string" || !UUID.test(eventoId))) {
    return { errores: { general: "Los datos no son válidos. Recargá la página." } };
  }
  const validacion = validarEvento(envio?.evento);
  if (!validacion.ok) return { errores: validacion.errores };

  let id: string;
  try {
    const resultado = await guardarEvento(obtenerDb(), eventoId, validacion.datos);
    if (!resultado.ok) return { errores: resultado.errores };
    id = resultado.id;
  } catch (error) {
    unstable_rethrow(error);
    console.error("[guardarEvento] Falló:", error);
    return { errores: { general: "No pudimos guardar: falló la conexión con el sistema. Probá de nuevo." } };
  }
  redirect(`/admin/eventos/${id}?guardado=1`);
}
