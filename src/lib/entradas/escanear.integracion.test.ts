// La puerta: escanear un QR y, si la entrada es válida, marcarla usada.
// Contra un PostgreSQL de verdad. Solo corre si está TEST_DATABASE_URL.
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { EstadoEntrada, EstadoOrden } from "@/generated/prisma/client";
import { PrismaClient } from "@/generated/prisma/client";
import type { Alcance } from "@/lib/auth/alcance";

import { firmarCodigo, nuevoCodigo } from "./codigo";
import { escanearCodigo, eventosDeLaPuerta } from "./escanear";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("escanear en la puerta", () => {
  let db: PrismaClient;
  let anterior: string | undefined;
  let productoraId: string;
  let eventoId: string;
  let otroEventoId: string;
  let tipoId: string;
  let otroTipoId: string;
  let validador: { id: string; nombre: string };
  let otroValidador: { id: string; nombre: string };
  const TODO: Alcance = { todo: true };
  const AHORA = new Date("2030-01-02T00:41:00-03:00");

  beforeAll(async () => {
    anterior = process.env.CLAVE_CODIGOS;
    process.env.CLAVE_CODIGOS = "clave-de-prueba-de-los-tests-con-mas-de-32-caracteres";
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    productoraId = (await db.productora.create({ data: { nombre: `Productora ${crypto.randomUUID()}` } })).id;
    const crear = (nombre: string) =>
      db.evento.create({
        data: {
          productoraId,
          slug: `escanear-${crypto.randomUUID()}`,
          nombre,
          fecha: new Date("2030-01-01T23:00:00-03:00"),
          lugar: "Lugar de prueba",
          estado: "PUBLICADO",
          tipos: { create: { nombre: "VIP" } },
        },
        include: { tipos: true },
      });
    const evento = await crear("Evento");
    const otro = await crear("Otro evento");
    eventoId = evento.id;
    tipoId = evento.tipos[0].id;
    otroEventoId = otro.id;
    otroTipoId = otro.tipos[0].id;
    const persona = (nombre: string) =>
      db.usuario.create({
        data: { nombre, email: `${crypto.randomUUID()}@ejemplo.com`, hashContrasena: "x", rol: "VALIDADOR", productoraId },
        select: { id: true, nombre: true },
      });
    validador = await persona("Ana Puerta");
    otroValidador = await persona("Beto Puerta");
  });

  afterAll(async () => {
    if (anterior === undefined) delete process.env.CLAVE_CODIGOS;
    else process.env.CLAVE_CODIGOS = anterior;
    await db?.$disconnect();
  });

  // Una compra con una entrada, en el estado pedido. Devuelve el código firmado.
  async function entrada(estadoOrden: EstadoOrden, estadoEntrada: EstadoEntrada, opciones: { evento?: "este" | "otro" } = {}) {
    const otro = opciones.evento === "otro";
    const codigo = nuevoCodigo();
    const orden = await db.orden.create({
      data: {
        eventoId: otro ? otroEventoId : eventoId,
        estado: estadoOrden,
        email: ["PENDIENTE", "VENCIDA", "CANCELADA"].includes(estadoOrden) ? null : "comprador@ejemplo.com",
        totalCentavos: 1000,
      },
      select: { id: true, numero: true },
    });
    const creada = await db.entrada.create({
      data: {
        ordenId: orden.id,
        eventoId: otro ? otroEventoId : eventoId,
        tipoEntradaId: otro ? otroTipoId : tipoId,
        codigo,
        precioCentavos: 1000,
        estado: estadoEntrada,
        titular: estadoEntrada === "PENDIENTE" ? null : "Persona de Prueba",
        dni: estadoEntrada === "PENDIENTE" ? null : "30111222",
      },
      select: { id: true },
    });
    return { firmado: firmarCodigo(codigo), numero: orden.numero, id: creada.id };
  }

  const escanear = (texto: string, opciones: { usuario?: { id: string }; alcance?: Alcance; ahora?: Date } = {}) =>
    escanearCodigo(db, {
      eventoId,
      alcance: opciones.alcance ?? TODO,
      usuarioId: (opciones.usuario ?? validador).id,
      texto,
      ahora: opciones.ahora ?? AHORA,
    });

  const escaneosDe = (entradaId: string) =>
    db.escaneo.findMany({ where: { entradaId }, orderBy: { creadoEn: "asc" } });

  it("válida: PASA con sus datos, queda usada (cuándo y quién) y se anota el escaneo", async () => {
    const { firmado, numero, id } = await entrada("PAGADA", "VALIDA");
    expect(await escanear(firmado)).toEqual({
      resultado: "pasa",
      entrada: { titular: "Persona de Prueba", dni: "30111222", tipo: "VIP", compra: numero },
    });
    const guardada = await db.entrada.findUniqueOrThrow({ where: { id } });
    expect(guardada).toMatchObject({ estado: "USADA", usadaEn: AHORA, validadaPorId: validador.id });
    const escaneos = await escaneosDe(id);
    expect(escaneos).toHaveLength(1);
    expect(escaneos[0]).toMatchObject({
      eventoId,
      usuarioId: validador.id,
      metodo: "QR",
      resultado: "PASA",
      codigoLeido: null,
    });
  });

  it("la segunda vez: YA INGRESÓ, a qué hora y quién la escaneó (y no cambia la primera)", async () => {
    const { firmado, numero, id } = await entrada("PAGADA", "VALIDA");
    await escanear(firmado);
    const despues = new Date(AHORA.getTime() + 5 * 60_000);
    expect(await escanear(firmado, { usuario: otroValidador, ahora: despues })).toEqual({
      resultado: "ya_ingreso",
      entrada: { titular: "Persona de Prueba", dni: "30111222", tipo: "VIP", compra: numero },
      usadaEn: AHORA,
      validadaPor: validador,
    });
    const guardada = await db.entrada.findUniqueOrThrow({ where: { id } });
    expect(guardada).toMatchObject({ estado: "USADA", usadaEn: AHORA, validadaPorId: validador.id });
    expect((await escaneosDe(id)).map((e) => [e.resultado, e.usuarioId])).toEqual([
      ["PASA", validador.id],
      ["YA_INGRESO", otroValidador.id],
    ]);
  });

  it("dos celulares a la vez con el mismo QR: entra una sola vez", async () => {
    const { firmado, id } = await entrada("PAGADA", "VALIDA");
    const resultados = await Promise.all(
      Array.from({ length: 8 }, (_, i) => escanear(firmado, { usuario: i % 2 ? otroValidador : validador })),
    );
    const pasaron = resultados.filter((r) => r?.resultado === "pasa");
    expect(pasaron).toHaveLength(1);
    expect(resultados.filter((r) => r?.resultado === "ya_ingreso")).toHaveLength(7);
    const escaneos = await escaneosDe(id);
    expect(escaneos.filter((e) => e.resultado === "PASA")).toHaveLength(1);
    expect(escaneos.filter((e) => e.resultado === "YA_INGRESO")).toHaveLength(7);
  });

  it("sin pagar: NO VÁLIDA y la entrada no cambia", async () => {
    for (const estado of ["PENDIENTE", "VENCIDA", "CANCELADA"] as const) {
      const { firmado, id } = await entrada(estado, "PENDIENTE");
      const resultado = await escanear(firmado);
      expect(resultado?.resultado, estado).toBe("no_valida");
      expect(resultado?.resultado === "no_valida" && resultado.motivo, estado).toBe("sin_pagar");
      expect((await db.entrada.findUniqueOrThrow({ where: { id } })).estado).toBe("PENDIENTE");
      expect((await escaneosDe(id)).map((e) => e.resultado)).toEqual(["NO_VALIDA"]);
    }
  });

  it("compra devuelta con la entrada todavía válida: NO VÁLIDA y no la marca usada", async () => {
    const { firmado, id } = await entrada("REEMBOLSADA", "VALIDA");
    expect(await escanear(firmado)).toMatchObject({ resultado: "no_valida", motivo: "anulada" });
    expect(await db.entrada.findUniqueOrThrow({ where: { id } })).toMatchObject({ estado: "VALIDA", usadaEn: null });
  });

  it("entrada anulada: NO VÁLIDA", async () => {
    const { firmado, id } = await entrada("PAGADA", "ANULADA");
    expect(await escanear(firmado)).toMatchObject({ resultado: "no_valida", motivo: "anulada" });
    expect((await db.entrada.findUniqueOrThrow({ where: { id } })).estado).toBe("ANULADA");
  });

  it("de otro evento: NO VÁLIDA, sin datos y sin tocarla", async () => {
    const { firmado, id } = await entrada("PAGADA", "VALIDA", { evento: "otro" });
    expect(await escanear(firmado)).toEqual({ resultado: "no_valida", motivo: "otro_evento" });
    expect((await db.entrada.findUniqueOrThrow({ where: { id } })).estado).toBe("VALIDA");
    // Se anota en este evento, sin la entrada ni el código (es un QR que sirve en el otro).
    const escaneo = await db.escaneo.findFirst({ where: { eventoId, codigoLeido: null }, orderBy: { creadoEn: "desc" } });
    expect(escaneo).toMatchObject({ resultado: "NO_VALIDA", entradaId: null });
    expect(await escaneosDe(id)).toHaveLength(0);
  });

  it("firma trucha: NO VÁLIDA y se guarda lo leído sin la firma; un texto cualquiera, no", async () => {
    const { firmado, id } = await entrada("PAGADA", "VALIDA");
    const trucho = firmado.slice(0, -1) + (firmado.endsWith("0") ? "1" : "0");
    expect(await escanear(trucho)).toEqual({ resultado: "no_valida", motivo: "firma" });
    expect((await db.entrada.findUniqueOrThrow({ where: { id } })).estado).toBe("VALIDA");
    const [version, azar] = trucho.split("-");
    expect(await db.escaneo.count({ where: { eventoId, codigoLeido: `${version}-${azar}` } })).toBe(1);
    expect(await db.escaneo.count({ where: { codigoLeido: { contains: trucho.split("-")[2] } } })).toBe(0);

    const cualquiera = `https://ejemplo.com/${crypto.randomUUID()}`;
    expect(await escanear(cualquiera)).toEqual({ resultado: "no_valida", motivo: "formato" });
    expect(await db.escaneo.count({ where: { codigoLeido: { contains: "ejemplo.com" } } })).toBe(0);
  });

  it("código a mano con un error en la parte al azar: no guarda la firma verdadera (con la base sola no se arma el QR)", async () => {
    const { firmado, id } = await entrada("PAGADA", "VALIDA");
    const [version, azar, firma] = firmado.split("-");
    const tipeado = `${version}-${(azar[0] === "A" ? "B" : "A") + azar.slice(1)}-${firma}`;
    expect(await escanear(tipeado)).toEqual({ resultado: "no_valida", motivo: "firma" });
    expect((await db.entrada.findUniqueOrThrow({ where: { id } })).estado).toBe("VALIDA");
    expect(await db.escaneo.count({ where: { codigoLeido: { contains: firma } } })).toBe(0);
  });

  it("bien firmado pero inexistente: NO VÁLIDA (sin guardar el código)", async () => {
    const firmado = firmarCodigo(nuevoCodigo());
    expect(await escanear(firmado)).toEqual({ resultado: "no_valida", motivo: "no_existe" });
    expect(await db.escaneo.count({ where: { codigoLeido: firmado } })).toBe(0);
  });

  it("validador de su productora: la deja pasar", async () => {
    const { firmado } = await entrada("PAGADA", "VALIDA");
    const propia: Alcance = { todo: false, productoraId };
    expect((await escanear(firmado, { alcance: propia }))?.resultado).toBe("pasa");
  });

  it("evento de otra productora: null, sin tocar la entrada ni anotar nada", async () => {
    const { firmado, id } = await entrada("PAGADA", "VALIDA");
    const ajena = (await db.productora.create({ data: { nombre: `Ajena ${crypto.randomUUID()}` } })).id;
    expect(await escanear(firmado, { alcance: { todo: false, productoraId: ajena } })).toBeNull();
    expect((await db.entrada.findUniqueOrThrow({ where: { id } })).estado).toBe("VALIDA");
    expect(await escaneosDe(id)).toHaveLength(0);
  });

  it("eventos para elegir: los de su productora que no pasaron hace más de 24 horas", async () => {
    const ahora = new Date("2030-01-02T22:00:00-03:00"); // 23 horas después de que empezaron
    const propios = await eventosDeLaPuerta(db, { todo: false, productoraId }, ahora);
    expect(propios.map((e) => e.id).sort()).toEqual([eventoId, otroEventoId].sort());
    const tarde = new Date("2030-01-03T00:00:00-03:00"); // 25 horas después
    expect(await eventosDeLaPuerta(db, { todo: false, productoraId }, tarde)).toEqual([]);
    const ajena = (await db.productora.create({ data: { nombre: `Ajena ${crypto.randomUUID()}` } })).id;
    expect(await eventosDeLaPuerta(db, { todo: false, productoraId: ajena }, ahora)).toEqual([]);
    expect((await eventosDeLaPuerta(db, TODO, ahora)).map((e) => e.id)).toEqual(expect.arrayContaining([eventoId]));
  });
});
