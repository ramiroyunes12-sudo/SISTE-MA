// Prueba las reglas que la base de datos hace cumplir sola (CHECK, UNIQUE),
// contra un PostgreSQL de verdad con las migraciones aplicadas.
// Solo corre si está TEST_DATABASE_URL (ver README, "Tests con base de datos").
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { nuevoCodigo } from "@/lib/entradas/codigo";

import { cargarDatosDePrueba, SLUG_EVENTO_PRUEBA } from "../../prisma/datos-prueba";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("reglas de la base de datos", () => {
  let db: PrismaClient;
  let eventoId: string;
  let tipoId: string;
  let productoraId: string;

  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 30 }) });
    productoraId = (await db.productora.create({ data: { nombre: `Productora ${crypto.randomUUID()}` } })).id;
    const evento = await db.evento.create({
      data: {
        productoraId,
        slug: `prueba-${crypto.randomUUID()}`,
        nombre: "Evento de prueba",
        fecha: new Date("2030-01-01T23:00:00-03:00"),
        lugar: "Lugar de prueba",
        cupoCortesias: 2,
        tipos: { create: { nombre: "General" } },
      },
      include: { tipos: true },
    });
    eventoId = evento.id;
    tipoId = evento.tipos[0].id;
  });

  afterAll(async () => {
    if (!db) return;
    await db.entrada.deleteMany({ where: { eventoId } });
    await db.pago.deleteMany({ where: { orden: { eventoId } } });
    await db.orden.deleteMany({ where: { eventoId } });
    await db.evento.delete({ where: { id: eventoId } });
    await db.productora.delete({ where: { id: productoraId } });
    await db.$disconnect();
  });

  async function crearLote(numero: number, cupo: number) {
    return db.lote.create({
      data: { tipoEntradaId: tipoId, numero, nombre: `Lote ${numero}`, precioCentavos: 800000, cupo },
    });
  }

  it("no deja vender más que el cupo de un lote", async () => {
    const lote = await crearLote(1, 2);
    await db.lote.update({ where: { id: lote.id }, data: { vendidas: 2 } });
    await expect(
      db.lote.update({ where: { id: lote.id }, data: { reservadas: { increment: 1 } } }),
    ).rejects.toThrow();
    await expect(db.lote.update({ where: { id: lote.id }, data: { vendidas: -1 } })).rejects.toThrow();
  });

  it("con 20 reservas al mismo tiempo sobre 5 lugares, entran exactamente 5", async () => {
    const lote = await crearLote(2, 5);
    const intentos = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        db.lote.update({ where: { id: lote.id }, data: { reservadas: { increment: 1 } } }),
      ),
    );
    expect(intentos.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    const final = await db.lote.findUniqueOrThrow({ where: { id: lote.id } });
    expect(final.reservadas).toBe(5);
  });

  it("no deja emitir más cortesías que el cupo del evento", async () => {
    await db.evento.update({ where: { id: eventoId }, data: { cortesiasEmitidas: 2 } });
    await expect(
      db.evento.update({ where: { id: eventoId }, data: { cortesiasEmitidas: { increment: 1 } } }),
    ).rejects.toThrow();
  });

  it("no acepta precios ni números de lote inválidos", async () => {
    await expect(crearLote(0, 10)).rejects.toThrow();
    await expect(
      db.lote.create({
        data: { tipoEntradaId: tipoId, numero: 9, nombre: "Lote 9", precioCentavos: -1, cupo: 10 },
      }),
    ).rejects.toThrow();
  });

  it("una reserva puede existir sin datos, pero para pagarla hacen falta", async () => {
    const orden = await db.orden.create({ data: { eventoId, totalCentavos: 800000 } });
    const entrada = await db.entrada.create({
      data: {
        ordenId: orden.id,
        eventoId,
        tipoEntradaId: tipoId,
        codigo: nuevoCodigo(),
        precioCentavos: 800000,
      },
    });
    // sin email no se puede marcar pagada
    await expect(db.orden.update({ where: { id: orden.id }, data: { estado: "PAGADA" } })).rejects.toThrow();
    // sin titular ni DNI la entrada no puede quedar válida
    await expect(db.entrada.update({ where: { id: entrada.id }, data: { estado: "VALIDA" } })).rejects.toThrow();
    await db.orden.update({ where: { id: orden.id }, data: { email: "a@b.com", estado: "PAGADA" } });
    await db.entrada.update({
      where: { id: entrada.id },
      data: { titular: "Juan Pérez", dni: "40123456", estado: "VALIDA" },
    });
  });

  it("una entrada no puede mezclar datos de dos eventos", async () => {
    const otro = await db.evento.create({
      data: {
        productoraId,
        slug: `prueba-${crypto.randomUUID()}`,
        nombre: "Otro evento",
        fecha: new Date("2030-02-01T23:00:00-03:00"),
        lugar: "Otro lugar",
        tipos: { create: { nombre: "General" } },
      },
      include: { tipos: true },
    });
    try {
      const orden = await db.orden.create({ data: { eventoId, totalCentavos: 0 } });
      await expect(
        db.entrada.create({
          data: {
            ordenId: orden.id,
            eventoId,
            tipoEntradaId: otro.tipos[0].id, // tipo de OTRO evento
            codigo: nuevoCodigo(),
            precioCentavos: 0,
          },
        }),
      ).rejects.toThrow();
    } finally {
      await db.evento.delete({ where: { id: otro.id } });
    }
  });

  it("no se puede devolver más de lo que se cobró", async () => {
    const orden = await db.orden.create({ data: { eventoId, totalCentavos: 800000 } });
    await expect(
      db.pago.create({
        data: {
          ordenId: orden.id,
          mpPagoId: `mp-${crypto.randomUUID()}`,
          estadoMp: "refunded",
          montoCentavos: 800000,
          reembolsadoCentavos: 900000,
        },
      }),
    ).rejects.toThrow();
  });

  it("no repite el código de una entrada", async () => {
    const orden = await db.orden.create({
      data: { eventoId, email: "prueba@ejemplo.com", totalCentavos: 0 },
    });
    const datos = {
      ordenId: orden.id,
      eventoId,
      tipoEntradaId: tipoId,
      titular: "Persona de Prueba",
      dni: "30111222",
      codigo: nuevoCodigo(),
      precioCentavos: 0,
    };
    await db.entrada.create({ data: datos });
    await expect(db.entrada.create({ data: { ...datos, dni: "30111223" } })).rejects.toThrow();
  });

  it("el código de una entrada tiene que ser 128 bits en hexadecimal con mayúsculas", async () => {
    const orden = await db.orden.create({ data: { eventoId, totalCentavos: 0 } });
    const datos = { ordenId: orden.id, eventoId, tipoEntradaId: tipoId, precioCentavos: 0 };
    for (const codigo of [`codigo-${crypto.randomUUID()}`, nuevoCodigo().toLowerCase(), nuevoCodigo().slice(1), `E1-${nuevoCodigo()}`]) {
      await expect(db.entrada.create({ data: { ...datos, codigo } }), codigo).rejects.toThrow(/entradas_codigo_formato/);
    }
    await db.entrada.create({ data: { ...datos, codigo: nuevoCodigo() } });
  });
});

describe.skipIf(!url)("datos de prueba", () => {
  let db: PrismaClient;

  beforeAll(() => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  async function contar() {
    const evento = await db.evento.findUniqueOrThrow({
      where: { slug: SLUG_EVENTO_PRUEBA },
      include: { tipos: { include: { lotes: true } } },
    });
    return {
      tipos: evento.tipos.length,
      lotes: evento.tipos.reduce((total, tipo) => total + tipo.lotes.length, 0),
      lote1General: evento.tipos.find((t) => t.nombre === "General")!.lotes.find((l) => l.numero === 1)!,
    };
  }

  it("se pueden cargar varias veces sin duplicar ni pisar las ventas", async () => {
    await cargarDatosDePrueba(db);
    const primera = await contar();
    expect(primera.tipos).toBe(2);
    expect(primera.lotes).toBe(4);
    expect(primera.lote1General.precioCentavos).toBe(600000);

    // simulamos ventas y volvemos a cargar: no tiene que borrarlas
    await db.lote.update({ where: { id: primera.lote1General.id }, data: { vendidas: 7, reservadas: 2 } });
    await cargarDatosDePrueba(db);
    const segunda = await contar();
    expect(segunda.tipos).toBe(2);
    expect(segunda.lotes).toBe(4);
    expect(segunda.lote1General.vendidas).toBe(7);
    expect(segunda.lote1General.reservadas).toBe(2);

    await db.lote.update({ where: { id: primera.lote1General.id }, data: { vendidas: 0, reservadas: 0 } });
  });
});
