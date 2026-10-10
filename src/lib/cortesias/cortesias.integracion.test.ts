// Cortesías (paso 19), contra un PostgreSQL de verdad: el cupo (también con
// varias cargas a la vez), un DNI con una sola cortesía por evento, anular
// (también mientras la escanean), el PDF, la puerta y el mail. Solo corre si
// está TEST_DATABASE_URL.
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { Alcance } from "@/lib/auth/alcance";
import { buscarEnLaPuerta, contarIngresos } from "@/lib/entradas/buscar";
import { firmarCodigo } from "@/lib/entradas/codigo";
import { escanearCodigo, marcarEntrada } from "@/lib/entradas/escanear";
import type { Cartero, Mensaje } from "@/lib/mails/cartero";
import { enviarMailsPendientes } from "@/lib/mails/pendientes";
import { reenviarCortesia, reenviarPorEmailYDni } from "@/lib/mails/reenviar";

import {
  anularCortesia,
  type CortesiaParaDar,
  darCortesias,
  eventoParaCortesias,
  filasParaCorregir,
  listarCortesias,
  pdfDeCortesia,
  revisarLista,
} from "./cortesias";

const url = process.env.TEST_DATABASE_URL;
const TODO: Alcance = { todo: true };
const AHORA = new Date("2030-01-01T12:00:00-03:00");
const FECHA = new Date("2030-01-01T23:00:00-03:00");

function carteroDePrueba() {
  const enviados: Mensaje[] = [];
  const cartero: Cartero = {
    async enviar(mensaje) {
      enviados.push(mensaje);
    },
  };
  return { cartero, enviados };
}

describe.skipIf(!url)("cortesías", () => {
  let db: PrismaClient;
  let anterior: { codigos?: string; smtp?: string };

  beforeAll(() => {
    anterior = { codigos: process.env.CLAVE_CODIGOS, smtp: process.env.SMTP_HOST };
    process.env.CLAVE_CODIGOS = "clave-de-prueba-de-los-tests-con-mas-de-32-caracteres";
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });

  afterAll(async () => {
    if (anterior.codigos === undefined) delete process.env.CLAVE_CODIGOS;
    else process.env.CLAVE_CODIGOS = anterior.codigos;
    await db?.$disconnect();
  });

  // Un evento propio (con su productora y su organizador) para cada prueba.
  async function evento(cupo = 10, fecha = FECHA) {
    const productora = await db.productora.create({ data: { nombre: `Productora ${crypto.randomUUID()}` } });
    const creado = await db.evento.create({
      data: {
        productoraId: productora.id,
        slug: `cortesias-${crypto.randomUUID()}`,
        nombre: "Fiesta de cortesías",
        fecha,
        lugar: "Club",
        cupoCortesias: cupo,
        tipos: { create: [{ nombre: "General", orden: 0 }, { nombre: "VIP", orden: 1 }] },
      },
      include: { tipos: { orderBy: { orden: "asc" } } },
    });
    const organizador = await db.usuario.create({
      data: { nombre: "Olga Organiza", email: `${crypto.randomUUID()}@ejemplo.com`, hashContrasena: "x", rol: "ORGANIZADOR", productoraId: productora.id },
    });
    const alcance: Alcance = { todo: false, productoraId: productora.id };
    return {
      eventoId: creado.id,
      general: creado.tipos[0].id,
      vip: creado.tipos[1].id,
      organizador: organizador.id,
      alcance,
      pedido: { eventoId: creado.id, alcance, usuarioId: organizador.id, ahora: AHORA },
    };
  }

  let dniSiguiente = 20_000_000 + Math.floor(Math.random() * 1_000_000) * 10;
  const nuevoDni = () => String(dniSiguiente++);

  function cortesia(tipoId: string, extra: Partial<CortesiaParaDar> = {}): CortesiaParaDar {
    return { nombre: "Persona Invitada", dni: nuevoDni(), email: null, tipoId, ...extra };
  }

  const emitidas = async (eventoId: string) =>
    (await db.evento.findUniqueOrThrow({ where: { id: eventoId }, select: { cortesiasEmitidas: true } })).cortesiasEmitidas;

  it("da cortesías: orden CORTESIA paga y gratis, una entrada válida sin lote, quién la dio; descuenta el cupo", async () => {
    const ev = await evento(5);
    const dadas = await darCortesias(db, ev.pedido, [
      cortesia(ev.vip, { nombre: "Juana Pérez", email: "juana@ejemplo.com" }),
      cortesia(ev.general, { nombre: "Carlos Gómez" }),
    ]);
    expect(dadas).toMatchObject({ ok: true, ordenes: [expect.any(String), expect.any(String)] });
    if (!dadas.ok) return;
    const ordenes = await db.orden.findMany({ where: { id: { in: dadas.ordenes } }, include: { entradas: true } });
    for (const orden of ordenes) {
      expect(orden).toMatchObject({ tipo: "CORTESIA", estado: "PAGADA", totalCentavos: 0, emitidaPorId: ev.organizador, accesoHash: null });
      expect(orden.pagadaEn).toEqual(AHORA);
      expect(orden.entradas).toHaveLength(1);
      expect(orden.entradas[0]).toMatchObject({ estado: "VALIDA", loteId: null, precioCentavos: 0 });
    }
    expect(ordenes.find((o) => o.email === "juana@ejemplo.com")?.entradas[0]).toMatchObject({ titular: "Juana Pérez", tipoEntradaId: ev.vip });
    expect(ordenes.find((o) => o.email === null)?.entradas[0]).toMatchObject({ titular: "Carlos Gómez", tipoEntradaId: ev.general });
    expect(await emitidas(ev.eventoId)).toBe(2);
  });

  it("si no alcanza el cupo no da ninguna (todas o ninguna) y dice cuántas quedan", async () => {
    const ev = await evento(3);
    expect(await darCortesias(db, ev.pedido, [cortesia(ev.general)])).toMatchObject({ ok: true });
    const tres = [cortesia(ev.general), cortesia(ev.general), cortesia(ev.general)];
    expect(await darCortesias(db, ev.pedido, tres)).toEqual({
      ok: false,
      error: "No alcanza el cupo: quedan 2 de 3 y son 3. Podés subir el cupo en Evento y lotes.",
    });
    expect(await emitidas(ev.eventoId)).toBe(1);
    expect(await db.orden.count({ where: { eventoId: ev.eventoId } })).toBe(1);

    const sinCupo = await evento(0);
    expect(await darCortesias(db, sinCupo.pedido, [cortesia(sinCupo.general)])).toMatchObject({
      ok: false,
      error: expect.stringMatching(/no tiene cupo de cortesías/),
    });
  });

  it("muchas cargas a la vez no se pasan del cupo", async () => {
    const ev = await evento(5);
    const resultados = await Promise.all(Array.from({ length: 12 }, () => darCortesias(db, ev.pedido, [cortesia(ev.general)])));
    expect(resultados.filter((r) => r.ok)).toHaveLength(5);
    expect(await emitidas(ev.eventoId)).toBe(5);
    expect(await db.entrada.count({ where: { eventoId: ev.eventoId, estado: "VALIDA" } })).toBe(5);
  });

  it("un DNI tiene una sola cortesía por evento (también con un cero adelante, y aunque lleguen a la vez)", async () => {
    const ev = await evento(20);
    const otro = await evento(20);
    const dni = "4123456";
    expect(await darCortesias(db, ev.pedido, [cortesia(ev.general, { dni })])).toMatchObject({ ok: true });
    expect(await darCortesias(db, ev.pedido, [cortesia(ev.vip, { dni: "04123456" }), cortesia(ev.general)])).toEqual({
      ok: false,
      error: "Ese DNI ya tiene una cortesía para este evento.",
      repetidos: ["04123456"],
    });
    expect(await emitidas(ev.eventoId)).toBe(1);
    // En otro evento, sí.
    expect(await darCortesias(db, otro.pedido, [cortesia(otro.general, { dni })])).toMatchObject({ ok: true });

    // El mismo DNI pedido varias veces a la vez: sale una sola.
    const mismo = nuevoDni();
    const aLaVez = await Promise.all(Array.from({ length: 8 }, () => darCortesias(db, ev.pedido, [cortesia(ev.general, { dni: mismo })])));
    expect(aLaVez.filter((r) => r.ok)).toHaveLength(1);
    expect(await db.entrada.count({ where: { eventoId: ev.eventoId, dni: mismo } })).toBe(1);
    expect(await emitidas(ev.eventoId)).toBe(2);
  });

  it("solo en los eventos de su productora, con tipos del evento, y no después de que terminó", async () => {
    const ev = await evento();
    const ajeno = await evento();
    expect(await darCortesias(db, { ...ev.pedido, eventoId: ajeno.eventoId }, [cortesia(ajeno.general)])).toEqual({
      ok: false,
      error: "Ese evento ya no existe.",
    });
    expect(await eventoParaCortesias(db, ajeno.eventoId, ev.alcance)).toBeNull();
    expect(await darCortesias(db, ev.pedido, [cortesia(ajeno.general)])).toMatchObject({ ok: false, error: expect.stringMatching(/tipo/) });

    const viejo = await evento(10, new Date("2029-12-30T23:00:00-03:00"));
    expect(await darCortesias(db, viejo.pedido, [cortesia(viejo.general)])).toEqual({
      ok: false,
      error: "El evento ya pasó: no se pueden dar más cortesías.",
    });
    expect((await eventoParaCortesias(db, viejo.eventoId, TODO, AHORA))?.terminado).toBe(true);
    expect(await db.orden.count({ where: { eventoId: { in: [ajeno.eventoId, viejo.eventoId] } } })).toBe(0);
  });

  it("revisar la lista: marca los DNI que ya tienen cortesía, cuenta las buenas y deja para corregir las que no", async () => {
    const ev = await evento(10);
    const yaTiene = nuevoDni();
    await darCortesias(db, ev.pedido, [cortesia(ev.general, { dni: yaTiene })]);
    const datos = await eventoParaCortesias(db, ev.eventoId, ev.alcance, AHORA);
    const texto = `Nombre\tDNI\tEmail\tTipo\nJuana Pérez\t${nuevoDni()}\tjuana@ejemplo.com\tVIP\nYa Tenía\t${yaTiene}\t\t\nMal\t12\t\t`;
    const revision = await revisarLista(db, datos!, texto, ev.general);
    expect(revision.ok).toBe(true);
    if (!revision.ok) return;
    expect(revision.validas).toBe(1);
    expect(revision.quedan).toBe(9);
    expect(revision.filas.map((f) => [f.fila, f.errores])).toEqual([
      [2, []],
      [3, ["Ya tiene una cortesía para este evento."]],
      [4, ["Poné nombre y apellido.", "El DNI son 7 u 8 números (con o sin puntos)."]],
    ]);
    expect(filasParaCorregir(revision)).toBe(`Nombre\tDNI\tEmail\tTipo\nYa Tenía\t${yaTiene}\t\t\nMal\t12\t\t`);

    expect(await revisarLista(db, datos!, "  ", ev.general)).toMatchObject({ ok: false });
    const muchas = Array.from({ length: 201 }, (_, i) => `Persona Número\t${30_000_000 + i}`).join("\n");
    expect(await revisarLista(db, datos!, muchas, ev.general)).toEqual({ ok: false, error: "Son 201 personas: cargá hasta 200 por vez." });
  });

  it("anular: la entrada queda ANULADA, la orden CANCELADA y el lugar vuelve al cupo; si ya entró, no", async () => {
    const ev = await evento(2);
    const dadas = await darCortesias(db, ev.pedido, [cortesia(ev.general), cortesia(ev.general)]);
    if (!dadas.ok) throw new Error(dadas.error);
    const [una, otra] = dadas.ordenes;

    expect(await anularCortesia(db, ev.pedido, una)).toEqual({ ok: true });
    expect(await db.orden.findUniqueOrThrow({ where: { id: una }, include: { entradas: true } })).toMatchObject({
      estado: "CANCELADA",
      entradas: [{ estado: "ANULADA" }],
    });
    expect(await emitidas(ev.eventoId)).toBe(1);
    expect(await anularCortesia(db, ev.pedido, una)).toEqual({ ok: false, error: "Ya estaba anulada." });
    expect(await emitidas(ev.eventoId)).toBe(1);

    // Ya entró: no se anula.
    const entrada = await db.entrada.findFirstOrThrow({ where: { ordenId: otra } });
    await marcarEntrada(db, { eventoId: ev.eventoId, alcance: TODO, usuarioId: ev.organizador, entradaId: entrada.id, ahora: AHORA });
    expect(await anularCortesia(db, ev.pedido, otra)).toEqual({ ok: false, error: "Ya entró: no se puede anular." });

    // De otra productora (o una venta, o cualquier cosa): no existe.
    const ajeno = await evento();
    expect(await anularCortesia(db, { ...ajeno.pedido, eventoId: ev.eventoId }, otra)).toEqual({ ok: false, error: "No encontramos esa cortesía." });
    expect(await anularCortesia(db, ev.pedido, "no-es-un-id")).toEqual({ ok: false, error: "No encontramos esa cortesía." });
  });

  it("anular mientras la escanean: gana uno solo (o entra, o queda anulada)", async () => {
    const ev = await evento(30);
    for (let ronda = 0; ronda < 15; ronda++) {
      const dadas = await darCortesias(db, ev.pedido, [cortesia(ev.general)]);
      if (!dadas.ok) throw new Error(dadas.error);
      const [ordenId] = dadas.ordenes;
      const { codigo } = await db.entrada.findFirstOrThrow({ where: { ordenId } });
      const [escaneo, anulada] = await Promise.all([
        escanearCodigo(db, { eventoId: ev.eventoId, alcance: TODO, usuarioId: ev.organizador, texto: firmarCodigo(codigo), ahora: AHORA }),
        anularCortesia(db, ev.pedido, ordenId),
      ]);
      const paso = escaneo?.resultado === "pasa";
      expect(paso !== anulada.ok, `ronda ${ronda}: ${escaneo?.resultado} / ${JSON.stringify(anulada)}`).toBe(true);
      const final = await db.entrada.findFirstOrThrow({ where: { ordenId } });
      expect(final.estado).toBe(paso ? "USADA" : "ANULADA");
    }
  });

  it("en la puerta es una entrada más: PASA dice que es cortesía, se busca por DNI y suma en el contador", async () => {
    const ev = await evento();
    const dni = nuevoDni();
    const dadas = await darCortesias(db, ev.pedido, [cortesia(ev.vip, { nombre: "Lola Invitada", dni })]);
    if (!dadas.ok) throw new Error(dadas.error);
    const { numero } = await db.orden.findUniqueOrThrow({ where: { id: dadas.ordenes[0] } });
    expect(await contarIngresos(db, { eventoId: ev.eventoId, alcance: TODO })).toEqual({ ingresaron: 0, total: 1 });

    const buscado = await buscarEnLaPuerta(db, {
      eventoId: ev.eventoId,
      alcance: TODO,
      usuario: { id: ev.organizador, rol: "ORGANIZADOR" },
      texto: dni,
      ahora: AHORA,
    });
    expect(buscado).toMatchObject({ resultado: "ok", entradas: [{ titular: "Lola Invitada", tipo: "VIP", compra: numero, cortesia: true, ingreso: null }] });

    const { codigo } = await db.entrada.findFirstOrThrow({ where: { ordenId: dadas.ordenes[0] } });
    const escaneo = await escanearCodigo(db, { eventoId: ev.eventoId, alcance: TODO, usuarioId: ev.organizador, texto: firmarCodigo(codigo), ahora: AHORA });
    expect(escaneo).toEqual({ resultado: "pasa", entrada: { titular: "Lola Invitada", dni, tipo: "VIP", compra: numero, cortesia: true } });
    expect(await contarIngresos(db, { eventoId: ev.eventoId, alcance: TODO })).toEqual({ ingresaron: 1, total: 1 });
    const otra = await escanearCodigo(db, { eventoId: ev.eventoId, alcance: TODO, usuarioId: ev.organizador, texto: firmarCodigo(codigo), ahora: AHORA });
    expect(otra).toMatchObject({ resultado: "ya_ingreso", entrada: { cortesia: true } });
  });

  it("la lista del panel: quién, si entró, si salió el mail y quién la dio", async () => {
    const ev = await evento();
    const dadas = await darCortesias(db, ev.pedido, [
      cortesia(ev.general, { nombre: "Sin Email" }),
      cortesia(ev.vip, { nombre: "Con Email", email: "con@ejemplo.com" }),
    ]);
    if (!dadas.ok) throw new Error(dadas.error);
    await anularCortesia(db, ev.pedido, dadas.ordenes[0]);
    const lista = await listarCortesias(db, ev.eventoId, AHORA);
    expect(lista.map((c) => [c.titular, c.tipo, c.estado, c.mail, c.dadaPor])).toEqual([
      ["Con Email", "VIP", "sin_usar", "enviando", "Olga Organiza"],
      ["Sin Email", "General", "anulada", "sin_email", "Olga Organiza"],
    ]);
  });

  it("el PDF: solo de una cortesía del evento y del alcance; dice \"Cortesía\"; una anulada no tiene", async () => {
    const ev = await evento();
    const dadas = await darCortesias(db, ev.pedido, [cortesia(ev.general), cortesia(ev.general)]);
    if (!dadas.ok) throw new Error(dadas.error);
    const { numero } = await db.orden.findUniqueOrThrow({ where: { id: dadas.ordenes[0] } });
    const pdf = await pdfDeCortesia(db, { eventoId: ev.eventoId, alcance: ev.alcance }, dadas.ordenes[0]);
    expect(pdf).toMatchObject({ ok: true, archivo: `cortesia-${numero}.pdf` });
    if (pdf.ok) expect(Buffer.from(pdf.pdf).subarray(0, 5).toString()).toBe("%PDF-");

    const ajeno = await evento();
    expect(await pdfDeCortesia(db, { eventoId: ev.eventoId, alcance: ajeno.alcance }, dadas.ordenes[0])).toEqual({ ok: false, motivo: "no_encontrada" });
    expect(await pdfDeCortesia(db, { eventoId: ajeno.eventoId, alcance: TODO }, dadas.ordenes[0])).toEqual({ ok: false, motivo: "no_encontrada" });
    await anularCortesia(db, ev.pedido, dadas.ordenes[1]);
    expect(await pdfDeCortesia(db, { eventoId: ev.eventoId, alcance: TODO }, dadas.ordenes[1])).toEqual({ ok: false, motivo: "sin_entradas" });
  });

  it("el mail: solo las que tienen email; las de un mismo email van juntas, sin mezclarse con sus compras", async () => {
    const ev = await evento();
    const dadas = await darCortesias(db, ev.pedido, [
      cortesia(ev.vip, { nombre: "Ana Invitada", email: "ana@ejemplo.com" }),
      cortesia(ev.general, { nombre: "Beto Invitado", email: "ana@ejemplo.com" }),
      cortesia(ev.general, { nombre: "Sin Email" }),
    ]);
    if (!dadas.ok) throw new Error(dadas.error);
    // Una compra paga del mismo email en el mismo evento.
    const venta = await db.orden.create({
      data: { eventoId: ev.eventoId, estado: "PAGADA", email: "ana@ejemplo.com", totalCentavos: 1000, pagadaEn: AHORA },
    });
    await db.entrada.create({
      data: {
        ordenId: venta.id,
        eventoId: ev.eventoId,
        tipoEntradaId: ev.general,
        codigo: crypto.randomUUID().replace(/-/g, "").toUpperCase(),
        precioCentavos: 1000,
        estado: "VALIDA",
        titular: "Ana Compradora",
        dni: nuevoDni(),
      },
    });
    const numeros = await Promise.all(dadas.ordenes.map(async (id) => (await db.orden.findUniqueOrThrow({ where: { id } })).numero));
    const { cartero, enviados } = carteroDePrueba();
    expect(await enviarMailsPendientes(db, cartero, { eventoId: ev.eventoId, ahora: AHORA })).toEqual({ enviados: 3, fallidos: 0 });
    expect(enviados).toHaveLength(2);
    const esDeCortesias = (m: Mensaje) => m.asunto.startsWith("Tus entradas de cortesía");
    const mailCortesias = enviados.find(esDeCortesias)!;
    const mailCompra = enviados.find((m) => !esDeCortesias(m))!;
    expect(mailCortesias.asunto).toBe(`Tus entradas de cortesía para Fiesta de cortesías (cortesías N° ${numeros[0]} y ${numeros[1]})`);
    expect(mailCortesias.html).toContain(`Acá están tus 2 entradas de cortesía (cortesías N° ${numeros[0]} y ${numeros[1]}).`);
    expect(mailCortesias.html).toContain(`CORTESÍA N° ${numeros[0]}<`);
    expect(mailCortesias.html).toContain("te dio entradas de cortesía para Fiesta de cortesías.");
    expect(mailCortesias.html).not.toContain("Ana Compradora");
    expect(mailCortesias.adjuntos.map((a) => a.archivo)).toEqual([
      `qr-entrada-1-cortesia-${numeros[0]}.png`,
      `qr-entrada-1-cortesia-${numeros[1]}.png`,
      `cortesias-${numeros[0]}-${numeros[1]}.pdf`,
      `cortesia-${numeros[0]}.pdf`,
      `cortesia-${numeros[1]}.pdf`,
    ]);
    expect(mailCompra.asunto).toMatch(/^Tus entradas para Fiesta de cortesías \(compra N° \d+\)$/);
    expect(mailCompra.html).not.toContain("Ana Invitada");
    expect(await db.orden.findUniqueOrThrow({ where: { id: dadas.ordenes[2] } })).toMatchObject({ mailEnviadoEn: null, mailIntentos: 0 });
  });

  it("reenviar el mail de una cortesía (desde el panel o con email y DNI), con el mismo límite que una compra", async () => {
    process.env.SMTP_HOST = "smtp.ejemplo.com";
    const smtp = { usuario: process.env.SMTP_USUARIO, clave: process.env.SMTP_CLAVE, puerto: process.env.SMTP_PUERTO };
    process.env.SMTP_USUARIO = "plataforma@ejemplo.com";
    process.env.SMTP_CLAVE = "clave";
    process.env.SMTP_PUERTO = "465";
    try {
      const ev = await evento();
      const dni = nuevoDni();
      const dadas = await darCortesias(db, ev.pedido, [
        cortesia(ev.general, { dni, email: "lola@ejemplo.com" }),
        cortesia(ev.general, { email: null }),
      ]);
      if (!dadas.ok) throw new Error(dadas.error);
      const [conEmail, sinEmail] = dadas.ordenes;
      await db.orden.update({ where: { id: conEmail }, data: { mailEnviadoEn: AHORA, mailIntentos: 1 } });

      expect(await reenviarCortesia(db, ev.eventoId, conEmail, AHORA)).toMatchObject({ ok: true, ordenId: conEmail });
      expect(await reenviarCortesia(db, ev.eventoId, conEmail, AHORA)).toMatchObject({ ok: false, motivo: "ya_sale" });
      expect(await reenviarCortesia(db, ev.eventoId, sinEmail, AHORA)).toEqual({ ok: false, motivo: "no_encontrada" });
      const ajeno = await evento();
      expect(await reenviarCortesia(db, ajeno.eventoId, conEmail, AHORA)).toEqual({ ok: false, motivo: "no_encontrada" });

      await db.orden.update({ where: { id: conEmail }, data: { mailEnviadoEn: AHORA } });
      expect(await reenviarPorEmailYDni(db, ev.eventoId, "lola@ejemplo.com", dni, AHORA)).toEqual({ ok: true, reenviadas: [conEmail] });
    } finally {
      for (const [clave, valor] of [
        ["SMTP_HOST", anterior.smtp],
        ["SMTP_USUARIO", smtp.usuario],
        ["SMTP_CLAVE", smtp.clave],
        ["SMTP_PUERTO", smtp.puerto],
      ] as const) {
        if (valor === undefined) delete process.env[clave];
        else process.env[clave] = valor;
      }
    }
  });
});
