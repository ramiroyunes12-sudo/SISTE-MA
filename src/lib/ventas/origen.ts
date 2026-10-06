// De dónde sale una reserva (para el límite de reservas abiertas): una cookie
// con un número al azar que identifica al navegador, y la IP de la conexión.
// En la base solo se guardan sus huellas (ver ordenes.ts).
// Solo desde acciones (Server Actions): las páginas no pueden escribir cookies.
import "server-only";

import { cookies, headers } from "next/headers";

import { generarToken } from "@/lib/auth/sesiones";

import type { Origen } from "./ordenes";

const COOKIE_NAVEGADOR = "navegador";

export async function origenDeLaVisita(): Promise<Origen> {
  const galletas = await cookies();
  let navegador = galletas.get(COOKIE_NAVEGADOR)?.value;
  if (!navegador || !/^[A-Za-z0-9_-]{43}$/.test(navegador)) {
    navegador = generarToken();
    galletas.set(COOKIE_NAVEGADOR, navegador, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 365 * 24 * 60 * 60,
    });
  }
  // En Vercel, x-real-ip la pone Vercel (no la puede inventar quien visita).
  const encabezados = await headers();
  const ip = encabezados.get("x-real-ip") ?? encabezados.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  return { navegador, ip: ip || "desconocida" };
}
