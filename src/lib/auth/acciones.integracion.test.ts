// Las acciones de los formularios (ingresar, salir, cambiar contraseña) y el
// control de permisos de las páginas, contra la base de prueba. Lo que da
// Next.js en el servidor (cookies, redirect) se simula en memoria.
// Solo corre si está TEST_DATABASE_URL (ver README, "Tests con base de datos").
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";

const simulado = vi.hoisted(() => {
  class Redireccion extends Error {
    constructor(public destino: string) {
      super(`redirect(${destino})`);
    }
  }
  return {
    Redireccion,
    cookies: new Map<string, { value: string; opciones?: Record<string, unknown> }>(),
    db: undefined as unknown,
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (nombre: string) => {
      const cookie = simulado.cookies.get(nombre);
      return cookie && { name: nombre, value: cookie.value };
    },
    set: (nombre: string, value: string, opciones?: Record<string, unknown>) => {
      simulado.cookies.set(nombre, { value, opciones });
    },
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new simulado.Redireccion(destino);
  },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof simulado.Redireccion) throw error;
  },
}));
vi.mock("@/lib/db", () => ({ obtenerDb: () => simulado.db }));

const { cambiarMiContrasena, ingresar, salir } = await import("./acciones");
const { requerirUsuario } = await import("./actual");
const { hashearContrasena } = await import("./contrasenas");
const { crearSesion, huellaDeToken, validarSesion } = await import("./sesiones");

const url = process.env.TEST_DATABASE_URL;
const CONTRASENA = "mate amargo en la costanera";
const NUEVA = "otra frase bastante larga";

// Corre `accion` y devuelve adónde redirigió (falla si no redirigió).
async function destinoDe(accion: Promise<unknown>) {
  try {
    await accion;
  } catch (error) {
    if (error instanceof simulado.Redireccion) return error.destino;
    throw error;
  }
  throw new Error("no redirigió");
}

function formulario(campos: Record<string, string>) {
  const datos = new FormData();
  for (const [clave, valor] of Object.entries(campos)) datos.set(clave, valor);
  return datos;
}

describe.skipIf(!url)("acciones de ingreso y permisos", { timeout: 60_000 }, () => {
  let db: PrismaClient;
  let hash: string;
  let productoraId: string;
  const emails: string[] = [];

  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    simulado.db = db;
    hash = await hashearContrasena(CONTRASENA);
    productoraId = (await db.productora.create({ data: { nombre: `Productora ${crypto.randomUUID()}` } })).id;
  });

  afterAll(async () => {
    if (!db) return;
    await db.usuario.deleteMany({ where: { email: { in: emails } } });
    await db.productora.deleteMany({ where: { id: productoraId } });
    await db.$disconnect();
  });

  beforeEach(() => simulado.cookies.clear());

  // El ADMIN no tiene productora; organizadores y validadores, la del test.
  async function crearUsuario(
    datos: { rol?: "ADMIN" | "ORGANIZADOR" | "VALIDADOR"; activo?: boolean; debeCambiarContrasena?: boolean } = {},
  ) {
    const email = `prueba-${crypto.randomUUID()}@ejemplo.com`;
    emails.push(email);
    const rol = datos.rol ?? "ADMIN";
    return db.usuario.create({
      data: {
        email,
        nombre: "Persona de Prueba",
        hashContrasena: hash,
        ...datos,
        rol,
        productoraId: rol === "ADMIN" ? null : productoraId,
      },
    });
  }

  async function conSesion(usuarioId: string) {
    const token = await crearSesion(db, usuarioId);
    simulado.cookies.set("sesion", { value: token });
    return token;
  }

  // ─── Permisos de las páginas ─────────────────────────────────────────────

  it("sin sesión, las páginas del panel mandan a ingresar", async () => {
    expect(await destinoDe(requerirUsuario(["ADMIN"]))).toBe("/ingresar");
    simulado.cookies.set("sesion", { value: "cualquier-cosa" });
    expect(await destinoDe(requerirUsuario(["ADMIN", "VALIDADOR"]))).toBe("/ingresar");
  });

  it("un validador no entra al panel: va a la puerta", async () => {
    const validador = await crearUsuario({ rol: "VALIDADOR" });
    await conSesion(validador.id);
    expect(await destinoDe(requerirUsuario(["ADMIN"]))).toBe("/validar");
    expect(await requerirUsuario(["ADMIN", "VALIDADOR"])).toMatchObject({ id: validador.id });
  });

  it("el admin entra a las dos partes", async () => {
    const admin = await crearUsuario();
    await conSesion(admin.id);
    expect(await requerirUsuario(["ADMIN"])).toMatchObject({ id: admin.id, rol: "ADMIN" });
    expect(await requerirUsuario(["ADMIN", "VALIDADOR"])).toMatchObject({ id: admin.id });
  });

  it("un organizador entra al panel y a la puerta, con su productora", async () => {
    const organizador = await crearUsuario({ rol: "ORGANIZADOR" });
    await conSesion(organizador.id);
    expect(await requerirUsuario(["ADMIN", "ORGANIZADOR"])).toMatchObject({
      id: organizador.id,
      rol: "ORGANIZADOR",
      productora: { id: productoraId },
    });
    expect(await requerirUsuario(["ADMIN", "ORGANIZADOR", "VALIDADOR"])).toMatchObject({ id: organizador.id });
    // lo que es solo del dueño (Productoras), no: va a su inicio
    expect(await destinoDe(requerirUsuario(["ADMIN"]))).toBe("/admin");
  });

  it("si se desactiva la productora, su gente queda afuera (y no puede volver a entrar)", async () => {
    const otra = await db.productora.create({ data: { nombre: `Otra ${crypto.randomUUID()}` } });
    const email = `prueba-${crypto.randomUUID()}@ejemplo.com`;
    emails.push(email);
    const organizador = await db.usuario.create({
      data: { email, nombre: "Persona de Prueba", hashContrasena: hash, rol: "ORGANIZADOR", productoraId: otra.id },
    });
    try {
      await conSesion(organizador.id);
      await db.productora.update({ where: { id: otra.id }, data: { activa: false } });
      expect(await destinoDe(requerirUsuario(["ADMIN", "ORGANIZADOR"]))).toBe("/ingresar");

      simulado.cookies.clear();
      const intento = await ingresar({}, formulario({ email, contrasena: CONTRASENA }));
      expect(intento.error).toMatch(/^Email o contraseña incorrectos/);
      expect(simulado.cookies.has("sesion")).toBe(false);
    } finally {
      await db.usuario.delete({ where: { id: organizador.id } });
      await db.productora.delete({ where: { id: otra.id } });
    }
  });

  it("con contraseña temporal, primero tiene que cambiarla", async () => {
    const admin = await crearUsuario({ debeCambiarContrasena: true });
    await conSesion(admin.id);
    expect(await destinoDe(requerirUsuario(["ADMIN"]))).toBe("/cuenta/contrasena");
  });

  it("un usuario desactivado queda afuera aunque tenga la sesión abierta", async () => {
    const admin = await crearUsuario();
    await conSesion(admin.id);
    await db.usuario.update({ where: { id: admin.id }, data: { activo: false } });
    expect(await destinoDe(requerirUsuario(["ADMIN"]))).toBe("/ingresar");
  });

  // ─── Ingresar y salir ────────────────────────────────────────────────────

  it("ingresar con la contraseña correcta guarda la cookie segura y lleva a su inicio", async () => {
    const admin = await crearUsuario();
    const vieja = await conSesion(admin.id); // otra sesión abierta en este navegador

    const destino = await destinoDe(ingresar({}, formulario({ email: admin.email.toUpperCase(), contrasena: CONTRASENA })));
    expect(destino).toBe("/admin");
    const cookie = simulado.cookies.get("sesion");
    expect(cookie?.opciones).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 30 * 24 * 60 * 60 });
    expect(cookie?.value).not.toBe(vieja);
    expect((await validarSesion(db, cookie!.value))?.usuario.id).toBe(admin.id);
    expect(await validarSesion(db, vieja)).toBeNull(); // la anterior de este navegador se cerró
  });

  it("ingresar con la temporal lleva a elegir contraseña; un validador va a la puerta", async () => {
    const conTemporal = await crearUsuario({ debeCambiarContrasena: true });
    expect(await destinoDe(ingresar({}, formulario({ email: conTemporal.email, contrasena: CONTRASENA })))).toBe(
      "/cuenta/contrasena",
    );
    const validador = await crearUsuario({ rol: "VALIDADOR" });
    expect(await destinoDe(ingresar({}, formulario({ email: validador.email, contrasena: CONTRASENA })))).toBe("/validar");
  });

  it("con email inexistente, contraseña mal o cuenta bloqueada, el mensaje es el mismo", async () => {
    const admin = await crearUsuario();
    const inexistente = await ingresar({}, formulario({ email: "nadie@ejemplo.com", contrasena: "algo" }));
    const mal = await ingresar({}, formulario({ email: admin.email, contrasena: "algo" }));
    await db.usuario.update({ where: { id: admin.id }, data: { bloqueadoHasta: new Date(Date.now() + 10 * 60 * 1000) } });
    const bloqueada = await ingresar({}, formulario({ email: admin.email, contrasena: CONTRASENA }));

    expect(inexistente.error).toMatch(/^Email o contraseña incorrectos/);
    expect(mal).toEqual({ error: inexistente.error, email: admin.email });
    expect(bloqueada).toEqual({ error: inexistente.error, email: admin.email });
    expect(simulado.cookies.has("sesion")).toBe(false);
    expect(await ingresar({}, formulario({ email: "", contrasena: "" }))).toMatchObject({ error: /Completá/ });
  });

  it("salir cierra la sesión en la base y borra la cookie", async () => {
    const admin = await crearUsuario();
    const token = await conSesion(admin.id);
    expect(await destinoDe(salir())).toBe("/ingresar");
    expect(await db.sesion.findUnique({ where: { id: huellaDeToken(token) } })).toBeNull();
    expect(simulado.cookies.get("sesion")).toMatchObject({ value: "", opciones: { maxAge: 0, path: "/" } });
  });

  // ─── Cambiar la contraseña ───────────────────────────────────────────────

  it("cambiar la contraseña sin sesión manda a ingresar", async () => {
    const datos = formulario({ actual: CONTRASENA, nueva: NUEVA, repetida: NUEVA });
    expect(await destinoDe(cambiarMiContrasena({}, datos))).toBe("/ingresar");
  });

  it("cambia la del que tiene la sesión (no la de otro), y le da una cookie nueva", async () => {
    const validador = await crearUsuario({ rol: "VALIDADOR", debeCambiarContrasena: true });
    const otro = await crearUsuario();
    const vieja = await conSesion(validador.id);

    const error = await cambiarMiContrasena({}, formulario({ actual: "mal", nueva: NUEVA, repetida: NUEVA }));
    expect(error).toEqual({ error: "La contraseña temporal no es correcta." });
    expect(simulado.cookies.get("sesion")?.value).toBe(vieja);

    const datos = formulario({ actual: CONTRASENA, nueva: NUEVA, repetida: NUEVA, usuarioId: otro.id });
    expect(await destinoDe(cambiarMiContrasena({}, datos))).toBe("/validar?contrasena=cambiada");
    const nueva = simulado.cookies.get("sesion")!.value;
    expect(nueva).not.toBe(vieja);
    expect(await validarSesion(db, vieja)).toBeNull();
    expect((await validarSesion(db, nueva))?.usuario).toMatchObject({ id: validador.id, debeCambiarContrasena: false });

    const otroDespues = await db.usuario.findUniqueOrThrow({ where: { id: otro.id } });
    expect(otroDespues.hashContrasena).toBe(hash); // al otro no se le tocó nada
  });
});
