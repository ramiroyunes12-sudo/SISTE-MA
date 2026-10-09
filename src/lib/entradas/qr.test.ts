// El QR de la entrada: lo leemos con un lector de verdad (jsQR) para
// asegurarnos de que lleva exactamente el código firmado y nada más.
import { inflateSync } from "node:zlib";

import jsQR from "jsqr";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { firmarCodigo, leerCodigo, nuevoCodigo } from "./codigo";
import { MARGEN_QR, matrizQr, qrParaSvg, qrPng, tramosQr } from "./qr";

// Pinta los tramos (lo mismo que dibujan el SVG y el PDF) en una imagen y la lee.
function leerQr(texto: string) {
  const matriz = matrizQr(texto);
  const escala = 8;
  const lado = (matriz.tamano + 2 * MARGEN_QR) * escala;
  const pixeles = new Uint8ClampedArray(lado * lado * 4).fill(255);
  for (const [fila, columna, largo] of tramosQr(matriz)) {
    for (let y = (fila + MARGEN_QR) * escala; y < (fila + MARGEN_QR + 1) * escala; y++) {
      for (let x = (columna + MARGEN_QR) * escala; x < (columna + MARGEN_QR + largo) * escala; x++) {
        pixeles.fill(0, (y * lado + x) * 4, (y * lado + x) * 4 + 3);
      }
    }
  }
  return jsQR(pixeles, lado, lado)?.data ?? null;
}

// Abre el PNG del mail (1 bit por píxel, sin filtros) y lo lee con jsQR.
function leerPng(png: Buffer) {
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  let posicion = 8;
  let lado = 0;
  const datos: Buffer[] = [];
  while (posicion < png.length) {
    const largo = png.readUInt32BE(posicion);
    const tipo = png.subarray(posicion + 4, posicion + 8).toString("ascii");
    const contenido = png.subarray(posicion + 8, posicion + 8 + largo);
    if (tipo === "IHDR") {
      lado = contenido.readUInt32BE(0);
      expect(contenido.readUInt32BE(4)).toBe(lado);
      expect([contenido[8], contenido[9]]).toEqual([1, 0]); // 1 bit, grises
    }
    if (tipo === "IDAT") datos.push(contenido);
    posicion += 12 + largo;
  }
  const crudo = inflateSync(Buffer.concat(datos));
  const porFila = Math.ceil(lado / 8) + 1;
  const pixeles = new Uint8ClampedArray(lado * lado * 4).fill(255);
  for (let y = 0; y < lado; y++) {
    expect(crudo[y * porFila]).toBe(0);
    for (let x = 0; x < lado; x++) {
      const blanco = (crudo[y * porFila + 1 + (x >> 3)] >> (7 - (x & 7))) & 1;
      if (!blanco) pixeles.fill(0, (y * lado + x) * 4, (y * lado + x) * 4 + 3);
    }
  }
  return { lado, leido: jsQR(pixeles, lado, lado)?.data ?? null };
}

describe("QR de la entrada", () => {
  let anterior: string | undefined;
  beforeAll(() => {
    anterior = process.env.CLAVE_CODIGOS;
    process.env.CLAVE_CODIGOS = "clave-de-prueba-de-los-tests-con-mas-de-32-caracteres";
  });
  afterAll(() => {
    if (anterior === undefined) delete process.env.CLAVE_CODIGOS;
    else process.env.CLAVE_CODIGOS = anterior;
  });

  it("un lector lo lee y da exactamente el código firmado, que la puerta acepta", () => {
    const firmado = firmarCodigo(nuevoCodigo());
    const leido = leerQr(firmado);
    expect(leido).toBe(firmado);
    expect(leerCodigo(leido)).toEqual({ ok: true, codigo: firmado.split("-")[1] });
  });

  it("es chico: versión 4 (33×33), porque el código va en modo alfanumérico", () => {
    expect(matrizQr(firmarCodigo(nuevoCodigo())).tamano).toBe(33);
  });

  it("el SVG dibuja cada módulo negro una sola vez, dentro del margen blanco", () => {
    const firmado = firmarCodigo(nuevoCodigo());
    const matriz = matrizQr(firmado);
    const { lado, camino } = qrParaSvg(firmado);
    expect(lado).toBe(33 + 2 * MARGEN_QR);
    let negros = 0;
    for (let f = 0; f < matriz.tamano; f++) for (let c = 0; c < matriz.tamano; c++) if (matriz.oscuro(f, c)) negros++;
    const dibujados = [...camino.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)];
    expect(dibujados.map((m) => m[0]).join("")).toBe(camino);
    expect(dibujados.reduce((suma, m) => suma + Number(m[3]), 0)).toBe(negros);
    for (const [, x, y, largo] of dibujados) {
      expect(Number(x)).toBeGreaterThanOrEqual(MARGEN_QR);
      expect(Number(y)).toBeGreaterThanOrEqual(MARGEN_QR);
      expect(Number(x) + Number(largo)).toBeLessThanOrEqual(lado - MARGEN_QR);
    }
  });

  it("el PNG del mail se lee y da exactamente el código firmado", () => {
    const firmado = firmarCodigo(nuevoCodigo());
    const { lado, leido } = leerPng(qrPng(firmado));
    expect(lado).toBe((33 + 2 * MARGEN_QR) * 8);
    expect(leido).toBe(firmado);
  });
});
