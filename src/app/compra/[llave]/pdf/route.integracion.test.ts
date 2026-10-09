// La ruta del PDF de la compra, contra un PostgreSQL de verdad: códigos de
// respuesta y encabezados (sin caché, inline, nosniff). Solo corre si está
// TEST_DATABASE_URL.
import { PrismaPg } from "@prisma/adapter-pg";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { generarToken, huellaDeToken } from "@/lib/auth/sesiones";
import { nuevoCodigo } from "@/lib/entradas/codigo";

const url = process.env.TEST_DATABASE_URL;
const prueba = { db: null as PrismaClient | null };
vi.mock("@/lib/db", () => ({ obtenerDb: () => prueba.db }));

const { GET } = await import("./route");

describe.skipIf(!url)("GET /compra/<llave>/pdf", () => {
  let db: PrismaClient;
  let anterior: string | undefined;
  let llave: string;

  beforeAll(async () => {
    anterior = process.env.CLAVE_CODIGOS;
    process.env.CLAVE_CODIGOS = "clave-de-prueba-de-los-tests-con-mas-de-32-caracteres";
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    prueba.db = db;
    const productora = await db.productora.create({ data: { nombre: `Productora ${crypto.randomUUID()}` } });
    const evento = await db.evento.create({
      data: {
        productoraId: productora.id,
        slug: `ruta-pdf-${crypto.randomUUID()}`,
        nombre: "Evento de la ruta",
        fecha: new Date("2030-01-01T23:00:00-03:00"),
        lugar: "Lugar de prueba",
        tipos: { create: { nombre: "General" } },
      },
      include: { tipos: true },
    });
    llave = generarToken();
    const orden = await db.orden.create({
      data: { eventoId: evento.id, estado: "PAGADA", accesoHash: huellaDeToken(llave), email: "comprador@ejemplo.com", totalCentavos: 1000 },
    });
    await db.entrada.create({
      data: {
        ordenId: orden.id,
        eventoId: evento.id,
        tipoEntradaId: evento.tipos[0].id,
        codigo: nuevoCodigo(),
        precioCentavos: 1000,
        estado: "VALIDA",
        titular: "Persona de Prueba",
        dni: "30111222",
      },
    });
  });

  afterAll(async () => {
    if (anterior === undefined) delete process.env.CLAVE_CODIGOS;
    else process.env.CLAVE_CODIGOS = anterior;
    await db?.$disconnect();
  });

  function pedir(l: string, consulta = "") {
    return GET(new NextRequest(`http://localhost/compra/${l}/pdf${consulta}`), { params: Promise.resolve({ llave: l }) });
  }

  function sinGuardar(respuesta: Response) {
    expect(respuesta.headers.get("cache-control")).toBe("private, no-store");
    expect(respuesta.headers.get("x-content-type-options")).toBe("nosniff");
    expect(respuesta.headers.get("referrer-policy")).toBe("no-referrer");
    expect(respuesta.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  }

  it("compra paga: el PDF, para ver en el navegador, sin caché y sin datos en el nombre", async () => {
    const respuesta = await pedir(llave);
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("content-type")).toBe("application/pdf");
    expect(respuesta.headers.get("content-disposition")).toMatch(/^inline; filename="entradas-compra-\d+\.pdf"$/);
    sinGuardar(respuesta);
    expect(Buffer.from(await respuesta.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("una sola entrada por su número", async () => {
    const respuesta = await pedir(llave, "?entrada=1");
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("content-disposition")).toMatch(/^inline; filename="entrada-1-compra-\d+\.pdf"$/);
  });

  it("llave inventada, número que no existe o cualquier cosa: 404, también sin caché", async () => {
    for (const [l, consulta] of [
      [generarToken(), ""],
      [llave, "?entrada=2"],
      [llave, "?entrada=abc"],
      [llave, "?entrada=0"],
    ]) {
      const respuesta = await pedir(l, consulta);
      expect(respuesta.status, consulta).toBe(404);
      expect(respuesta.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      sinGuardar(respuesta);
    }
  });

  it("sin CLAVE_CODIGOS: 503 y nada de PDF", async () => {
    const clave = process.env.CLAVE_CODIGOS;
    delete process.env.CLAVE_CODIGOS;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const respuesta = await pedir(llave);
      expect(respuesta.status).toBe(503);
      sinGuardar(respuesta);
      expect(await respuesta.text()).not.toContain("Persona");
    } finally {
      process.env.CLAVE_CODIGOS = clave;
      error.mockRestore();
    }
  });
});
