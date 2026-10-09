// El QR de cada entrada. Lleva solo el código firmado (E1-…-…), nunca nombre
// ni DNI. Se arma acá, en nuestro servidor (sin servicios de afuera), y no se
// guarda: se vuelve a armar desde la base cada vez que hace falta (página de
// la compra, PDF y mail).
//
// El código usa solo mayúsculas, números y "-": el QR sale en modo
// alfanumérico, versión 4 (33×33), con corrección de errores M (se lee aunque
// falte ~15%, por ejemplo con la pantalla rayada).
import { crc32, deflateSync } from "node:zlib";

import QRCode from "qrcode";

export const MARGEN_QR = 4; // el borde blanco que piden los lectores, en módulos

export type MatrizQr = { tamano: number; oscuro: (fila: number, columna: number) => boolean };

export function matrizQr(texto: string): MatrizQr {
  const { modules } = QRCode.create(texto, { errorCorrectionLevel: "M" });
  return { tamano: modules.size, oscuro: (fila, columna) => modules.get(fila, columna) === 1 };
}

// Los módulos negros, juntando los que están seguidos en cada fila:
// [fila, columna, largo]. Sirve para dibujarlo en SVG y en el PDF.
export function tramosQr(matriz: MatrizQr): [number, number, number][] {
  const tramos: [number, number, number][] = [];
  for (let fila = 0; fila < matriz.tamano; fila++) {
    let columna = 0;
    while (columna < matriz.tamano) {
      if (!matriz.oscuro(fila, columna)) {
        columna++;
        continue;
      }
      const inicio = columna;
      while (columna < matriz.tamano && matriz.oscuro(fila, columna)) columna++;
      tramos.push([fila, inicio, columna - inicio]);
    }
  }
  return tramos;
}

// Para un <svg>: el lado total (con el margen) y el dibujo de los módulos.
export function qrParaSvg(texto: string) {
  const matriz = matrizQr(texto);
  const camino = tramosQr(matriz)
    .map(([fila, columna, largo]) => `M${columna + MARGEN_QR} ${fila + MARGEN_QR}h${largo}v1h-${largo}z`)
    .join("");
  return { lado: matriz.tamano + 2 * MARGEN_QR, camino };
}

// Para el mail: una imagen PNG en blanco y negro (Gmail no muestra SVG ni
// imágenes "data:", así que va adjunta y el mail la nombra por su cid). Se
// arma acá con los mismos módulos que el SVG y el PDF. `escala`: píxeles por
// módulo.
export function qrPng(texto: string, escala = 8): Buffer {
  const matriz = matrizQr(texto);
  const lado = (matriz.tamano + 2 * MARGEN_QR) * escala;
  const bytesPorFila = Math.ceil(lado / 8);
  // Cada fila: un byte de filtro (0, sin filtro) y 1 bit por píxel (1 = blanco).
  const crudo = Buffer.alloc((bytesPorFila + 1) * lado);
  for (let y = 0; y < lado; y++) {
    const fila = Math.floor(y / escala) - MARGEN_QR;
    const inicio = y * (bytesPorFila + 1) + 1;
    for (let x = 0; x < lado; x++) {
      const columna = Math.floor(x / escala) - MARGEN_QR;
      const dentro = fila >= 0 && fila < matriz.tamano && columna >= 0 && columna < matriz.tamano;
      if (!(dentro && matriz.oscuro(fila, columna))) crudo[inicio + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  const cabecera = Buffer.alloc(13);
  cabecera.writeUInt32BE(lado, 0);
  cabecera.writeUInt32BE(lado, 4);
  cabecera[8] = 1; // 1 bit por píxel
  cabecera[9] = 0; // escala de grises
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloquePng("IHDR", cabecera),
    bloquePng("IDAT", deflateSync(crudo)),
    bloquePng("IEND", Buffer.alloc(0)),
  ]);
}

function bloquePng(tipo: string, datos: Buffer) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const contenido = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
  const control = Buffer.alloc(4);
  control.writeUInt32BE(crc32(contenido));
  return Buffer.concat([largo, contenido, control]);
}
