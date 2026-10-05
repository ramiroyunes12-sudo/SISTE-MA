import { describe, expect, it } from "vitest";

import { inicioSegunRol, normalizarEmail } from "./cuentas";
import { DURACION_MAXIMA, generarToken, huellaDeToken, INACTIVIDAD_MAXIMA, nuevoVencimiento } from "./sesiones";

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;

describe("sesiones", () => {
  it("cada token es distinto y su huella es SHA-256 en hexadecimal", () => {
    const token = generarToken();
    expect(token).toMatch(/^[\w-]{43}$/);
    expect(generarToken()).not.toBe(token);
    expect(huellaDeToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(huellaDeToken(token)).toBe(huellaDeToken(token));
  });

  it("al usarla se estira a 7 días desde ahora, como mucho una vez por día", () => {
    const creada = new Date("2026-11-01T12:00:00Z");
    const expira = new Date(creada.getTime() + INACTIVIDAD_MAXIMA);

    // al rato de ingresar: no hace falta escribir en la base
    expect(nuevoVencimiento(creada, expira, new Date(creada.getTime() + 2 * HORA))).toBeNull();

    // dos días después: vence 7 días desde ese momento
    const ahora = new Date(creada.getTime() + 2 * DIA);
    expect(nuevoVencimiento(creada, expira, ahora)).toEqual(new Date(ahora.getTime() + INACTIVIDAD_MAXIMA));
  });

  it("nunca pasa de 30 días desde que se abrió", () => {
    const creada = new Date("2026-11-01T12:00:00Z");
    const tope = new Date(creada.getTime() + DURACION_MAXIMA);
    const expira = new Date(creada.getTime() + 25 * DIA);
    expect(nuevoVencimiento(creada, expira, new Date(creada.getTime() + 24 * DIA))).toEqual(tope);
    expect(nuevoVencimiento(creada, tope, new Date(creada.getTime() + 29 * DIA))).toBeNull();
  });

  it("cada rol arranca en su pantalla y el email se compara sin mayúsculas ni espacios", () => {
    expect(inicioSegunRol("ADMIN")).toBe("/admin");
    expect(inicioSegunRol("VALIDADOR")).toBe("/validar");
    expect(normalizarEmail("  Ana.Gomez@Gmail.COM ")).toBe("ana.gomez@gmail.com");
    expect(normalizarEmail(null)).toBe("");
  });
});
