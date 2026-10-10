// Guardar evento, tipos y lotes contra un PostgreSQL de verdad.
// Solo corre si está TEST_DATABASE_URL (ver README, "Tests con base de datos").
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";

import { type Alcance, filtroDeEventos } from "@/lib/auth/alcance";

import { type EventoEditado, type EventoValidado, validarEvento } from "./editor";
import { guardarEvento } from "./guardar";

const url = process.env.TEST_DATABASE_URL;
const ADMIN: Alcance = { todo: true }; // el dueño de la plataforma ve todo

function datos(cambios: Partial<EventoEditado> = {}): EventoValidado {
  const resultado = validarEvento({
    nombre: "Evento de test",
    slug: "",
    fecha: "2030-03-07T23:00",
    lugar: "Lugar",
    direccion: "",
    descripcion: "",
    maxPorCompra: "4",
    cupoCortesias: "10",
    estado: "BORRADOR",
    tipos: [
      {
        nombre: "General",
        lotes: [
          { nombre: "Lote 1", precio: "6000", cupo: "100" },
          { nombre: "Lote 2", precio: "8000", cupo: "100" },
        ],
      },
      { nombre: "VIP", lotes: [{ nombre: "Lote 1", precio: "15000", cupo: "20" }] },
    ],
    ...cambios,
  });
  if (!resultado.ok) throw new Error(JSON.stringify(resultado.errores));
  return resultado.datos;
}

describe.skipIf(!url)("guardar evento, tipos y lotes", { timeout: 60_000 }, () => {
  let db: PrismaClient;
  let productoraId: string;
  const creados: string[] = [];

  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    productoraId = (await db.productora.create({ data: { nombre: `Productora ${crypto.randomUUID()}` } })).id;
  });

  afterAll(async () => {
    if (!db) return;
    await db.entrada.deleteMany({ where: { eventoId: { in: creados } } });
    await db.orden.deleteMany({ where: { eventoId: { in: creados } } });
    await db.evento.deleteMany({ where: { id: { in: creados } } });
    await db.productora.deleteMany({ where: { id: productoraId } });
    await db.$disconnect();
  });

  async function crear(cambios: Partial<EventoEditado> = {}) {
    const resultado = await guardarEvento(db, null, { ...datos(cambios), productoraId }, ADMIN);
    if (!resultado.ok) throw new Error(JSON.stringify(resultado.errores));
    creados.push(resultado.id);
    return leer(resultado.id);
  }

  function leer(id: string) {
    return db.evento.findUniqueOrThrow({
      where: { id },
      include: { tipos: { orderBy: { orden: "asc" }, include: { lotes: { orderBy: { numero: "asc" } } } } },
    });
  }

  // Lo guardado, en el formato que manda la pantalla.
  function comoEnPantalla(evento: Awaited<ReturnType<typeof leer>>): EventoEditado {
    return {
      nombre: evento.nombre,
      slug: evento.slug,
      fecha: "2030-03-07T23:00",
      lugar: evento.lugar,
      direccion: "",
      descripcion: "",
      maxPorCompra: String(evento.maxPorCompra),
      cupoCortesias: String(evento.cupoCortesias),
      estado: evento.estado,
      tipos: evento.tipos.map((tipo) => ({
        id: tipo.id,
        nombre: tipo.nombre,
        lotes: tipo.lotes.map((l) => ({ id: l.id, nombre: l.nombre, precio: String(l.precioCentavos / 100), cupo: String(l.cupo) })),
      })),
    };
  }

  it("crea el evento con sus tipos y lotes numerados, y una dirección libre", async () => {
    const primero = await crear();
    const segundo = await crear();
    expect(primero.tipos.map((t) => t.nombre)).toEqual(["General", "VIP"]);
    expect(primero.tipos[0].lotes.map((l) => [l.numero, l.nombre, l.precioCentavos, l.cupo])).toEqual([
      [1, "Lote 1", 600000, 100],
      [2, "Lote 2", 800000, 100],
    ]);
    expect(primero.slug).toMatch(/^evento-de-test(-\d+)?$/);
    expect(segundo.slug).not.toBe(primero.slug);
  });

  it("edita precios, cupos y nombres sin tocar lo vendido; los lotes nuevos van al final", async () => {
    const evento = await crear();
    const general = evento.tipos[0];
    await db.lote.update({ where: { id: general.lotes[0].id }, data: { vendidas: 30, reservadas: 5 } });

    const pantalla = comoEnPantalla(evento);
    pantalla.tipos[0].lotes[0].precio = "6500";
    pantalla.tipos[0].lotes[0].cupo = "35"; // justo lo ocupado: se puede
    pantalla.tipos[0].lotes.push({ nombre: "Lote 3", precio: "10000", cupo: "50" });
    pantalla.tipos[1].nombre = "Platea";
    const resultado = await guardarEvento(db, evento.id, datos(pantalla), ADMIN);
    expect(resultado).toEqual({ ok: true, id: evento.id });

    const despues = await leer(evento.id);
    expect(despues.tipos[0].lotes.map((l) => [l.numero, l.precioCentavos, l.cupo, l.vendidas, l.reservadas])).toEqual([
      [1, 650000, 35, 30, 5],
      [2, 800000, 100, 0, 0],
      [3, 1000000, 50, 0, 0],
    ]);
    expect(despues.tipos[1].nombre).toBe("Platea");
    expect(despues.slug).toBe(evento.slug); // la dirección no cambia sola
  });

  it("no deja bajar un cupo por debajo de lo vendido ni quitar lotes o tipos con ventas", async () => {
    const evento = await crear();
    await db.lote.update({ where: { id: evento.tipos[0].lotes[0].id }, data: { vendidas: 40 } });
    const antes = await leer(evento.id);

    const cupoChico = comoEnPantalla(evento);
    cupoChico.tipos[0].lotes[0].cupo = "39";
    expect(await guardarEvento(db, evento.id, datos(cupoChico), ADMIN)).toEqual({
      ok: false,
      errores: { "tipos.0.lotes.0.cupo": expect.stringMatching(/Ya hay 40/) },
    });

    const sinLote = comoEnPantalla(evento);
    sinLote.tipos[0].lotes.shift();
    expect(await guardarEvento(db, evento.id, datos(sinLote), ADMIN)).toMatchObject({
      ok: false,
      errores: { "tipos.0.nombre": expect.stringMatching(/No se puede quitar "Lote 1"/) },
    });

    const sinTipo = comoEnPantalla(evento);
    sinTipo.tipos.shift();
    expect(await guardarEvento(db, evento.id, datos(sinTipo), ADMIN)).toMatchObject({
      ok: false,
      errores: { general: expect.stringMatching(/No se puede quitar "General"/) },
    });

    // y no quedó nada a medias: ni el evento ni sus tipos y lotes cambiaron
    expect(await leer(evento.id)).toEqual(antes);
  });

  it("quita lotes y tipos sin ventas; un lote nuevo toma el número que sigue", async () => {
    const evento = await crear();
    const pantalla = comoEnPantalla(evento);
    pantalla.tipos[0].lotes.pop(); // Lote 2 sin ventas
    pantalla.tipos[0].lotes.push({ nombre: "Lote final", precio: "9000", cupo: "10" });
    pantalla.tipos.pop(); // VIP sin ventas
    expect(await guardarEvento(db, evento.id, datos(pantalla), ADMIN)).toMatchObject({ ok: true });

    const despues = await leer(evento.id);
    expect(despues.tipos.map((t) => t.nombre)).toEqual(["General"]);
    expect(despues.tipos[0].lotes.map((l) => [l.numero, l.nombre])).toEqual([
      [1, "Lote 1"],
      [2, "Lote final"],
    ]);
  });

  it("se pueden intercambiar los nombres de dos tipos y reordenarlos", async () => {
    const evento = await crear();
    const pantalla = comoEnPantalla(evento);
    pantalla.tipos[0].nombre = "VIP";
    pantalla.tipos[1].nombre = "General";
    pantalla.tipos.reverse();
    expect(await guardarEvento(db, evento.id, datos(pantalla), ADMIN)).toMatchObject({ ok: true });
    const despues = await leer(evento.id);
    expect(despues.tipos.map((t) => [t.nombre, t.lotes.length])).toEqual([
      ["General", 1], // el que era VIP (1 lote), ahora primero y con el otro nombre
      ["VIP", 2],
    ]);
  });

  it("no acepta lotes ni tipos de otro evento", async () => {
    const uno = await crear();
    const otro = await crear();
    const mezclado = comoEnPantalla(uno);
    mezclado.tipos[0].lotes[0].id = otro.tipos[0].lotes[0].id;
    expect(await guardarEvento(db, uno.id, datos(mezclado), ADMIN)).toMatchObject({
      ok: false,
      errores: { general: expect.stringMatching(/Recargá/) },
    });
    const tipoAjeno = comoEnPantalla(uno);
    tipoAjeno.tipos[1].id = otro.tipos[1].id;
    expect(await guardarEvento(db, uno.id, datos(tipoAjeno), ADMIN)).toMatchObject({ ok: false });
    // el otro evento sigue intacto
    expect((await leer(otro.id)).tipos[0].lotes).toHaveLength(2);
  });

  it("una dirección elegida a mano tiene que estar libre; el cupo de cortesías no baja de lo dado", async () => {
    const uno = await crear();
    const otro = await crear();
    const mismaDireccion = comoEnPantalla(otro);
    mismaDireccion.slug = uno.slug;
    expect(await guardarEvento(db, otro.id, datos(mismaDireccion), ADMIN)).toMatchObject({
      ok: false,
      errores: { slug: expect.stringMatching(/otra/) },
    });

    await db.evento.update({ where: { id: uno.id }, data: { cortesiasEmitidas: 8 } });
    const menosCortesias = comoEnPantalla(uno);
    menosCortesias.cupoCortesias = "5";
    expect(await guardarEvento(db, uno.id, datos(menosCortesias), ADMIN)).toMatchObject({
      ok: false,
      errores: { cupoCortesias: expect.stringMatching(/Ya se dieron 8/) },
    });
  });

  // ─── Productoras ───────────────────────────────────────────────────────────

  it("un organizador solo ve y toca los eventos de su productora", async () => {
    const otra = (await db.productora.create({ data: { nombre: `Otra ${crypto.randomUUID()}` } })).id;
    const organizadorDeOtra: Alcance = { todo: false, productoraId: otra };
    try {
      const ajeno = await crear(); // de la productora del test, no de "otra"
      expect(await guardarEvento(db, ajeno.id, datos(comoEnPantalla(ajeno)), organizadorDeOtra)).toEqual({
        ok: false,
        errores: { general: "Ese evento ya no existe." },
      });

      // aunque mande otra productora, el evento queda en la suya
      const propio = await guardarEvento(db, null, { ...datos(), productoraId }, organizadorDeOtra);
      if (!propio.ok) throw new Error(JSON.stringify(propio.errores));
      creados.push(propio.id);
      expect((await leer(propio.id)).productoraId).toBe(otra);

      const visibles = await db.evento.findMany({ where: filtroDeEventos(organizadorDeOtra), select: { id: true } });
      expect(visibles.map((e) => e.id)).toEqual([propio.id]);
      expect(await leer(ajeno.id)).toMatchObject({ productoraId }); // el ajeno, intacto
    } finally {
      await db.evento.deleteMany({ where: { productoraId: otra } });
      await db.productora.delete({ where: { id: otra } });
    }
  });

  it("el dueño tiene que elegir una productora activa al crear", async () => {
    expect(await guardarEvento(db, null, datos(), ADMIN)).toEqual({
      ok: false,
      errores: { productoraId: "Elegí una productora." },
    });
    const inactiva = await db.productora.create({ data: { nombre: `Inactiva ${crypto.randomUUID()}`, activa: false } });
    try {
      expect(await guardarEvento(db, null, { ...datos(), productoraId: inactiva.id }, ADMIN)).toMatchObject({
        ok: false,
        errores: { productoraId: expect.any(String) },
      });
    } finally {
      await db.productora.delete({ where: { id: inactiva.id } });
    }
  });
});
