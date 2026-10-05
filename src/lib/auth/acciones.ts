"use server";
// Acciones de los formularios de ingreso, salida y cambio de contraseña.
// Corren en el servidor; Next.js además rechaza las que vengan de otra página.
import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";

import { obtenerDb } from "@/lib/db";

import { borrarCookieSesion, COOKIE_SESION, guardarCookieSesion, obtenerSesionActual } from "./actual";
import { cambiarContrasena, inicioSegunRol, ingresarConContrasena, MAX_INTENTOS, MINUTOS_BLOQUEO, normalizarEmail } from "./cuentas";
import { cerrarSesion } from "./sesiones";

const ERROR_CONEXION = "No pudimos conectar con el sistema. Probá de nuevo en un rato.";

// El mismo mensaje si el email no existe, si la contraseña está mal o si la
// cuenta está bloqueada: así no se puede averiguar qué emails tienen cuenta.
const ERROR_INGRESO = `Email o contraseña incorrectos. Después de ${MAX_INTENTOS} intentos fallidos seguidos, la cuenta se bloquea ${MINUTOS_BLOQUEO} minutos.`;

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
    const resultado = await ingresarConContrasena(db, email, contrasena);
    if (!resultado.ok) {
      // Solo lo ve quien acertó la temporal: no delata nada.
      const error =
        resultado.motivo === "temporal_vencida"
          ? "Tu contraseña temporal venció. Pedile una nueva al administrador."
          : ERROR_INGRESO;
      return { error, email };
    }
    // Si en este navegador había otra sesión abierta, se cierra: queda solo la nueva.
    const anterior = (await cookies()).get(COOKIE_SESION)?.value;
    if (anterior) await cerrarSesion(db, anterior);
    await guardarCookieSesion(resultado.token);
    const { usuario } = resultado;
    destino = usuario.debeCambiarContrasena ? "/cuenta/contrasena" : inicioSegunRol(usuario.rol);
  } catch (error) {
    unstable_rethrow(error); // las señales internas de Next.js no son errores
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
  const campo = (nombre: string) => {
    const valor = datos.get(nombre);
    return typeof valor === "string" ? valor : "";
  };
  const actual = campo("actual");
  const nueva = campo("nueva");
  const repetida = campo("repetida");
  if (!actual || !nueva || !repetida) return { error: "Completá los tres campos." };

  let destino: string;
  try {
    const sesion = await obtenerSesionActual();
    if (!sesion) destino = "/ingresar";
    else {
      const resultado = await cambiarContrasena(obtenerDb(), {
        usuarioId: sesion.usuario.id,
        actual,
        nueva,
        repetida,
      });
      if (!resultado.ok) return { error: resultado.error };
      // Sesión nueva para este navegador; las demás quedaron cerradas.
      await guardarCookieSesion(resultado.token);
      destino = `${inicioSegunRol(sesion.usuario.rol)}?contrasena=cambiada`;
    }
  } catch (error) {
    unstable_rethrow(error);
    console.error("[cambiarMiContrasena] Falló:", error);
    return { error: ERROR_CONEXION };
  }
  redirect(destino);
}
