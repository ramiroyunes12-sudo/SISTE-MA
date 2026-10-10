import { describe, expect, it } from "vitest";

import { bloqueaRepetir, leerRespuestaPuerta, respuestaPuerta } from "./puerta";

const ENTRADA = { titular: "Ana Pérez", dni: "30111222", tipo: "VIP", compra: 12 };
const AHORA = new Date("2026-11-22T01:10:00-03:00");

describe("lo que ve la puerta", () => {
  it("PASA: los datos de la persona, con el DNI con puntos", () => {
    expect(respuestaPuerta({ resultado: "pasa", entrada: ENTRADA }, "yo", AHORA)).toEqual({
      resultado: "pasa",
      persona: { titular: "Ana Pérez", dni: "30.111.222", tipo: "VIP", compra: 12 },
    });
  });

  it("YA INGRESÓ: a qué hora y quién (o 'vos' si fue quien escanea)", () => {
    const usadaEn = new Date("2026-11-21T23:41:00-03:00");
    const otro = respuestaPuerta(
      { resultado: "ya_ingreso", entrada: ENTRADA, usadaEn, validadaPor: { id: "otro", nombre: "Beto" } },
      "yo",
      AHORA,
    );
    expect(otro).toMatchObject({ resultado: "ya_ingreso", entro: "a las 23:41", por: "Beto" }); // hace 89 minutos
    const yo = respuestaPuerta(
      { resultado: "ya_ingreso", entrada: ENTRADA, usadaEn, validadaPor: { id: "yo", nombre: "Ana" } },
      "yo",
      AHORA,
    );
    expect(yo).toMatchObject({ entro: "a las 23:41", por: "vos" });
  });

  it("YA INGRESÓ en la última hora: cuánto hace (para no confundir un QR repetido con el escaneo propio que se cortó)", () => {
    const ya = (segundos: number) =>
      respuestaPuerta(
        { resultado: "ya_ingreso", entrada: ENTRADA, usadaEn: new Date(AHORA.getTime() - segundos * 1000), validadaPor: null },
        "yo",
        AHORA,
      );
    expect(ya(20)).toMatchObject({ entro: "a las 01:09, hace menos de un minuto" });
    expect(ya(90)).toMatchObject({ entro: "a las 01:08, hace 1 minuto" });
    expect(ya(59 * 60)).toMatchObject({ entro: "a las 00:11, hace 59 minutos" });
    expect(ya(60 * 60)).toMatchObject({ entro: "a las 00:10" });
    expect(ya(-30)).toMatchObject({ entro: "a las 01:10, hace menos de un minuto" }); // reloj de otro servidor adelantado
  });

  it("YA INGRESÓ hace más de 12 horas: con el día", () => {
    const usadaEn = new Date("2026-11-20T23:41:00-03:00");
    expect(
      respuestaPuerta({ resultado: "ya_ingreso", entrada: ENTRADA, usadaEn, validadaPor: null }, "yo", AHORA),
    ).toMatchObject({ entro: "el vie 20/11/2026 23:41", por: null });
  });

  it("NO VÁLIDA: el motivo, y la persona solo si se sabe de quién es", () => {
    expect(respuestaPuerta({ resultado: "no_valida", motivo: "firma" }, "yo", AHORA)).toEqual({
      resultado: "no_valida",
      motivo: "firma",
    });
    expect(respuestaPuerta({ resultado: "no_valida", motivo: "sin_pagar", entrada: ENTRADA }, "yo", AHORA)).toMatchObject({
      motivo: "sin_pagar",
      persona: { titular: "Ana Pérez" },
    });
  });
});

describe("lo que cree la pantalla de la puerta", () => {
  const PASA = { resultado: "pasa", persona: { titular: "Ana", dni: "30.111.222", tipo: "VIP", compra: 1 } };

  it("un resultado solo si el servidor contestó bien y con un resultado conocido", () => {
    expect(leerRespuestaPuerta(true, PASA)).toEqual(PASA);
    expect(leerRespuestaPuerta(true, { resultado: "no_valida", motivo: "firma" })).toEqual({ resultado: "no_valida", motivo: "firma" });
  });

  it("nunca PASA con un error, una respuesta rara o vacía: falló la conexión", () => {
    const conexion = { error: "conexion" };
    expect(leerRespuestaPuerta(false, PASA)).toEqual(conexion); // un 500 que dice "pasa" no se cree
    expect(leerRespuestaPuerta(true, { resultado: "PASA" })).toEqual(conexion);
    expect(leerRespuestaPuerta(true, { resultado: "pasa_igual" })).toEqual(conexion);
    expect(leerRespuestaPuerta(true, null)).toEqual(conexion);
    expect(leerRespuestaPuerta(true, "pasa")).toEqual(conexion);
    expect(leerRespuestaPuerta(true, { error: "sesion" })).toEqual(conexion);
    expect(leerRespuestaPuerta(false, { error: "otra_cosa" })).toEqual(conexion);
  });

  it("los errores conocidos del servidor, tal cual", () => {
    for (const error of ["sesion", "evento", "pedido", "conexion"]) {
      expect(leerRespuestaPuerta(false, { error })).toEqual({ error });
    }
  });

  it("el QR de recién se bloquea solo si el servidor contestó (después de un error hay que poder escanearlo de nuevo)", () => {
    expect(bloqueaRepetir(PASA as never)).toBe(true);
    expect(bloqueaRepetir({ resultado: "ya_ingreso", persona: PASA.persona, entro: null, por: null })).toBe(true);
    expect(bloqueaRepetir({ resultado: "no_valida", motivo: "formato" })).toBe(true);
    expect(bloqueaRepetir({ error: "conexion" })).toBe(false);
    expect(bloqueaRepetir({ error: "pedido" })).toBe(false);
  });
});
