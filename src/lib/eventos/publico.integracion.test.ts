// La página pública contra un PostgreSQL de verdad: lo que sale de la base
// para el público tiene solo el lote en venta, sin cantidades.
// Solo corre si está TEST_DATABASE_URL (ver README, "Tests con base de datos").
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";

import { buscarEventoPublico } from "./publico";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("evento para el público", { timeout: 60_000 }, () => {
  let db: PrismaClient;
  let productoraId: string;
  const slug = `publico-${crypto.randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const productora = await db.productora.create({ data: { nombre: `Productora ${slug}` } });
    productoraId = productora.id;
    await db.evento.create({
      data: {
        productoraId,
        slug,
        nombre: "Fiesta de test",
        fecha: new Date("2030-03-07T23:00:00-03:00"),
        lugar: "Club",
        estado: "PUBLICADO",
        tipos: {
          create: [
            {
              nombre: "VIP",
              orden: 2,
              lotes: { create: [{ numero: 1, nombre: "Única", precioCentavos: 1_500_000, cupo: 20, vendidas: 20 }] },
            },
            {
              nombre: "General",
              orden: 1,
              lotes: {
                create: [
                  { numero: 1, nombre: "Preventa", precioCentavos: 600_000, cupo: 300, vendidas: 123 },
                  { numero: 2, nombre: "Lote 2", precioCentavos: 800_000, cupo: 200 },
                  { numero: 3, nombre: "Puerta", precioCentavos: 1_000_000, cupo: 150 },
                ],
              },
            },
          ],
        },
      },
    });
  });

  afterAll(async () => {
    if (!db) return;
    await db.evento.deleteMany({ where: { slug } });
    await db.productora.deleteMany({ where: { id: productoraId } });
    await db.$disconnect();
  });

  it("de cada tipo, solo el lote en venta; los agotados dicen agotado", async () => {
    const evento = await buscarEventoPublico(db, slug);
    expect(evento).toMatchObject({ slug, nombre: "Fiesta de test", estado: "PUBLICADO", productora: { id: productoraId } });
    expect(evento?.tipos).toEqual([
      { id: expect.any(String), nombre: "General", lote: { id: expect.any(String), nombre: "Preventa", precioCentavos: 600_000 } },
      { id: expect.any(String), nombre: "VIP", lote: null },
    ]);
    expect(Object.keys(evento!).sort()).toEqual(
      ["descripcion", "direccion", "estado", "fecha", "id", "lugar", "maxPorCompra", "nombre", "productora", "slug", "tipos"],
    );
    const enviado = JSON.stringify(evento);
    for (const oculto of ["cupo", "vendidas", "reservadas", "numero", "Lote 2", "Puerta"]) {
      expect(enviado, oculto).not.toContain(oculto);
    }
  });

  it("al agotarse la preventa aparece el Lote 2, y recién ahí", async () => {
    await db.lote.updateMany({ where: { nombre: "Preventa", tipoEntrada: { evento: { slug } } }, data: { vendidas: 300 } });
    const evento = await buscarEventoPublico(db, slug);
    expect(evento?.tipos[0].lote).toMatchObject({ nombre: "Lote 2", precioCentavos: 800_000 });
    expect(JSON.stringify(evento)).not.toContain("Puerta");
  });

  it("un evento que no existe: null", async () => {
    expect(await buscarEventoPublico(db, `${slug}-no`)).toBeNull();
  });
});
