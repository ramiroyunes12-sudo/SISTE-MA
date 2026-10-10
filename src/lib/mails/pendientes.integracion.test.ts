// El envío del mail con las entradas, contra un PostgreSQL de verdad: sale
// una sola vez (aunque haya dos envíos a la vez), se reintenta si falla y el
// motivo guardado no tiene datos de la persona. Solo corre si está
// TEST_DATABASE_URL. Cada prueba manda solo los mails de su evento.
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { EstadoEntrada, EstadoOrden } from "@/generated/prisma/client";
import { PrismaClient } from "@/generated/prisma/client";
import { nuevoCodigo } from "@/lib/entradas/codigo";

import type { Cartero, Mensaje } from "./cartero";
import {
  DURACION_MAXIMA_ENVIO_MS,
  enviarMailsPendientes,
  MAX_COMPRAS_POR_MAIL,
  ESPERA_LIMITE_DIARIO_MS,
  ESPERAS_MS,
  estadoDelMail,
  estadoDeLosMails,
  MAX_INTENTOS,
  reintentarMailsDelEvento,
} from "./pendientes";

const url = process.env.TEST_DATABASE_URL;
const MINUTO = 60_000;
const HORA = 60 * MINUTO;

const dormir = (ms: number) => new Promise((listo) => setTimeout(listo, ms));

// Un cartero de mentira: anota lo que manda. `fallar`: tira ese error;
// `demora`: tarda en "mandarlo" (para probar dos envíos a la vez).
function carteroDePrueba(opciones: { fallar?: unknown; demora?: number } = {}) {
  const enviados: Mensaje[] = [];
  const cartero: Cartero = {
    async enviar(mensaje) {
      if (opciones.demora) await new Promise((listo) => setTimeout(listo, opciones.demora));
      if (opciones.fallar !== undefined) throw opciones.fallar;
      enviados.push(mensaje);
    },
  };
  return { cartero, enviados };
}

describe.skipIf(!url)("Mail con las entradas", () => {
  let db: PrismaClient;
  let anterior: string | undefined;

  beforeAll(() => {
    anterior = process.env.CLAVE_CODIGOS;
    process.env.CLAVE_CODIGOS = "clave-de-prueba-de-los-tests-con-mas-de-32-caracteres";
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });

  afterAll(async () => {
    if (anterior === undefined) delete process.env.CLAVE_CODIGOS;
    else process.env.CLAVE_CODIGOS = anterior;
    await db?.$disconnect();
  });

  // Un evento propio (con su productora) para cada prueba.
  async function evento() {
    const productora = await db.productora.create({ data: { nombre: `Productora ${crypto.randomUUID()}` } });
    const creado = await db.evento.create({
      data: {
        productoraId: productora.id,
        slug: `mail-${crypto.randomUUID()}`,
        nombre: "Fiesta <del> mail",
        fecha: new Date("2030-01-01T23:00:00-03:00"),
        lugar: "Club",
        tipos: { create: { nombre: "General", lotes: { create: { nombre: "Lote 2", numero: 2, precioCentavos: 1000, cupo: 100 } } } },
      },
      include: { tipos: { include: { lotes: true } } },
    });
    return { eventoId: creado.id, tipoId: creado.tipos[0].id, loteId: creado.tipos[0].lotes[0].id };
  }

  // Por defecto, todas de la misma persona (comprador@ejemplo.com): las que
  // faltan a la vez salen juntas en un mail. Para personas distintas, otro email.
  async function compra(
    ev: { eventoId: string; tipoId: string; loteId: string },
    estado: EstadoOrden = "PAGADA",
    entradas: EstadoEntrada[] = ["VALIDA", "VALIDA"],
    email = "comprador@ejemplo.com",
  ) {
    const pagada = estado === "PAGADA" || estado === "REEMBOLSADA";
    const orden = await db.orden.create({
      data: {
        eventoId: ev.eventoId,
        estado,
        email,
        totalCentavos: 1000 * entradas.length,
        pagadaEn: pagada ? new Date() : null,
      },
    });
    for (const [i, estadoEntrada] of entradas.entries()) {
      await db.entrada.create({
        data: {
          ordenId: orden.id,
          eventoId: ev.eventoId,
          tipoEntradaId: ev.tipoId,
          loteId: ev.loteId,
          codigo: nuevoCodigo(),
          precioCentavos: 1000,
          estado: estadoEntrada,
          titular: `Persona ${i + 1}`,
          dni: `3011122${i}`,
        },
      });
    }
    return orden.id;
  }

  const mailDe = (id: string) =>
    db.orden.findUniqueOrThrow({
      where: { id },
      select: { mailEnviadoEn: true, mailIntentos: true, mailError: true, mailIntentoEn: true, mailReintentarDesde: true },
    });

  it("manda el mail de una compra paga una sola vez, con los QR y los PDF", async () => {
    const ev = await evento();
    const id = await compra(ev);
    const { cartero, enviados } = carteroDePrueba();

    expect(await enviarMailsPendientes(db, cartero, { eventoId: ev.eventoId })).toEqual({ enviados: 1, fallidos: 0 });
    expect(await enviarMailsPendientes(db, cartero, { eventoId: ev.eventoId })).toEqual({ enviados: 0, fallidos: 0 });
    expect(enviados).toHaveLength(1);

    const [mensaje] = enviados;
    expect(mensaje.para).toBe("comprador@ejemplo.com");
    expect(mensaje.asunto).toMatch(/^Tus entradas para Fiesta <del> mail \(compra N° \d+\)$/);
    // 2 QR dentro del mail + el PDF con todas + uno por persona.
    expect(mensaje.adjuntos.map((a) => a.archivo)).toEqual([
      expect.stringMatching(/^qr-entrada-1-compra-\d+\.png$/),
      expect.stringMatching(/^qr-entrada-2-compra-\d+\.png$/),
      expect.stringMatching(/^entradas-compra-\d+\.pdf$/),
      expect.stringMatching(/^entrada-1-compra-\d+\.pdf$/),
      expect.stringMatching(/^entrada-2-compra-\d+\.pdf$/),
    ]);
    expect(mensaje.html).toContain("General · Lote 2");
    expect(mensaje.html).toContain("Fiesta &lt;del&gt; mail");

    const guardado = await mailDe(id);
    expect(guardado.mailEnviadoEn).not.toBeNull();
    expect(guardado.mailIntentos).toBe(1);
    expect(guardado.mailError).toBeNull();
  });

  it("las compras que faltan de una misma persona (mismo email) en el evento salen juntas en un solo mail", async () => {
    const ev = await evento();
    const otroEvento = await evento();
    const primera = await compra(ev, "PAGADA", ["VALIDA"]);
    const segunda = await compra(ev, "PAGADA", ["VALIDA", "ANULADA", "VALIDA"]);
    const deOtraPersona = await compra(ev, "PAGADA", ["VALIDA"], "otra@ejemplo.com");
    const deOtroEvento = await compra(otroEvento, "PAGADA", ["VALIDA"]);
    const { cartero, enviados } = carteroDePrueba();

    // Pedida por una sola (como la página de la compra): sale con la otra de la
    // misma persona. La cuenta es de compras (como la lista del panel).
    expect(await enviarMailsPendientes(db, cartero, { ordenId: primera })).toEqual({ enviados: 2, fallidos: 0 });
    expect(enviados).toHaveLength(1);
    const [mail] = enviados;
    const [n1, n2] = await Promise.all([primera, segunda].map(async (id) => (await db.orden.findUniqueOrThrow({ where: { id } })).numero));
    expect(mail.para).toBe("comprador@ejemplo.com");
    expect(mail.asunto).toBe(`Tus entradas para Fiesta <del> mail (compras N° ${n1} y ${n2})`);
    expect(mail.html).toContain(`Acá están tus 3 entradas (compras N° ${n1} y ${n2}).`);
    // Cada entrada dice de qué compra es (la 2 de la segunda está anulada: no va).
    expect(mail.html).toContain(`COMPRA N° ${n1}<`);
    expect(mail.html).toContain(`COMPRA N° ${n2} · ENTRADA 1 DE 3`);
    expect(mail.html).toContain(`COMPRA N° ${n2} · ENTRADA 3 DE 3`);
    expect(mail.adjuntos.map((a) => a.archivo)).toEqual([
      `qr-entrada-1-compra-${n1}.png`,
      `qr-entrada-1-compra-${n2}.png`,
      `qr-entrada-3-compra-${n2}.png`,
      `entradas-compras-${n1}-${n2}.pdf`,
      `entrada-1-compra-${n1}.pdf`,
      `entrada-1-compra-${n2}.pdf`,
      `entrada-3-compra-${n2}.pdf`,
    ]);
    for (const id of [primera, segunda]) expect((await mailDe(id)).mailEnviadoEn).not.toBeNull();
    for (const id of [deOtraPersona, deOtroEvento]) expect((await mailDe(id)).mailEnviadoEn).toBeNull();

    // Las otras: cada persona y cada evento, su mail.
    expect(await enviarMailsPendientes(db, cartero, { eventoId: ev.eventoId })).toEqual({ enviados: 1, fallidos: 0 });
    expect(await enviarMailsPendientes(db, cartero, { eventoId: otroEvento.eventoId })).toEqual({ enviados: 1, fallidos: 0 });
    expect(enviados.map((m) => m.para)).toEqual(["comprador@ejemplo.com", "otra@ejemplo.com", "comprador@ejemplo.com"]);
  });

  it(`como mucho ${MAX_COMPRAS_POR_MAIL} compras por mail: las que siguen, en otro`, async () => {
    const ev = await evento();
    const ids: string[] = [];
    for (let i = 0; i < MAX_COMPRAS_POR_MAIL + 2; i++) ids.push(await compra(ev, "PAGADA", ["VALIDA"]));
    const { cartero, enviados } = carteroDePrueba();
    expect(await enviarMailsPendientes(db, cartero, { eventoId: ev.eventoId })).toEqual({ enviados: MAX_COMPRAS_POR_MAIL + 2, fallidos: 0 });
    expect(enviados.map((m) => m.adjuntos.filter((a) => a.tipo === "image/png").length)).toEqual([MAX_COMPRAS_POR_MAIL, 2]);
    for (const id of ids) expect((await mailDe(id)).mailIntentos).toBe(1);
  });

  it("varios envíos a la vez con compras de la misma persona: cada compra sale una sola vez", async () => {
    const ev = await evento();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await compra(ev, "PAGADA", ["VALIDA"]));
    const { cartero, enviados } = carteroDePrueba({ demora: 100 });
    await Promise.all([
      enviarMailsPendientes(db, cartero, { eventoId: ev.eventoId }),
      ...ids.map((ordenId) => enviarMailsPendientes(db, cartero, { ordenId })),
    ]);
    // Cada QR (una entrada por compra) aparece en un solo mail.
    const qrs = enviados.flatMap((m) => m.adjuntos.filter((a) => a.tipo === "image/png").map((a) => a.archivo));
    expect(qrs).toHaveLength(5);
    expect(new Set(qrs).size).toBe(5);
    for (const id of ids) expect(await mailDe(id)).toMatchObject({ mailIntentos: 1, mailEnviadoEn: expect.any(Date) });
  });

  it("si el mail de varias compras falla, fallan juntas y se reintentan juntas", async () => {
    const ev = await evento();
    const ids = [await compra(ev, "PAGADA", ["VALIDA"]), await compra(ev, "PAGADA", ["VALIDA"])];
    const ahora = new Date();
    const fallando = carteroDePrueba({ fallar: Object.assign(new Error("x"), { code: "ECONNECTION" }) });
    expect(await enviarMailsPendientes(db, fallando.cartero, { eventoId: ev.eventoId, ahora })).toEqual({ enviados: 0, fallidos: 2 });
    const [a, b] = await Promise.all(ids.map(mailDe));
    expect(a.mailError).toBe(b.mailError);
    expect(a.mailReintentarDesde).toEqual(b.mailReintentarDesde);

    const andando = carteroDePrueba();
    const despues = new Date(a.mailReintentarDesde!.getTime() + 1000);
    expect(await enviarMailsPendientes(db, andando.cartero, { eventoId: ev.eventoId, ahora: despues })).toEqual({ enviados: 2, fallidos: 0 });
    expect(andando.enviados).toHaveLength(1);
  });

  it("una compra recién pagada no espera horas por otra de su mail que viene fallando", async () => {
    const ev = await evento();
    const vieja = await compra(ev, "PAGADA", ["VALIDA"]);
    await db.orden.update({
      where: { id: vieja },
      data: { mailIntentos: MAX_INTENTOS - 1, mailError: "x", mailReintentarDesde: new Date(Date.now() - MINUTO) },
    });
    const nueva = await compra(ev, "PAGADA", ["VALIDA"]);
    const ahora = new Date();
    const fallando = carteroDePrueba({ fallar: Object.assign(new Error("x"), { code: "ECONNECTION" }) });
    expect(await enviarMailsPendientes(db, fallando.cartero, { eventoId: ev.eventoId, ahora })).toEqual({ enviados: 0, fallidos: 2 });
    // La vieja llegó al último intento; la nueva se reintenta en 5 minutos (no en 4 horas).
    expect((await mailDe(vieja)).mailIntentos).toBe(MAX_INTENTOS);
    const { mailReintentarDesde } = await mailDe(nueva);
    expect(mailReintentarDesde!.getTime() - ahora.getTime()).toBeLessThan(ESPERAS_MS[0] + 30_000);
  });

  it("tomar las compras de un mail no se traba con otro que las bloquea en otro orden (como 'Reintentar')", async () => {
    const ev = await evento();
    const a = await compra(ev, "PAGADA", ["VALIDA"]);
    const b = await compra(ev, "PAGADA", ["VALIDA"]);
    const { cartero, enviados } = carteroDePrueba();
    let envio: ReturnType<typeof enviarMailsPendientes> | undefined;
    await db.$transaction(
      async (tx) => {
        // Otro (por ejemplo "Reintentar" del panel) bloquea primero la b…
        await tx.$queryRaw`SELECT id FROM entradas.ordenes WHERE id = ${b}::uuid FOR UPDATE`;
        // …el envío arranca por la a y también quiere la b…
        envio = enviarMailsPendientes(db, cartero, { ordenId: a });
        await dormir(400);
        // …y el otro después quiere la a. Si el envío las tomara a las dos en
        // una sola consulta, se trabarían (y Postgres cortaría a uno).
        await tx.$queryRaw`SELECT id FROM entradas.ordenes WHERE id = ${a}::uuid FOR UPDATE`;
      },
      { timeout: 15_000 },
    );
    expect(await envio).toEqual({ enviados: 2, fallidos: 0 });
    expect(enviados).toHaveLength(1);
  });

  it("si la base se cae justo después de mandar, la compra que salió queda anotada (no sale otra vez)", async () => {
    const ev = await evento();
    const conEntradas = await compra(ev, "PAGADA", ["VALIDA"]);
    await compra(ev, "PAGADA", ["ANULADA"]); // de la misma persona, sin nada para mandar
    const conFalla = db.$extends({
      query: {
        orden: {
          async updateMany({ args, query }) {
            if ((args.data as { mailError?: unknown }).mailError === "No tiene entradas para mandar.") throw new Error("se cayó la base");
            return query(args);
          },
        },
      },
    }) as unknown as PrismaClient;
    const { cartero, enviados } = carteroDePrueba();
    await expect(enviarMailsPendientes(conFalla, cartero, { eventoId: ev.eventoId })).rejects.toThrow("se cayó la base");
    expect(enviados).toHaveLength(1);
    expect((await mailDe(conEntradas)).mailEnviadoEn).not.toBeNull();
    // Pasado lo que puede durar un intento, no vuelve a salir.
    await enviarMailsPendientes(db, cartero, { eventoId: ev.eventoId, ahora: new Date(Date.now() + DURACION_MAXIMA_ENVIO_MS + 1000) });
    expect(enviados).toHaveLength(1);
  });

  it("dos envíos a la vez no mandan el mismo mail dos veces", async () => {
    const ev = await evento();
    await compra(ev);
    const { cartero, enviados } = carteroDePrueba({ demora: 200 });
    const resultados = await Promise.all([
      enviarMailsPendientes(db, cartero, { eventoId: ev.eventoId }),
      enviarMailsPendientes(db, cartero, { eventoId: ev.eventoId }),
      enviarMailsPendientes(db, cartero, { eventoId: ev.eventoId }),
    ]);
    expect(enviados).toHaveLength(1);
    expect(resultados.reduce((suma, r) => suma + r.enviados, 0)).toBe(1);
  });

  it("si falla, guarda el motivo (sin el email) y lo reintenta recién después de la espera", async () => {
    const ev = await evento();
    const id = await compra(ev);
    const ahora = new Date();
    const error = Object.assign(new Error("550 5.1.1 <comprador@ejemplo.com>: Recipient address rejected"), {
      code: "EENVELOPE",
      responseCode: 550,
    });

    const fallando = carteroDePrueba({ fallar: error });
    expect(await enviarMailsPendientes(db, fallando.cartero, { eventoId: ev.eventoId, ahora })).toEqual({ enviados: 0, fallidos: 1 });
    let guardado = await mailDe(id);
    expect(guardado.mailEnviadoEn).toBeNull();
    expect(guardado.mailIntentos).toBe(1);
    expect(guardado.mailError).toMatch(/no aceptó el destinatario/);
    expect(guardado.mailError).not.toContain("comprador");

    const andando = carteroDePrueba();
    const despues = (ms: number) => ({ eventoId: ev.eventoId, ahora: new Date(ahora.getTime() + ms) });
    expect(await enviarMailsPendientes(db, andando.cartero, despues(MINUTO))).toEqual({ enviados: 0, fallidos: 0 });
    expect(await enviarMailsPendientes(db, andando.cartero, despues(ESPERAS_MS[0] + 1000))).toEqual({ enviados: 1, fallidos: 0 });
    guardado = await mailDe(id);
    expect(guardado.mailEnviadoEn).not.toBeNull();
    expect(guardado.mailIntentos).toBe(2);
    expect(guardado.mailError).toBeNull();
  });

  it("un error que no es del servidor de mail tampoco guarda datos de la persona", async () => {
    const ev = await evento();
    const id = await compra(ev);
    const { cartero } = carteroDePrueba({ fallar: new Error("algo con comprador@ejemplo.com y Persona 1") });
    await enviarMailsPendientes(db, cartero, { eventoId: ev.eventoId });
    const { mailError } = await mailDe(id);
    expect(mailError).toBe("Falló al armar o mandar el mail.");
  });

  it(`después de ${MAX_INTENTOS} intentos no se reintenta solo; "Reintentar" lo vuelve a intentar`, async () => {
    const ev = await evento();
    const id = await compra(ev);
    const ahora = Date.now();
    const fallando = carteroDePrueba({ fallar: Object.assign(new Error("x"), { code: "ECONNECTION" }) });
    // Cada vuelta, pasada la espera más larga.
    for (let i = 0; i < MAX_INTENTOS + 1; i++) {
      await enviarMailsPendientes(db, fallando.cartero, { eventoId: ev.eventoId, ahora: new Date(ahora + i * 5 * HORA) });
    }
    let guardado = await mailDe(id);
    expect(guardado.mailIntentos).toBe(MAX_INTENTOS);
    expect(guardado.mailError).toBe("No se pudo conectar con el servidor de mail.");

    const andando = carteroDePrueba();
    const tarde = new Date(ahora + 50 * HORA);
    expect(await enviarMailsPendientes(db, andando.cartero, { eventoId: ev.eventoId, ahora: tarde })).toEqual({ enviados: 0, fallidos: 0 });

    expect(await reintentarMailsDelEvento(db, ev.eventoId, andando.cartero, tarde)).toEqual({ enviados: 1, fallidos: 0 });
    guardado = await mailDe(id);
    expect(guardado.mailEnviadoEn).not.toBeNull();
    expect(andando.enviados).toHaveLength(1);
  });

  it("cada intento que falla espera más que el anterior", async () => {
    const ev = await evento();
    const id = await compra(ev);
    const fallando = carteroDePrueba({ fallar: Object.assign(new Error("x"), { code: "ECONNECTION" }) });
    let ahora = Date.now();
    for (const espera of ESPERAS_MS) {
      await enviarMailsPendientes(db, fallando.cartero, { eventoId: ev.eventoId, ahora: new Date(ahora) });
      const { mailReintentarDesde } = await mailDe(id);
      expect(mailReintentarDesde!.getTime() - ahora).toBeGreaterThanOrEqual(espera);
      expect(mailReintentarDesde!.getTime() - ahora).toBeLessThan(espera + 10_000);
      // Un minuto antes de la espera, no lo intenta.
      expect(await enviarMailsPendientes(db, fallando.cartero, { eventoId: ev.eventoId, ahora: new Date(ahora + espera - MINUTO) })).toEqual({
        enviados: 0,
        fallidos: 0,
      });
      ahora = mailReintentarDesde!.getTime();
    }
    expect((await mailDe(id)).mailIntentos).toBe(ESPERAS_MS.length);
  });

  it("el límite diario de la cuenta no gasta intentos: espera una hora", async () => {
    const ev = await evento();
    const id = await compra(ev);
    const ahora = Date.now();
    const limite = Object.assign(new Error("x"), { responseCode: 550, response: "550-5.4.5 Daily user sending limit exceeded." });
    const fallando = carteroDePrueba({ fallar: limite });
    for (let i = 0; i < MAX_INTENTOS + 2; i++) {
      expect(
        await enviarMailsPendientes(db, fallando.cartero, { eventoId: ev.eventoId, ahora: new Date(ahora + i * ESPERA_LIMITE_DIARIO_MS + i * 1000) }),
      ).toEqual({ enviados: 0, fallidos: 1 });
    }
    const guardado = await mailDe(id);
    expect(guardado.mailIntentos).toBe(0);
    expect(guardado.mailError).toMatch(/límite de mails por día/);
    const andando = carteroDePrueba();
    const despues = new Date(guardado.mailReintentarDesde!.getTime() + 1000);
    expect(await enviarMailsPendientes(db, andando.cartero, { eventoId: ev.eventoId, ahora: despues })).toEqual({ enviados: 1, fallidos: 0 });
  });

  it("en una ráfaga de pagos no queda ningún mail sin intentar", async () => {
    const ev = await evento();
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) ids.push(await compra(ev, "PAGADA", ["VALIDA"], `persona${i}@ejemplo.com`));
    const { cartero, enviados } = carteroDePrueba({ demora: 20 });
    await Promise.all(ids.map(() => enviarMailsPendientes(db, cartero, { eventoId: ev.eventoId })));
    expect(enviados).toHaveLength(25);
    for (const id of ids) expect((await mailDe(id)).mailIntentos).toBe(1);
  });

  it("cada compra se toma con la hora en que de verdad empieza su envío (no la de la vuelta)", async () => {
    const ev = await evento();
    const ids: string[] = [];
    for (const email of ["a@ejemplo.com", "b@ejemplo.com", "c@ejemplo.com"]) ids.push(await compra(ev, "PAGADA", ["VALIDA"], email));
    const ahora = new Date();
    const { cartero } = carteroDePrueba({ demora: 300 });
    await enviarMailsPendientes(db, cartero, { eventoId: ev.eventoId, ahora });
    const tomadas = await Promise.all(ids.map(async (id) => (await mailDe(id)).mailIntentoEn!.getTime() - ahora.getTime()));
    expect(Math.max(...tomadas)).toBeGreaterThanOrEqual(550);
  });

  it('"Reintentar" no toca un envío que está en curso', async () => {
    const ev = await evento();
    const id = await compra(ev);
    const ahora = new Date();
    // Alguien lo empezó a mandar hace 30 segundos.
    await db.orden.update({ where: { id }, data: { mailIntentoEn: new Date(ahora.getTime() - 30_000), mailIntentos: 1 } });
    const { cartero, enviados } = carteroDePrueba();
    expect(await reintentarMailsDelEvento(db, ev.eventoId, cartero, ahora)).toEqual({ enviados: 0, fallidos: 0 });
    expect(enviados).toHaveLength(0);
    // Pasado lo que puede durar un envío, sí.
    const luego = new Date(ahora.getTime() + DURACION_MAXIMA_ENVIO_MS);
    expect(await reintentarMailsDelEvento(db, ev.eventoId, cartero, luego)).toEqual({ enviados: 1, fallidos: 0 });
  });

  it("no manda compras sin pagar ni devueltas, y una pedida por id manda solo esa (y las de su misma persona)", async () => {
    const ev = await evento();
    const pendiente = await compra(ev, "PENDIENTE", ["PENDIENTE"]);
    const devuelta = await compra(ev, "REEMBOLSADA", ["ANULADA"]);
    const una = await compra(ev);
    const otra = await compra(ev, "PAGADA", ["VALIDA"], "otra@ejemplo.com");
    const { cartero, enviados } = carteroDePrueba();
    expect(await enviarMailsPendientes(db, cartero, { ordenId: una })).toEqual({ enviados: 1, fallidos: 0 });
    expect((await mailDe(otra)).mailEnviadoEn).toBeNull();
    expect(await enviarMailsPendientes(db, cartero, { eventoId: ev.eventoId })).toEqual({ enviados: 1, fallidos: 0 });
    expect(enviados).toHaveLength(2);
    expect((await mailDe(pendiente)).mailIntentos).toBe(0);
    expect((await mailDe(devuelta)).mailIntentos).toBe(0);
  });

  it("sin configurar (sin cartero o sin CLAVE_CODIGOS) no gasta intentos", async () => {
    const ev = await evento();
    const id = await compra(ev);
    expect(await enviarMailsPendientes(db, null, { eventoId: ev.eventoId })).toEqual({ enviados: 0, fallidos: 0, sinConfigurar: true });
    const clave = process.env.CLAVE_CODIGOS;
    delete process.env.CLAVE_CODIGOS;
    try {
      const { cartero } = carteroDePrueba();
      expect(await enviarMailsPendientes(db, cartero, { eventoId: ev.eventoId })).toEqual({ enviados: 0, fallidos: 0, sinConfigurar: true });
    } finally {
      process.env.CLAVE_CODIGOS = clave;
    }
    expect((await mailDe(id)).mailIntentos).toBe(0);
  });

  it("una compra paga sin entradas para mandar (todas anuladas) no se reintenta", async () => {
    const ev = await evento();
    const id = await compra(ev, "PAGADA", ["ANULADA"]);
    const { cartero, enviados } = carteroDePrueba();
    expect(await enviarMailsPendientes(db, cartero, { eventoId: ev.eventoId })).toEqual({ enviados: 0, fallidos: 1 });
    expect(enviados).toHaveLength(0);
    const guardado = await mailDe(id);
    expect(guardado.mailIntentos).toBe(MAX_INTENTOS);
    expect(guardado.mailError).toBe("No tiene entradas para mandar.");
  });

  it("la página de la compra paga dice si el mail salió (y nada si no está configurado o es de antes)", async () => {
    const ev = await evento();
    const id = await compra(ev);
    const vieja = await compra(ev);
    // Como las que marcó la migración: 5 intentos sin ningún intento de verdad.
    await db.orden.update({ where: { id: vieja }, data: { mailIntentos: MAX_INTENTOS, mailError: "Se pagó antes." } });
    const smtp = { SMTP_HOST: "smtp.ejemplo.com", SMTP_USUARIO: "plataforma@ejemplo.com", SMTP_CLAVE: "clave" };
    const anteriores = Object.fromEntries(Object.keys(smtp).map((k) => [k, process.env[k]]));
    try {
      expect(await estadoDelMail(db, id)).toBe("nada"); // sin servidor de mail
      Object.assign(process.env, smtp);
      expect(await estadoDelMail(db, id)).toBe("enviando");
      expect(await estadoDelMail(db, vieja)).toBe("nada");
      await enviarMailsPendientes(db, carteroDePrueba({ fallar: Object.assign(new Error("x"), { code: "EAUTH" }) }).cartero, { ordenId: id });
      await db.orden.update({ where: { id }, data: { mailIntentos: MAX_INTENTOS } });
      expect(await estadoDelMail(db, id)).toBe("no_salio");
      await reintentarMailsDelEvento(db, ev.eventoId, carteroDePrueba().cartero, new Date(Date.now() + DURACION_MAXIMA_ENVIO_MS));
      expect(await estadoDelMail(db, id)).toBe("enviado");
    } finally {
      for (const [k, v] of Object.entries(anteriores)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it("el panel ve cuántos salieron y cuáles no", async () => {
    const ev = await evento();
    const bien = await compra(ev);
    const mal = await compra(ev, "PAGADA", ["VALIDA", "VALIDA"], "otra@ejemplo.com");
    await enviarMailsPendientes(db, carteroDePrueba().cartero, { ordenId: bien });
    await enviarMailsPendientes(db, carteroDePrueba({ fallar: Object.assign(new Error("x"), { code: "EAUTH" }) }).cartero, { ordenId: mal });
    const estado = await estadoDeLosMails(db, ev.eventoId, new Date(Date.now() + DURACION_MAXIMA_ENVIO_MS + 1000));
    expect(estado.enviados).toBe(1);
    expect(estado.cuantosSinEnviar).toBe(1);
    expect(estado.sinEnviar).toEqual([
      expect.objectContaining({
        id: mal,
        intentos: 1,
        error: expect.stringMatching(/usuario o la contraseña/),
        enCurso: false,
        reintentaSolo: true,
      }),
    ]);
  });
});
