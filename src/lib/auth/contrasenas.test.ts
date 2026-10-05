import { describe, expect, it } from "vitest";

import { generarContrasenaTemporal, hashearContrasena, hashFalso, verificarContrasena } from "./contrasenas";
import { problemaConContrasenaNueva } from "./reglas";

// scrypt tarda ~0,4 s a propósito: estos tests son más lentos que los demás.
describe("contraseñas", { timeout: 20_000 }, () => {
  it("guarda un hash que sirve para comprobar, pero no contiene la contraseña", async () => {
    const hash = await hashearContrasena("mate amargo en la costanera");
    expect(hash).toMatch(/^scrypt\$17\$8\$1\$[\w-]{22}\$[\w-]{43}$/);
    expect(hash).not.toContain("mate");
    expect(await verificarContrasena("mate amargo en la costanera", hash)).toBe(true);
    expect(await verificarContrasena("mate amargo en la costanerA", hash)).toBe(false);
    expect(await verificarContrasena("", hash)).toBe(false);
  });

  it("la misma contraseña da hashes distintos (sal al azar)", async () => {
    const [a, b] = await Promise.all([hashearContrasena("una contraseña"), hashearContrasena("una contraseña")]);
    expect(a).not.toBe(b);
  });

  it("acepta la misma letra con acento escrita de dos formas", async () => {
    const compuesta = "canción-de-cuna"; // "ó" como un solo carácter
    const separada = compuesta.normalize("NFD"); // "o" + tilde aparte (algunos celulares)
    expect(separada).not.toBe(compuesta);
    expect(await verificarContrasena(separada, await hashearContrasena(compuesta))).toBe(true);
  });

  it("un hash roto o manipulado no deja entrar (ni cuelga el servidor)", async () => {
    const hash = await hashearContrasena("una contraseña");
    const partes = hash.split("$");
    for (const roto of [
      "",
      "texto cualquiera",
      ["bcrypt", ...partes.slice(1)].join("$"),
      ["scrypt", "30", ...partes.slice(2)].join("$"), // costo absurdo
      ["scrypt", "17", "8", "1", partes[4], "corto"].join("$"),
      ["scrypt", "17", "8", "1", "", partes[5]].join("$"), // sin sal
    ]) {
      expect(await verificarContrasena("una contraseña", roto)).toBe(false);
    }
  });

  it("el hash de relleno no coincide con nada razonable", async () => {
    expect(await verificarContrasena("", await hashFalso())).toBe(false);
    expect(await hashFalso()).toBe(await hashFalso()); // se calcula una sola vez
  });

  it("las contraseñas temporales son fáciles de dictar y no se repiten", () => {
    const temporales = Array.from({ length: 200 }, generarContrasenaTemporal);
    for (const t of temporales) expect(t).toMatch(/^[a-hjkmnp-z2-9]{4}(-[a-hjkmnp-z2-9]{4}){3}$/);
    expect(new Set(temporales).size).toBe(200);
  });
});

describe("reglas para una contraseña nueva", () => {
  it("pide largo mínimo, sin espacios en las puntas y distinta del email", () => {
    expect(problemaConContrasenaNueva("corta", "a@b.com")).toMatch(/al menos 10/);
    expect(problemaConContrasenaNueva("x".repeat(129), "a@b.com")).toMatch(/hasta 128/);
    expect(problemaConContrasenaNueva(" con espacio al principio", "a@b.com")).toMatch(/espacios/);
    expect(problemaConContrasenaNueva("Ana@Gmail.com", "ana@gmail.com")).toMatch(/email/);
    expect(problemaConContrasenaNueva("aaaaaaaaaaaa", "a@b.com")).toMatch(/adivinar/);
    expect(problemaConContrasenaNueva("mate amargo en la costanera", "a@b.com")).toBeNull();
  });
});
