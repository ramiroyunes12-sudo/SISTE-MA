"use server";
// Acciones de los formularios de ingreso, salida y cambio de contraseña.
// Corren en el servidor; Next.js además rechaza las que vengan de otra página.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { obtenerDb } from "@/lib/db";

import { borrarCookieSesion, COOKIE_SESION, guardarCookieSesion, obtenerSesionActual } from "./actual";
import { MINUTOS_BLOQUEO, cambiarContrasena, inicioSegunRol, normalizarEmail, verificarCredenciales } from "./cuentas";
import { cerrarSesion, crearSesion } from "./sesiones";

const ERROR_CONEXION = "No pudimos conectar con el sistema. Probá de nuevo en un rato.";

export type EstadoIngreso = { error?: string; email?: string };

export async function ingresar(_anterior: EstadoIngreso, datos: FormData): Promise<EstadoIngreso> {
  const email = normalizarEmail(datos.get("email"));
  const contrasena = datos.get("contrasena");
  if (!email || typeof contrasena !== "string" || contrasena === "") {
    return { error: "Completá el email y la contraseña.", email };
  }

  let destino: string;
  try {
    const db = obtenerDb();
    const resultado = await verificarCredenciales(db, email, contrasena);
    if (!resultado.ok) {
      const error =
        resultado.motivo === "bloqueada"
          ? `Demasiados intentos fallidos. Probá de nuevo en ${resultado.minutos} ${resultado.minutos === 1 ? "minuto" : "minutos"}.`
          : resultado.motivo === "bloqueada_ahora"
            ? `Email o contraseña incorrectos. Por seguridad, esperá ${MINUTOS_BLOQUEO} minutos antes de volver a probar.`
            : "Email o contraseña incorrectos.";
      return { error, email };
    }
    // Si en este navegador había otra sesión abierta, se cierra: queda solo la nueva.
    const anterior = (await cookies()).get(COOKIE_SESION)?.value;
    if (anterior) await cerrarSesion(db, anterior);
    await guardarCookieSesion(await crearSesion(db, resultado.usuario.id));
    const { usuario } = resultado;
    destino = usuario.debeCambiarContrasena ? "/cuenta/contrasena" : inicioSegunRol(usuario.rol);
  } catch (error) {
    console.error("[ingresar] Falló:", error);
    return { error: ERROR_CONEXION, email };
  }
  redirect(destino);
}

export async function salir() {
  const token = (await cookies()).get(COOKIE_SESION)?.value;
  if (token) {
    try {
      await cerrarSesion(obtenerDb(), token);
    } catch (error) {
      // Igual se borra la cookie: en este navegador queda cerrada.
      console.error("[salir] No se pudo borrar la sesión de la base:", error);
    }
  }
  await borrarCookieSesion();
  redirect("/ingresar");
}

export type EstadoContrasena = { error?: string };

export async function cambiarMiContrasena(
  _anterior: EstadoContrasena,
  datos: FormData,
): Promise<EstadoContrasena> {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/ingresar");

  const campo = (nombre: string) => {
    const valor = datos.get(nombre);
    return typeof valor === "string" ? valor : "";
  };
  const actual = campo("actual");
  const nueva = campo("nueva");
  const repetida = campo("repetida");
  if (!actual || !nueva || !repetida) return { error: "Completá los tres campos." };

  try {
    const resultado = await cambiarContrasena(obtenerDb(), {
      usuarioId: sesion.usuario.id,
      sesionId: sesion.id,
      actual,
      nueva,
      repetida,
    });
    if (!resultado.ok) return { error: resultado.error };
  } catch (error) {
    console.error("[cambiarMiContrasena] Falló:", error);
    return { error: ERROR_CONEXION };
  }
  redirect(`${inicioSegunRol(sesion.usuario.rol)}?contrasena=cambiada`);
}
