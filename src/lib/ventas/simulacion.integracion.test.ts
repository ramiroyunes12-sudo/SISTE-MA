// "Probar una compra" del panel contra un PostgreSQL de verdad: cada
// organizador solo prueba sus eventos, los avisos dicen por qué no se vende y
// no cambia ningún número.
// Solo corre si está TEST_DATABASE_URL (ver README, "Tests con base de datos").
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { Alcance } from "@/lib/auth/alcance";

import { simularCompra } from "./simulacion";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("probar una compra", { timeout: 60_000 }, () => {
  let db: PrismaClient;
  const unico = crypto.randomUUID().slice(0, 8);
  let productoraA: string;
  let productoraB: string;
  let eventoA: string;
  let general: string;
  let vip: string;
  const ADMIN: Alcance = { todo: true };

  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    productoraA = (await db.productora.create({ data: { nombre: `Simulación A ${unico}` } })).id;
    productoraB = (await db.productora.create({ data: { nombre: `Simulación B ${unico}` } })).id;
    const evento = await db.evento.create({
      data: {
        productoraId: productoraA,
        slug: `simulacion-${unico}`,
        nombre: "Fiesta A",
        fecha: new Date("2030-03-07T23:00:00-03:00"),
        lugar: "Club",
        estado: "PUBLICADO",
        tipos: {
          create: [
            {
              nombre: "General",
              orden: 1,
              lotes: {
                create: [
                  { numero: 1, nombre: "Lote 1", precioCentavos: 600_000, cupo: 10, vendidas: 8 },
                  { numero: 2, nombre: "Lote 2", precioCentavos: 800_000, cupo: 10 },
                ],
              },
            },
            { nombre: "VIP", orden: 2, lotes: { create: [{ numero: 1, nombre: "Lote 1", precioCentavos: 1_500_000, cupo: 2 }] } },
          ],
        },
      },
      include: { tipos: true },
    });
    eventoA = evento.id;
    general = evento.tipos.find((tipo) => tipo.nombre === "General")!.id;
    vip = evento.tipos.find((tipo) => tipo.nombre === "VIP")!.id;
  });

  afterAll(async () => {
    if (!db) return;
    await db.evento.deleteMany({ where: { productoraId: { in: [productoraA, productoraB] } } });
    await db.productora.deleteMany({ where: { id: { in: [productoraA, productoraB] } } });
    await db.$disconnect();
  });

  const cantidades = (valores: Record<string, string>) => (tipoId: string) => valores[tipoId] ?? "";

  it("reparte como la compra de verdad y no cambia ningún número", async () => {
    const antes = await db.lote.findMany({ where: { tipoEntrada: { eventoId: eventoA } }, orderBy: { id: "asc" } });
    const resultado = await simularCompra(db, eventoA, ADMIN, cantidades({ [general]: "4", [vip]: "1" }));
    expect(resultado).toEqual({
      plan: {
        ok: true,
        cantidad: 5,
        totalCentavos: 2 * 600_000 + 2 * 800_000 + 1_500_000,
        lineas: [
          expect.objectContaining({ tipoNombre: "General", loteNombre: "Lote 1", cantidad: 2 }),
          expect.objectContaining({ tipoNombre: "General", loteNombre: "Lote 2", cantidad: 2 }),
          expect.objectContaining({ tipoNombre: "VIP", loteNombre: "Lote 1", cantidad: 1 }),
        ],
      },
      aviso: undefined,
    });
    expect(await db.lote.findMany({ where: { tipoEntrada: { eventoId: eventoA } }, orderBy: { id: "asc" } })).toEqual(antes);
  });

  it("un organizador solo prueba los eventos de su productora", async () => {
    const deOtra: Alcance = { todo: false, productoraId: productoraB };
    expect(await simularCompra(db, eventoA, deOtra, cantidades({ [general]: "1" }))).toEqual({ error: "Ese evento ya no existe." });
    const propia: Alcance = { todo: false, productoraId: productoraA };
    expect(await simularCompra(db, eventoA, propia, cantidades({ [general]: "1" }))).toMatchObject({ plan: { ok: true } });
  });

  it("avisa por qué el público no puede comprar", async () => {
    const pedido = cantidades({ [general]: "1" });
    await db.evento.update({ where: { id: eventoA }, data: { estado: "BORRADOR" } });
    expect(await simularCompra(db, eventoA, ADMIN, pedido)).toMatchObject({ aviso: expect.stringContaining("borrador") });
    await db.evento.update({ where: { id: eventoA }, data: { estado: "FINALIZADO" } });
    expect(await simularCompra(db, eventoA, ADMIN, pedido)).toMatchObject({ aviso: expect.stringContaining("finalizado") });
    await db.evento.update({ where: { id: eventoA }, data: { estado: "PUBLICADO" } });
    await db.productora.update({ where: { id: productoraA }, data: { activa: false } });
    expect(await simularCompra(db, eventoA, ADMIN, pedido)).toMatchObject({
      plan: { ok: true },
      aviso: expect.stringContaining("productora está desactivada"),
    });
    await db.productora.update({ where: { id: productoraA }, data: { activa: true } });
  });

  it("cantidades raras, ninguna entrada o más del máximo: lo dice", async () => {
    expect(await simularCompra(db, eventoA, ADMIN, cantidades({ [general]: "1.5" }))).toMatchObject({
      error: "Poné cantidades enteras, de 0 a 20.",
    });
    expect(await simularCompra(db, eventoA, ADMIN, cantidades({ [general]: "dos" }))).toMatchObject({
      error: "Poné cantidades enteras, de 0 a 20.",
    });
    expect(await simularCompra(db, eventoA, ADMIN, cantidades({}))).toMatchObject({ error: "Elegí al menos una entrada." });
    expect(await simularCompra(db, eventoA, ADMIN, cantidades({ [general]: "7" }))).toMatchObject({
      error: "Se pueden comprar hasta 6 entradas por vez.",
    });
    expect(await simularCompra(db, eventoA, ADMIN, cantidades({ [vip]: "3" }))).toMatchObject({
      error: 'No quedan 3 entradas "VIP". Probá con menos.',
    });
  });
});
