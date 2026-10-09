// El PDF con las entradas de una compra: una página (tamaño A6, cómoda en el
// celu y para imprimir) por entrada, con el evento, el tipo, quién entra y
// su QR. Se arma en el momento, en nuestro servidor, y no se guarda: con la
// base y CLAVE_CODIGOS se vuelve a armar igual cuando haga falta.
//
// El QR va dibujado con rectángulos (vectorial): se ve nítido con cualquier
// zoom y el archivo queda chico.
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib";

import { formatearFechaLarga } from "@/lib/fechas";
import { formatearDni } from "@/lib/ventas/datos";

import { MARGEN_QR, matrizQr, tramosQr } from "./qr";

export type EntradaParaPdf = {
  numero: number; // "Entrada 2 de 3"
  tipo: string;
  titular: string;
  dni: string;
  codigoFirmado: string; // lo que va en el QR
  usada?: boolean; // ya se usó para entrar
};

export type DatosPdf = {
  evento: { nombre: string; fecha: Date; lugar: string; direccion: string | null };
  compra: number;
  totalEntradas: number;
  entradas: EntradaParaPdf[];
};

const ANCHO = 297.64; // A6, en puntos
const ALTO = 419.53;
const BORDE = 22;
const LADO_QR = 196;
const TINTA = rgb(0.1, 0.1, 0.12);
const TENUE = rgb(0.38, 0.38, 0.42);

// Las fuentes estándar del PDF solo tienen las letras de Europa occidental
// (WinAnsi). Lo demás se pasa a la letra sin acento si se puede (ő → o) y si
// no, a "?": un nombre raro nunca rompe el PDF.
const EXTRAS_WINANSI = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
function entraEnWinAnsi(letra: string) {
  const codigo = letra.codePointAt(0)!;
  return (codigo >= 0x20 && codigo <= 0x7e) || (codigo >= 0xa0 && codigo <= 0xff) || EXTRAS_WINANSI.includes(letra);
}

export function aTextoPdf(texto: string) {
  let resultado = "";
  // Primero los espacios raros (tab, salto de línea) a espacio; después, fuera
  // lo invisible: caracteres de control y el guion opcional.
  const limpio = texto.normalize("NFC").replace(/\s+/g, " ").replace(/[\p{Cc}\u00AD]/gu, "");
  for (const letra of limpio) {
    if (entraEnWinAnsi(letra)) {
      resultado += letra;
      continue;
    }
    const sinAcento = letra.normalize("NFD").replace(/\p{M}/gu, "");
    resultado += sinAcento && [...sinAcento].every(entraEnWinAnsi) ? sinAcento : "?";
  }
  return resultado.trim().replace(/ {2,}/g, " ");
}

// En mayúsculas, salvo las letras cuya mayúscula no está en la fuente (µ → Μ griega).
function aMayusculas(texto: string) {
  return [...aTextoPdf(texto)]
    .map((letra) => {
      const mayuscula = letra.toUpperCase();
      return [...mayuscula].every(entraEnWinAnsi) ? mayuscula : letra;
    })
    .join("");
}

// Corta el texto en renglones que entren en el ancho (como mucho `maximo`;
// el último termina en "…" si no entra todo).
function renglones(texto: string, fuente: PDFFont, tamano: number, ancho: number, maximo: number) {
  const medir = (t: string) => fuente.widthOfTextAtSize(t, tamano);
  const lineas: string[] = [];
  let actual = "";
  for (const palabra of texto.split(" ")) {
    const probando = actual ? `${actual} ${palabra}` : palabra;
    if (medir(probando) <= ancho || !actual) actual = probando;
    else {
      lineas.push(actual);
      actual = palabra;
    }
  }
  if (actual) lineas.push(actual);
  const recortar = (linea: string) => {
    while (linea.length > 1 && medir(`${linea}…`) > ancho) linea = linea.slice(0, -1);
    return `${linea.trimEnd()}…`;
  };
  return lineas
    .slice(0, maximo)
    .map((linea, i) => (medir(linea) > ancho || (i === maximo - 1 && lineas.length > maximo) ? recortar(linea) : linea));
}

type Fuentes = { normal: PDFFont; negrita: PDFFont; mono: PDFFont };

// Escribe renglones desde `y` (la parte de arriba) hacia abajo; devuelve dónde quedó.
function escribir(
  pagina: PDFPage,
  texto: string,
  y: number,
  opciones: { fuente: PDFFont; tamano: number; color?: ReturnType<typeof rgb>; maximo?: number; centrado?: boolean },
) {
  const { fuente, tamano, color = TINTA, maximo = 1, centrado = false } = opciones;
  const ancho = ANCHO - 2 * BORDE;
  let abajo = y;
  for (const linea of renglones(aTextoPdf(texto), fuente, tamano, ancho, maximo)) {
    abajo -= tamano * 1.2;
    const x = centrado ? (ANCHO - fuente.widthOfTextAtSize(linea, tamano)) / 2 : BORDE;
    pagina.drawText(linea, { x, y: abajo + tamano * 0.22, size: tamano, font: fuente, color });
  }
  return abajo;
}

function dibujarQr(pagina: PDFPage, texto: string, x: number, y: number) {
  const matriz = matrizQr(texto);
  const modulo = LADO_QR / (matriz.tamano + 2 * MARGEN_QR);
  pagina.drawRectangle({ x, y, width: LADO_QR, height: LADO_QR, color: rgb(1, 1, 1) });
  for (const [fila, columna, largo] of tramosQr(matriz)) {
    pagina.drawRectangle({
      x: x + (columna + MARGEN_QR) * modulo,
      // En el PDF la y crece hacia arriba: la fila 0 va arriba de todo.
      y: y + LADO_QR - (fila + MARGEN_QR + 1) * modulo,
      width: largo * modulo,
      height: modulo,
      color: rgb(0, 0, 0),
    });
  }
}

function paginaDeEntrada(pdf: PDFDocument, fuentes: Fuentes, datos: DatosPdf, entrada: EntradaParaPdf) {
  const pagina = pdf.addPage([ANCHO, ALTO]);
  const { evento } = datos;
  let y = ALTO - BORDE + 4;

  y = escribir(pagina, evento.nombre, y, { fuente: fuentes.negrita, tamano: 15, maximo: 2 });
  y = escribir(pagina, formatearFechaLarga(evento.fecha), y - 2, { fuente: fuentes.normal, tamano: 9.5 });
  const lugar = evento.direccion ? `${evento.lugar} · ${evento.direccion}` : evento.lugar;
  y = escribir(pagina, lugar, y, { fuente: fuentes.normal, tamano: 9.5, color: TENUE, maximo: 2 });

  pagina.drawLine({ start: { x: BORDE, y: y - 6 }, end: { x: ANCHO - BORDE, y: y - 6 }, thickness: 0.6, color: TENUE });
  y -= 8;
  y = escribir(pagina, aMayusculas(entrada.tipo), y, { fuente: fuentes.negrita, tamano: 13, maximo: 1 });
  y = escribir(pagina, `Entrada ${entrada.numero} de ${datos.totalEntradas} · Compra N° ${datos.compra}`, y, {
    fuente: fuentes.normal,
    tamano: 8.5,
    color: TENUE,
  });

  const yQr = y - 4 - LADO_QR;
  dibujarQr(pagina, entrada.codigoFirmado, (ANCHO - LADO_QR) / 2, yQr);
  y = escribir(pagina, entrada.codigoFirmado, yQr + 2, { fuente: fuentes.mono, tamano: 5.6, color: TENUE, centrado: true });

  y = escribir(pagina, entrada.titular, y - 2, { fuente: fuentes.negrita, tamano: 11.5, maximo: 1, centrado: true });
  y = escribir(pagina, `DNI ${formatearDni(entrada.dni)}`, y, { fuente: fuentes.normal, tamano: 10, centrado: true });
  if (entrada.usada) escribir(pagina, "YA USADA", y, { fuente: fuentes.negrita, tamano: 9, color: TENUE, centrado: true });

  escribir(pagina, "Mostrá este QR en la puerta junto con tu DNI. Cada QR sirve para entrar una sola vez: no lo publiques.", BORDE + 22, {
    fuente: fuentes.normal,
    tamano: 7.5,
    color: TENUE,
    maximo: 2,
    centrado: true,
  });
}

export async function armarPdfEntradas(datos: DatosPdf): Promise<Uint8Array> {
  if (datos.entradas.length === 0) throw new Error("PDF sin entradas");
  const pdf = await PDFDocument.create();
  const titulo = aTextoPdf(`Entradas · ${datos.evento.nombre}`);
  pdf.setTitle(titulo);
  pdf.setSubject(titulo);
  pdf.setCreator("Siste-MA");
  pdf.setProducer("Siste-MA");
  const fuentes: Fuentes = {
    normal: await pdf.embedFont(StandardFonts.Helvetica),
    negrita: await pdf.embedFont(StandardFonts.HelveticaBold),
    mono: await pdf.embedFont(StandardFonts.Courier),
  };
  for (const entrada of datos.entradas) paginaDeEntrada(pdf, fuentes, datos, entrada);
  return pdf.save();
}
