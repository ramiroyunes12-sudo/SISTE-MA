// Cobrar contra un PostgreSQL de verdad, con un Mercado Pago de mentira:
// elegir transferencia (monto único) o Mercado Pago (con cargo), ver si entró
// la plata, pagos repetidos, pagos tarde y confirmar a mano. Solo corre si
// está TEST_DATABASE_URL (ver README).
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { liberarVencidas, crearReserva, guardarDatosCompra, MINUTOS_RESERVA } from "@/lib/ventas/ordenes";
import { pedidoATexto } from "@/lib/ventas/pedido";

import {
  confirmarPagoManual,
  elegirMercadoPago,
  elegirTransferencia,
  opcionesDePago,
  procesarAviso,
  procesarPagoMp,
  revisarCobros,
  revisarPagoDeCompra,
} from "./cobros";
import { conectarMercadoPago, cuentaMpDe, type CuentaMp } from "./cuenta";
import { type ApiMercadoPago, type DatosPreferencia, ErrorMercadoPago, type PagoMp } from "./mercadopago";

const url = process.env.TEST_DATABASE_URL;
const MINUTO = 60_000;

// Un Mercado Pago de mentira: los pagos que "entraron" a la cuenta.
function mercadoPagoFalso(mpUsuarioId: string) {
  const pagos: PagoMp[] = [];
  const preferencias: DatosPreferencia[] = [];
  let consultas = 0;
  const api: ApiMercadoPago = {
    async cuenta(token) {
      if (token.includes("malo")) throw new ErrorMercadoPago("Mercado Pago respondió 401", 401);
      return { id: mpUsuarioId, nombre: "CUENTA_PRUEBA" };
    },
    async pago(_token, id) {
      return pagos.find((pago) => pago.id === id) ?? null;
    },
    async pagosRecientes(_token, desde) {
      consultas++;
      return pagos
        .filter((pago) => !pago.creadoEn || pago.creadoEn >= desde)
        .sort((a, b) => (b.creadoEn?.getTime() ?? 0) - (a.creadoEn?.getTime() ?? 0));
    },
    async crearPreferencia(_token, datos) {
      preferencias.push(datos);
      return { id: `pref-${crypto.randomUUID()}`, link: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=x" };
    },
  };
  let n = 0;
  const entra = (montoCentavos: number, extra: Partial<PagoMp> = {}): PagoMp => {
    const pago: PagoMp = {
      id: `${Date.now()}${n++}${Math.floor(Math.random() * 1000)}`,
      estado: "approved",
      tipo: "account_fund",
      montoCentavos,
      comisionCentavos: 0,
      moneda: "ARS",
      cobradorId: mpUsuarioId,
      referencia: null,
      creadoEn: new Date(),
      ...extra,
    };
    pagos.push(pago);
    return pago;
  };
  return { api, pagos, preferencias, entra, consultas: () => consultas };
}

describe.skipIf(!url)("cobrar por transferencia o Mercado Pago", { timeout: 120_000 }, () => {
  let db: PrismaClient;
  const unico = crypto.randomUUID().slice(0, 8);
  const mpUsuarioId = String(Math.floor(Math.random() * 1e12));
  const mp = mercadoPagoFalso(mpUsuarioId);
  let productoraId: string;
  let cuenta: CuentaMp;
  let n = 0;
  const claveAnterior = process.env.CLAVE_CIFRADO;

  async function crearEvento(cupos: number[], precio = 8_000) {
    const creado = await db.evento.create({
      data: {
        productoraId,
        slug: `cobro-${unico}-${n++}`,
        nombre: "Fiesta",
        fecha: new Date("2030-03-07T23:00:00-03:00"),
        lugar: "Club",
        estado: "PUBLICADO",
        maxPorCompra: 6,
        tipos: {
          create: {
            nombre: "General",
            lotes: { create: cupos.map((cupo, i) => ({ numero: i + 1, nombre: `Lote ${i + 1}`, precioCentavos: precio * 100, cupo })) },
          },
        },
      },
      include: { tipos: { include: { lotes: { orderBy: { numero: "asc" } } } } },
    });
    return { id: creado.id, general: creado.tipos[0].id, lotes: creado.tipos[0].lotes.map((lote) => lote.id) };
  }

  // Reserva y completa los datos (como quien compra antes de elegir cómo pagar).
  async function reservar(evento: { id: string; general: string }, cantidad: number, ahora = new Date()) {
    const k = n++;
    const reserva = await crearReserva(db, evento.id, pedidoATexto([{ tipoId: evento.general, cantidad }]), {
      navegador: `nav-${unico}-${k}`,
      ip: `10.0.${Math.floor(k / 200)}.${k % 200}`,
    }, ahora);
    if (!reserva.ok) throw new Error(reserva.error);
    const campos: Record<string, string> = { email: "ana@gmail.com", email2: "ana@gmail.com", telefono: "" };
    for (let i = 0; i < cantidad; i++) Object.assign(campos, { [`nombre-${i}`]: "Ana Pérez", [`dni-${i}`]: `3012345${i}` });
    const datos = await guardarDatosCompra(db, reserva.llave, (c) => campos[c], ahora);
    if (!datos.ok) throw new Error(JSON.stringify(datos));
    return reserva;
  }

  async function lote(id: string) {
    return db.lote.findUniqueOrThrow({ where: { id }, select: { vendidas: true, reservadas: true } });
  }
  async function orden(id: string) {
    return db.orden.findUniqueOrThrow({
      where: { id },
      select: { estado: true, metodoPago: true, recargoCentavos: true, entradas: { select: { estado: true } }, pagos: true },
    });
  }
  async function montoDe(ordenId: string) {
    return (await db.montoTransferencia.findUniqueOrThrow({ where: { ordenId } })).montoCentavos;
  }

  beforeAll(async () => {
    process.env.CLAVE_CIFRADO = "clave-de-prueba-para-los-tests-de-cobros-123";
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }, { schema: "entradas" }) });
    const productora = await db.productora.create({
      data: { nombre: `Cobros ${unico}`, aliasTransferencia: "fiesta.prueba", titularTransferencia: "Ramiro Prueba" },
    });
    productoraId = productora.id;
    const conexion = await conectarMercadoPago(db, productoraId, "APP_USR-1234567890123456-prueba-token-de-test", mp.api);
    expect(conexion).toEqual({ ok: true, cuenta: "CUENTA_PRUEBA" });
    cuenta = cuentaMpDe((await db.productora.findUniqueOrThrow({ where: { id: productoraId } })))!;
  });

  afterAll(async () => {
    process.env.CLAVE_CIFRADO = claveAnterior;
    await db.$disconnect();
  });

  it("conectar Mercado Pago guarda el token cifrado y de quién es la cuenta", async () => {
    const guardada = await db.productora.findUniqueOrThrow({ where: { id: productoraId } });
    expect(guardada.mpUsuarioId).toBe(mpUsuarioId);
    expect(guardada.mpTokenCifrado).not.toContain("prueba-token");
    expect(cuenta.token).toBe("APP_USR-1234567890123456-prueba-token-de-test");
    // Un token que Mercado Pago no acepta (o con otra forma) no se guarda.
    expect(await conectarMercadoPago(db, productoraId, "APP_USR-1234567890123456-malo-malo-malo", mp.api)).toMatchObject({ ok: false });
    expect(await conectarMercadoPago(db, productoraId, "cualquier cosa", mp.api)).toMatchObject({ ok: false });
    expect((await db.productora.findUniqueOrThrow({ where: { id: productoraId } })).mpTokenCifrado).toBe(guardada.mpTokenCifrado);
  });

  it("transferencia: monto único, la plata entra y la compra queda paga una sola vez", async () => {
    const evento = await crearEvento([10]);
    const reserva = await reservar(evento, 2);
    expect((await opcionesDePago(db, reserva.llave))!.transferencia).toMatchObject({ alias: "fiesta.prueba", montoCentavos: null });

    const elegido = await elegirTransferencia(db, reserva.llave);
    expect(elegido.ok).toBe(true);
    const monto = await montoDe(reserva.ordenId);
    expect(monto).toBeGreaterThan(1_600_000); // $16.000 + centavos
    expect(monto).toBeLessThanOrEqual(1_600_000 + 999);
    // Elegir de nuevo no cambia el monto.
    expect(await elegirTransferencia(db, reserva.llave)).toEqual({ ok: true, montoCentavos: monto });

    // Sin la plata todavía: sigue pendiente.
    await db.productora.update({ where: { id: productoraId }, data: { mpRevisadoEn: null } });
    expect(await revisarPagoDeCompra(db, reserva.llave, mp.api)).toEqual({ estado: "PENDIENTE" });

    const pago = mp.entra(monto);
    await db.productora.update({ where: { id: productoraId }, data: { mpRevisadoEn: null } });
    expect(await revisarPagoDeCompra(db, reserva.llave, mp.api)).toEqual({ estado: "PAGADA" });
    const pagada = await orden(reserva.ordenId);
    expect(pagada.metodoPago).toBe("TRANSFERENCIA");
    expect(pagada.entradas.every((entrada) => entrada.estado === "VALIDA")).toBe(true);
    expect(pagada.pagos).toMatchObject([{ mpPagoId: pago.id, montoCentavos: monto, metodo: "TRANSFERENCIA", aDevolver: false }]);
    expect(await lote(evento.lotes[0])).toEqual({ vendidas: 2, reservadas: 0 });

    // El mismo pago otra vez (otro aviso, otra revisión): no hace nada.
    expect(await procesarPagoMp(db, cuenta, pago)).toBe("ya_registrado");
    expect(await lote(evento.lotes[0])).toEqual({ vendidas: 2, reservadas: 0 });
    expect(await db.pago.count({ where: { ordenId: reserva.ordenId } })).toBe(1);
  });

  it("muchas órdenes del mismo total eligen transferencia a la vez: todos los montos distintos", async () => {
    const evento = await crearEvento([100]);
    const reservas = [];
    for (let i = 0; i < 25; i++) reservas.push(await reservar(evento, 1));
    const resultados = await Promise.all(reservas.map((reserva) => elegirTransferencia(db, reserva.llave)));
    expect(resultados.every((r) => r.ok)).toBe(true);
    const montos = await Promise.all(reservas.map((reserva) => montoDe(reserva.ordenId)));
    expect(new Set(montos).size).toBe(25);
    expect(montos.every((monto) => monto > 800_000 && monto <= 800_999)).toBe(true);
  });

  it("solo con la reserva vigente y los datos completos", async () => {
    const evento = await crearEvento([10]);
    const sinDatos = await crearReserva(db, evento.id, pedidoATexto([{ tipoId: evento.general, cantidad: 1 }]), {
      navegador: `nav-${unico}-sin-datos`,
      ip: "10.9.9.9",
    });
    if (!sinDatos.ok) throw new Error(sinDatos.error);
    expect(await elegirTransferencia(db, sinDatos.llave)).toMatchObject({ ok: false, error: expect.stringContaining("datos") });
    expect(await elegirMercadoPago(db, sinDatos.llave, mp.api, "https://x.test")).toMatchObject({ ok: false });

    const reserva = await reservar(evento, 1);
    const tarde = new Date(Date.now() + (MINUTOS_RESERVA + 1) * MINUTO);
    expect(await elegirTransferencia(db, reserva.llave, tarde)).toMatchObject({ ok: false, error: expect.stringContaining("vigente") });
    expect(await db.montoTransferencia.count({ where: { ordenId: reserva.ordenId } })).toBe(0);
  });

  it("una transferencia de otro monto, de antes o a otra cuenta no confirma nada", async () => {
    const evento = await crearEvento([10]);
    const reserva = await reservar(evento, 1);
    await elegirTransferencia(db, reserva.llave);
    const monto = await montoDe(reserva.ordenId);
    expect(await procesarPagoMp(db, cuenta, mp.entra(800_000))).toBe("ignorado"); // sin los centavos
    expect(await procesarPagoMp(db, cuenta, mp.entra(monto, { cobradorId: "999" }))).toBe("ignorado"); // otra cuenta
    expect(await procesarPagoMp(db, cuenta, mp.entra(monto, { creadoEn: new Date(Date.now() - 60 * MINUTO) }))).toBe("ignorado");
    expect(await procesarPagoMp(db, cuenta, mp.entra(monto, { estado: "pending" }))).toBe("ignorado");
    expect(await procesarPagoMp(db, cuenta, mp.entra(monto, { moneda: "USD" }))).toBe("ignorado");
    expect((await orden(reserva.ordenId)).estado).toBe("PENDIENTE");
    expect(await lote(evento.lotes[0])).toEqual({ vendidas: 0, reservadas: 1 });
  });

  it("el mismo pago procesado dos veces a la vez (aviso + revisión): una sola venta", async () => {
    const evento = await crearEvento([10]);
    const reserva = await reservar(evento, 3);
    await elegirTransferencia(db, reserva.llave);
    const pago = mp.entra(await montoDe(reserva.ordenId));
    const resultados = await Promise.all([procesarPagoMp(db, cuenta, pago), procesarPagoMp(db, cuenta, pago), procesarPagoMp(db, cuenta, pago)]);
    expect(resultados.filter((r) => r === "confirmada")).toHaveLength(1);
    expect(resultados.filter((r) => r === "ya_registrado")).toHaveLength(2);
    expect(await lote(evento.lotes[0])).toEqual({ vendidas: 3, reservadas: 0 });
  });

  it("pagó dos veces: el segundo pago queda para devolver", async () => {
    const evento = await crearEvento([10]);
    const reserva = await reservar(evento, 1);
    await elegirTransferencia(db, reserva.llave);
    const monto = await montoDe(reserva.ordenId);
    expect(await procesarPagoMp(db, cuenta, mp.entra(monto))).toBe("confirmada");
    expect(await procesarPagoMp(db, cuenta, mp.entra(monto))).toBe("a_devolver");
    const pagos = (await orden(reserva.ordenId)).pagos;
    expect(pagos.map((pago) => pago.aDevolver).sort()).toEqual([false, true]);
    expect(await lote(evento.lotes[0])).toEqual({ vendidas: 1, reservadas: 0 });
  });

  it("pagó tarde: si queda lugar se confirma; si no, para devolver", async () => {
    const evento = await crearEvento([2]);
    const tardia = await reservar(evento, 1);
    const sinLugar = await reservar(evento, 1);
    await elegirTransferencia(db, tardia.llave);
    await elegirTransferencia(db, sinLugar.llave);
    // Vencen las dos: los lugares vuelven al lote.
    expect(await liberarVencidas(db, evento.id, new Date(Date.now() + (MINUTOS_RESERVA + 1) * MINUTO))).toBe(2);
    expect(await lote(evento.lotes[0])).toEqual({ vendidas: 0, reservadas: 0 });

    // Hay lugar: se confirma igual.
    expect(await procesarPagoMp(db, cuenta, mp.entra(await montoDe(tardia.ordenId)))).toBe("confirmada_tarde");
    expect((await orden(tardia.ordenId)).estado).toBe("PAGADA");
    expect(await lote(evento.lotes[0])).toEqual({ vendidas: 1, reservadas: 0 });

    // Alguien reserva el último lugar; después paga la otra: ya no hay lugar.
    await reservar(evento, 1);
    expect(await procesarPagoMp(db, cuenta, mp.entra(await montoDe(sinLugar.ordenId)))).toBe("a_devolver");
    const devuelta = await orden(sinLugar.ordenId);
    expect(devuelta.estado).toBe("VENCIDA");
    expect(devuelta.entradas.every((entrada) => entrada.estado === "ANULADA")).toBe(true);
    expect(devuelta.pagos).toMatchObject([{ aDevolver: true, nota: expect.stringContaining("no quedaba lugar") }]);
    expect(await lote(evento.lotes[0])).toEqual({ vendidas: 1, reservadas: 1 });
  });

  it("Mercado Pago: cobro con cargo por servicio, y se confirma con el pago de esa orden", async () => {
    const evento = await crearEvento([10]);
    const reserva = await reservar(evento, 2);
    const opciones = await opcionesDePago(db, reserva.llave);
    expect(opciones!.mercadoPago).toEqual({ totalCentavos: 1_600_000 + 70_400, recargoCentavos: 70_400 });

    const elegido = await elegirMercadoPago(db, reserva.llave, mp.api, "https://entradas.test");
    expect(elegido).toMatchObject({ ok: true, link: expect.stringContaining("mercadopago") });
    const preferencia = mp.preferencias.at(-1)!;
    expect(preferencia).toMatchObject({
      ordenId: reserva.ordenId,
      totalCentavos: 1_600_000,
      recargoCentavos: 70_400,
      volverA: `https://entradas.test/compra/${reserva.llave}`,
      avisoA: `https://entradas.test/api/mercadopago/aviso?p=${productoraId}`,
    });
    // El cobro vence junto con la reserva.
    const guardada = await db.orden.findUniqueOrThrow({ where: { id: reserva.ordenId } });
    expect(preferencia.venceEn.getTime()).toBe(guardada.venceEn!.getTime());
    expect(guardada).toMatchObject({ metodoPago: "MERCADOPAGO", recargoCentavos: 70_400 });

    // Un pago con la referencia de la orden pero otro monto: para devolver, sin dar entradas.
    const otroMonto = mp.entra(1_600_000, { tipo: "regular_payment", referencia: reserva.ordenId });
    expect(await procesarAviso(db, { productoraId, pagoId: otroMonto.id }, mp.api)).toBe("a_devolver");
    expect((await orden(reserva.ordenId)).estado).toBe("PENDIENTE");

    // El pago bueno llega por el aviso (sin ?p=, por la cuenta que cobró).
    const bueno = mp.entra(1_670_400, { tipo: "regular_payment", referencia: reserva.ordenId, comisionCentavos: 70_324 });
    expect(await procesarAviso(db, { mpUsuarioId, pagoId: bueno.id }, mp.api)).toBe("confirmada");
    const pagada = await orden(reserva.ordenId);
    expect(pagada.estado).toBe("PAGADA");
    expect(pagada.pagos.find((pago) => pago.mpPagoId === bueno.id)).toMatchObject({ metodo: "MERCADOPAGO", comisionCentavos: 70_324, aDevolver: false });
    expect(await lote(evento.lotes[0])).toEqual({ vendidas: 2, reservadas: 0 });
  });

  it("un pago con la referencia de una orden de otra productora no se toca", async () => {
    const evento = await crearEvento([10]);
    const reserva = await reservar(evento, 1);
    const otra = await db.productora.create({ data: { nombre: `Otra ${unico}`, mpUsuarioId: "4242", mpTokenCifrado: "v1.x.y.z" } });
    const ajena: CuentaMp = { productoraId: otra.id, mpUsuarioId: "4242", token: "t" };
    expect(await procesarPagoMp(db, ajena, mp.entra(800_000, { cobradorId: "4242", tipo: "regular_payment", referencia: reserva.ordenId }))).toBe("ignorado");
    expect((await orden(reserva.ordenId)).estado).toBe("PENDIENTE");
  });

  it("revisar los movimientos: como mucho una consulta cada 5 segundos por productora", async () => {
    const evento = await crearEvento([10]);
    const reserva = await reservar(evento, 1);
    await elegirTransferencia(db, reserva.llave);
    await db.productora.update({ where: { id: productoraId }, data: { mpRevisadoEn: null } });
    const antes = mp.consultas();
    const ahora = new Date();
    const resultados = await Promise.all(Array.from({ length: 10 }, () => revisarCobros(db, productoraId, mp.api, ahora)));
    expect(resultados.filter((r) => r.revisado)).toHaveLength(1);
    expect(mp.consultas() - antes).toBe(1);
    expect((await revisarCobros(db, productoraId, mp.api, new Date(ahora.getTime() + 2_000))).revisado).toBe(false);

    mp.entra(await montoDe(reserva.ordenId));
    expect(await revisarCobros(db, productoraId, mp.api, new Date(ahora.getTime() + 6_000))).toEqual({ revisado: true, confirmadas: 1 });
  });

  it("confirmar a mano: confirma una vez; si después entra la transferencia, la respalda", async () => {
    const evento = await crearEvento([10]);
    const reserva = await reservar(evento, 1);
    await elegirTransferencia(db, reserva.llave);
    const usuario = await db.usuario.create({
      data: { nombre: "Org", email: `org-${unico}-${n++}@x.com`, hashContrasena: "x", rol: "ORGANIZADOR", productoraId },
    });
    const todos = async () => true;

    // Sin permiso sobre el evento: "no existe".
    expect(await confirmarPagoManual(db, reserva.ordenId, usuario.id, async () => false)).toMatchObject({ ok: false });
    expect(await confirmarPagoManual(db, reserva.ordenId, usuario.id, todos)).toEqual({ ok: true, resultado: "confirmada" });
    expect(await confirmarPagoManual(db, reserva.ordenId, usuario.id, todos)).toMatchObject({ ok: false, error: expect.stringContaining("ya está paga") });
    const pagada = await orden(reserva.ordenId);
    expect(pagada.pagos).toMatchObject([{ metodo: "MANUAL", mpPagoId: `manual:${reserva.ordenId}`, registradoPorId: usuario.id }]);

    // Llega la transferencia de verdad: respalda la confirmación a mano (no es para devolver).
    expect(await procesarPagoMp(db, cuenta, mp.entra(await montoDe(reserva.ordenId)))).toBe("respalda_manual");
    // Una segunda, sí.
    expect(await procesarPagoMp(db, cuenta, mp.entra(await montoDe(reserva.ordenId)))).toBe("a_devolver");
    expect(await lote(evento.lotes[0])).toEqual({ vendidas: 1, reservadas: 0 });
  });

  it("confirmar a mano una reserva vencida sin lugar: no hace nada", async () => {
    const evento = await crearEvento([1]);
    const reserva = await reservar(evento, 1);
    await liberarVencidas(db, evento.id, new Date(Date.now() + (MINUTOS_RESERVA + 1) * MINUTO));
    await reservar(evento, 1); // otro se queda con el lugar
    const usuario = await db.usuario.create({
      data: { nombre: "Org", email: `org-${unico}-${n++}@x.com`, hashContrasena: "x", rol: "ORGANIZADOR", productoraId },
    });
    expect(await confirmarPagoManual(db, reserva.ordenId, usuario.id, async () => true)).toMatchObject({
      ok: false,
      error: expect.stringContaining("no quedaba lugar"),
    });
    expect(await db.pago.count({ where: { ordenId: reserva.ordenId } })).toBe(0);
    expect((await orden(reserva.ordenId)).estado).toBe("VENCIDA");
  });
});
