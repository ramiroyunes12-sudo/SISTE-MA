"use server";

import { redirect, unstable_rethrow } from "next/navigation";

import { requerirUsuario } from "@/lib/auth/actual";
import { alcanceDe } from "@/lib/auth/alcance";
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
  const usuario = await requerirUsuario(["ADMIN", "ORGANIZADOR"]);

  const eventoId = envio?.eventoId ?? null;
  if (eventoId !== null && (typeof eventoId !== "string" || !UUID.test(eventoId))) {
    return { errores: { general: "Los datos no son válidos. Recargá la página." } };
  }
  const validacion = validarEvento(envio?.evento);
  // El dueño, al crear, tiene que elegir la productora (se avisa junto con lo demás).
  const elegida = (envio?.evento as { productoraId?: unknown } | undefined)?.productoraId;
  const faltaProductora =
    usuario.rol === "ADMIN" && eventoId === null && !(typeof elegida === "string" && UUID.test(elegida));
  if (!validacion.ok || faltaProductora) {
    return {
      errores: {
        ...(validacion.ok ? {} : validacion.errores),
        ...(faltaProductora ? { productoraId: "Elegí una productora." } : {}),
      },
    };
  }

  let id: string;
  try {
    const resultado = await guardarEvento(obtenerDb(), eventoId, validacion.datos, alcanceDe(usuario));
    if (!resultado.ok) return { errores: resultado.errores };
    id = resultado.id;
  } catch (error) {
    unstable_rethrow(error);
    console.error("[guardarEvento] Falló:", error);
    return { errores: { general: "No pudimos guardar: falló la conexión con el sistema. Probá de nuevo." } };
  }
  redirect(`/admin/eventos/${id}?guardado=1`);
}
