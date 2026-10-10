// La puerta sin el QR: buscar por DNI o nombre, y el contador de ingresados.
// Contra un PostgreSQL de verdad. Solo corre si está TEST_DATABASE_URL.
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { EstadoEntrada, EstadoOrden } from "@/generated/prisma/client";
import { PrismaClient } from "@/generated/prisma/client";
import type { Alcance } from "@/lib/auth/alcance";

import { buscarEnLaPuerta, contarIngresos, MAXIMO_RESULTADOS } from "./buscar";
import { nuevoCodigo } from "./codigo";
import { marcarEntrada } from "./escanear";

const url = process.env.TEST_DATABASE_URL;

// Un apellido que no se repite entre tests (solo letras, como los nombres de verdad).
const unico = () =>
  "Q" + Array.from(crypto.getRandomValues(new Uint8Array(9)), (n) => String.fromCharCode(97 + (n % 26))).join("");
const unDni = () => String(10_000_000 + Math.floor(Math.random() * 89_999_999));

describe.skipIf(!url)("buscar en la puerta por DNI o nombre, y contar ingresos", () => {
  let db: PrismaClient;
  let productoraId: string;
  let eventoId: string;
  let otroEventoId: string;
  let validador: { id: string; nombre: string };
  const TODO: Alcance = { todo: true };
  const AHORA = new Date("2030-01-02T00:41:00-03:00");

  async function crearEvento() {
    const evento = await db.evento.create({
      data: {
        productoraId,
        slug: `buscar-${crypto.randomUUID()}`,
        nombre: "Evento",
        fecha: new Date("2030-01-01T23:00:00-03:00"),
        lugar: "Lugar de prueba",
        estado: "PUBLICADO",
        tipos: { create: { nombre: "General" } },
      },
      include: { tipos: true },
    });
    return { id: evento.id, tipoId: evento.tipos[0].id };
  }
  const tipos = new Map<string, string>();

  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    productoraId = (await db.productora.create({ data: { nombre: `Productora ${crypto.randomUUID()}` } })).id;
    for (const evento of [await crearEvento(), await crearEvento()]) tipos.set(evento.id, evento.tipoId);
    [eventoId, otroEventoId] = [...tipos.keys()];
    validador = await db.usuario.create({
      data: { nombre: "Ana Puerta", email: `${crypto.randomUUID()}@ejemplo.com`, hashContrasena: "x", rol: "VALIDADOR", productoraId },
      select: { id: true, nombre: true },
    });
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  // Una entrada de una compra, en el estado pedido.
  async function entrada(
    titular: string,
    dni: string,
    opciones: { orden?: EstadoOrden; estado?: EstadoEntrada; evento?: string } = {},
  ) {
    const enEvento = opciones.evento ?? eventoId;
    const orden = await db.orden.create({
      data: {
        eventoId: enEvento,
        estado: opciones.orden ?? "PAGADA",
        email: ["PENDIENTE", "VENCIDA", "CANCELADA"].includes(opciones.orden ?? "PAGADA") ? null : "comprador@ejemplo.com",
        totalCentavos: 1000,
      },
      select: { id: true, numero: true },
    });
    const creada = await db.entrada.create({
      data: {
        ordenId: orden.id,
        eventoId: enEvento,
        tipoEntradaId: tipos.get(enEvento)!,
        codigo: nuevoCodigo(),
        precioCentavos: 1000,
        estado: opciones.estado ?? "VALIDA",
        titular,
        dni,
      },
      select: { id: true },
    });
    return { id: creada.id, compra: orden.numero };
  }

  const buscar = (texto: unknown, opciones: { alcance?: Alcance; evento?: string } = {}) =>
    buscarEnLaPuerta(db, { eventoId: opciones.evento ?? eventoId, alcance: opciones.alcance ?? TODO, texto });
  const ids = async (texto: unknown) => {
    const buscado = await buscar(texto);
    return buscado?.resultado === "ok" ? buscado.entradas.map((e) => e.id) : buscado;
  };

  it("DNI completo (con o sin puntos): sus entradas pagas de este evento, con sus datos", async () => {
    const dni = unDni();
    const apellido = unico();
    const una = await entrada(`Juan ${apellido}`, dni);
    const otra = await entrada(`Juan ${apellido}`, dni);
    expect(await buscar(dni)).toEqual({
      resultado: "ok",
      hayMas: false,
      entradas: [
        { id: una.id, titular: `Juan ${apellido}`, dni, tipo: "General", compra: una.compra, ingreso: null },
        { id: otra.id, titular: `Juan ${apellido}`, dni, tipo: "General", compra: otra.compra, ingreso: null },
      ],
    });
    const conPuntos = `${dni.slice(0, 2)}.${dni.slice(2, 5)}.${dni.slice(5)}`;
    expect(await ids(` ${conPuntos} `)).toEqual([una.id, otra.id]);
  });

  it("no aparecen las reservas sin pagar, las anuladas, las de compras devueltas ni las de otro evento", async () => {
    const dni = unDni();
    const paga = await entrada(`Ana ${unico()}`, dni);
    await entrada(`Ana ${unico()}`, dni, { orden: "PENDIENTE", estado: "PENDIENTE" });
    await entrada(`Ana ${unico()}`, dni, { orden: "VENCIDA", estado: "ANULADA" });
    await entrada(`Ana ${unico()}`, dni, { orden: "PAGADA", estado: "ANULADA" });
    await entrada(`Ana ${unico()}`, dni, { orden: "REEMBOLSADA", estado: "VALIDA" });
    await entrada(`Ana ${unico()}`, dni, { evento: otroEventoId });
    expect(await ids(dni)).toEqual([paga.id]);
  });

  it("parte del DNI: no busca (para no ir listando a la gente)", async () => {
    const dni = unDni();
    await entrada(`Ana ${unico()}`, dni);
    expect(await buscar(dni.slice(0, 4))).toEqual({ resultado: "falta", motivo: "dni" });
    expect(await buscar(`${dni.slice(0, 4)} ana`)).toEqual({ resultado: "falta", motivo: "dni" });
    expect(await buscar("00000000")).toEqual({ resultado: "falta", motivo: "dni" });
  });

  it("nombre: cada palabra en cualquier parte, sin importar tildes, mayúsculas ni apóstrofos", async () => {
    const apellido = unico();
    const maria = await entrada(`María José Gómez ${apellido}`, unDni());
    const alvarez = await entrada(`ÁLVAREZ ÑOÑO ${apellido}`, unDni());
    const luca = await entrada(`Luca D’Alessandro ${apellido}`, unDni());
    const a = apellido.toLowerCase();
    expect(await ids(`gomez maria ${a}`)).toEqual([maria.id]);
    expect(await ids(`GÓMEZ ${apellido}`)).toEqual([maria.id]);
    expect(await ids(`jose ${a}`)).toEqual([maria.id]);
    expect(await ids(`gomez pedro ${a}`)).toEqual([]);
    expect(await ids(`alvarez nono ${a}`)).toEqual([alvarez.id]);
    expect(await ids(`Álvarez ${a}`)).toEqual([alvarez.id]);
    expect(await ids(`dalessandro ${a}`)).toEqual([luca.id]);
    expect(await ids(`D'Alessandro ${a}`)).toEqual([luca.id]);
    expect(await ids(a)).toEqual([alvarez.id, luca.id, maria.id]); // por nombre, sin mirar tildes
  });

  it("menos de 3 letras: no busca", async () => {
    expect(await buscar("Al")).toEqual({ resultado: "falta", motivo: "corto" });
    expect(await buscar("  a . b ")).toEqual({ resultado: "falta", motivo: "corto" });
    expect(await buscar("%%%")).toEqual({ resultado: "falta", motivo: "corto" });
    expect(await buscar(undefined)).toEqual({ resultado: "falta", motivo: "corto" });
  });

  it("hasta 10 resultados, y avisa que hay más", async () => {
    const apellido = unico();
    for (let i = 0; i < MAXIMO_RESULTADOS; i++) await entrada(`Persona ${apellido}`, unDni());
    expect(await buscar(apellido)).toMatchObject({ hayMas: false });
    await entrada(`Persona ${apellido}`, unDni());
    const buscado = await buscar(apellido);
    expect(buscado).toMatchObject({ resultado: "ok", hayMas: true });
    expect(buscado?.resultado === "ok" && buscado.entradas).toHaveLength(MAXIMO_RESULTADOS);
  });

  it("ya entró: cuándo, quién la marcó y si fue por DNI", async () => {
    const dni = unDni();
    const { id } = await entrada(`Ana ${unico()}`, dni);
    await marcarEntrada(db, { eventoId, alcance: TODO, usuarioId: validador.id, entradaId: id, ahora: AHORA });
    expect(await buscar(dni)).toMatchObject({
      entradas: [{ id, ingreso: { usadaEn: AHORA, validadaPor: validador, metodo: "DNI" } }],
    });
  });

  it("evento de otra productora: null; de su productora, busca", async () => {
    const dni = unDni();
    await entrada(`Ana ${unico()}`, dni);
    const ajena = (await db.productora.create({ data: { nombre: `Ajena ${crypto.randomUUID()}` } })).id;
    expect(await buscar(dni, { alcance: { todo: false, productoraId: ajena } })).toBeNull();
    expect(await buscar(dni, { alcance: { todo: false, productoraId } })).toMatchObject({ resultado: "ok" });
  });

  it("contador: ingresaron (usadas) de las que pueden entrar (válidas y usadas) de este evento", async () => {
    const evento = await crearEvento();
    tipos.set(evento.id, evento.tipoId);
    const contar = (alcance: Alcance = TODO) => contarIngresos(db, { eventoId: evento.id, alcance });
    expect(await contar()).toEqual({ ingresaron: 0, total: 0 });
    const usada = await entrada(`Ana ${unico()}`, unDni(), { evento: evento.id });
    await entrada(`Ana ${unico()}`, unDni(), { evento: evento.id });
    await entrada(`Ana ${unico()}`, unDni(), { evento: evento.id, orden: "PENDIENTE", estado: "PENDIENTE" });
    await entrada(`Ana ${unico()}`, unDni(), { evento: evento.id, estado: "ANULADA" });
    await entrada(`Ana ${unico()}`, unDni(), { evento: otroEventoId });
    expect(await contar()).toEqual({ ingresaron: 0, total: 2 });
    await marcarEntrada(db, { eventoId: evento.id, alcance: TODO, usuarioId: validador.id, entradaId: usada.id });
    expect(await contar()).toEqual({ ingresaron: 1, total: 2 });

    const ajena = (await db.productora.create({ data: { nombre: `Ajena ${crypto.randomUUID()}` } })).id;
    expect(await contar({ todo: false, productoraId: ajena })).toBeNull();
  });
});
