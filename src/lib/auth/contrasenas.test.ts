import { describe, expect, it } from "vitest";

import { generarContrasenaTemporal, HASH_DE_RELLENO, hashearContrasena, verificarContrasena } from "./contrasenas";
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
      ["scrypt", "18", ...partes.slice(2)].join("$"), // necesitaría más memoria que la permitida
      ["scrypt", "17", "16", "1", ...partes.slice(4)].join("$"), // ídem
      ["scrypt", "17", "8", "1", partes[4], "corto"].join("$"),
      ["scrypt", "17", "8", "1", "", partes[5]].join("$"), // sin sal
    ]) {
      expect(await verificarContrasena("una contraseña", roto)).toBe(false);
    }
  });

  it("el hash de relleno tiene el formato real (tarda lo mismo) y no coincide con nada", async () => {
    expect(HASH_DE_RELLENO).toMatch(/^scrypt\$17\$8\$1\$[\w-]{22}\$[\w-]{43}$/);
    for (const intento of ["", "admin", "mate amargo en la costanera"]) {
      expect(await verificarContrasena(intento, HASH_DE_RELLENO)).toBe(false);
    }
  });

  it("las contraseñas temporales son fáciles de dictar y no se repiten", () => {
    const temporales = Array.from({ length: 200 }, generarContrasenaTemporal);
    for (const t of temporales) expect(t).toMatch(/^[a-hjkmnp-z2-9]{4}(-[a-hjkmnp-z2-9]{4}){3}$/);
    expect(new Set(temporales).size).toBe(200);
  });
});

describe("reglas para una contraseña nueva", () => {
  const email = "ana.gomez@gmail.com";

  it("pide largo mínimo y máximo, sin espacios en las puntas", () => {
    expect(problemaConContrasenaNueva("corta", email)).toMatch(/al menos 10/);
    expect(problemaConContrasenaNueva("x".repeat(129), email)).toMatch(/hasta 128/);
    expect(problemaConContrasenaNueva(" con espacio al principio", email)).toMatch(/espacios/);
  });

  it("rechaza las más usadas, secuencias, repeticiones y el propio email", () => {
    const rechazadas: [string, RegExp][] = [
      ["1234567890", /letras/],
      ["!@#$%^&*()_+", /letras/],
      ["0123456789", /letras/],
      ["contraseña", /más usadas/],
      ["Contraseña123!", /más usadas/],
      ["argentina1", /más usadas/],
      ["password12", /más usadas/],
      ["Boca Juniors 2024", /más usadas/],
      ["P@ssw0rd123", /más usadas/],
      ["Pa$$word2026", /más usadas/],
      ["C0ntr4s3n4!", /más usadas/],
      ["Contr@seña123", /más usadas/],
      ["4rgentina2026", /más usadas/],
      ["Adm1n12345!", /más usadas/],
      ["W3lcome2024", /más usadas/],
      ["qwertyuiop", /secuencia/],
      ["poiuytrewq", /secuencia/],
      ["1q2w3e4r5t", /secuencia/],
      ["a1234567890", /secuencia/],
      ["zxcvbnm123", /secuencia/],
      ["aaaaaaaaab", /adivinar/],
      ["abababab12", /adivinar/],
      ["ab12ab12ab12", /adivinar/],
      ["Ana.Gomez@Gmail.com", /email/],
      ["ana.gomez2024", /email/],
    ];
    for (const [contrasena, motivo] of rechazadas) {
      expect(problemaConContrasenaNueva(contrasena, email), contrasena).toMatch(motivo);
    }
  });

  it("acepta frases y contraseñas al azar", () => {
    for (const contrasena of [
      "mate amargo en la costanera",
      "tres perros y un gato",
      "Río Paraná 1816 grande",
      "x7#k9!q2@zR",
      "canción-de-cuna",
      "amor de verano en corrientes", // empieza con una palabra común, pero sigue
      "#9$!Q%&*@k-x", // al azar, con pocas letras y un número
      "Sapo-8273-5519!",
      "Привет мир 2026",
    ]) {
      expect(problemaConContrasenaNueva(contrasena, email), contrasena).toBeNull();
    }
  });
});
