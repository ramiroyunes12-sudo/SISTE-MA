"use server";
// Acciones de la pantalla "Productoras". Solo el ADMIN (dueño de la plataforma).
import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { requerirUsuario } from "@/lib/auth/actual";
import { obtenerDb } from "@/lib/db";
import {
  agregarPersona,
  cambiarActivo,
  type CuentaNueva,
  crearProductora,
  editarProductora,
  type Errores,
  nuevaTemporal,
} from "@/lib/productoras";

export type EstadoProductora = { errores?: Errores; cuenta?: CuentaNueva; productoraId?: string; guardado?: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ERROR_CONEXION = { general: "No pudimos conectar con el sistema. Probá de nuevo en un rato." };

function campos(datos: FormData) {
  return Object.fromEntries([...datos.entries()].filter(([, valor]) => typeof valor === "string"));
}

function idValido(id: unknown): id is string {
  return typeof id === "string" && UUID.test(id);
}

export async function crearProductoraAccion(_anterior: EstadoProductora, datos: FormData): Promise<EstadoProductora> {
  await requerirUsuario(["ADMIN"]);
  try {
    const resultado = await crearProductora(obtenerDb(), campos(datos));
    if (!resultado.ok) return { errores: resultado.errores };
    refresh();
    return { cuenta: resultado.cuenta, productoraId: resultado.productoraId };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[crearProductora] Falló:", error);
    return { errores: ERROR_CONEXION };
  }
}

export async function editarProductoraAccion(
  productoraId: string,
  _anterior: EstadoProductora,
  datos: FormData,
): Promise<EstadoProductora> {
  await requerirUsuario(["ADMIN"]);
  if (!idValido(productoraId)) return { errores: { general: "Datos no válidos. Recargá la página." } };
  try {
    const resultado = await editarProductora(obtenerDb(), productoraId, {
      nombre: datos.get("nombre"),
      activa: datos.get("activa") === "si",
    });
    if (!resultado.ok) return { errores: resultado.errores };
    refresh();
    return { guardado: true };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[editarProductora] Falló:", error);
    return { errores: ERROR_CONEXION };
  }
}

export async function agregarPersonaAccion(
  productoraId: string,
  _anterior: EstadoProductora,
  datos: FormData,
): Promise<EstadoProductora> {
  await requerirUsuario(["ADMIN"]);
  if (!idValido(productoraId)) return { errores: { general: "Datos no válidos. Recargá la página." } };
  try {
    const resultado = await agregarPersona(obtenerDb(), productoraId, campos(datos));
    if (!resultado.ok) return { errores: resultado.errores };
    refresh();
    return { cuenta: resultado.cuenta };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[agregarPersona] Falló:", error);
    return { errores: ERROR_CONEXION };
  }
}

// (useActionState también pasa el estado anterior; acá no hace falta.)
export async function nuevaTemporalAccion(productoraId: string, usuarioId: string): Promise<EstadoProductora> {
  await requerirUsuario(["ADMIN"]);
  if (!idValido(productoraId) || !idValido(usuarioId)) return { errores: { general: "Datos no válidos." } };
  try {
    const resultado = await nuevaTemporal(obtenerDb(), productoraId, usuarioId);
    if (!resultado.ok) return { errores: { general: resultado.error } };
    refresh();
    return { cuenta: resultado.cuenta };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[nuevaTemporal] Falló:", error);
    return { errores: ERROR_CONEXION };
  }
}

export async function cambiarActivoAccion(
  productoraId: string,
  usuarioId: string,
  activo: boolean,
): Promise<EstadoProductora> {
  await requerirUsuario(["ADMIN"]);
  if (!idValido(productoraId) || !idValido(usuarioId)) return { errores: { general: "Datos no válidos." } };
  try {
    const resultado = await cambiarActivo(obtenerDb(), productoraId, usuarioId, activo === true);
    if (!resultado.ok) return { errores: { general: resultado.error } };
    refresh();
    return {};
  } catch (error) {
    unstable_rethrow(error);
    console.error("[cambiarActivo] Falló:", error);
    return { errores: ERROR_CONEXION };
  }
}
