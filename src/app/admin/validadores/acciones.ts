"use server";
// Acciones de la pantalla "Validadores": cada organizador maneja los
// validadores de SU productora (la sale de su sesión, nunca del formulario).
// Solo validadores: a otro organizador no lo puede crear, resetear ni desactivar.
import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { requerirUsuario } from "@/lib/auth/actual";
import { obtenerDb } from "@/lib/db";
import { agregarPersona, cambiarActivo, nuevaTemporal } from "@/lib/productoras";

import type { EstadoProductora } from "../productoras/acciones";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ERROR_CONEXION = { general: "No pudimos conectar con el sistema. Probá de nuevo en un rato." };
const SOLO_VALIDADORES = { soloRol: "VALIDADOR" } as const;

async function productoraDelOrganizador() {
  const usuario = await requerirUsuario(["ORGANIZADOR"]);
  // No debería pasar (lo impide la base), pero si pasa, mejor fallar.
  if (!usuario.productora) throw new Error("Organizador sin productora");
  return usuario.productora.id;
}

export async function agregarValidadorAccion(_anterior: EstadoProductora, datos: FormData): Promise<EstadoProductora> {
  const productoraId = await productoraDelOrganizador();
  try {
    const resultado = await agregarPersona(obtenerDb(), productoraId, {
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
export async function nuevaTemporalValidadorAccion(usuarioId: string): Promise<EstadoProductora> {
  const productoraId = await productoraDelOrganizador();
  if (typeof usuarioId !== "string" || !UUID.test(usuarioId)) return { errores: { general: "Datos no válidos." } };
  try {
    const resultado = await nuevaTemporal(obtenerDb(), productoraId, usuarioId, SOLO_VALIDADORES);
    if (!resultado.ok) return { errores: { general: resultado.error } };
    refresh();
    return { cuenta: resultado.cuenta };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[nuevaTemporalValidador] Falló:", error instanceof Error ? error.message : "error desconocido");
    return { errores: ERROR_CONEXION };
  }
}

export async function cambiarActivoValidadorAccion(usuarioId: string, activo: boolean): Promise<EstadoProductora> {
  const productoraId = await productoraDelOrganizador();
  if (typeof usuarioId !== "string" || !UUID.test(usuarioId)) return { errores: { general: "Datos no válidos." } };
  try {
    const resultado = await cambiarActivo(obtenerDb(), productoraId, usuarioId, activo === true, SOLO_VALIDADORES);
    if (!resultado.ok) return { errores: { general: resultado.error } };
    refresh();
    return {};
  } catch (error) {
    unstable_rethrow(error);
    console.error("[cambiarActivoValidador] Falló:", error instanceof Error ? error.message : "error desconocido");
    return { errores: ERROR_CONEXION };
  }
}
