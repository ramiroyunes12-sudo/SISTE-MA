// El PDF desde el link de la compra, contra un PostgreSQL de verdad. Solo
// corre si está TEST_DATABASE_URL.
import { PrismaPg } from "@prisma/adapter-pg";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { EstadoEntrada, EstadoOrden } from "@/generated/prisma/client";
import { PrismaClient } from "@/generated/prisma/client";
import { generarToken, huellaDeToken } from "@/lib/auth/sesiones";
import { buscarCompra } from "@/lib/ventas/ordenes";

import { nuevoCodigo } from "./codigo";
import { entradasConQr, pdfDeCompra } from "./imprimir";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("PDF de las entradas de una compra", () => {
  let db: PrismaClient;
  let anterior: string | undefined;
  let eventoId: string;
  let tipoId: string;

  beforeAll(async () => {
    anterior = process.env.CLAVE_CODIGOS;
    process.env.CLAVE_CODIGOS = "clave-de-prueba-de-los-tests-con-mas-de-32-caracteres";
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const productora = await db.productora.create({ data: { nombre: `Productora ${crypto.randomUUID()}` } });
    const evento = await db.evento.create({
      data: {
        productoraId: productora.id,
        slug: `pdf-${crypto.randomUUID()}`,
        nombre: "Evento del PDF",
        fecha: new Date("2030-01-01T23:00:00-03:00"),
        lugar: "Lugar de prueba",
        tipos: { create: { nombre: "General" } },
      },
      include: { tipos: true },
    });
    eventoId = evento.id;
    tipoId = evento.tipos[0].id;
  });

  afterAll(async () => {
    if (anterior === undefined) delete process.env.CLAVE_CODIGOS;
    else process.env.CLAVE_CODIGOS = anterior;
    await db?.$disconnect();
  });

  // Una compra con entradas en esos estados. Devuelve la llave del link.
  async function compra(estadoOrden: EstadoOrden, estados: EstadoEntrada[]) {
    const llave = generarToken();
    const conDatos = !["PENDIENTE", "VENCIDA", "CANCELADA"].includes(estadoOrden);
    const orden = await db.orden.create({
      data: {
        eventoId,
        estado: estadoOrden,
        accesoHash: huellaDeToken(llave),
        email: conDatos ? "comprador@ejemplo.com" : null,
        totalCentavos: 1000 * estados.length,
      },
    });
    for (const [i, estado] of estados.entries()) {
      await db.entrada.create({
        data: {
          ordenId: orden.id,
          eventoId,
          tipoEntradaId: tipoId,
          codigo: nuevoCodigo(),
          precioCentavos: 1000,
          estado,
          titular: estado === "PENDIENTE" ? null : `Persona ${i + 1}`,
          dni: estado === "PENDIENTE" ? null : `3011122${i}`,
        },
      });
    }
    return llave;
  }

  async function paginas(resultado: Awaited<ReturnType<typeof pdfDeCompra>>) {
    if (!resultado.ok) throw new Error(`sin PDF: ${resultado.motivo}`);
    return (await PDFDocument.load(resultado.pdf)).getPageCount();
  }

  it("compra paga: todas las entradas con QR (válidas y usadas), una página cada una", async () => {
    const llave = await compra("PAGADA", ["VALIDA", "USADA", "VALIDA"]);
    const resultado = await pdfDeCompra(db, llave, null);
    expect(await paginas(resultado)).toBe(3);
    expect(resultado.ok && resultado.archivo).toMatch(/^entradas-compra-\d+\.pdf$/);
  });

  it("una sola entrada, por su número en la compra", async () => {
    const llave = await compra("PAGADA", ["VALIDA", "VALIDA"]);
    const resultado = await pdfDeCompra(db, llave, 2);
    expect(await paginas(resultado)).toBe(1);
    expect(resultado.ok && resultado.archivo).toMatch(/^entrada-2-compra-\d+\.pdf$/);
    expect(await pdfDeCompra(db, llave, 3)).toEqual({ ok: false, motivo: "sin_entradas" });
  });

  it("las anuladas no salen (ni sueltas)", async () => {
    const llave = await compra("PAGADA", ["VALIDA", "ANULADA"]);
    expect(await paginas(await pdfDeCompra(db, llave, null))).toBe(1);
    expect(await pdfDeCompra(db, llave, 2)).toEqual({ ok: false, motivo: "sin_entradas" });
    const compraLeida = await buscarCompra(db, llave);
    expect(entradasConQr(compraLeida!).map((e) => e.numero)).toEqual([1]);
  });

  it("sin pagar, vencida, cancelada o devuelta: no hay PDF", async () => {
    for (const [estado, entradas] of [
      ["PENDIENTE", ["PENDIENTE"]],
      ["VENCIDA", ["PENDIENTE"]],
      ["CANCELADA", ["PENDIENTE"]],
      ["REEMBOLSADA", ["VALIDA"]],
    ] as const) {
      const llave = await compra(estado, [...entradas]);
      expect(await pdfDeCompra(db, llave, null), estado).toEqual({ ok: false, motivo: "sin_entradas" });
    }
  });

  it("con una llave que no existe o con otro formato, no encuentra nada", async () => {
    expect(await pdfDeCompra(db, generarToken(), null)).toEqual({ ok: false, motivo: "no_encontrada" });
    expect(await pdfDeCompra(db, "../../algo", null)).toEqual({ ok: false, motivo: "no_encontrada" });
  });

  it("sin CLAVE_CODIGOS falla (nunca arma un QR que no sirva)", async () => {
    const llave = await compra("PAGADA", ["VALIDA"]);
    const clave = process.env.CLAVE_CODIGOS;
    delete process.env.CLAVE_CODIGOS;
    try {
      await expect(pdfDeCompra(db, llave, null)).rejects.toThrow(/CLAVE_CODIGOS/);
    } finally {
      process.env.CLAVE_CODIGOS = clave;
    }
  });
});
