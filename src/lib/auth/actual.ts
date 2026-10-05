// Quién está usando el sistema ahora (lee la cookie de la sesión).
// Cada página y cada acción del panel tiene que llamar a requerirUsuario():
// el menú o el layout solos no alcanzan para proteger una página.
import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import type { Rol } from "@/generated/prisma/client";
import { obtenerDb } from "@/lib/db";

import { inicioSegunRol } from "./cuentas";
import { DURACION_MAXIMA, validarSesion } from "./sesiones";

export const COOKIE_SESION = "sesion";

// Una vez por pedido, aunque la llamen varios componentes.
export const obtenerSesionActual = cache(async () => {
  const token = (await cookies()).get(COOKIE_SESION)?.value;
  if (!token) return null;
  return validarSesion(obtenerDb(), token);
});

// Devuelve el usuario si tiene uno de los roles. Si no ingresó, lo manda a
// /ingresar; si tiene que cambiar la contraseña, a cambiarla; si no tiene
// permiso, a su propio inicio.
export async function requerirUsuario(roles: Rol[]) {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/ingresar");
  const { usuario } = sesion;
  if (usuario.debeCambiarContrasena) redirect("/cuenta/contrasena");
  if (!roles.includes(usuario.rol)) redirect(inicioSegunRol(usuario.rol));
  return usuario;
}

// Solo desde acciones (Server Actions): las páginas no pueden escribir cookies.
export async function guardarCookieSesion(token: string, maxAge = DURACION_MAXIMA / 1000) {
  (await cookies()).set(COOKIE_SESION, token, {
    httpOnly: true, // el JavaScript de la página no la puede leer
    secure: process.env.NODE_ENV === "production", // solo por https
    sameSite: "lax", // otras páginas no la pueden usar para mandar formularios
    path: "/",
    maxAge,
  });
}

export async function borrarCookieSesion() {
  await guardarCookieSesion("", 0);
}
