import { describe, expect, it } from "vitest";

import { respuestaPuerta } from "./puerta";

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
    expect(otro).toMatchObject({ resultado: "ya_ingreso", entro: "a las 23:41", por: "Beto" });
    const yo = respuestaPuerta(
      { resultado: "ya_ingreso", entrada: ENTRADA, usadaEn, validadaPor: { id: "yo", nombre: "Ana" } },
      "yo",
      AHORA,
    );
    expect(yo).toMatchObject({ entro: "a las 23:41", por: "vos" });
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
