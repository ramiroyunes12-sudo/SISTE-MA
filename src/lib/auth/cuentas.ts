// Cuentas del panel: ingresar, cambiar la contraseña y dar una temporal.
import type { PrismaClient, Rol } from "@/generated/prisma/client";

import { generarContrasenaTemporal, hashearContrasena, hashFalso, verificarContrasena } from "./contrasenas";
import { LARGO_MAXIMO, problemaConContrasenaNueva } from "./reglas";
import { cerrarSesionesDe, type UsuarioDeSesion } from "./sesiones";

// 5 contraseñas mal seguidas → 15 minutos bloqueado. Después del bloqueo
// queda 1 intento cada 15 minutos hasta que acierte.
export const MAX_INTENTOS = 5;
export const MINUTOS_BLOQUEO = 15;

export function normalizarEmail(valor: unknown) {
  return typeof valor === "string" ? valor.trim().toLowerCase() : "";
}

// Adónde va cada uno después de ingresar.
export function inicioSegunRol(rol: Rol) {
  return rol === "ADMIN" ? "/admin" : "/validar";
}

type Intento = "ok" | "incorrecta" | "bloqueada_ahora" | "bloqueada";

// Comprueba la contraseña de un usuario y cuenta el intento. El intento se
// anota ANTES de comprobar, así ni mandando muchos a la vez se pasan del límite.
async function probarContrasena(
  db: PrismaClient,
  usuario: { id: string; hashContrasena: string },
  contrasena: string,
  ahora: Date,
): Promise<Intento> {
  const libre = { OR: [{ bloqueadoHasta: null }, { bloqueadoHasta: { lte: ahora } }] };
  const comun = await db.usuario.updateMany({
    where: { id: usuario.id, intentosFallidos: { lt: MAX_INTENTOS - 1 }, ...libre },
    data: { intentosFallidos: { increment: 1 } },
  });
  let ultimo = false;
  if (comun.count === 0) {
    // Es el último intento permitido: se bloquea de antemano y, si acierta, se desbloquea.
    const bloqueo = await db.usuario.updateMany({
      where: { id: usuario.id, intentosFallidos: { gte: MAX_INTENTOS - 1 }, ...libre },
      data: {
        intentosFallidos: { increment: 1 },
        bloqueadoHasta: new Date(ahora.getTime() + MINUTOS_BLOQUEO * 60 * 1000),
      },
    });
    if (bloqueo.count === 0) return "bloqueada";
    ultimo = true;
  }

  // Se calcula siempre (aunque sea larguísima) para que tarde lo mismo.
  const coincide = await verificarContrasena(contrasena.slice(0, LARGO_MAXIMO), usuario.hashContrasena);
  if (!coincide || contrasena.length > LARGO_MAXIMO) return ultimo ? "bloqueada_ahora" : "incorrecta";

  await db.usuario.update({
    where: { id: usuario.id },
    data: { intentosFallidos: 0, bloqueadoHasta: null },
  });
  return "ok";
}

export type ResultadoIngreso =
  | { ok: true; usuario: UsuarioDeSesion }
  | { ok: false; motivo: "incorrecta" | "bloqueada_ahora" }
  | { ok: false; motivo: "bloqueada"; minutos: number };

export async function verificarCredenciales(
  db: PrismaClient,
  email: string,
  contrasena: string,
  ahora = new Date(),
): Promise<ResultadoIngreso> {
  const usuario = await db.usuario.findUnique({
    where: { email: normalizarEmail(email) },
    select: {
      id: true,
      nombre: true,
      email: true,
      rol: true,
      activo: true,
      debeCambiarContrasena: true,
      hashContrasena: true,
      bloqueadoHasta: true,
    },
  });

  if (!usuario || !usuario.activo) {
    // Misma demora que con un email que existe, para no delatar cuáles existen.
    await verificarContrasena(contrasena.slice(0, LARGO_MAXIMO), await hashFalso());
    return { ok: false, motivo: "incorrecta" };
  }

  const intento = await probarContrasena(db, usuario, contrasena, ahora);
  if (intento === "bloqueada") {
    // Si cuando lo leímos todavía no estaba bloqueada, la bloqueó recién otro intento.
    const hasta =
      usuario.bloqueadoHasta && usuario.bloqueadoHasta > ahora
        ? usuario.bloqueadoHasta.getTime()
        : ahora.getTime() + MINUTOS_BLOQUEO * 60 * 1000;
    return { ok: false, motivo: "bloqueada", minutos: Math.ceil((hasta - ahora.getTime()) / 60000) };
  }
  if (intento !== "ok") return { ok: false, motivo: intento };

  await db.usuario.update({ where: { id: usuario.id }, data: { ultimoIngresoEn: ahora } });
  return {
    ok: true,
    usuario: {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      rol: usuario.rol,
      debeCambiarContrasena: usuario.debeCambiarContrasena,
    },
  };
}

export type ResultadoCambio = { ok: true } | { ok: false; error: string };

export async function cambiarContrasena(
  db: PrismaClient,
  datos: { usuarioId: string; sesionId: string; actual: string; nueva: string; repetida: string },
  ahora = new Date(),
): Promise<ResultadoCambio> {
  const usuario = await db.usuario.findUniqueOrThrow({
    where: { id: datos.usuarioId },
    select: { id: true, email: true, hashContrasena: true },
  });

  // Primero lo que no gasta intentos.
  const problema = problemaConContrasenaNueva(datos.nueva, usuario.email);
  if (problema) return { ok: false, error: `La contraseña nueva no sirve: ${problema}` };
  if (datos.nueva !== datos.repetida) return { ok: false, error: "Las dos contraseñas nuevas no coinciden." };
  if (datos.nueva === datos.actual) return { ok: false, error: "La nueva tiene que ser distinta de la actual." };

  const intento = await probarContrasena(db, usuario, datos.actual, ahora);
  if (intento === "bloqueada" || intento === "bloqueada_ahora") {
    return { ok: false, error: `Demasiados intentos fallidos. Probá de nuevo en ${MINUTOS_BLOQUEO} minutos.` };
  }
  if (intento === "incorrecta") return { ok: false, error: "La contraseña actual no es correcta." };

  const hash = await hashearContrasena(datos.nueva);
  await db.$transaction([
    db.usuario.update({
      where: { id: usuario.id },
      data: { hashContrasena: hash, debeCambiarContrasena: false },
    }),
    // Los otros navegadores donde estaba abierta quedan afuera.
    db.sesion.deleteMany({ where: { usuarioId: usuario.id, id: { not: datos.sesionId } } }),
  ]);
  return { ok: true };
}

// Crea el usuario (o, si ya existe, le resetea la contraseña) con una
// contraseña temporal que tiene que cambiar al entrar. Devuelve la temporal.
export async function darContrasenaTemporal(
  db: PrismaClient,
  datos: { email: string; nombre: string; rol: Rol },
) {
  const email = normalizarEmail(datos.email);
  const temporal = generarContrasenaTemporal();
  const hashContrasena = await hashearContrasena(temporal);
  const comun = { hashContrasena, debeCambiarContrasena: true, intentosFallidos: 0, bloqueadoHasta: null };
  const existe = await db.usuario.findUnique({ where: { email }, select: { id: true } });
  const usuario = existe
    ? await db.usuario.update({ where: { id: existe.id }, data: comun })
    : await db.usuario.create({ data: { email, nombre: datos.nombre.trim(), rol: datos.rol, ...comun } });
  await cerrarSesionesDe(db, usuario.id);
  return { usuario, temporal };
}
