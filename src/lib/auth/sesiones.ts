// Sesiones del panel. Al ingresar, el navegador recibe un código secreto al
// azar (el "token") en una cookie. En la base se guarda solo su huella
// SHA-256: con la base sola no se puede armar una cookie válida.
//
// Duración: se cierra después de 7 días sin usarla, y siempre a los 30 días.
import { createHash, randomBytes } from "node:crypto";

import type { Prisma, PrismaClient, Rol } from "@/generated/prisma/client";

// La base, o una transacción abierta en ella.
type Db = PrismaClient | Prisma.TransactionClient;

const DIA = 24 * 60 * 60 * 1000;
export const INACTIVIDAD_MAXIMA = 7 * DIA;
export const DURACION_MAXIMA = 30 * DIA;

export type UsuarioDeSesion = {
  id: string;
  nombre: string;
  email: string;
  rol: Rol;
  debeCambiarContrasena: boolean;
};

export type Sesion = { id: string; usuario: UsuarioDeSesion };

export function generarToken() {
  return randomBytes(32).toString("base64url"); // 43 caracteres
}

export function huellaDeToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

// Cuando se usa la sesión, se estira el vencimiento (7 días desde ahora, sin
// pasar los 30 desde que se abrió). Para no escribir en la base en cada
// página, solo se actualiza si gana al menos un día. null = no tocar.
export function nuevoVencimiento(creadaEn: Date, expiraEn: Date, ahora: Date): Date | null {
  const tope = creadaEn.getTime() + DURACION_MAXIMA;
  const candidato = Math.min(ahora.getTime() + INACTIVIDAD_MAXIMA, tope);
  return candidato - expiraEn.getTime() >= DIA ? new Date(candidato) : null;
}

export async function crearSesion(db: Db, usuarioId: string, ahora = new Date()) {
  const token = generarToken();
  // De paso, se borran las sesiones vencidas de este usuario.
  await db.sesion.deleteMany({ where: { usuarioId, expiraEn: { lte: ahora } } });
  await db.sesion.create({
    data: {
      id: huellaDeToken(token),
      usuarioId,
      creadaEn: ahora,
      expiraEn: new Date(ahora.getTime() + INACTIVIDAD_MAXIMA),
    },
  });
  return token;
}

export async function validarSesion(
  db: PrismaClient,
  token: string,
  ahora = new Date(),
): Promise<Sesion | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const id = huellaDeToken(token);
  const sesion = await db.sesion.findUnique({
    where: { id },
    select: {
      creadaEn: true,
      expiraEn: true,
      usuario: {
        select: { id: true, nombre: true, email: true, rol: true, activo: true, debeCambiarContrasena: true },
      },
    },
  });
  if (!sesion) return null;

  const { usuario } = sesion;
  if (sesion.expiraEn <= ahora || !usuario.activo) {
    await db.sesion.deleteMany({ where: { id } });
    return null;
  }

  const vencimiento = nuevoVencimiento(sesion.creadaEn, sesion.expiraEn, ahora);
  if (vencimiento) await db.sesion.updateMany({ where: { id }, data: { expiraEn: vencimiento } });

  return {
    id,
    usuario: {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      rol: usuario.rol,
      debeCambiarContrasena: usuario.debeCambiarContrasena,
    },
  };
}

export async function cerrarSesion(db: Db, token: string) {
  await db.sesion.deleteMany({ where: { id: huellaDeToken(token) } });
}
