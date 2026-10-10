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
import { enviarMailsPendientes, MAX_INTENTOS, reintentarMailsDelEvento } from "./pendientes";
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

const dormir = (ms: number) => new Promise((listo) => setTimeout(listo, ms));

// Un cartero de mentira: anota lo que manda. `fallar`: tira ese error;
// `demora`: tarda en "mandarlo" (para tener un envío en curso).
function carteroDePrueba(opciones: { fallar?: unknown; demora?: number | (() => number) } = {}) {
  const enviados: Mensaje[] = [];
  const cartero: Cartero = {
    async enviar(mensaje) {
      const demora = typeof opciones.demora === "function" ? opciones.demora() : opciones.demora;
      if (demora) await dormir(demora);
      if (opciones.fallar !== undefined) throw opciones.fallar;
      enviados.push(mensaje);
    },
  };
  return { cartero, enviados };
}

const FALLA_DE_CONEXION = Object.assign(new Error("x"), { code: "ECONNECTION" });

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
      select: {
        mailEnviadoEn: true,
        mailIntentos: true,
        mailIntentoEn: true,
        mailError: true,
        mailReintentarDesde: true,
        reenviosCount: true,
        reenviosDesde: true,
      },
    });

  // Manda el primer mail de la compra (como al pagarla).
  async function mandarElPrimero(ev: Ev, ahora = new Date()) {
    const { cartero, enviados } = carteroDePrueba();
    expect(await enviarMailsPendientes(db, cartero, { eventoId: ev.eventoId, ahora })).toEqual({ enviados: 1, fallidos: 0 });
    return enviados[0];
  }

  // ─── Desde el link de la compra ───────────────────────────────────────────

  it("reenvía una compra cuyo mail ya salió: sale una vez más, al email de la compra y con otro asunto", async () => {
    const ev = await evento();
    const { id, llave } = await compra(ev);
    const primero = await mandarElPrimero(ev);
    expect(primero.asunto).toMatch(/^Tus entradas para Fiesta del reenvío \(compra N° \d+\)$/);

    expect(await reenviarDeCompra(db, llave)).toEqual({ ok: true, ordenId: id, email: "comprador@ejemplo.com" });
    const { cartero, enviados } = carteroDePrueba();
    expect(await enviarMailsPendientes(db, cartero, { eventoId: ev.eventoId })).toEqual({ enviados: 1, fallidos: 0 });
    expect(await enviarMailsPendientes(db, cartero, { eventoId: ev.eventoId })).toEqual({ enviados: 0, fallidos: 0 });
    expect(enviados.map((mensaje) => mensaje.para)).toEqual(["comprador@ejemplo.com"]);
    // Otro asunto: si fuera el mismo, Gmail lo mete en la conversación del
    // primero y parece que no llegó nada nuevo.
    expect(enviados[0].asunto).toMatch(/^Te reenviamos tus entradas para Fiesta del reenvío \(compra N° \d+\)$/);

    const orden = await ordenDe(id);
    expect(orden.mailEnviadoEn).not.toBeNull();
    expect(orden.reenviosCount).toBe(1);
  });

  it(`como mucho ${MAX_REENVIOS_POR_DIA} seguidos por compra; después, 24 horas sin reenviar`, async () => {
    const ev = await evento();
    const { id, llave } = await compra(ev);
    const inicio = Date.now();
    const en = (ms: number) => new Date(inicio + ms);
    await mandarElPrimero(ev, en(0));
    const { cartero, enviados } = carteroDePrueba();
    const reenviar = async (ms: number) => {
      const resultado = await reenviarDeCompra(db, llave, en(ms));
      await enviarMailsPendientes(db, cartero, { eventoId: ev.eventoId, ahora: en(ms + 1000) });
      return resultado;
    };

    // Uno al principio y dos justo antes de que se cumplan 24 horas…
    for (const ms of [10 * MINUTO, 23 * HORA + 58 * MINUTO, 23 * HORA + 59 * MINUTO]) {
      expect(await reenviar(ms)).toMatchObject({ ok: true });
    }
    // …y justo después no salen 3 más: hacen falta 24 horas desde el último.
    expect(await reenviar(24 * HORA + 11 * MINUTO)).toEqual({ ok: false, motivo: "limite", ordenId: id });
    expect(await reenviar(47 * HORA + 58 * MINUTO)).toEqual({ ok: false, motivo: "limite", ordenId: id });
    expect(enviados).toHaveLength(MAX_REENVIOS_POR_DIA);
    expect((await ordenDe(id)).reenviosCount).toBe(MAX_REENVIOS_POR_DIA);

    expect(await reenviar(47 * HORA + 59 * MINUTO)).toMatchObject({ ok: true });
    const orden = await ordenDe(id);
    expect(orden.reenviosCount).toBe(1);
    expect(orden.reenviosDesde).toEqual(en(47 * HORA + 59 * MINUTO));
  });

  it("un solo pedido cuenta una sola vez aunque entre sus dos consultas salga el mail entero", async () => {
    for (const conReenvioAnterior of [false, true]) {
      const ev = await evento();
      const { id, llave } = await compra(ev);
      await mandarElPrimero(ev);
      if (conReenvioAnterior) {
        expect(await reenviarDeCompra(db, llave)).toMatchObject({ ok: true });
        await enviarMailsPendientes(db, carteroDePrueba().cartero, { ordenId: id });
      }
      const antes = (await ordenDe(id)).reenviosCount;

      // Una pausa justo antes de la 2.ª consulta del reenvío…
      let llegoALaSegunda!: () => void;
      const enLaSegunda = new Promise<void>((listo) => (llegoALaSegunda = listo));
      let abrir!: () => void;
      const puerta = new Promise<void>((listo) => (abrir = listo));
      let consultas = 0;
      const conPausa = db.$extends({
        query: {
          orden: {
            async updateManyAndReturn({ args, query }) {
              if (++consultas === 2) {
                llegoALaSegunda();
                await puerta;
              }
              return query(args);
            },
          },
        },
      }) as unknown as PrismaClient;
      const pedido = reenviarDeCompra(conPausa, llave);
      await enLaSegunda;
      // …y mientras tanto otro envío (la tarea diaria, el panel) manda todo lo que falta.
      const { cartero, enviados } = carteroDePrueba();
      await enviarMailsPendientes(db, cartero, { ordenId: id });
      abrir();
      expect(await pedido).toMatchObject({ ok: true });
      await enviarMailsPendientes(db, cartero, { ordenId: id });

      expect(enviados).toHaveLength(1);
      expect((await ordenDe(id)).reenviosCount).toBe(antes + 1);
    }
  });

  it("no reenvía un mail que se está mandando o que está por salir solo (y no gasta reenvíos)", async () => {
    const ev = await evento();
    const { id, llave } = await compra(ev);

    // Recién pagada: el mail está por salir.
    expect(await reenviarDeCompra(db, llave)).toEqual({ ok: false, motivo: "ya_sale", ordenId: id });

    // Falló una vez y ahora lo están volviendo a intentar (un envío lento, en curso).
    await enviarMailsPendientes(db, carteroDePrueba({ fallar: FALLA_DE_CONEXION }).cartero, { ordenId: id });
    const { mailReintentarDesde } = await ordenDe(id);
    const lento = carteroDePrueba({ demora: 500 });
    const reintento = enviarMailsPendientes(db, lento.cartero, { ordenId: id, ahora: new Date(mailReintentarDesde!.getTime() + 1000) });
    await dormir(150);
    expect(await reenviarDeCompra(db, llave)).toEqual({ ok: false, motivo: "ya_sale", ordenId: id });
    expect(await reintento).toEqual({ enviados: 1, fallidos: 0 });
    expect(lento.enviados).toHaveLength(1);
    expect((await ordenDe(id)).reenviosCount).toBe(0);
  });

  it("justo después de un intento que falló se puede pedir de nuevo (no dice que ya sale) y sale enseguida", async () => {
    const ev = await evento();
    const { id, llave } = await compra(ev);
    expect(await enviarMailsPendientes(db, carteroDePrueba({ fallar: FALLA_DE_CONEXION }).cartero, { ordenId: id })).toEqual({
      enviados: 0,
      fallidos: 1,
    });

    expect(await reenviarDeCompra(db, llave)).toMatchObject({ ok: true });
    expect(await ordenDe(id)).toMatchObject({ mailIntentos: 0, mailError: null, mailIntentoEn: null, reenviosCount: 1 });
    const { cartero, enviados } = carteroDePrueba();
    expect(await enviarMailsPendientes(db, cartero, { ordenId: id })).toEqual({ enviados: 1, fallidos: 0 });
    expect(enviados).toHaveLength(1);
  });

  it("un intento colgado que termina tarde no pisa el reenvío pedido mientras tanto", async () => {
    const ev = await evento();
    const { id, llave } = await compra(ev);
    // Ya falló 4 veces; el 5.º intento arrancó hace 3 minutos y sigue colgado.
    await db.orden.update({
      where: { id },
      data: { mailIntentos: MAX_INTENTOS - 1, mailError: "x", mailReintentarDesde: new Date(Date.now() - HORA) },
    });
    // El servidor de mail se cuelga en ese intento y termina fallando; después anda.
    const enviados: Mensaje[] = [];
    let intentos = 0;
    const cartero: Cartero = {
      async enviar(mensaje) {
        if (++intentos === 1) {
          await dormir(600);
          throw Object.assign(new Error("x"), { code: "ETIMEDOUT" });
        }
        enviados.push(mensaje);
      },
    };
    const vuelta = enviarMailsPendientes(db, cartero, { ordenId: id, ahora: new Date(Date.now() - 3 * MINUTO) });
    await dormir(200);
    // Pasó más de lo que puede durar un intento: se puede pedir de nuevo.
    expect(await reenviarDeCompra(db, llave)).toMatchObject({ ok: true });
    // El intento colgado termina fallando, pero no pisa el pedido nuevo: sale
    // enseguida (si lo pisara, esperaría 4 horas al próximo reintento).
    await vuelta;
    await enviarMailsPendientes(db, cartero, { ordenId: id });
    expect(enviados).toHaveLength(1);
    expect(await ordenDe(id)).toMatchObject({ mailEnviadoEn: expect.any(Date), mailError: null });
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

    // Las dos compras, en un solo mail.
    const { cartero, enviados } = carteroDePrueba();
    await enviarMailsPendientes(db, cartero, { eventoId: ev.eventoId });
    expect(enviados).toHaveLength(1);
    expect(enviados[0].para).toBe("comprador@ejemplo.com");
    expect(enviados[0].asunto).toMatch(/^Te reenviamos tus entradas para Fiesta del reenvío \(compras N° \d+ y \d+\)$/);
    expect(enviados[0].adjuntos.filter((a) => a.tipo === "image/png")).toHaveLength(3);
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

  it("todo a la vez (reenvíos por los dos caminos, envíos y 'Reintentar'): cada reenvío contado es exactamente un mail", async () => {
    for (let ronda = 0; ronda < 12; ronda++) {
      const ev = await evento();
      const { id, llave } = await compra(ev);
      const { cartero, enviados } = carteroDePrueba({ demora: () => Math.random() * 30 });
      await enviarMailsPendientes(db, cartero, { ordenId: id });
      let marcados = 0;
      await Promise.all(
        Array.from({ length: 8 }, async () => {
          await dormir(Math.random() * 60);
          const azar = Math.random();
          if (azar < 0.35) {
            if ((await reenviarDeCompra(db, llave)).ok) marcados++;
          } else if (azar < 0.7) {
            const resultado = await reenviarPorEmailYDni(db, ev.eventoId, "comprador@ejemplo.com", "30111220");
            if (resultado.ok) marcados += resultado.reenviadas.length;
          } else if (azar < 0.8) {
            await reintentarMailsDelEvento(db, ev.eventoId, cartero);
          } else {
            await enviarMailsPendientes(db, cartero, azar < 0.9 ? { ordenId: id } : { eventoId: ev.eventoId });
          }
        }),
      );
      await enviarMailsPendientes(db, cartero, { ordenId: id });
      const orden = await ordenDe(id);
      expect(orden.mailEnviadoEn).not.toBeNull();
      expect(orden.reenviosCount).toBe(marcados);
      expect(orden.reenviosCount).toBeLessThanOrEqual(MAX_REENVIOS_POR_DIA);
      expect(enviados).toHaveLength(1 + marcados);
    }
  }, 60_000);

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
