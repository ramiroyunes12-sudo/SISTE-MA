"use server";
// Acciones de la pantalla "Validadores". Un organizador maneja los
// validadores de SU productora; el ADMIN, los de cualquiera. Solo
// validadores: a un organizador no se lo puede crear, resetear ni desactivar
// desde acá.
import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { requerirUsuario } from "@/lib/auth/actual";
import { alcanceDe, puedeTocarProductora } from "@/lib/auth/alcance";
import { obtenerDb } from "@/lib/db";
import { agregarPersona, cambiarActivo, nuevaTemporal } from "@/lib/productoras";

import type { EstadoProductora } from "../productoras/acciones";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ERROR_CONEXION = { general: "No pudimos conectar con el sistema. Probá de nuevo en un rato." };
const NO_VALIDO = { general: "Datos no válidos. Recargá la página." };
const SOLO_VALIDADORES = { soloRol: "VALIDADOR" } as const;

// La productora pedida, si quien está usando el panel la puede tocar (null si no).
async function productoraPermitida(productoraId: unknown) {
  const usuario = await requerirUsuario(["ADMIN", "ORGANIZADOR"]);
  return puedeTocarProductora(alcanceDe(usuario), productoraId) ? productoraId : null;
}

export async function agregarValidadorAccion(
  productoraId: string,
  _anterior: EstadoProductora,
  datos: FormData,
): Promise<EstadoProductora> {
  const permitida = await productoraPermitida(productoraId);
  if (!permitida) return { errores: NO_VALIDO };
  try {
    const resultado = await agregarPersona(obtenerDb(), permitida, {
      nombrePersona: datos.get("nombrePersona"),
      email: datos.get("email"),
      rol: "VALIDADOR",
    });
    if (!resultado.ok) return { errores: resultado.errores };
    refresh();
    return { cuenta: resultado.cuenta };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[agregarValidador] Falló:", error instanceof Error ? error.message : "error desconocido");
    return { errores: ERROR_CONEXION };
  }
}

// (useActionState también pasa el estado anterior; acá no hace falta.)
export async function nuevaTemporalValidadorAccion(productoraId: string, usuarioId: string): Promise<EstadoProductora> {
  const permitida = await productoraPermitida(productoraId);
  if (!permitida || typeof usuarioId !== "string" || !UUID.test(usuarioId)) return { errores: NO_VALIDO };
  try {
    const resultado = await nuevaTemporal(obtenerDb(), permitida, usuarioId, SOLO_VALIDADORES);
    if (!resultado.ok) return { errores: { general: resultado.error } };
    refresh();
    return { cuenta: resultado.cuenta };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[nuevaTemporalValidador] Falló:", error instanceof Error ? error.message : "error desconocido");
    return { errores: ERROR_CONEXION };
  }
}

export async function cambiarActivoValidadorAccion(
  productoraId: string,
  usuarioId: string,
  activo: boolean,
): Promise<EstadoProductora> {
  const permitida = await productoraPermitida(productoraId);
  if (!permitida || typeof usuarioId !== "string" || !UUID.test(usuarioId)) return { errores: NO_VALIDO };
  try {
    const resultado = await cambiarActivo(obtenerDb(), permitida, usuarioId, activo === true, SOLO_VALIDADORES);
    if (!resultado.ok) return { errores: { general: resultado.error } };
    refresh();
    return {};
  } catch (error) {
    unstable_rethrow(error);
    console.error("[cambiarActivoValidador] Falló:", error instanceof Error ? error.message : "error desconocido");
    return { errores: ERROR_CONEXION };
  }
}
