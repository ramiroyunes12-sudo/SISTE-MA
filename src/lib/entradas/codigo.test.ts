import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { firmarCodigo, leerCodigo, nuevoCodigo } from "./codigo";

const CLAVE = "clave-de-prueba-de-los-tests-con-mas-de-32-caracteres";
let anterior: string | undefined;

beforeEach(() => {
  anterior = process.env.CLAVE_CIFRADO;
  process.env.CLAVE_CIFRADO = CLAVE;
});
afterEach(() => {
  if (anterior === undefined) delete process.env.CLAVE_CIFRADO;
  else process.env.CLAVE_CIFRADO = anterior;
});

// Cambia un carácter hexadecimal por otro distinto.
function cambiar(texto: string, posicion: number) {
  const nuevo = texto[posicion] === "0" ? "1" : "0";
  return texto.slice(0, posicion) + nuevo + texto.slice(posicion + 1);
}

describe("código de cada entrada", () => {
  it("es de 128 bits al azar, en hexadecimal mayúscula, y no se repite", () => {
    const codigos = new Set(Array.from({ length: 1000 }, () => nuevoCodigo()));
    expect(codigos.size).toBe(1000);
    for (const codigo of codigos) expect(codigo).toMatch(/^[0-9A-F]{32}$/);
  });

  it("firmado: E1-<al azar>-<firma>, y al leerlo devuelve el mismo código", () => {
    const codigo = nuevoCodigo();
    const firmado = firmarCodigo(codigo);
    expect(firmado).toMatch(/^E1-[0-9A-F]{32}-[0-9A-F]{32}$/);
    expect(firmado.startsWith(`E1-${codigo}-`)).toBe(true);
    // Solo caracteres del modo alfanumérico del QR (QR más chico).
    expect(firmado).toMatch(/^[0-9A-Z $%*+\-./:]+$/);
    expect(leerCodigo(firmado)).toEqual({ ok: true, codigo });
  });

  it("la firma siempre es la misma para el mismo código (se puede volver a armar el QR)", () => {
    const codigo = nuevoCodigo();
    expect(firmarCodigo(codigo)).toBe(firmarCodigo(codigo));
  });

  it("tolera minúsculas y espacios alrededor (algunos lectores los agregan)", () => {
    const codigo = nuevoCodigo();
    expect(leerCodigo(`  ${firmarCodigo(codigo).toLowerCase()}\n`)).toEqual({ ok: true, codigo });
  });

  it("rechaza cualquier cambio en el código o en la firma", () => {
    const firmado = firmarCodigo(nuevoCodigo());
    for (const posicion of [3, 20, 34, 36, 50, 67]) {
      expect(leerCodigo(cambiar(firmado, posicion))).toEqual({ ok: false, motivo: "firma" });
    }
  });

  it("rechaza la firma de un código pegada a otro código", () => {
    const [, , firmaA] = firmarCodigo(nuevoCodigo()).split("-");
    const otro = nuevoCodigo();
    expect(leerCodigo(`E1-${otro}-${firmaA}`)).toEqual({ ok: false, motivo: "firma" });
  });

  it("un código firmado con otra clave no sirve", () => {
    const codigo = nuevoCodigo();
    const firmado = firmarCodigo(codigo);
    process.env.CLAVE_CIFRADO = "otra-clave-distinta-de-la-anterior-tambien-larga";
    expect(leerCodigo(firmado)).toEqual({ ok: false, motivo: "firma" });
  });

  it("la firma no es la de un HMAC con CLAVE_CIFRADO tal cual (usa una clave derivada)", async () => {
    const { createHmac } = await import("node:crypto");
    const codigo = nuevoCodigo();
    const ingenua = createHmac("sha256", CLAVE).update(`entrada:${codigo}`).digest("hex").slice(0, 32).toUpperCase();
    expect(firmarCodigo(codigo).endsWith(ingenua)).toBe(false);
  });

  it("rechaza formatos que no son (versiones desconocidas, largos, vacíos, basura)", () => {
    const codigo = nuevoCodigo();
    const [, , firma] = firmarCodigo(codigo).split("-");
    const malos: unknown[] = [
      "",
      "   ",
      null,
      undefined,
      42,
      { codigo },
      codigo,
      `E2-${codigo}-${firma}`,
      `E01-${codigo}-${firma}`,
      `E1-${codigo}`,
      `E1-${codigo}-${firma}-`,
      `E1-${codigo}-${firma}0`,
      `E1-${codigo.slice(1)}-${firma}`,
      `E1-${codigo}-${firma.slice(1)}`,
      `E1_${codigo}_${firma}`,
      `E1-G${codigo.slice(1)}-${firma}`,
      `xE1-${codigo}-${firma}`,
      `E1-${codigo}-${firma}`.repeat(50),
    ];
    for (const malo of malos) {
      const leido = leerCodigo(malo);
      expect(leido.ok, String(malo)).toBe(false);
    }
    expect(leerCodigo(`E2-${codigo}-${firma}`)).toEqual({ ok: false, motivo: "formato" });
  });

  it("firmar exige un código con el formato de la base", () => {
    expect(() => firmarCodigo("abc")).toThrow();
    expect(() => firmarCodigo(nuevoCodigo().toLowerCase())).toThrow();
  });

  it("sin CLAVE_CIFRADO no firma ni lee (falla, no deja pasar)", () => {
    const firmado = firmarCodigo(nuevoCodigo());
    delete process.env.CLAVE_CIFRADO;
    expect(() => firmarCodigo(nuevoCodigo())).toThrow(/CLAVE_CIFRADO/);
    expect(() => leerCodigo(firmado)).toThrow(/CLAVE_CIFRADO/);
  });
});
