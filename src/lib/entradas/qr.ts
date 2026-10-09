// El QR de cada entrada. Lleva solo el código firmado (E1-…-…), nunca nombre
// ni DNI. Se arma acá, en nuestro servidor (sin servicios de afuera), y no se
// guarda: se vuelve a armar desde la base cada vez que hace falta (página de
// la compra, PDF y, más adelante, el mail).
//
// El código usa solo mayúsculas, números y "-": el QR sale en modo
// alfanumérico, versión 4 (33×33), con corrección de errores M (se lee aunque
// falte ~15%, por ejemplo con la pantalla rayada).
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
