// Reservar, liberar y confirmar contra un PostgreSQL de verdad: el reparto
// entre lotes, que nunca se venda de más (aunque compren muchos a la vez) y
// que editar el evento espere a las compras en curso.
// Solo corre si está TEST_DATABASE_URL (ver README, "Tests con base de datos").
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { aFechaLocal } from "@/lib/fechas";
import { validarEvento } from "@/lib/eventos/editor";
import { guardarEvento } from "@/lib/eventos/guardar";

import { confirmarReservas, liberarReservas, reservarEntradas } from "./reservas";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("reservas en los lotes", { timeout: 120_000 }, () => {
  let db: PrismaClient;
  let productoraId: string;
  let eventoId: string;
  let otroEventoId: string;
  let general: { id: string; lotes: string[] };
  let vip: { id: string; lote: string };
  let tipoDeOtroEvento: string;
  let loteDeOtroEvento: string;
  const unico = crypto.randomUUID().slice(0, 8);

  async function crearEvento(slug: string, tipos: { nombre: string; orden: number; cupos: number[] }[]) {
    return db.evento.create({
      data: {
        productoraId,
        slug,
        nombre: `Evento ${slug}`,
        fecha: new Date("2030-03-07T23:00:00-03:00"),
        lugar: "Club",
        estado: "PUBLICADO",
        maxPorCompra: 6,
        tipos: {
          create: tipos.map((tipo) => ({
            nombre: tipo.nombre,
            orden: tipo.orden,
            lotes: {
              create: tipo.cupos.map((cupo, i) => ({
                numero: i + 1,
                nombre: `Lote ${i + 1}`,
                precioCentavos: (6000 + i * 2000) * 100,
                cupo,
              })),
            },
          })),
        },
      },
      include: { tipos: { include: { lotes: { orderBy: { numero: "asc" } } } } },
    });
  }

  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 20 }) });
    productoraId = (await db.productora.create({ data: { nombre: `Productora reservas ${unico}` } })).id;
    const evento = await crearEvento(`reservas-${unico}`, [
      { nombre: "General", orden: 1, cupos: [5, 5, 5] },
      { nombre: "VIP", orden: 2, cupos: [3] },
    ]);
    eventoId = evento.id;
    const [g, v] = evento.tipos.sort((a, b) => a.orden - b.orden);
    general = { id: g.id, lotes: g.lotes.map((lote) => lote.id) };
    vip = { id: v.id, lote: v.lotes[0].id };
    const otro = await crearEvento(`reservas-otro-${unico}`, [{ nombre: "General", orden: 1, cupos: [10] }]);
    otroEventoId = otro.id;
    tipoDeOtroEvento = otro.tipos[0].id;
    loteDeOtroEvento = otro.tipos[0].lotes[0].id;
  });

  beforeEach(async () => {
    await db.lote.updateMany({
      where: { tipoEntrada: { eventoId: { in: [eventoId, otroEventoId] } } },
      data: { vendidas: 0, reservadas: 0 },
    });
    await db.evento.update({ where: { id: eventoId }, data: { estado: "PUBLICADO", maxPorCompra: 6 } });
    await db.productora.update({ where: { id: productoraId }, data: { activa: true } });
  });

  afterAll(async () => {
    if (!db) return;
    await db.evento.deleteMany({ where: { productoraId } });
    await db.productora.deleteMany({ where: { id: productoraId } });
    await db.$disconnect();
  });

  const reservar = (pedido: unknown, evento = eventoId) =>
    db.$transaction((tx) => reservarEntradas(tx, evento, pedido), { maxWait: 60_000, timeout: 60_000 });

  async function numeros() {
    const lotes = await db.lote.findMany({
      where: { id: { in: [...general.lotes, vip.lote] } },
      select: { id: true, vendidas: true, reservadas: true },
    });
    const por = new Map(lotes.map((lote) => [lote.id, { vendidas: lote.vendidas, reservadas: lote.reservadas }]));
    return { general: general.lotes.map((id) => por.get(id)!), vip: por.get(vip.lote)! };
  }

  it("reparte entre lotes: piden 4 y 3 → el segundo pedido toma 1 del Lote 1 y 2 del Lote 2", async () => {
    expect(await reservar([{ tipoId: general.id, cantidad: 4 }])).toMatchObject({
      ok: true,
      cantidad: 4,
      totalCentavos: 4 * 600000,
      lineas: [{ loteId: general.lotes[0], cantidad: 4 }],
    });
    const segundo = await reservar([{ tipoId: general.id, cantidad: 3 }]);
    expect(segundo).toMatchObject({
      ok: true,
      totalCentavos: 600000 + 2 * 800000,
      lineas: [
        { loteId: general.lotes[0], loteNombre: "Lote 1", cantidad: 1, precioCentavos: 600000 },
        { loteId: general.lotes[1], loteNombre: "Lote 2", cantidad: 2, precioCentavos: 800000 },
      ],
    });
    expect((await numeros()).general.map((lote) => lote.reservadas)).toEqual([5, 2, 0]);
  });

  it("o todo o nada: si un tipo no entra, no se reserva ninguno", async () => {
    const resultado = await reservar([
      { tipoId: general.id, cantidad: 3 },
      { tipoId: vip.id, cantidad: 4 },
    ]);
    expect(resultado).toEqual({ ok: false, error: "Se pueden comprar hasta 6 entradas por vez." });
    // Con un máximo más alto, el que no entra es VIP (3 lugares): tampoco se reserva General.
    await db.evento.update({ where: { id: eventoId }, data: { maxPorCompra: 10 } });
    expect(await reservar([{ tipoId: general.id, cantidad: 2 }, { tipoId: vip.id, cantidad: 4 }])).toEqual({
      ok: false,
      error: 'No quedan 4 entradas "VIP". Probá con menos.',
    });
    const despues = await numeros();
    expect([...despues.general, despues.vip].every((lote) => lote.reservadas === 0 && lote.vendidas === 0)).toBe(true);
  });

  it("solo eventos a la venta: ni borradores, ni finalizados, ni de productoras desactivadas", async () => {
    const pedido = [{ tipoId: general.id, cantidad: 1 }];
    const noEsta = { ok: false, error: "Este evento no está a la venta." };
    for (const estado of ["BORRADOR", "FINALIZADO"] as const) {
      await db.evento.update({ where: { id: eventoId }, data: { estado } });
      expect(await reservar(pedido), estado).toEqual(noEsta);
    }
    await db.evento.update({ where: { id: eventoId }, data: { estado: "PUBLICADO" } });
    await db.productora.update({ where: { id: productoraId }, data: { activa: false } });
    expect(await reservar(pedido)).toEqual(noEsta);
    await db.productora.update({ where: { id: productoraId }, data: { activa: true } });
    expect(await reservar(pedido, crypto.randomUUID())).toEqual(noEsta);
    expect(await reservar(pedido, "no-es-un-id")).toEqual(noEsta);
    expect((await numeros()).general[0].reservadas).toBe(0);
  });

  it("no acepta tipos de otro evento", async () => {
    expect(await reservar([{ tipoId: tipoDeOtroEvento, cantidad: 1 }])).toMatchObject({
      ok: false,
      error: expect.stringContaining("ya no está a la venta"),
    });
    expect(await db.lote.findUniqueOrThrow({ where: { id: loteDeOtroEvento } })).toMatchObject({ reservadas: 0 });
  });

  it("confirmar pasa reservadas a vendidas; liberar las devuelve", async () => {
    await reservar([{ tipoId: general.id, cantidad: 6 }]); // 5 del Lote 1 y 1 del Lote 2
    await db.$transaction((tx) =>
      confirmarReservas(tx, eventoId, [
        { loteId: general.lotes[0], cantidad: 3 },
        { loteId: general.lotes[1], cantidad: 1 },
      ]),
    );
    await db.$transaction((tx) => liberarReservas(tx, eventoId, [{ loteId: general.lotes[0], cantidad: 2 }]));
    expect((await numeros()).general).toEqual([
      { vendidas: 3, reservadas: 0 },
      { vendidas: 1, reservadas: 0 },
      { vendidas: 0, reservadas: 0 },
    ]);
    // Liberada la reserva, el Lote 1 vuelve a estar en venta (decisión 2a).
    expect(await reservar([{ tipoId: general.id, cantidad: 1 }])).toMatchObject({
      ok: true,
      lineas: [{ loteId: general.lotes[0], precioCentavos: 600000 }],
    });
  });

  it("si los números no cierran, falla todo y no cambia nada", async () => {
    await reservar([{ tipoId: general.id, cantidad: 2 }]);
    const antes = await numeros();
    // más de lo reservado (aunque una parte sí se pueda)
    await expect(
      db.$transaction((tx) =>
        liberarReservas(tx, eventoId, [
          { loteId: general.lotes[0], cantidad: 1 },
          { loteId: general.lotes[0], cantidad: 2 },
        ]),
      ),
    ).rejects.toThrow(/tiene 2 reservadas/);
    // un lote de otro evento
    await expect(
      db.$transaction((tx) => confirmarReservas(tx, eventoId, [{ loteId: loteDeOtroEvento, cantidad: 1 }])),
    ).rejects.toThrow(/no son de este evento/);
    // cantidades inválidas
    await expect(
      db.$transaction((tx) => liberarReservas(tx, eventoId, [{ loteId: general.lotes[0], cantidad: 0 }])),
    ).rejects.toThrow(/porción inválida/);
    expect(await numeros()).toEqual(antes);
  });

  it("40 compras al mismo tiempo sobre 15 lugares: nunca se vende de más y los lotes se llenan en orden", async () => {
    const cantidades = Array.from({ length: 40 }, (_, i) => (i % 3) + 1); // 1, 2, 3, 1, 2, 3…
    const resultados = await Promise.allSettled(cantidades.map((cantidad) => reservar([{ tipoId: general.id, cantidad }])));

    const fallas = resultados.filter((r) => r.status === "rejected");
    expect(fallas, "ninguna se trabó ni explotó").toEqual([]);
    const planes = resultados.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof reservar>>>).value);
    const reservadasOk = planes.reduce((suma, plan) => suma + (plan.ok ? plan.cantidad : 0), 0);
    for (const plan of planes) {
      if (!plan.ok) expect(plan.error).toMatch(/No quedan|agotado/);
    }

    const lotes = (await numeros()).general;
    const total = lotes.reduce((suma, lote) => suma + lote.reservadas, 0);
    expect(total).toBe(reservadasOk);
    expect(total).toBeLessThanOrEqual(15);
    expect(total).toBeGreaterThanOrEqual(13); // con pedidos de 1 a 3, a lo sumo quedan 2 sin vender
    expect(lotes.every((lote) => lote.reservadas <= 5)).toBe(true);
    // en orden: si un lote tiene algo, los anteriores están llenos
    for (let i = 1; i < lotes.length; i++) {
      if (lotes[i].reservadas > 0) expect(lotes[i - 1].reservadas).toBe(5);
    }
  });

  it("compras, liberaciones y confirmaciones mezcladas al mismo tiempo: los números cierran", async () => {
    // primero 5 reservas de 2 (10 lugares), después todo a la vez
    const previas = [];
    for (let i = 0; i < 5; i++) {
      const plan = await reservar([{ tipoId: general.id, cantidad: 2 }]);
      if (!plan.ok) throw new Error(plan.error);
      previas.push(plan.lineas.map((linea) => ({ loteId: linea.loteId, cantidad: linea.cantidad })));
    }
    const tareas = [
      ...previas.slice(0, 3).map((porciones) => db.$transaction((tx) => liberarReservas(tx, eventoId, porciones), { maxWait: 60_000 })),
      ...previas.slice(3).map((porciones) => db.$transaction((tx) => confirmarReservas(tx, eventoId, porciones), { maxWait: 60_000 })),
      ...Array.from({ length: 12 }, () => reservar([{ tipoId: general.id, cantidad: 1 }, { tipoId: vip.id, cantidad: 1 }])),
    ];
    const resultados = await Promise.allSettled(tareas);
    expect(resultados.filter((r) => r.status === "rejected")).toEqual([]);

    const nuevas = resultados
      .slice(5)
      .map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof reservar>>>).value)
      .filter((plan) => plan.ok);
    const { general: lotes, vip: lugarVip } = await numeros();
    expect(nuevas).toHaveLength(3); // VIP tiene 3 lugares
    expect(lugarVip).toEqual({ vendidas: 0, reservadas: 3 });
    expect(lotes.reduce((suma, lote) => suma + lote.vendidas, 0)).toBe(4); // 2 confirmadas de 2
    expect(lotes.reduce((suma, lote) => suma + lote.reservadas, 0)).toBe(3); // las 3 nuevas de General
    expect(lotes.every((lote) => lote.vendidas + lote.reservadas <= 5)).toBe(true);
  });

  it("editar el evento espera a la compra en curso, y después ve los números nuevos", async () => {
    const evento = await db.evento.findUniqueOrThrow({
      where: { id: eventoId },
      include: { tipos: { orderBy: { orden: "asc" }, include: { lotes: { orderBy: { numero: "asc" } } } } },
    });
    // Lo que manda la pantalla: el Lote 1 de General baja a cupo 1 y se quita el Lote 3.
    const validado = validarEvento({
      nombre: evento.nombre,
      slug: evento.slug,
      fecha: aFechaLocal(evento.fecha),
      lugar: evento.lugar,
      direccion: "",
      descripcion: "",
      maxPorCompra: "6",
      cupoCortesias: "0",
      estado: "PUBLICADO",
      tipos: evento.tipos.map((tipo) => ({
        id: tipo.id,
        nombre: tipo.nombre,
        lotes: tipo.lotes
          .filter((lote) => lote.id !== general.lotes[2])
          .map((lote) => ({
            id: lote.id,
            nombre: lote.nombre,
            precio: String(lote.precioCentavos / 100),
            cupo: lote.id === general.lotes[0] ? "1" : String(lote.cupo),
          })),
      })),
    });
    if (!validado.ok) throw new Error(JSON.stringify(validado.errores));

    // Una compra de 3 que todavía no terminó (tiene el evento bloqueado).
    let terminar!: () => void;
    const puerta = new Promise<void>((resolve) => (terminar = resolve));
    let reservo!: () => void;
    const yaReservo = new Promise<void>((resolve) => (reservo = resolve));
    const compra = db.$transaction(
      async (tx) => {
        const plan = await reservarEntradas(tx, eventoId, [{ tipoId: general.id, cantidad: 3 }]);
        reservo();
        await puerta;
        return plan;
      },
      { timeout: 60_000 },
    );
    await yaReservo;

    let guardado: Awaited<ReturnType<typeof guardarEvento>> | undefined;
    const guardar = guardarEvento(db, eventoId, validado.datos, { todo: true }).then((r) => (guardado = r));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(guardado, "guardar espera a la compra").toBeUndefined();

    terminar();
    expect(await compra).toMatchObject({ ok: true });
    await guardar;
    // Vio las 3 reservadas del Lote 1: no lo deja bajar a 1.
    expect(guardado).toEqual({
      ok: false,
      errores: { "tipos.0.lotes.0.cupo": "Ya hay 3 vendidas o reservadas: el cupo no puede ser menor." },
    });
    expect((await numeros()).general[0]).toEqual({ vendidas: 0, reservadas: 3 });
  });

  it("no se puede quitar un lote que tiene reservas", async () => {
    await reservar([{ tipoId: general.id, cantidad: 6 }]); // 5 del Lote 1 y 1 del Lote 2
    const evento = await db.evento.findUniqueOrThrow({
      where: { id: eventoId },
      include: { tipos: { orderBy: { orden: "asc" }, include: { lotes: { orderBy: { numero: "asc" } } } } },
    });
    const validado = validarEvento({
      nombre: evento.nombre,
      slug: evento.slug,
      fecha: aFechaLocal(evento.fecha),
      lugar: evento.lugar,
      direccion: "",
      descripcion: "",
      maxPorCompra: "6",
      cupoCortesias: "0",
      estado: "PUBLICADO",
      tipos: evento.tipos.map((tipo) => ({
        id: tipo.id,
        nombre: tipo.nombre,
        lotes: tipo.lotes
          .filter((lote) => lote.id !== general.lotes[1])
          .map((lote) => ({ id: lote.id, nombre: lote.nombre, precio: String(lote.precioCentavos / 100), cupo: String(lote.cupo) })),
      })),
    });
    if (!validado.ok) throw new Error(JSON.stringify(validado.errores));
    expect(await guardarEvento(db, eventoId, validado.datos, { todo: true })).toMatchObject({ ok: false });
    expect((await numeros()).general[1]).toEqual({ vendidas: 0, reservadas: 1 });
  });
});
