// Verificar una entrada por su código (solo mirar, sin marcarla usada),
// contra un PostgreSQL de verdad. Solo corre si está TEST_DATABASE_URL.
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { EstadoEntrada, EstadoOrden } from "@/generated/prisma/client";
import { PrismaClient } from "@/generated/prisma/client";

import { firmarCodigo, nuevoCodigo } from "./codigo";
import { verificarCodigo } from "./verificar";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("verificar una entrada por su código", () => {
  let db: PrismaClient;
  let anterior: string | undefined;
  let eventoId: string;
  let otroEventoId: string;
  let tipoId: string;
  let otroTipoId: string;

  beforeAll(async () => {
    anterior = process.env.CLAVE_CIFRADO;
    process.env.CLAVE_CIFRADO = "clave-de-prueba-de-los-tests-con-mas-de-32-caracteres";
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const productoraId = (await db.productora.create({ data: { nombre: `Productora ${crypto.randomUUID()}` } })).id;
    const crear = (nombre: string) =>
      db.evento.create({
        data: {
          productoraId,
          slug: `verificar-${crypto.randomUUID()}`,
          nombre,
          fecha: new Date("2030-01-01T23:00:00-03:00"),
          lugar: "Lugar de prueba",
          tipos: { create: { nombre: "General" } },
        },
        include: { tipos: true },
      });
    const evento = await crear("Evento");
    const otro = await crear("Otro evento");
    eventoId = evento.id;
    tipoId = evento.tipos[0].id;
    otroEventoId = otro.id;
    otroTipoId = otro.tipos[0].id;
  });

  afterAll(async () => {
    if (anterior === undefined) delete process.env.CLAVE_CIFRADO;
    else process.env.CLAVE_CIFRADO = anterior;
    await db?.$disconnect();
  });

  // Una compra con una entrada, en el estado pedido. Devuelve el código firmado.
  async function entrada(
    estadoOrden: EstadoOrden,
    estadoEntrada: EstadoEntrada,
    opciones: { evento?: "este" | "otro"; usadaEn?: Date } = {},
  ) {
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
    await db.entrada.create({
      data: {
        ordenId: orden.id,
        eventoId: otro ? otroEventoId : eventoId,
        tipoEntradaId: otro ? otroTipoId : tipoId,
        codigo,
        precioCentavos: 1000,
        estado: estadoEntrada,
        titular: estadoEntrada === "PENDIENTE" ? null : "Persona de Prueba",
        dni: estadoEntrada === "PENDIENTE" ? null : "30111222",
        usadaEn: opciones.usadaEn ?? null,
      },
    });
    return { firmado: firmarCodigo(codigo), numero: orden.numero };
  }

  it("válida: compra paga y entrada válida, con sus datos", async () => {
    const { firmado, numero } = await entrada("PAGADA", "VALIDA");
    expect(await verificarCodigo(db, eventoId, firmado)).toEqual({
      resultado: "valida",
      entrada: { titular: "Persona de Prueba", dni: "30111222", tipo: "General", compra: numero, usadaEn: null },
    });
  });

  it("acepta el código en minúsculas y con espacios", async () => {
    const { firmado } = await entrada("PAGADA", "VALIDA");
    expect((await verificarCodigo(db, eventoId, ` ${firmado.toLowerCase()} `)).resultado).toBe("valida");
  });

  it("usada: dice cuándo entró", async () => {
    const usadaEn = new Date("2030-01-02T01:30:00-03:00");
    const { firmado } = await entrada("PAGADA", "USADA", { usadaEn });
    const resultado = await verificarCodigo(db, eventoId, firmado);
    expect(resultado.resultado).toBe("usada");
    expect(resultado.resultado !== "no_valida" && resultado.entrada.usadaEn).toEqual(usadaEn);
  });

  it("sin pagar: la reserva todavía no se pagó, venció o se canceló", async () => {
    for (const estado of ["PENDIENTE", "VENCIDA", "CANCELADA"] as const) {
      const { firmado } = await entrada(estado, "PENDIENTE");
      expect((await verificarCodigo(db, eventoId, firmado)).resultado, estado).toBe("sin_pagar");
    }
  });

  it("anulada: entrada anulada o compra devuelta (aunque la entrada siga como válida)", async () => {
    const anulada = await entrada("PAGADA", "ANULADA");
    expect((await verificarCodigo(db, eventoId, anulada.firmado)).resultado).toBe("anulada");
    const devuelta = await entrada("REEMBOLSADA", "VALIDA");
    expect((await verificarCodigo(db, eventoId, devuelta.firmado)).resultado).toBe("anulada");
  });

  it("de otro evento: no válida y sin mostrar datos", async () => {
    const { firmado } = await entrada("PAGADA", "VALIDA", { evento: "otro" });
    expect(await verificarCodigo(db, eventoId, firmado)).toEqual({ resultado: "no_valida", motivo: "otro_evento" });
  });

  it("bien firmado pero inexistente: no válida", async () => {
    expect(await verificarCodigo(db, eventoId, firmarCodigo(nuevoCodigo()))).toEqual({
      resultado: "no_valida",
      motivo: "no_existe",
    });
  });

  it("firma trucha o formato raro: no válida (no la busca)", async () => {
    const { firmado } = await entrada("PAGADA", "VALIDA");
    const trucho = firmado.slice(0, -1) + (firmado.endsWith("0") ? "1" : "0");
    expect(await verificarCodigo(db, eventoId, trucho)).toEqual({ resultado: "no_valida", motivo: "firma" });
    // El número al azar solo (lo que hay en la base) no sirve sin la firma.
    expect(await verificarCodigo(db, eventoId, firmado.split("-")[1])).toEqual({ resultado: "no_valida", motivo: "formato" });
    expect(await verificarCodigo(db, eventoId, "")).toEqual({ resultado: "no_valida", motivo: "formato" });
  });
});
