// "Reenviar mis entradas" contra un PostgreSQL de verdad: el mail vuelve a
// salir una vez y al email de la compra, con un límite por día, sin
// reenviar uno que se está mandando y sin decir nada de compras ajenas. Solo
// corre si está TEST_DATABASE_URL. Cada prueba usa su propio evento.
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { EstadoEntrada, EstadoOrden } from "@/generated/prisma/client";
import { PrismaClient } from "@/generated/prisma/client";
import { generarToken, huellaDeToken } from "@/lib/auth/sesiones";
import { nuevoCodigo } from "@/lib/entradas/codigo";

import type { Cartero, Mensaje } from "./cartero";
import { DURACION_MAXIMA_ENVIO_MS, enviarMailsPendientes, MAX_INTENTOS } from "./pendientes";
import { MAX_REENVIOS_POR_DIA, reenviarDeCompra, reenviarPorEmailYDni } from "./reenviar";

const url = process.env.TEST_DATABASE_URL;
const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const ENTORNO = {
  CLAVE_CODIGOS: "clave-de-prueba-de-los-tests-con-mas-de-32-caracteres",
  SMTP_HOST: "smtp.ejemplo.com",
  SMTP_USUARIO: "plataforma@ejemplo.com",
  SMTP_CLAVE: "clave",
};

function carteroDePrueba() {
  const enviados: Mensaje[] = [];
  const cartero: Cartero = {
    async enviar(mensaje) {
      enviados.push(mensaje);
    },
  };
  return { cartero, enviados };
}

describe.skipIf(!url)("Reenviar mis entradas", () => {
  let db: PrismaClient;
  const anterior: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const clave of Object.keys(ENTORNO)) anterior[clave] = process.env[clave];
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });

  beforeEach(() => {
    Object.assign(process.env, ENTORNO);
  });

  afterAll(async () => {
    for (const [clave, valor] of Object.entries(anterior)) {
      if (valor === undefined) delete process.env[clave];
      else process.env[clave] = valor;
    }
    await db?.$disconnect();
  });

  type Ev = { eventoId: string; tipoId: string; loteId: string };

  async function evento(): Promise<Ev> {
    const productora = await db.productora.create({ data: { nombre: `Productora ${crypto.randomUUID()}` } });
    const creado = await db.evento.create({
      data: {
        productoraId: productora.id,
        slug: `reenviar-${crypto.randomUUID()}`,
        nombre: "Fiesta del reenvío",
        fecha: new Date("2030-01-01T23:00:00-03:00"),
        lugar: "Club",
        tipos: { create: { nombre: "General", lotes: { create: { nombre: "Lote 1", numero: 1, precioCentavos: 1000, cupo: 100 } } } },
      },
      include: { tipos: { include: { lotes: true } } },
    });
    return { eventoId: creado.id, tipoId: creado.tipos[0].id, loteId: creado.tipos[0].lotes[0].id };
  }

  // Una compra con su link. Por defecto: paga, a comprador@ejemplo.com, con
  // dos entradas válidas de DNI 30111220 y 30111221.
  async function compra(
    ev: Ev,
    opciones: { estado?: EstadoOrden; email?: string; entradas?: { dni: string; estado: EstadoEntrada }[] } = {},
  ) {
    const llave = generarToken();
    const estado = opciones.estado ?? "PAGADA";
    const entradas = opciones.entradas ?? [
      { dni: "30111220", estado: "VALIDA" },
      { dni: "30111221", estado: "VALIDA" },
    ];
    const orden = await db.orden.create({
      data: {
        eventoId: ev.eventoId,
        estado,
        email: opciones.email ?? "comprador@ejemplo.com",
        totalCentavos: 1000 * entradas.length,
        pagadaEn: estado === "PAGADA" || estado === "REEMBOLSADA" ? new Date() : null,
        venceEn: estado === "PENDIENTE" ? new Date(Date.now() + 15 * MINUTO) : null,
        accesoHash: huellaDeToken(llave),
      },
    });
    for (const [i, entrada] of entradas.entries()) {
      await db.entrada.create({
        data: {
          ordenId: orden.id,
          eventoId: ev.eventoId,
          tipoEntradaId: ev.tipoId,
          loteId: ev.loteId,
          codigo: nuevoCodigo(),
          precioCentavos: 1000,
          estado: entrada.estado,
          titular: `Persona ${i + 1}`,
          dni: entrada.dni,
        },
      });
    }
    return { id: orden.id, llave };
  }

  const ordenDe = (id: string) =>
    db.orden.findUniqueOrThrow({
      where: { id },
      select: { mailEnviadoEn: true, mailIntentos: true, mailIntentoEn: true, mailError: true, reenviosCount: true, reenviosDesde: true },
    });

  // Manda el primer mail de la compra (como al pagarla).
  async function mandarElPrimero(ev: Ev, ahora = new Date()) {
    const { cartero } = carteroDePrueba();
    expect(await enviarMailsPendientes(db, cartero, { eventoId: ev.eventoId, ahora })).toEqual({ enviados: 1, fallidos: 0 });
  }

  // ─── Desde el link de la compra ───────────────────────────────────────────

  it("reenvía una compra cuyo mail ya salió: sale una vez más, al email de la compra", async () => {
    const ev = await evento();
    const { id, llave } = await compra(ev);
    await mandarElPrimero(ev);

    expect(await reenviarDeCompra(db, llave)).toEqual({ ok: true, ordenId: id, email: "comprador@ejemplo.com" });
    const { cartero, enviados } = carteroDePrueba();
    expect(await enviarMailsPendientes(db, cartero, { eventoId: ev.eventoId })).toEqual({ enviados: 1, fallidos: 0 });
    expect(await enviarMailsPendientes(db, cartero, { eventoId: ev.eventoId })).toEqual({ enviados: 0, fallidos: 0 });
    expect(enviados.map((mensaje) => mensaje.para)).toEqual(["comprador@ejemplo.com"]);

    const orden = await ordenDe(id);
    expect(orden.mailEnviadoEn).not.toBeNull();
    expect(orden.reenviosCount).toBe(1);
  });

  it(`como mucho ${MAX_REENVIOS_POR_DIA} por día por compra; pasadas 24 horas se puede de nuevo`, async () => {
    const ev = await evento();
    const { id, llave } = await compra(ev);
    const inicio = Date.now();
    const en = (ms: number) => new Date(inicio + ms);
    await mandarElPrimero(ev, en(0));
    const { cartero, enviados } = carteroDePrueba();

    for (let i = 1; i <= MAX_REENVIOS_POR_DIA; i++) {
      expect(await reenviarDeCompra(db, llave, en(i * 10 * MINUTO))).toMatchObject({ ok: true });
      await enviarMailsPendientes(db, cartero, { eventoId: ev.eventoId, ahora: en(i * 10 * MINUTO + 1000) });
    }
    expect(enviados).toHaveLength(MAX_REENVIOS_POR_DIA);
    expect(await reenviarDeCompra(db, llave, en(23 * HORA))).toEqual({ ok: false, motivo: "limite", ordenId: id });
    expect((await ordenDe(id)).reenviosCount).toBe(MAX_REENVIOS_POR_DIA);

    // Las 24 horas se cuentan desde el primer reenvío (a los 10 minutos).
    expect(await reenviarDeCompra(db, llave, en(24 * HORA + 10 * MINUTO))).toMatchObject({ ok: true });
    const orden = await ordenDe(id);
    expect(orden.reenviosCount).toBe(1);
    expect(orden.reenviosDesde).toEqual(en(24 * HORA + 10 * MINUTO));
  });

  it("no reenvía un mail que se está mandando o que está por salir solo (y no gasta reenvíos)", async () => {
    const ev = await evento();
    const { id, llave } = await compra(ev);
    const ahora = new Date();

    // Recién pagada: el mail está por salir.
    expect(await reenviarDeCompra(db, llave, ahora)).toEqual({ ok: false, motivo: "ya_sale", ordenId: id });

    // Falló y lo están volviendo a intentar ahora mismo.
    await db.orden.update({
      where: { id },
      data: { mailIntentos: 2, mailError: "x", mailIntentoEn: new Date(ahora.getTime() - 30_000) },
    });
    expect(await reenviarDeCompra(db, llave, ahora)).toEqual({ ok: false, motivo: "ya_sale", ordenId: id });
    expect((await ordenDe(id)).reenviosCount).toBe(0);

    // Ese intento ya terminó (falló): se puede pedir de nuevo, sin esperar al reintento.
    expect(await reenviarDeCompra(db, llave, new Date(ahora.getTime() + DURACION_MAXIMA_ENVIO_MS))).toMatchObject({ ok: true });
    const orden = await ordenDe(id);
    expect(orden).toMatchObject({ mailIntentos: 0, mailError: null, mailIntentoEn: null, reenviosCount: 1 });
  });

  it("una compra de antes de los mails (nunca se mandó solo) se puede pedir", async () => {
    const ev = await evento();
    const { id, llave } = await compra(ev);
    await db.orden.update({ where: { id }, data: { mailIntentos: MAX_INTENTOS, mailError: "Se pagó antes de que existieran los mails." } });

    expect(await reenviarDeCompra(db, llave)).toMatchObject({ ok: true });
    const { cartero, enviados } = carteroDePrueba();
    await enviarMailsPendientes(db, cartero, { eventoId: ev.eventoId });
    expect(enviados).toHaveLength(1);
  });

  it("varios pedidos a la vez: se marca una sola vez y cuenta uno", async () => {
    const ev = await evento();
    const { id, llave } = await compra(ev);
    await mandarElPrimero(ev);

    const resultados = await Promise.all(Array.from({ length: 6 }, () => reenviarDeCompra(db, llave)));
    expect(resultados.filter((resultado) => resultado.ok)).toHaveLength(1);
    expect(resultados.filter((resultado) => !resultado.ok && resultado.motivo === "ya_sale")).toHaveLength(5);
    expect((await ordenDe(id)).reenviosCount).toBe(1);
  });

  it("sin el envío configurado no gasta reenvíos", async () => {
    const ev = await evento();
    const { id, llave } = await compra(ev);
    await mandarElPrimero(ev);
    delete process.env.SMTP_HOST;

    expect(await reenviarDeCompra(db, llave)).toEqual({ ok: false, motivo: "sin_configurar" });
    expect(await reenviarPorEmailYDni(db, ev.eventoId, "comprador@ejemplo.com", "30111220")).toEqual({ ok: false, sinConfigurar: true });
    expect((await ordenDe(id)).reenviosCount).toBe(0);
  });

  it("solo compras pagas: ni reservas, ni devueltas, ni un link inventado", async () => {
    const ev = await evento();
    const pendiente = await compra(ev, { estado: "PENDIENTE" });
    const devuelta = await compra(ev, { estado: "REEMBOLSADA" });

    expect(await reenviarDeCompra(db, pendiente.llave)).toEqual({ ok: false, motivo: "no_encontrada" });
    expect(await reenviarDeCompra(db, devuelta.llave)).toEqual({ ok: false, motivo: "no_encontrada" });
    expect(await reenviarDeCompra(db, generarToken())).toEqual({ ok: false, motivo: "no_encontrada" });
    expect(await reenviarDeCompra(db, "cualquier-cosa")).toEqual({ ok: false, motivo: "no_encontrada" });
  });

  // ─── Con email y DNI, desde la página del evento ──────────────────────────

  it("con el email y el DNI de una entrada, reenvía las compras pagas de ese evento (y nada más)", async () => {
    const ev = await evento();
    const otroEvento = await evento();
    const primera = await compra(ev);
    const segunda = await compra(ev, { entradas: [{ dni: "30111220", estado: "USADA" }] });
    const deOtro = await compra(otroEvento);
    const sinPagar = await compra(ev, { estado: "PENDIENTE" });
    const otroEmail = await compra(ev, { email: "otra@ejemplo.com" });
    // A las tres pagas de este evento ya les llegó el mail.
    await db.orden.updateMany({ where: { id: { in: [primera.id, segunda.id, otroEmail.id] } }, data: { mailEnviadoEn: new Date() } });

    // Escrito como lo escribe la gente: con mayúsculas, espacios y puntos.
    const resultado = await reenviarPorEmailYDni(db, ev.eventoId, "  Comprador@Ejemplo.COM ", "30.111.220");
    expect(resultado.ok).toBe(true);
    expect(resultado.ok && [...resultado.reenviadas].sort()).toEqual([primera.id, segunda.id].sort());
    for (const { id } of [deOtro, sinPagar, otroEmail]) expect((await ordenDe(id)).reenviosCount).toBe(0);

    const { cartero, enviados } = carteroDePrueba();
    await enviarMailsPendientes(db, cartero, { eventoId: ev.eventoId });
    expect(enviados.map((mensaje) => mensaje.para)).toEqual(["comprador@ejemplo.com", "comprador@ejemplo.com"]);
  });

  it("si los datos no coinciden (o el DNI es de una entrada anulada) no reenvía nada, con la misma respuesta", async () => {
    const ev = await evento();
    const { id } = await compra(ev, {
      entradas: [
        { dni: "30111220", estado: "VALIDA" },
        { dni: "30111229", estado: "ANULADA" },
      ],
    });
    await mandarElPrimero(ev);

    const sinCompra = { ok: true, reenviadas: [] };
    expect(await reenviarPorEmailYDni(db, ev.eventoId, "comprador@ejemplo.com", "30111229")).toEqual(sinCompra);
    expect(await reenviarPorEmailYDni(db, ev.eventoId, "comprador@ejemplo.com", "30111221")).toEqual(sinCompra);
    expect(await reenviarPorEmailYDni(db, ev.eventoId, "otra@ejemplo.com", "30111220")).toEqual(sinCompra);
    expect((await ordenDe(id)).reenviosCount).toBe(0);
  });

  it("con email y DNI también vale el límite por día (y la respuesta no cambia)", async () => {
    const ev = await evento();
    const { id } = await compra(ev);
    const inicio = Date.now();
    await mandarElPrimero(ev, new Date(inicio));
    const { cartero } = carteroDePrueba();

    for (let i = 1; i <= MAX_REENVIOS_POR_DIA + 1; i++) {
      const ahora = new Date(inicio + i * 10 * MINUTO);
      const resultado = await reenviarPorEmailYDni(db, ev.eventoId, "comprador@ejemplo.com", "30111221", ahora);
      expect(resultado).toEqual({ ok: true, reenviadas: i <= MAX_REENVIOS_POR_DIA ? [id] : [] });
      await enviarMailsPendientes(db, cartero, { eventoId: ev.eventoId, ahora: new Date(ahora.getTime() + 1000) });
    }
    expect((await ordenDe(id)).reenviosCount).toBe(MAX_REENVIOS_POR_DIA);
  });

  it("revisa el email y el DNI antes de buscar", async () => {
    const ev = await evento();
    expect(await reenviarPorEmailYDni(db, ev.eventoId, "no-es-un-mail", "123")).toEqual({
      ok: false,
      errores: { email: expect.any(String), dni: expect.any(String) },
    });
    expect(await reenviarPorEmailYDni(db, ev.eventoId, "", "30111220")).toMatchObject({ ok: false, errores: { email: "Poné tu email." } });
    expect(await reenviarPorEmailYDni(db, ev.eventoId, "comprador@ejemplo.com", null)).toMatchObject({
      ok: false,
      errores: { dni: "Poné el DNI." },
    });
  });
});
