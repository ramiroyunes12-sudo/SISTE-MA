// El QR de la entrada: lo leemos con un lector de verdad (jsQR) para
// asegurarnos de que lleva exactamente el código firmado y nada más.
import jsQR from "jsqr";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { firmarCodigo, leerCodigo, nuevoCodigo } from "./codigo";
import { MARGEN_QR, matrizQr, qrParaSvg, tramosQr } from "./qr";

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
});
