// Productoras y su gente (organizadores y validadores). Esto lo maneja el
// ADMIN desde el panel; cada cuenta nueva sale con una contraseña temporal
// que se le pasa a la persona (vence en 72 horas y la cambia al entrar).
import type { PrismaClient } from "@/generated/prisma/client";

import { normalizarEmail, prepararTemporal } from "./auth/cuentas";
import { unicoRepetido } from "./errores-db";

export type Errores = Record<string, string>;
export type CuentaNueva = { email: string; temporal: string; venceEn: Date };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const ROLES_DE_PRODUCTORA = ["ORGANIZADOR", "VALIDADOR"] as const;
export type RolDeProductora = (typeof ROLES_DE_PRODUCTORA)[number];

function texto(valor: unknown) {
  return typeof valor === "string" ? valor.trim() : "";
}

function validarNombreProductora(valor: unknown, errores: Errores) {
  const nombre = texto(valor);
  if (nombre.length < 2 || nombre.length > 80) errores.nombre = "Poné un nombre de 2 a 80 caracteres.";
  return nombre;
}

function validarPersona(valor: { nombre?: unknown; email?: unknown; rol?: unknown }, errores: Errores, prefijo = "") {
  const nombre = texto(valor.nombre);
  if (nombre.length < 2 || nombre.length > 80) errores[`${prefijo}nombrePersona`] = "Poné nombre y apellido.";
  const email = normalizarEmail(valor.email);
  if (!EMAIL.test(email) || email.length > 200) errores[`${prefijo}email`] = "Poné un email válido.";
  const rol = ROLES_DE_PRODUCTORA.find((r) => r === valor.rol) ?? "ORGANIZADOR";
  return { nombre, email, rol };
}

const NOMBRE_REPETIDO = "productoras_nombre_key";
const EMAIL_REPETIDO = "usuarios_email_key";

// Crea la productora con su primer organizador.
export async function crearProductora(
  db: PrismaClient,
  entrada: { nombre?: unknown; nombrePersona?: unknown; email?: unknown },
  ahora = new Date(),
): Promise<{ ok: true; productoraId: string; cuenta: CuentaNueva } | { ok: false; errores: Errores }> {
  const errores: Errores = {};
  const nombre = validarNombreProductora(entrada.nombre, errores);
  const persona = validarPersona({ nombre: entrada.nombrePersona, email: entrada.email }, errores);
  if (Object.keys(errores).length) return { ok: false, errores };

  const { temporal, venceEn, datos } = await prepararTemporal(ahora);
  try {
    const productoraId = await db.$transaction(async (tx) => {
      const productora = await tx.productora.create({ data: { nombre }, select: { id: true } });
      await tx.usuario.create({
        data: { ...datos, nombre: persona.nombre, email: persona.email, rol: "ORGANIZADOR", productoraId: productora.id },
      });
      return productora.id;
    });
    return { ok: true, productoraId, cuenta: { email: persona.email, temporal, venceEn } };
  } catch (error) {
    const repetido = unicoRepetido(error);
    if (repetido === NOMBRE_REPETIDO) return { ok: false, errores: { nombre: "Ya hay una productora con ese nombre." } };
    if (repetido === EMAIL_REPETIDO) return { ok: false, errores: { email: "Ese email ya tiene una cuenta." } };
    throw error;
  }
}

export async function editarProductora(
  db: PrismaClient,
  productoraId: string,
  entrada: { nombre?: unknown; activa?: unknown },
): Promise<{ ok: true } | { ok: false; errores: Errores }> {
  const errores: Errores = {};
  const nombre = validarNombreProductora(entrada.nombre, errores);
  if (Object.keys(errores).length) return { ok: false, errores };
  try {
    // Al desactivarla, su gente queda afuera enseguida (validarSesion mira si está activa).
    const { count } = await db.productora.updateMany({
      where: { id: productoraId },
      data: { nombre, activa: entrada.activa === true },
    });
    return count === 1 ? { ok: true } : { ok: false, errores: { general: "Esa productora ya no existe." } };
  } catch (error) {
    if (unicoRepetido(error) === NOMBRE_REPETIDO) {
      return { ok: false, errores: { nombre: "Ya hay una productora con ese nombre." } };
    }
    throw error;
  }
}

// Suma una persona a la productora. Nunca toca una cuenta que ya exista.
export async function agregarPersona(
  db: PrismaClient,
  productoraId: string,
  entrada: { nombrePersona?: unknown; email?: unknown; rol?: unknown },
  ahora = new Date(),
): Promise<{ ok: true; cuenta: CuentaNueva } | { ok: false; errores: Errores }> {
  const errores: Errores = {};
  const persona = validarPersona({ nombre: entrada.nombrePersona, email: entrada.email, rol: entrada.rol }, errores);
  if (Object.keys(errores).length) return { ok: false, errores };

  const productora = await db.productora.findUnique({ where: { id: productoraId }, select: { id: true } });
  if (!productora) return { ok: false, errores: { general: "Esa productora ya no existe." } };

  const { temporal, venceEn, datos } = await prepararTemporal(ahora);
  try {
    await db.usuario.create({
      data: { ...datos, nombre: persona.nombre, email: persona.email, rol: persona.rol, productoraId },
    });
    return { ok: true, cuenta: { email: persona.email, temporal, venceEn } };
  } catch (error) {
    if (unicoRepetido(error) === EMAIL_REPETIDO) return { ok: false, errores: { email: "Ese email ya tiene una cuenta." } };
    throw error;
  }
}

// Contraseña temporal nueva para alguien de la productora (la olvidó o no
// llegó a usar la anterior). Le destraba la cuenta y le cierra las sesiones.
export async function nuevaTemporal(
  db: PrismaClient,
  productoraId: string,
  usuarioId: string,
  ahora = new Date(),
): Promise<{ ok: true; cuenta: CuentaNueva } | { ok: false; error: string }> {
  const { temporal, venceEn, datos } = await prepararTemporal(ahora);
  const usuario = await db.$transaction(async (tx) => {
    const encontrado = await tx.usuario.findFirst({ where: { id: usuarioId, productoraId }, select: { id: true, email: true } });
    if (!encontrado) return null;
    await tx.usuario.update({ where: { id: encontrado.id }, data: datos });
    await tx.sesion.deleteMany({ where: { usuarioId: encontrado.id } });
    return encontrado;
  });
  if (!usuario) return { ok: false, error: "Esa persona ya no está en esta productora." };
  return { ok: true, cuenta: { email: usuario.email, temporal, venceEn } };
}

// Activar o desactivar a alguien de la productora (al desactivar, queda afuera enseguida).
export async function cambiarActivo(
  db: PrismaClient,
  productoraId: string,
  usuarioId: string,
  activo: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const encontrado = await db.$transaction(async (tx) => {
    const { count } = await tx.usuario.updateMany({ where: { id: usuarioId, productoraId }, data: { activo } });
    if (count === 1 && !activo) await tx.sesion.deleteMany({ where: { usuarioId } });
    return count === 1;
  });
  return encontrado ? { ok: true } : { ok: false, error: "Esa persona ya no está en esta productora." };
}
