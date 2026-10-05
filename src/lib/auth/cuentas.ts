// Cuentas del panel: ingresar, cambiar la contraseña y dar una temporal.
import type { PrismaClient, Rol } from "@/generated/prisma/client";

import { generarContrasenaTemporal, HASH_DE_RELLENO, hashearContrasena, verificarContrasena } from "./contrasenas";
import { LARGO_MAXIMO, problemaConContrasenaNueva } from "./reglas";
import { crearSesion, type UsuarioDeSesion } from "./sesiones";

// 5 contraseñas mal seguidas → 15 minutos bloqueado. Después del bloqueo
// queda 1 intento cada 15 minutos hasta que acierte.
export const MAX_INTENTOS = 5;
export const MINUTOS_BLOQUEO = 15;
// La contraseña temporal sirve por 72 horas.
export const HORAS_TEMPORAL = 72;

export function normalizarEmail(valor: unknown) {
  return typeof valor === "string" ? valor.trim().toLowerCase() : "";
}

// Adónde va cada uno después de ingresar.
export function inicioSegunRol(rol: Rol) {
  return rol === "ADMIN" ? "/admin" : "/validar";
}

type ParaProbar = {
  id: string;
  hashContrasena: string;
  debeCambiarContrasena: boolean;
  temporalVenceEn: Date | null;
};

type Intento = "ok" | "incorrecta" | "bloqueada_ahora" | "bloqueada" | "temporal_vencida";

// Igual que comparar una contraseña, para que todos los caminos tarden lo mismo.
async function demorar(contrasena: string) {
  await verificarContrasena(contrasena.slice(0, LARGO_MAXIMO), HASH_DE_RELLENO);
}

// Una consulta que no cambia nada: así, con un email que existe o que no,
// se hace la misma cantidad de idas y vueltas a la base (1 lectura + 2 escrituras).
const ID_INEXISTENTE = "00000000-0000-0000-0000-000000000000";
async function consultaDeRelleno(db: PrismaClient) {
  await db.usuario.updateMany({ where: { id: ID_INEXISTENTE }, data: { intentosFallidos: { increment: 1 } } });
}

// Comprueba la contraseña de un usuario y cuenta el intento. El intento se
// anota ANTES de comprobar, así ni mandando muchos a la vez se pasan del límite.
// Si da "ok", el que llama pone el contador en cero junto con lo que haga.
async function probarContrasena(
  db: PrismaClient,
  usuario: ParaProbar,
  contrasena: string,
  ahora: Date,
): Promise<Intento> {
  const libre = { OR: [{ bloqueadoHasta: null }, { bloqueadoHasta: { lte: ahora } }] };
  const comun = await db.usuario.updateMany({
    where: { id: usuario.id, intentosFallidos: { lt: MAX_INTENTOS - 1 }, ...libre },
    data: { intentosFallidos: { increment: 1 } },
  });
  let ultimo = false;
  if (comun.count === 1) {
    await consultaDeRelleno(db);
  } else {
    // Es el último intento permitido: se bloquea de antemano y, si acierta, se desbloquea.
    const bloqueo = await db.usuario.updateMany({
      where: { id: usuario.id, intentosFallidos: { gte: MAX_INTENTOS - 1 }, ...libre },
      data: {
        intentosFallidos: { increment: 1 },
        bloqueadoHasta: new Date(ahora.getTime() + MINUTOS_BLOQUEO * 60 * 1000),
      },
    });
    if (bloqueo.count === 0) {
      await demorar(contrasena);
      return "bloqueada";
    }
    ultimo = true;
  }

  // Se calcula siempre (aunque sea larguísima) para que tarde lo mismo.
  const coincide = await verificarContrasena(contrasena.slice(0, LARGO_MAXIMO), usuario.hashContrasena);
  if (!coincide || contrasena.length > LARGO_MAXIMO) return ultimo ? "bloqueada_ahora" : "incorrecta";
  if (usuario.debeCambiarContrasena && usuario.temporalVenceEn && usuario.temporalVenceEn <= ahora) {
    return "temporal_vencida";
  }
  return "ok";
}

// Minutos que le quedan al bloqueo. Si cuando se leyó todavía no estaba
// bloqueada, la bloqueó recién otro intento: quedan los 15.
function minutosDeBloqueo(bloqueadoHasta: Date | null, ahora: Date) {
  const hasta =
    bloqueadoHasta && bloqueadoHasta > ahora
      ? bloqueadoHasta.getTime()
      : ahora.getTime() + MINUTOS_BLOQUEO * 60 * 1000;
  return Math.ceil((hasta - ahora.getTime()) / 60000);
}

export type ResultadoIngreso =
  | { ok: true; usuario: UsuarioDeSesion; token: string }
  | { ok: false; motivo: Exclude<Intento, "ok"> };

// Comprueba email y contraseña y, si están bien, abre una sesión (devuelve su token).
export async function ingresarConContrasena(
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
      temporalVenceEn: true,
      hashContrasena: true,
    },
  });

  if (!usuario || !usuario.activo) {
    // Mismo trabajo que con un email que existe, para no delatar cuáles existen.
    await consultaDeRelleno(db);
    await consultaDeRelleno(db);
    await demorar(contrasena);
    return { ok: false, motivo: "incorrecta" };
  }

  const intento = await probarContrasena(db, usuario, contrasena, ahora);
  if (intento !== "ok") return { ok: false, motivo: intento };

  // La sesión se abre solo si la contraseña sigue siendo la que se comprobó:
  // si justo la cambiaron o la resetearon mientras tanto, no entra.
  const token = await db.$transaction(async (tx) => {
    const vigente = await tx.usuario.updateMany({
      where: { id: usuario.id, hashContrasena: usuario.hashContrasena, activo: true },
      data: { intentosFallidos: 0, bloqueadoHasta: null, ultimoIngresoEn: ahora },
    });
    return vigente.count === 1 ? crearSesion(tx, usuario.id, ahora) : null;
  });
  if (!token) return { ok: false, motivo: "incorrecta" };

  return {
    ok: true,
    token,
    usuario: {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      rol: usuario.rol,
      debeCambiarContrasena: usuario.debeCambiarContrasena,
    },
  };
}

export type ResultadoCambio = { ok: true; token: string } | { ok: false; error: string };

// Cambia la contraseña. Cierra TODAS las sesiones del usuario y abre una nueva
// para este navegador (devuelve su token): los otros navegadores quedan afuera.
export async function cambiarContrasena(
  db: PrismaClient,
  datos: { usuarioId: string; actual: string; nueva: string; repetida: string },
  ahora = new Date(),
): Promise<ResultadoCambio> {
  const usuario = await db.usuario.findUniqueOrThrow({
    where: { id: datos.usuarioId },
    select: {
      id: true,
      email: true,
      hashContrasena: true,
      debeCambiarContrasena: true,
      temporalVenceEn: true,
      bloqueadoHasta: true,
    },
  });
  const cual = usuario.debeCambiarContrasena ? "temporal" : "actual";

  // Primero lo que no gasta intentos.
  const problema = problemaConContrasenaNueva(datos.nueva, usuario.email);
  if (problema) return { ok: false, error: `La contraseña nueva no sirve: ${problema}` };
  if (datos.nueva !== datos.repetida) return { ok: false, error: "Las dos contraseñas nuevas no coinciden." };
  if (datos.nueva === datos.actual) {
    return { ok: false, error: `La nueva tiene que ser distinta de la ${cual}.` };
  }

  const intento = await probarContrasena(db, usuario, datos.actual, ahora);
  if (intento === "bloqueada" || intento === "bloqueada_ahora") {
    const minutos = minutosDeBloqueo(intento === "bloqueada" ? usuario.bloqueadoHasta : null, ahora);
    return {
      ok: false,
      error: `Demasiados intentos fallidos. Probá de nuevo en ${minutos} ${minutos === 1 ? "minuto" : "minutos"}.`,
    };
  }
  if (intento === "incorrecta") return { ok: false, error: `La contraseña ${cual} no es correcta.` };
  if (intento === "temporal_vencida") {
    return { ok: false, error: "Tu contraseña temporal venció. Pedile una nueva al administrador." };
  }

  const hash = await hashearContrasena(datos.nueva);
  const token = await db.$transaction(async (tx) => {
    // Solo si nadie la cambió (o reseteó) mientras tanto.
    const cambio = await tx.usuario.updateMany({
      where: { id: usuario.id, hashContrasena: usuario.hashContrasena },
      data: {
        hashContrasena: hash,
        debeCambiarContrasena: false,
        temporalVenceEn: null,
        intentosFallidos: 0,
        bloqueadoHasta: null,
      },
    });
    if (cambio.count !== 1) return null;
    await tx.sesion.deleteMany({ where: { usuarioId: usuario.id } });
    return crearSesion(tx, usuario.id, ahora);
  });
  if (!token) {
    return { ok: false, error: "Tu contraseña cambió mientras tanto. Cerrá sesión y volvé a ingresar." };
  }
  return { ok: true, token };
}

// Crea el usuario (o, si ya existe, le resetea la contraseña) con una
// contraseña temporal que tiene que cambiar al entrar y que vence en 72 horas.
// También lo desbloquea y le cierra las sesiones. Devuelve la temporal.
export async function darContrasenaTemporal(
  db: PrismaClient,
  datos: { email: string; nombre: string; rol: Rol },
  ahora = new Date(),
) {
  const email = normalizarEmail(datos.email);
  const temporal = generarContrasenaTemporal();
  const venceEn = new Date(ahora.getTime() + HORAS_TEMPORAL * 60 * 60 * 1000);
  const comun = {
    hashContrasena: await hashearContrasena(temporal),
    debeCambiarContrasena: true,
    temporalVenceEn: venceEn,
    intentosFallidos: 0,
    bloqueadoHasta: null,
  };
  const campos = { id: true, nombre: true, email: true, rol: true, activo: true } as const;

  const usuario = await db.$transaction(async (tx) => {
    const existe = await tx.usuario.findUnique({ where: { email }, select: { id: true } });
    const resultado = existe
      ? await tx.usuario.update({ where: { id: existe.id }, data: comun, select: campos })
      : await tx.usuario.create({
          data: { email, nombre: datos.nombre.trim(), rol: datos.rol, ...comun },
          select: campos,
        });
    await tx.sesion.deleteMany({ where: { usuarioId: resultado.id } });
    return resultado;
  });
  return { usuario, temporal, venceEn };
}
