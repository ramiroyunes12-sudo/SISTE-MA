// Login, bloqueo por intentos y sesiones, contra un PostgreSQL de verdad.
// Solo corre si está TEST_DATABASE_URL (ver README, "Tests con base de datos").
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";

import { hashearContrasena } from "./contrasenas";
import { cambiarContrasena, darContrasenaTemporal, MAX_INTENTOS, verificarCredenciales } from "./cuentas";
import { cerrarSesion, crearSesion, DURACION_MAXIMA, huellaDeToken, validarSesion } from "./sesiones";

const url = process.env.TEST_DATABASE_URL;
const MINUTO = 60 * 1000;
const DIA = 24 * 60 * MINUTO;
const CONTRASENA = "mate amargo en la costanera";

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

  async function crearUsuario(datos: { activo?: boolean; debeCambiarContrasena?: boolean } = {}) {
    const email = `prueba-${crypto.randomUUID()}@ejemplo.com`;
    emails.push(email);
    return db.usuario.create({
      data: { email, nombre: "Persona de Prueba", rol: "ADMIN", hashContrasena: hash, ...datos },
    });
  }

  it("entra con la contraseña correcta, sin importar mayúsculas en el email", async () => {
    const usuario = await crearUsuario();
    const resultado = await verificarCredenciales(db, `  ${usuario.email.toUpperCase()} `, CONTRASENA);
    expect(resultado).toEqual({
      ok: true,
      usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: "ADMIN", debeCambiarContrasena: false },
    });
    const despues = await db.usuario.findUniqueOrThrow({ where: { id: usuario.id } });
    expect(despues.ultimoIngresoEn).not.toBeNull();
    expect(despues.intentosFallidos).toBe(0);
  });

  it("con email inexistente o usuario desactivado da el mismo error que con contraseña mal", async () => {
    const desactivado = await crearUsuario({ activo: false });
    expect(await verificarCredenciales(db, "nadie@ejemplo.com", CONTRASENA)).toEqual({ ok: false, motivo: "incorrecta" });
    expect(await verificarCredenciales(db, desactivado.email, CONTRASENA)).toEqual({ ok: false, motivo: "incorrecta" });
  });

  it(`después de ${MAX_INTENTOS} contraseñas mal, se bloquea 15 minutos (aunque después acierte)`, async () => {
    const usuario = await crearUsuario();
    const ahora = new Date();
    for (let i = 1; i < MAX_INTENTOS; i++) {
      expect(await verificarCredenciales(db, usuario.email, `mal ${i}`, ahora)).toEqual({ ok: false, motivo: "incorrecta" });
    }
    expect(await verificarCredenciales(db, usuario.email, "mal otra vez", ahora)).toEqual({
      ok: false,
      motivo: "bloqueada_ahora",
    });
    // bloqueada: ni con la correcta
    const enCinco = new Date(ahora.getTime() + 5 * MINUTO);
    expect(await verificarCredenciales(db, usuario.email, CONTRASENA, enCinco)).toEqual({
      ok: false,
      motivo: "bloqueada",
      minutos: 10,
    });
    // pasado el bloqueo: 1 intento; si falla, otros 15 minutos
    const enVeinte = new Date(ahora.getTime() + 20 * MINUTO);
    expect(await verificarCredenciales(db, usuario.email, "mal", enVeinte)).toMatchObject({ motivo: "bloqueada_ahora" });
    expect(await verificarCredenciales(db, usuario.email, CONTRASENA, enVeinte)).toMatchObject({ motivo: "bloqueada" });
    // si acierta, vuelve todo a cero
    const enUnaHora = new Date(ahora.getTime() + 60 * MINUTO);
    expect(await verificarCredenciales(db, usuario.email, CONTRASENA, enUnaHora)).toMatchObject({ ok: true });
    const despues = await db.usuario.findUniqueOrThrow({ where: { id: usuario.id } });
    expect(despues.intentosFallidos).toBe(0);
    expect(despues.bloqueadoHasta).toBeNull();
  });

  it(`mandando 12 intentos al mismo tiempo, solo ${MAX_INTENTOS} se llegan a probar`, async () => {
    const usuario = await crearUsuario();
    const resultados = await Promise.all(
      Array.from({ length: 12 }, (_, i) => verificarCredenciales(db, usuario.email, `mal ${i}`)),
    );
    const probados = resultados.filter((r) => !r.ok && r.motivo !== "bloqueada");
    expect(probados).toHaveLength(MAX_INTENTOS);
  });

  it("acertar resetea el contador: los errores que cuentan son los seguidos", async () => {
    const usuario = await crearUsuario();
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      for (let i = 1; i < MAX_INTENTOS; i++) await verificarCredenciales(db, usuario.email, "mal");
      expect(await verificarCredenciales(db, usuario.email, CONTRASENA)).toMatchObject({ ok: true });
    }
  });

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

  it("cambiar la contraseña pide la actual y cierra las otras sesiones", async () => {
    const usuario = await crearUsuario({ debeCambiarContrasena: true });
    const esta = await crearSesion(db, usuario.id);
    const otra = await crearSesion(db, usuario.id);
    const sesionId = huellaDeToken(esta);
    const nueva = "otra frase bastante larga";

    const intento = (datos: { actual: string; nueva: string; repetida: string }) =>
      cambiarContrasena(db, { usuarioId: usuario.id, sesionId, ...datos });

    expect(await intento({ actual: CONTRASENA, nueva: "corta", repetida: "corta" })).toMatchObject({ ok: false });
    expect(await intento({ actual: CONTRASENA, nueva, repetida: nueva + "x" })).toMatchObject({ error: /no coinciden/ });
    expect(await intento({ actual: CONTRASENA, nueva: CONTRASENA, repetida: CONTRASENA })).toMatchObject({
      error: /distinta/,
    });
    expect(await intento({ actual: "mal", nueva, repetida: nueva })).toMatchObject({ error: /actual no es correcta/ });

    expect(await intento({ actual: CONTRASENA, nueva, repetida: nueva })).toEqual({ ok: true });
    const despues = await db.usuario.findUniqueOrThrow({ where: { id: usuario.id } });
    expect(despues.debeCambiarContrasena).toBe(false);
    expect(despues.intentosFallidos).toBe(0);
    expect(await validarSesion(db, esta)).not.toBeNull();
    expect(await validarSesion(db, otra)).toBeNull();
    expect(await verificarCredenciales(db, usuario.email, CONTRASENA)).toMatchObject({ ok: false });
    expect(await verificarCredenciales(db, usuario.email, nueva)).toMatchObject({ ok: true });
  });

  it("la contraseña temporal crea el usuario, o lo resetea y le cierra las sesiones", async () => {
    const email = `prueba-${crypto.randomUUID()}@ejemplo.com`;
    emails.push(email);
    const creado = await darContrasenaTemporal(db, { email: email.toUpperCase(), nombre: " Ana ", rol: "VALIDADOR" });
    expect(creado.usuario).toMatchObject({ email, nombre: "Ana", rol: "VALIDADOR", debeCambiarContrasena: true });
    expect(await verificarCredenciales(db, email, creado.temporal)).toMatchObject({
      ok: true,
      usuario: { debeCambiarContrasena: true },
    });

    const token = await crearSesion(db, creado.usuario.id);
    const reseteado = await darContrasenaTemporal(db, { email, nombre: "", rol: "VALIDADOR" });
    expect(reseteado.usuario.id).toBe(creado.usuario.id);
    expect(reseteado.usuario.nombre).toBe("Ana");
    expect(reseteado.temporal).not.toBe(creado.temporal);
    expect(await validarSesion(db, token)).toBeNull();
    expect(await verificarCredenciales(db, email, creado.temporal)).toMatchObject({ ok: false });
  });

  it("la base no acepta emails con mayúsculas ni huellas de sesión inventadas", async () => {
    await expect(
      db.usuario.create({ data: { email: "Ana@Ejemplo.com", nombre: "Ana", hashContrasena: hash } }),
    ).rejects.toThrow();
    const usuario = await crearUsuario();
    await expect(
      db.sesion.create({ data: { id: "no-es-una-huella", usuarioId: usuario.id, expiraEn: new Date(Date.now() + DIA) } }),
    ).rejects.toThrow();
  });
});
