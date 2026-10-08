// La reserva de 15 minutos contra un PostgreSQL de verdad: crear la orden con
// sus entradas, los límites de reservas abiertas, el vencimiento, guardar los
// datos y cancelar. Solo corre si está TEST_DATABASE_URL (ver README).
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";

import {
  buscarCompra,
  cancelarReserva,
  crearReserva,
  guardarDatosCompra,
  liberarVencidas,
  MAX_ABIERTAS_POR_CONEXION,
  MAX_ABIERTAS_POR_NAVEGADOR,
  MINUTOS_RESERVA,
} from "./ordenes";
import { pedidoATexto } from "./pedido";
import { tomarTurnoDelEvento } from "./turno";

const url = process.env.TEST_DATABASE_URL;
const MINUTO = 60_000;

describe.skipIf(!url)("reserva de 15 minutos", { timeout: 120_000 }, () => {
  let db: PrismaClient;
  let productoraId: string;
  const unico = crypto.randomUUID().slice(0, 8);
  // Un evento principal (General con 2 lotes de 5) y otros chicos para los límites.
  let evento: { id: string; general: string; lotes: string[] };
  const otros: { id: string; general: string }[] = [];
  let n = 0;
  const navegador = () => `navegador-${unico}-${n++}`;

  async function crearEvento(cupos: number[]) {
    const creado = await db.evento.create({
      data: {
        productoraId,
        slug: `orden-${unico}-${n++}`,
        nombre: "Fiesta",
        fecha: new Date("2030-03-07T23:00:00-03:00"),
        lugar: "Club",
        estado: "PUBLICADO",
        tipos: {
          create: {
            nombre: "General",
            lotes: {
              create: cupos.map((cupo, i) => ({ numero: i + 1, nombre: `Lote ${i + 1}`, precioCentavos: (6000 + i * 2000) * 100, cupo })),
            },
          },
        },
      },
      include: { tipos: { include: { lotes: { orderBy: { numero: "asc" } } } } },
    });
    return { id: creado.id, general: creado.tipos[0].id, lotes: creado.tipos[0].lotes.map((lote) => lote.id) };
  }

  const pedir = (tipoId: string, cantidad: number) => pedidoATexto([{ tipoId, cantidad }]);
  async function lotes() {
    return db.lote.findMany({
      where: { id: { in: evento.lotes } },
      orderBy: { numero: "asc" },
      select: { vendidas: true, reservadas: true },
    });
  }

  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 20 }) });
    productoraId = (await db.productora.create({ data: { nombre: `Productora órdenes ${unico}` } })).id;
    evento = await crearEvento([5, 5]);
    for (let i = 0; i < MAX_ABIERTAS_POR_NAVEGADOR + 1; i++) otros.push(await crearEvento([50]));
  });

  beforeEach(async () => {
    const eventos = [evento.id, ...otros.map((otro) => otro.id)];
    await db.entrada.deleteMany({ where: { eventoId: { in: eventos } } });
    await db.orden.deleteMany({ where: { eventoId: { in: eventos } } });
    await db.lote.updateMany({ where: { tipoEntrada: { eventoId: { in: eventos } } }, data: { vendidas: 0, reservadas: 0 } });
  });

  afterAll(async () => {
    if (!db) return;
    const eventos = await db.evento.findMany({ where: { productoraId }, select: { id: true } });
    const ids = eventos.map((e) => e.id);
    await db.entrada.deleteMany({ where: { eventoId: { in: ids } } });
    await db.orden.deleteMany({ where: { eventoId: { in: ids } } });
    await db.evento.deleteMany({ where: { productoraId } });
    await db.productora.deleteMany({ where: { id: productoraId } });
    await db.$disconnect();
  });

  it("crea la orden pendiente con una entrada por persona y aparta los lugares", async () => {
    const ahora = new Date();
    const resultado = await crearReserva(db, evento.id, pedir(evento.general, 6), { navegador: navegador(), ip: "1.1.1.1" }, ahora);
    if (!resultado.ok) throw new Error(resultado.error);
    expect(resultado.llave).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const orden = await db.orden.findUniqueOrThrow({ where: { id: resultado.ordenId } });
    expect(orden).toMatchObject({ estado: "PENDIENTE", tipo: "VENTA", totalCentavos: 5 * 600000 + 800000 });
    expect(orden.venceEn!.getTime() - ahora.getTime()).toBe(MINUTOS_RESERVA * MINUTO);
    // la llave no se guarda: solo su huella
    expect(JSON.stringify(orden)).not.toContain(resultado.llave);
    expect(await lotes()).toEqual([
      { vendidas: 0, reservadas: 5 },
      { vendidas: 0, reservadas: 1 },
    ]);

    const compra = await buscarCompra(db, resultado.llave, ahora);
    expect(compra).toMatchObject({ estado: "PENDIENTE", vencida: false, evento: { id: evento.id } });
    expect(compra!.entradas.map((e) => `${e.lote} ${e.precioCentavos}`)).toEqual([
      ...Array(5).fill("Lote 1 600000"),
      "Lote 2 800000",
    ]);
    expect(await buscarCompra(db, "x".repeat(43))).toBeNull();
    expect(await buscarCompra(db, "no-es-una-llave")).toBeNull();
  });

  it("el mismo navegador vuelve a elegir: la reserva anterior se cancela y sus lugares vuelven", async () => {
    const yo = navegador();
    const primera = await crearReserva(db, evento.id, pedir(evento.general, 4), { navegador: yo, ip: "1.1.1.1" });
    const segunda = await crearReserva(db, evento.id, pedir(evento.general, 2), { navegador: yo, ip: "1.1.1.1" });
    if (!primera.ok || !segunda.ok) throw new Error("no reservó");
    expect(await db.orden.findUniqueOrThrow({ where: { id: primera.ordenId } })).toMatchObject({ estado: "CANCELADA" });
    expect(await db.entrada.count({ where: { ordenId: primera.ordenId, estado: "ANULADA" } })).toBe(4);
    expect(await lotes()).toEqual([
      { vendidas: 0, reservadas: 2 },
      { vendidas: 0, reservadas: 0 },
    ]);
  });

  it("si la reserva nueva no entra, la anterior sigue en pie", async () => {
    const yo = navegador();
    const primera = await crearReserva(db, evento.id, pedir(evento.general, 4), { navegador: yo, ip: "1.1.1.1" });
    await crearReserva(db, evento.id, pedir(evento.general, 6), { navegador: navegador(), ip: "2.2.2.2" }); // quedan 0
    // al cancelar la suya quedarían 4: pide 5 y no entra
    expect(await crearReserva(db, evento.id, pedir(evento.general, 5), { navegador: yo, ip: "1.1.1.1" })).toEqual({
      ok: false,
      error: 'No quedan 5 entradas "General". Probá con menos.',
    });
    if (!primera.ok) throw new Error(primera.error);
    expect(await db.orden.findUniqueOrThrow({ where: { id: primera.ordenId } })).toMatchObject({ estado: "PENDIENTE" });
    expect((await lotes()).reduce((suma, lote) => suma + lote.reservadas, 0)).toBe(10);
  });

  it(`hasta ${MAX_ABIERTAS_POR_NAVEGADOR} reservas abiertas por navegador (en distintos eventos)`, async () => {
    const yo = navegador();
    for (const otro of otros.slice(0, MAX_ABIERTAS_POR_NAVEGADOR)) {
      expect(await crearReserva(db, otro.id, pedir(otro.general, 1), { navegador: yo, ip: "3.3.3.3" })).toMatchObject({ ok: true });
    }
    const otro = otros[MAX_ABIERTAS_POR_NAVEGADOR];
    expect(await crearReserva(db, otro.id, pedir(otro.general, 1), { navegador: yo, ip: "3.3.3.3" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("Ya tenés 3 reservas abiertas"),
    });
    // otro navegador, misma conexión: sí puede
    expect(await crearReserva(db, otro.id, pedir(otro.general, 1), { navegador: navegador(), ip: "3.3.3.3" })).toMatchObject({ ok: true });
    // y cuando vencen, dejan de contar
    const pasadaLaReserva = new Date(Date.now() + (MINUTOS_RESERVA + 1) * MINUTO);
    expect(await crearReserva(db, otro.id, pedir(otro.general, 1), { navegador: yo, ip: "3.3.3.3" }, pasadaLaReserva)).toMatchObject({
      ok: true,
    });
  });

  it(`hasta ${MAX_ABIERTAS_POR_CONEXION} reservas abiertas por conexión`, async () => {
    const [otro] = otros;
    for (let i = 0; i < MAX_ABIERTAS_POR_CONEXION; i++) {
      expect(await crearReserva(db, otro.id, pedir(otro.general, 1), { navegador: navegador(), ip: "4.4.4.4" })).toMatchObject({ ok: true });
    }
    expect(await crearReserva(db, otro.id, pedir(otro.general, 1), { navegador: navegador(), ip: "4.4.4.4" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("demasiadas reservas abiertas desde esta conexión"),
    });
    expect(await crearReserva(db, otro.id, pedir(otro.general, 1), { navegador: navegador(), ip: "5.5.5.5" })).toMatchObject({ ok: true });
  });

  it("a los 10 minutos vence y los lugares vuelven (una sola vez)", async () => {
    const ahora = new Date();
    const reserva = await crearReserva(db, evento.id, pedir(evento.general, 6), { navegador: navegador(), ip: "1.1.1.1" }, ahora);
    if (!reserva.ok) throw new Error(reserva.error);
    expect(await liberarVencidas(db, evento.id, new Date(ahora.getTime() + (MINUTOS_RESERVA - 1) * MINUTO))).toBe(0);
    expect((await buscarCompra(db, reserva.llave, new Date(ahora.getTime() + MINUTOS_RESERVA * MINUTO)))!.vencida).toBe(true);

    const despues = new Date(ahora.getTime() + (MINUTOS_RESERVA + 1) * MINUTO);
    expect(await liberarVencidas(db, evento.id, despues)).toBe(1);
    expect(await liberarVencidas(db, evento.id, despues)).toBe(0);
    expect(await db.orden.findUniqueOrThrow({ where: { id: reserva.ordenId } })).toMatchObject({ estado: "VENCIDA" });
    expect(await db.entrada.count({ where: { ordenId: reserva.ordenId, estado: "ANULADA" } })).toBe(6);
    expect(await lotes()).toEqual([
      { vendidas: 0, reservadas: 0 },
      { vendidas: 0, reservadas: 0 },
    ]);
  });

  it("al abrir una página, liberar vencidas no hace fila: si el turno está ocupado, sigue de largo", async () => {
    const ahora = new Date();
    await crearReserva(db, evento.id, pedir(evento.general, 2), { navegador: navegador(), ip: "1.1.1.1" }, ahora);
    const despues = new Date(ahora.getTime() + (MINUTOS_RESERVA + 1) * MINUTO);
    let soltar!: () => void;
    const puerta = new Promise<void>((resolve) => (soltar = resolve));
    let tengo!: () => void;
    const yaTengo = new Promise<void>((resolve) => (tengo = resolve));
    const ocupado = db.$transaction(
      async (tx) => {
        await tomarTurnoDelEvento(tx, evento.id, 5_000);
        tengo();
        await puerta;
      },
      { timeout: 30_000 },
    );
    await yaTengo;
    const inicio = Date.now();
    expect(await liberarVencidas(db, evento.id, despues)).toBe(0);
    expect(Date.now() - inicio).toBeLessThan(1_000);
    soltar();
    await ocupado;
    expect(await liberarVencidas(db, evento.id, despues)).toBe(1);
  });

  it("reservar libera antes las vencidas del evento (el Lote 1 vuelve a estar en venta)", async () => {
    const ahora = new Date();
    await crearReserva(db, evento.id, pedir(evento.general, 5), { navegador: navegador(), ip: "1.1.1.1" }, ahora);
    const despues = new Date(ahora.getTime() + (MINUTOS_RESERVA + 1) * MINUTO);
    const nueva = await crearReserva(db, evento.id, pedir(evento.general, 1), { navegador: navegador(), ip: "1.1.1.1" }, despues);
    if (!nueva.ok) throw new Error(nueva.error);
    expect((await buscarCompra(db, nueva.llave, despues))!.entradas[0]).toMatchObject({ lote: "Lote 1", precioCentavos: 600000 });
    expect(await lotes()).toEqual([
      { vendidas: 0, reservadas: 1 },
      { vendidas: 0, reservadas: 0 },
    ]);
  });

  it("guarda nombre y DNI de cada entrada y el email, mientras la reserva esté vigente", async () => {
    const ahora = new Date();
    const reserva = await crearReserva(db, evento.id, pedir(evento.general, 2), { navegador: navegador(), ip: "1.1.1.1" }, ahora);
    if (!reserva.ok) throw new Error(reserva.error);
    const campos: Record<string, string> = {
      "nombre-0": "Juan Pérez",
      "dni-0": "40.123.456",
      "nombre-1": "Ana Gómez",
      "dni-1": "38999111",
      email: "Juan@Ejemplo.com",
      email2: "juan@ejemplo.com",
      telefono: "",
    };
    expect(await guardarDatosCompra(db, reserva.llave, (c) => campos[c], ahora)).toMatchObject({ ok: true });
    const compra = await buscarCompra(db, reserva.llave, ahora);
    expect(compra).toMatchObject({ email: "juan@ejemplo.com", telefono: null });
    expect(compra!.entradas.map((e) => [e.titular, e.dni])).toEqual([
      ["Juan Pérez", "40123456"],
      ["Ana Gómez", "38999111"],
    ]);

    expect(await guardarDatosCompra(db, reserva.llave, (c) => ({ ...campos, "dni-1": "" })[c], ahora)).toMatchObject({
      ok: false,
      errores: { "dni-1": "Poné el DNI." },
    });
    const tarde = new Date(ahora.getTime() + MINUTOS_RESERVA * MINUTO);
    expect(await guardarDatosCompra(db, reserva.llave, (c) => campos[c], tarde)).toMatchObject({
      ok: false,
      general: expect.stringContaining("ya no está vigente"),
    });
    expect(await guardarDatosCompra(db, "x".repeat(43), (c) => campos[c], ahora)).toMatchObject({ ok: false });
  });

  it("cancelar devuelve los lugares, una sola vez", async () => {
    const reserva = await crearReserva(db, evento.id, pedir(evento.general, 3), { navegador: navegador(), ip: "1.1.1.1" });
    if (!reserva.ok) throw new Error(reserva.error);
    expect(await cancelarReserva(db, reserva.llave)).toBe(true);
    expect(await cancelarReserva(db, reserva.llave)).toBe(false);
    expect((await lotes())[0]).toEqual({ vendidas: 0, reservadas: 0 });
    expect((await buscarCompra(db, reserva.llave))!.estado).toBe("CANCELADA");
  });

  it("30 reservas al mismo tiempo sobre 10 lugares: nunca de más, y cada lugar con su entrada", async () => {
    const resultados = await Promise.allSettled(
      Array.from({ length: 30 }, (_, i) =>
        crearReserva(db, evento.id, pedir(evento.general, (i % 2) + 1), { navegador: navegador(), ip: `10.0.0.${i}` }),
      ),
    );
    expect(resultados.filter((r) => r.status === "rejected")).toEqual([]);
    const reservadas = (await lotes()).reduce((suma, lote) => suma + lote.reservadas, 0);
    expect(reservadas).toBeLessThanOrEqual(10);
    expect(await db.entrada.count({ where: { eventoId: evento.id, estado: "PENDIENTE" } })).toBe(reservadas);
  });
});
