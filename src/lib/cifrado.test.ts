import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { cifrar, descifrar, hayClaveDeCifrado } from "./cifrado";

describe("cifrar secretos de la base", () => {
  const anterior = process.env.CLAVE_CIFRADO;
  beforeEach(() => {
    process.env.CLAVE_CIFRADO = "una-clave-de-prueba-bien-larga-de-mas-de-32";
  });
  afterEach(() => {
    process.env.CLAVE_CIFRADO = anterior;
  });

  it("ida y vuelta, y el cifrado no contiene el secreto", () => {
    const guardado = cifrar("APP_USR-secreto", "mp-token:1");
    expect(guardado).not.toContain("secreto");
    expect(descifrar(guardado, "mp-token:1")).toBe("APP_USR-secreto");
    expect(cifrar("APP_USR-secreto", "mp-token:1")).not.toBe(guardado); // cada vez distinto
  });

  it("no se descifra con otro contexto (token copiado a otra productora)", () => {
    const guardado = cifrar("APP_USR-secreto", "mp-token:1");
    expect(() => descifrar(guardado, "mp-token:2")).toThrow();
  });

  it("no se descifra si lo tocaron o con otra clave", () => {
    const guardado = cifrar("APP_USR-secreto", "mp-token:1");
    const partes = guardado.split(".");
    partes[2] = partes[2].slice(0, -2) + (partes[2].endsWith("AA") ? "BB" : "AA");
    expect(() => descifrar(partes.join("."), "mp-token:1")).toThrow();
    process.env.CLAVE_CIFRADO = "otra-clave-de-prueba-bien-larga-de-mas-de-32";
    expect(() => descifrar(guardado, "mp-token:1")).toThrow();
  });

  it("sin clave (o muy corta) no cifra", () => {
    process.env.CLAVE_CIFRADO = "corta";
    expect(hayClaveDeCifrado()).toBe(false);
    expect(() => cifrar("x", "y")).toThrow(/CLAVE_CIFRADO/);
  });
});
