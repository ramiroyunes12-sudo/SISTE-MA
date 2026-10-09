// La ruta de la tarea programada: sin CRON_SECRET no hace nada, y sin la
// clave correcta, tampoco. (Acá no hay servidor de mail: no manda nada.)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prueba = vi.hoisted(() => ({ consultas: 0 }));
vi.mock("@/lib/db", () => ({
  obtenerDb: () =>
    new Proxy(
      {},
      {
        get() {
          prueba.consultas++;
          throw new Error("no debería tocar la base");
        },
      },
    ),
}));

const { GET } = await import("./route");

const CLAVE = "clave-de-prueba-de-la-tarea-diaria";
const pedido = (autorizacion?: string) =>
  new Request("https://siste-ma.vercel.app/api/mails/pendientes", {
    headers: autorizacion ? { authorization: autorizacion } : {},
  });

describe("GET /api/mails/pendientes", () => {
  const anteriores = { CRON_SECRET: process.env.CRON_SECRET, SMTP_HOST: process.env.SMTP_HOST };

  beforeEach(() => {
    prueba.consultas = 0;
    process.env.CRON_SECRET = CLAVE;
    delete process.env.SMTP_HOST;
  });

  afterEach(() => {
    for (const [nombre, valor] of Object.entries(anteriores)) {
      if (valor === undefined) delete process.env[nombre];
      else process.env[nombre] = valor;
    }
  });

  it("sin CRON_SECRET cargada (o muy corta) no hace nada", async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(pedido(`Bearer ${CLAVE}`))).status).toBe(503);
    process.env.CRON_SECRET = "corta";
    expect((await GET(pedido("Bearer corta"))).status).toBe(503);
  });

  it("sin la clave, o con otra, no hace nada", async () => {
    for (const autorizacion of [undefined, CLAVE, `Bearer ${CLAVE}x`, `Bearer ${CLAVE.slice(1)}`, "Bearer "]) {
      expect((await GET(pedido(autorizacion))).status).toBe(401);
    }
    expect(prueba.consultas).toBe(0);
  });

  it("con la clave: manda lo pendiente (acá, sin servidor de mail, avisa que no está configurado)", async () => {
    const respuesta = await GET(pedido(`Bearer ${CLAVE}`));
    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ ok: true, enviados: 0, fallidos: 0, sinConfigurar: true });
    expect(prueba.consultas).toBe(0);
  });
});
