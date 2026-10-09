// Productoras y su gente, contra un PostgreSQL de verdad.
// Solo corre si está TEST_DATABASE_URL (ver README, "Tests con base de datos").
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";

import { hashearContrasena } from "./auth/contrasenas";
import { ingresarConContrasena } from "./auth/cuentas";
import { crearSesion, validarSesion } from "./auth/sesiones";
import { agregarPersona, cambiarActivo, crearProductora, editarProductora, nuevaTemporal } from "./productoras";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("productoras y su gente", { timeout: 60_000 }, () => {
  let db: PrismaClient;
  const productoras: string[] = [];

  beforeAll(() => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });

  afterAll(async () => {
    if (!db) return;
    await db.usuario.deleteMany({ where: { productoraId: { in: productoras } } });
    await db.productora.deleteMany({ where: { id: { in: productoras } } });
    await db.$disconnect();
  });

  const unico = () => crypto.randomUUID().slice(0, 8);

  async function nueva() {
    const email = `org-${unico()}@ejemplo.com`;
    const resultado = await crearProductora(db, { nombre: `Productora ${unico()}`, nombrePersona: "Ana Gómez", email });
    if (!resultado.ok) throw new Error(JSON.stringify(resultado.errores));
    productoras.push(resultado.productoraId);
    return { ...resultado, email };
  }

  it("crea la productora con su organizador, que entra con la temporal y ve su productora", async () => {
    const { productoraId, cuenta, email } = await nueva();
    expect(cuenta.email).toBe(email);
    const ingreso = await ingresarConContrasena(db, email, cuenta.temporal);
    expect(ingreso).toMatchObject({
      ok: true,
      usuario: { rol: "ORGANIZADOR", debeCambiarContrasena: true, productora: { id: productoraId } },
    });
  });

  it("no repite nombres de productora ni emails, y valida los datos", async () => {
    const { email } = await nueva();
    const nombre = (await db.productora.findFirstOrThrow({ where: { id: productoras.at(-1) } })).nombre;
    expect(await crearProductora(db, { nombre, nombrePersona: "Otra Persona", email: `x-${unico()}@ejemplo.com` })).toEqual({
      ok: false,
      errores: { nombre: "Ya hay una productora con ese nombre." },
    });
    expect(await crearProductora(db, { nombre: `Nueva ${unico()}`, nombrePersona: "Otra Persona", email })).toEqual({
      ok: false,
      errores: { email: "Ese email ya tiene una cuenta." },
    });
    expect(await crearProductora(db, { nombre: "x", nombrePersona: "", email: "no-es-email" })).toMatchObject({
      ok: false,
      errores: { nombre: expect.any(String), nombrePersona: expect.any(String), email: expect.any(String) },
    });
  });

  it("sumar una persona nunca pisa una cuenta que ya existe (de esta u otra productora)", async () => {
    const una = await nueva();
    const otra = await nueva();
    const antes = await db.usuario.findUniqueOrThrow({ where: { email: una.email } });
    expect(await agregarPersona(db, otra.productoraId, { nombrePersona: "Intruso", email: una.email })).toEqual({
      ok: false,
      errores: { email: "Ese email ya tiene una cuenta." },
    });
    const despues = await db.usuario.findUniqueOrThrow({ where: { email: una.email } });
    expect(despues).toEqual(antes);

    const validador = await agregarPersona(db, otra.productoraId, {
      nombrePersona: "Pedro Puerta",
      email: `puerta-${unico()}@ejemplo.com`,
      rol: "VALIDADOR",
    });
    if (!validador.ok) throw new Error(JSON.stringify(validador.errores));
    expect(await ingresarConContrasena(db, validador.cuenta.email, validador.cuenta.temporal)).toMatchObject({
      ok: true,
      usuario: { rol: "VALIDADOR", productora: { id: otra.productoraId } },
    });
  });

  it("contraseña nueva y desactivar: solo con gente de esa productora", async () => {
    const una = await nueva();
    const otra = await nueva();
    const persona = await db.usuario.findUniqueOrThrow({ where: { email: una.email } });

    // desde otra productora, no se puede tocar
    expect(await nuevaTemporal(db, otra.productoraId, persona.id)).toMatchObject({ ok: false });
    expect(await cambiarActivo(db, otra.productoraId, persona.id, false)).toMatchObject({ ok: false });
    expect(await ingresarConContrasena(db, una.email, una.cuenta.temporal)).toMatchObject({ ok: true });

    // desde la suya, sí: la temporal vieja deja de servir y se cierran las sesiones
    const token = await crearSesion(db, persona.id);
    const nuevaCuenta = await nuevaTemporal(db, una.productoraId, persona.id);
    if (!nuevaCuenta.ok) throw new Error(nuevaCuenta.error);
    expect(await validarSesion(db, token)).toBeNull();
    expect(await ingresarConContrasena(db, una.email, una.cuenta.temporal)).toMatchObject({ ok: false });
    expect(await ingresarConContrasena(db, una.email, nuevaCuenta.cuenta.temporal)).toMatchObject({ ok: true });

    const otroToken = await crearSesion(db, persona.id);
    expect(await cambiarActivo(db, una.productoraId, persona.id, false)).toEqual({ ok: true });
    expect(await validarSesion(db, otroToken)).toBeNull();
    expect(await ingresarConContrasena(db, una.email, nuevaCuenta.cuenta.temporal)).toMatchObject({ ok: false });
  });

  it("desactivar la productora deja afuera a toda su gente; reactivarla los deja volver", async () => {
    const una = await nueva();
    const persona = await db.usuario.findUniqueOrThrow({ where: { email: una.email } });
    const token = await crearSesion(db, persona.id);
    const nombre = (await db.productora.findUniqueOrThrow({ where: { id: una.productoraId } })).nombre;

    expect(await editarProductora(db, una.productoraId, { nombre, activa: false })).toEqual({ ok: true });
    expect(await validarSesion(db, token)).toBeNull();
    expect(await ingresarConContrasena(db, una.email, una.cuenta.temporal)).toEqual({ ok: false, motivo: "incorrecta" });

    expect(await editarProductora(db, una.productoraId, { nombre, activa: true })).toEqual({ ok: true });
    expect(await ingresarConContrasena(db, una.email, una.cuenta.temporal)).toMatchObject({ ok: true });
  });

  it("mail de contacto: se guarda en minúsculas, vacío lo borra y sin el campo no se toca", async () => {
    const una = await nueva();
    const nombre = (await db.productora.findUniqueOrThrow({ where: { id: una.productoraId } })).nombre;
    const contacto = async () => (await db.productora.findUniqueOrThrow({ where: { id: una.productoraId } })).emailContacto;

    expect(await editarProductora(db, una.productoraId, { nombre, activa: true, emailContacto: " Hola@Productora.com " })).toEqual({
      ok: true,
    });
    expect(await contacto()).toBe("hola@productora.com");
    expect(await editarProductora(db, una.productoraId, { nombre, activa: true })).toEqual({ ok: true });
    expect(await contacto()).toBe("hola@productora.com");
    expect(await editarProductora(db, una.productoraId, { nombre, activa: true, emailContacto: "no es un mail" })).toEqual({
      ok: false,
      errores: { emailContacto: "Poné un email válido (o dejalo vacío)." },
    });
    expect(await editarProductora(db, una.productoraId, { nombre, activa: true, emailContacto: "" })).toEqual({ ok: true });
    expect(await contacto()).toBeNull();
  });

  it("al desactivar la productora se cierran sus sesiones: reactivarla no las revive", async () => {
    const una = await nueva();
    const persona = await db.usuario.findUniqueOrThrow({ where: { email: una.email } });
    const token = await crearSesion(db, persona.id);
    const nombre = (await db.productora.findUniqueOrThrow({ where: { id: una.productoraId } })).nombre;
    await editarProductora(db, una.productoraId, { nombre, activa: false });
    await editarProductora(db, una.productoraId, { nombre, activa: true }); // sin usar la sesión en el medio
    expect(await validarSesion(db, token)).toBeNull();
  });

  it("avisa si la contraseña temporal no va a servir (persona o productora desactivada)", async () => {
    const una = await nueva();
    const persona = await db.usuario.findUniqueOrThrow({ where: { email: una.email } });
    expect(una.cuenta.sirve).toBe(true);

    await cambiarActivo(db, una.productoraId, persona.id, false);
    expect(await nuevaTemporal(db, una.productoraId, persona.id)).toMatchObject({ ok: true, cuenta: { sirve: false } });
    await cambiarActivo(db, una.productoraId, persona.id, true);
    expect(await nuevaTemporal(db, una.productoraId, persona.id)).toMatchObject({ ok: true, cuenta: { sirve: true } });

    const nombre = (await db.productora.findUniqueOrThrow({ where: { id: una.productoraId } })).nombre;
    await editarProductora(db, una.productoraId, { nombre, activa: false });
    expect(
      await agregarPersona(db, una.productoraId, { nombrePersona: "Pedro Puerta", email: `p-${unico()}@ejemplo.com` }),
    ).toMatchObject({ ok: true, cuenta: { sirve: false } });
  });

  it("la base exige productora para organizadores y validadores, y ninguna para el dueño", async () => {
    const hash = await hashearContrasena("una frase cualquiera");
    const { productoraId } = await nueva();
    await expect(
      db.usuario.create({ data: { email: `v-${unico()}@ejemplo.com`, nombre: "Sin productora", hashContrasena: hash, rol: "VALIDADOR" } }),
    ).rejects.toThrow(/usuarios_productora_segun_rol/);
    await expect(
      db.usuario.create({
        data: { email: `a-${unico()}@ejemplo.com`, nombre: "Dueño con productora", hashContrasena: hash, rol: "ADMIN", productoraId },
      }),
    ).rejects.toThrow(/usuarios_productora_segun_rol/);
  });
});
