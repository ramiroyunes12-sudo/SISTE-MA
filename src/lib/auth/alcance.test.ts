import { describe, expect, it } from "vitest";

import { alcanceDeLaPuerta, filtroDeEventos, puedeTocarProductora } from "./alcance";

const PROPIA = "0190f2a0-0000-7000-8000-000000000001";
const AJENA = "0190f2a0-0000-7000-8000-000000000002";

describe("qué productora puede tocar cada uno", () => {
  it("el ADMIN, cualquiera", () => {
    expect(puedeTocarProductora({ todo: true }, AJENA)).toBe(true);
  });

  it("un organizador, solo la suya", () => {
    expect(puedeTocarProductora({ todo: false, productoraId: PROPIA }, PROPIA)).toBe(true);
    expect(puedeTocarProductora({ todo: false, productoraId: PROPIA }, AJENA)).toBe(false);
  });

  it("nada que no sea un id", () => {
    expect(puedeTocarProductora({ todo: true }, "x")).toBe(false);
    expect(puedeTocarProductora({ todo: true }, undefined)).toBe(false);
    expect(puedeTocarProductora({ todo: false, productoraId: PROPIA }, null)).toBe(false);
  });
});

describe("la puerta: un validador, solo cerca del evento", () => {
  const AHORA = new Date("2030-01-01T12:00:00Z");
  const usuario = (rol: "ADMIN" | "ORGANIZADOR" | "VALIDADOR") => ({ rol, productora: rol === "ADMIN" ? null : { id: PROPIA } });

  it("validador: eventos que empiezan dentro de 12 horas o empezaron hace menos de 24 (decidido por Ramiro)", () => {
    expect(filtroDeEventos(alcanceDeLaPuerta(usuario("VALIDADOR"), AHORA))).toEqual({
      productoraId: PROPIA,
      fecha: { gte: new Date("2029-12-31T12:00:00Z"), lte: new Date("2030-01-02T00:00:00Z") },
    });
  });

  it("organizador y ADMIN: cualquier evento suyo (para probar antes)", () => {
    expect(filtroDeEventos(alcanceDeLaPuerta(usuario("ORGANIZADOR"), AHORA))).toEqual({ productoraId: PROPIA });
    expect(filtroDeEventos(alcanceDeLaPuerta(usuario("ADMIN"), AHORA))).toEqual({});
  });
});
