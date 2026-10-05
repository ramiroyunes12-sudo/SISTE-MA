// Login, bloqueo por intentos y sesiones, contra un PostgreSQL de verdad.
// Solo corre si está TEST_DATABASE_URL (ver README, "Tests con base de datos").
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";

import { hashearContrasena } from "./contrasenas";
import {
  cambiarContrasena,
  darContrasenaTemporal,
  HORAS_TEMPORAL,
  ingresarConContrasena,
  MAX_INTENTOS,
} from "./cuentas";
import { cerrarSesion, crearSesion, DURACION_MAXIMA, huellaDeToken, validarSesion } from "./sesiones";

const url = process.env.TEST_DATABASE_URL;
const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;
const CONTRASENA = "mate amargo en la costanera";
const NUEVA = "otra frase bastante larga";

// Una copia de `db` que, justo antes de abrir la transacción final, ejecuta
// `cambio`: simula que otra persona cambió algo mientras se comprobaba la contraseña.
function conCambioEnElMedio(db: PrismaClient, cambio: () => Promise<unknown>): PrismaClient {
  return new Proxy(db, {
    get(objetivo, clave) {
      if (clave === "$transaction") {
        return async (...args: unknown[]) => {
          await cambio();
          return (objetivo.$transaction as (...a: unknown[]) => unknown).apply(objetivo, args);
        };
      }
      const valor = Reflect.get(objetivo, clave, objetivo);
      return typeof valor === "function" ? valor.bind(objetivo) : valor;
    },
  });
}

describe.skipIf(!url)("cuentas y sesiones", { timeout: 60_000 }, () => {
  let db: PrismaClient;
  let hash: string;
  const emails: string[] = [];

  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 20 }) });
    hash = await hashearContrasena(CONTRASENA);
  });

  afterAll(async () => {
    if (!db) return;
    await db.usuario.deleteMany({ where: { email: { in: emails } } }); // borra sus sesiones también
    await db.$disconnect();
  });

  function emailNuevo() {
    const email = `prueba-${crypto.randomUUID()}@ejemplo.com`;
    emails.push(email);
    return email;
  }

  async function crearUsuario(datos: { activo?: boolean; debeCambiarContrasena?: boolean; hashContrasena?: string } = {}) {
    return db.usuario.create({
      data: { email: emailNuevo(), nombre: "Persona de Prueba", rol: "ADMIN", hashContrasena: hash, ...datos },
    });
  }

  async function cantidadDeSesiones(usuarioId: string) {
    return db.sesion.count({ where: { usuarioId } });
  }

  // ─── Ingresar ────────────────────────────────────────────────────────────

  it("entra con la contraseña correcta (sin importar mayúsculas en el email) y abre una sesión", async () => {
    const usuario = await crearUsuario();
    const resultado = await ingresarConContrasena(db, `  ${usuario.email.toUpperCase()} `, CONTRASENA);
    expect(resultado).toMatchObject({
      ok: true,
      usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: "ADMIN", debeCambiarContrasena: false },
    });
    if (!resultado.ok) throw new Error("no entró");
    expect((await validarSesion(db, resultado.token))?.usuario.id).toBe(usuario.id);
    const despues = await db.usuario.findUniqueOrThrow({ where: { id: usuario.id } });
    expect(despues.ultimoIngresoEn).not.toBeNull();
    expect(despues.intentosFallidos).toBe(0);
  });

  it("con email inexistente o usuario desactivado da el mismo error que con contraseña mal", async () => {
    const desactivado = await crearUsuario({ activo: false });
    expect(await ingresarConContrasena(db, "nadie@ejemplo.com", CONTRASENA)).toEqual({ ok: false, motivo: "incorrecta" });
    expect(await ingresarConContrasena(db, desactivado.email, CONTRASENA)).toEqual({ ok: false, motivo: "incorrecta" });
    expect(await cantidadDeSesiones(desactivado.id)).toBe(0);
  });

  it("una contraseña más larga que el máximo no entra, aunque empiece con la correcta", async () => {
    const larga = "x".repeat(127) + "y"; // 128 caracteres: el máximo
    const usuario = await crearUsuario({ hashContrasena: await hashearContrasena(larga) });
    expect(await ingresarConContrasena(db, usuario.email, larga + "z")).toEqual({ ok: false, motivo: "incorrecta" });
    expect(await ingresarConContrasena(db, usuario.email, larga)).toMatchObject({ ok: true });
  });

  it(`después de ${MAX_INTENTOS} contraseñas mal, se bloquea 15 minutos (aunque después acierte)`, async () => {
    const usuario = await crearUsuario();
    const ahora = new Date();
    for (let i = 1; i < MAX_INTENTOS; i++) {
      expect(await ingresarConContrasena(db, usuario.email, `mal ${i}`, ahora)).toEqual({ ok: false, motivo: "incorrecta" });
    }
    expect(await ingresarConContrasena(db, usuario.email, "mal otra vez", ahora)).toEqual({
      ok: false,
      motivo: "bloqueada_ahora",
    });
    // bloqueada: ni con la correcta
    const enCinco = new Date(ahora.getTime() + 5 * MINUTO);
    expect(await ingresarConContrasena(db, usuario.email, CONTRASENA, enCinco)).toEqual({ ok: false, motivo: "bloqueada" });
    // pasado el bloqueo: 1 intento; si falla, otros 15 minutos
    const enVeinte = new Date(ahora.getTime() + 20 * MINUTO);
    expect(await ingresarConContrasena(db, usuario.email, "mal", enVeinte)).toMatchObject({ motivo: "bloqueada_ahora" });
    expect(await ingresarConContrasena(db, usuario.email, CONTRASENA, enVeinte)).toMatchObject({ motivo: "bloqueada" });
    // si acierta, vuelve todo a cero
    const enUnaHora = new Date(ahora.getTime() + 60 * MINUTO);
    expect(await ingresarConContrasena(db, usuario.email, CONTRASENA, enUnaHora)).toMatchObject({ ok: true });
    const despues = await db.usuario.findUniqueOrThrow({ where: { id: usuario.id } });
    expect(despues.intentosFallidos).toBe(0);
    expect(despues.bloqueadoHasta).toBeNull();
  });

  it(`mandando 12 intentos al mismo tiempo, solo ${MAX_INTENTOS} se llegan a probar`, async () => {
    const usuario = await crearUsuario();
    const resultados = await Promise.all(
      Array.from({ length: 12 }, (_, i) => ingresarConContrasena(db, usuario.email, `mal ${i}`)),
    );
    const probados = resultados.filter((r) => !r.ok && r.motivo !== "bloqueada");
    expect(probados).toHaveLength(MAX_INTENTOS);
  });

  it("acertar resetea el contador: los errores que cuentan son los seguidos", async () => {
    const usuario = await crearUsuario();
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      for (let i = 1; i < MAX_INTENTOS; i++) await ingresarConContrasena(db, usuario.email, "mal");
      expect(await ingresarConContrasena(db, usuario.email, CONTRASENA)).toMatchObject({ ok: true });
    }
  });

  it("si la contraseña cambia mientras se comprueba, no abre la sesión", async () => {
    const usuario = await crearUsuario();
    const otroHash = await hashearContrasena("una contraseña distinta");
    const mientras = conCambioEnElMedio(db, () =>
      db.usuario.update({ where: { id: usuario.id }, data: { hashContrasena: otroHash } }),
    );
    expect(await ingresarConContrasena(mientras, usuario.email, CONTRASENA)).toEqual({ ok: false, motivo: "incorrecta" });
    expect(await cantidadDeSesiones(usuario.id)).toBe(0);
  });

  // ─── Sesiones ────────────────────────────────────────────────────────────

  it("la sesión vale con su token; la base guarda solo la huella", async () => {
    const usuario = await crearUsuario();
    const token = await crearSesion(db, usuario.id);
    const sesion = await validarSesion(db, token);
    expect(sesion?.usuario.id).toBe(usuario.id);
    expect(sesion?.id).toBe(huellaDeToken(token));
    expect(await db.sesion.findUnique({ where: { id: token } })).toBeNull(); // el token en sí no está

    expect(await validarSesion(db, token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"))).toBeNull();
    expect(await validarSesion(db, "")).toBeNull();
    expect(await validarSesion(db, "'; drop table usuarios; --")).toBeNull();
  });

  it("se estira con el uso, vence por inactividad y nunca pasa de 30 días", async () => {
    const usuario = await crearUsuario();
    const inicio = new Date();
    const token = await crearSesion(db, usuario.id, inicio);
    const id = huellaDeToken(token);

    // usada cada 5 días: sigue viva y se estira
    for (let dia = 5; dia < 30; dia += 5) {
      expect(await validarSesion(db, token, new Date(inicio.getTime() + dia * DIA))).not.toBeNull();
    }
    const { expiraEn } = await db.sesion.findUniqueOrThrow({ where: { id } });
    expect(expiraEn.getTime()).toBe(inicio.getTime() + DURACION_MAXIMA);
    // a los 30 días se corta igual, y se borra
    expect(await validarSesion(db, token, new Date(inicio.getTime() + 30 * DIA))).toBeNull();
    expect(await db.sesion.findUnique({ where: { id } })).toBeNull();

    // 8 días sin usarla: vencida
    const otro = await crearSesion(db, usuario.id, inicio);
    expect(await validarSesion(db, otro, new Date(inicio.getTime() + 8 * DIA))).toBeNull();
  });

  it("al desactivar un usuario o cerrar la sesión, deja de valer", async () => {
    const usuario = await crearUsuario();
    const token = await crearSesion(db, usuario.id);
    const otro = await crearSesion(db, usuario.id);

    await cerrarSesion(db, token);
    expect(await validarSesion(db, token)).toBeNull();
    expect(await validarSesion(db, otro)).not.toBeNull();

    await db.usuario.update({ where: { id: usuario.id }, data: { activo: false } });
    expect(await validarSesion(db, otro)).toBeNull();
  });

  // ─── Cambiar la contraseña ───────────────────────────────────────────────

  it("cambiar la contraseña pide la actual, cierra todas las sesiones y abre una nueva", async () => {
    const usuario = await crearUsuario({ debeCambiarContrasena: true });
    const esta = await crearSesion(db, usuario.id);
    const otra = await crearSesion(db, usuario.id);

    const intento = (datos: { actual: string; nueva: string; repetida: string }) =>
      cambiarContrasena(db, { usuarioId: usuario.id, ...datos });

    expect(await intento({ actual: CONTRASENA, nueva: "corta", repetida: "corta" })).toMatchObject({
      error: /al menos 10/,
    });
    expect(await intento({ actual: CONTRASENA, nueva: "1234567890", repetida: "1234567890" })).toMatchObject({
      error: /letras/,
    });
    expect(await intento({ actual: CONTRASENA, nueva: NUEVA, repetida: NUEVA + "x" })).toMatchObject({ error: /no coinciden/ });
    expect(await intento({ actual: CONTRASENA, nueva: CONTRASENA, repetida: CONTRASENA })).toMatchObject({
      error: /distinta de la temporal/,
    });
    expect(await intento({ actual: "mal", nueva: NUEVA, repetida: NUEVA })).toMatchObject({
      error: "La contraseña temporal no es correcta.",
    });

    const resultado = await intento({ actual: CONTRASENA, nueva: NUEVA, repetida: NUEVA });
    if (!resultado.ok) throw new Error(resultado.error);
    const despues = await db.usuario.findUniqueOrThrow({ where: { id: usuario.id } });
    expect(despues.debeCambiarContrasena).toBe(false);
    expect(despues.intentosFallidos).toBe(0);
    expect(await validarSesion(db, esta)).toBeNull();
    expect(await validarSesion(db, otra)).toBeNull();
    expect((await validarSesion(db, resultado.token))?.usuario.debeCambiarContrasena).toBe(false);
    expect(await cantidadDeSesiones(usuario.id)).toBe(1);
    expect(await ingresarConContrasena(db, usuario.email, CONTRASENA)).toMatchObject({ ok: false });
    expect(await ingresarConContrasena(db, usuario.email, NUEVA)).toMatchObject({ ok: true });
  });

  it("los errores con la contraseña actual también cuentan para el bloqueo", async () => {
    const usuario = await crearUsuario();
    const ahora = new Date();
    for (let i = 1; i < MAX_INTENTOS; i++) {
      expect(
        await cambiarContrasena(db, { usuarioId: usuario.id, actual: `mal ${i}`, nueva: NUEVA, repetida: NUEVA }, ahora),
      ).toMatchObject({ error: "La contraseña actual no es correcta." });
    }
    expect(
      await cambiarContrasena(db, { usuarioId: usuario.id, actual: "mal", nueva: NUEVA, repetida: NUEVA }, ahora),
    ).toMatchObject({ error: /Probá de nuevo en 15 minutos/ });
    const enDiez = new Date(ahora.getTime() + 10 * MINUTO);
    expect(
      await cambiarContrasena(db, { usuarioId: usuario.id, actual: CONTRASENA, nueva: NUEVA, repetida: NUEVA }, enDiez),
    ).toMatchObject({ error: /Probá de nuevo en 5 minutos/ });
    expect(await ingresarConContrasena(db, usuario.email, CONTRASENA, enDiez)).toEqual({ ok: false, motivo: "bloqueada" });
  });

  it("si la resetean mientras se cambia, el cambio no pisa el reset", async () => {
    const usuario = await crearUsuario();
    let temporal = "";
    const mientras = conCambioEnElMedio(db, async () => {
      ({ temporal } = await darContrasenaTemporal(db, { email: usuario.email, nombre: "", rol: "ADMIN" }));
    });
    expect(
      await cambiarContrasena(mientras, { usuarioId: usuario.id, actual: CONTRASENA, nueva: NUEVA, repetida: NUEVA }),
    ).toMatchObject({ ok: false, error: /cambió mientras tanto/ });
    expect(await ingresarConContrasena(db, usuario.email, NUEVA)).toMatchObject({ ok: false });
    expect(await ingresarConContrasena(db, usuario.email, temporal)).toMatchObject({
      ok: true,
      usuario: { debeCambiarContrasena: true },
    });
  });

  // ─── Contraseña temporal ─────────────────────────────────────────────────

  it("la temporal crea el usuario, o lo resetea: lo desbloquea y le cierra las sesiones", async () => {
    const email = emailNuevo();
    const ahora = new Date();
    const creado = await darContrasenaTemporal(db, { email: email.toUpperCase(), nombre: " Ana ", rol: "VALIDADOR" }, ahora);
    expect(creado.usuario).toEqual({ id: expect.any(String), email, nombre: "Ana", rol: "VALIDADOR", activo: true });
    expect(creado.venceEn.getTime()).toBe(ahora.getTime() + HORAS_TEMPORAL * HORA);
    expect(await ingresarConContrasena(db, email, creado.temporal, ahora)).toMatchObject({
      ok: true,
      usuario: { debeCambiarContrasena: true },
    });

    // la bloquean y le queda una sesión abierta; el reset arregla las dos cosas
    for (let i = 0; i < MAX_INTENTOS; i++) await ingresarConContrasena(db, email, "mal", ahora);
    const token = await crearSesion(db, creado.usuario.id, ahora);
    const reseteado = await darContrasenaTemporal(db, { email, nombre: "", rol: "VALIDADOR" }, ahora);
    expect(reseteado.usuario.id).toBe(creado.usuario.id);
    expect(reseteado.usuario.nombre).toBe("Ana");
    expect(reseteado.temporal).not.toBe(creado.temporal);
    expect(await validarSesion(db, token, ahora)).toBeNull();
    expect(await ingresarConContrasena(db, email, creado.temporal, ahora)).toMatchObject({ ok: false });
    expect(await ingresarConContrasena(db, email, reseteado.temporal, ahora)).toMatchObject({ ok: true });
  });

  it("la temporal vence a las 72 horas (para entrar y para cambiarla)", async () => {
    const email = emailNuevo();
    const ahora = new Date();
    const { usuario, temporal } = await darContrasenaTemporal(db, { email, nombre: "Beto", rol: "VALIDADOR" }, ahora);
    const antes = new Date(ahora.getTime() + (HORAS_TEMPORAL - 1) * HORA);
    const despues = new Date(ahora.getTime() + (HORAS_TEMPORAL + 1) * HORA);

    expect(await ingresarConContrasena(db, email, temporal, despues)).toEqual({ ok: false, motivo: "temporal_vencida" });
    expect(await ingresarConContrasena(db, email, temporal, antes)).toMatchObject({ ok: true });
    // entró a tiempo, pero quiso cambiarla tarde
    expect(
      await cambiarContrasena(db, { usuarioId: usuario.id, actual: temporal, nueva: NUEVA, repetida: NUEVA }, despues),
    ).toMatchObject({ error: /temporal venció/ });
    // a tiempo sí, y después ya no vence
    expect(
      await cambiarContrasena(db, { usuarioId: usuario.id, actual: temporal, nueva: NUEVA, repetida: NUEVA }, antes),
    ).toMatchObject({ ok: true });
    const lejos = new Date(ahora.getTime() + 365 * DIA);
    expect(await ingresarConContrasena(db, email, NUEVA, lejos)).toMatchObject({ ok: true });
  });

  // ─── Reglas de la base ───────────────────────────────────────────────────

  it("la base no acepta emails con mayúsculas ni huellas de sesión inventadas", async () => {
    const conMayusculas = `Prueba-${crypto.randomUUID()}@Ejemplo.com`;
    emails.push(conMayusculas.toLowerCase(), conMayusculas);
    await expect(
      db.usuario.create({ data: { email: conMayusculas, nombre: "Ana", hashContrasena: hash } }),
    ).rejects.toThrow(/usuarios_datos_validos/);
    const usuario = await crearUsuario();
    await expect(
      db.sesion.create({ data: { id: "no-es-una-huella", usuarioId: usuario.id, expiraEn: new Date(Date.now() + DIA) } }),
    ).rejects.toThrow(/sesiones_datos_validos/);
  });
});
