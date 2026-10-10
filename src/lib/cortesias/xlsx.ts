// Leer un .xlsx (Excel o Google Sheets → Descargar → Microsoft Excel) para la
// carga masiva de cortesías: las celdas de la primera hoja, como texto. Se lee
// en el navegador de quien carga (el archivo no se sube): después se pasa a
// texto (celdasATexto) y sigue igual que si lo hubiera pegado.
//
// Un .xlsx es un .zip con XML adentro. Solo se mira lo que hace falta para
// una lista de nombres, DNI y emails: los textos compartidos
// (sharedStrings.xml) y las celdas de la primera hoja; ni fórmulas ni
// formatos (de una fórmula, el último valor que guardó el Excel).
import { strFromU8, unzipSync } from "fflate";

export const MAX_BYTES_ARCHIVO = 5 * 1024 * 1024;
const MAX_FILAS_LEIDAS = 2000;
const MAX_COLUMNAS = 30;

function desescapar(texto: string) {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (todo, entidad: string) => {
    const e = entidad.toLowerCase();
    if (e === "amp") return "&";
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "quot") return '"';
    if (e === "apos") return "'";
    const codigo = e.startsWith("#x") ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(codigo) && codigo > 0 && codigo <= 0x10ffff ? String.fromCodePoint(codigo) : todo;
  });
}

// Todo el texto de un <si> o un <is>: los <t> sueltos o de cada <r> (texto
// con formatos), sin la guía de pronunciación (<rPh>).
function textoDe(xml: string) {
  const sinGuia = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let texto = "";
  for (const t of sinGuia.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)) texto += desescapar(t[1] ?? "");
  return texto;
}

// "AB12" → 27 (la columna, desde 0).
function columna(referencia: string) {
  const letras = /^[A-Z]+/.exec(referencia)?.[0] ?? "";
  let numero = 0;
  for (const letra of letras) numero = numero * 26 + (letra.charCodeAt(0) - 64);
  return numero - 1;
}

// La ruta de la primera hoja según el libro (por si no es sheet1.xml).
function primeraHoja(archivos: Record<string, Uint8Array>) {
  const libro = archivos["xl/workbook.xml"] && strFromU8(archivos["xl/workbook.xml"]);
  const relaciones = archivos["xl/_rels/workbook.xml.rels"] && strFromU8(archivos["xl/_rels/workbook.xml.rels"]);
  const id = libro && /<sheet\b[^>]*\br:id="([^"]+)"/.exec(libro)?.[1];
  if (id && relaciones) {
    for (const relacion of relaciones.matchAll(/<Relationship\b[^>]*>/g)) {
      if (!relacion[0].includes(`Id="${id}"`)) continue;
      const destino = /Target="([^"]+)"/.exec(relacion[0])?.[1];
      if (destino) return destino.startsWith("/") ? destino.slice(1) : `xl/${destino.replace(/^\.\//, "")}`;
    }
  }
  return "xl/worksheets/sheet1.xml";
}

export class ArchivoIlegible extends Error {}

// Las filas de la primera hoja (cada una, sus celdas como texto). Tira
// ArchivoIlegible si no es un .xlsx que se pueda leer.
export function leerXlsx(bytes: Uint8Array): string[][] {
  let archivos: Record<string, Uint8Array>;
  try {
    archivos = unzipSync(bytes, {
      filter: (archivo) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(archivo.name),
    });
  } catch {
    throw new ArchivoIlegible("No es un .xlsx");
  }
  const ruta = primeraHoja(archivos);
  const hoja = archivos[ruta];
  if (!hoja) throw new ArchivoIlegible("No tiene hojas");

  const compartidos: string[] = [];
  if (archivos["xl/sharedStrings.xml"]) {
    for (const si of strFromU8(archivos["xl/sharedStrings.xml"]).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) {
      compartidos.push(textoDe(si[1] ?? ""));
    }
  }

  const filas: string[][] = [];
  for (const fila of strFromU8(hoja).matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const numero = Number(/\br="(\d+)"/.exec(fila[1])?.[1] ?? filas.length + 1);
    if (numero > MAX_FILAS_LEIDAS) break;
    const celdas: string[] = [];
    let siguiente = 0;
    for (const celda of fila[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const atributos = celda[1];
      const contenido = celda[2] ?? "";
      const referencia = /\br="([A-Z]+\d+)"/.exec(atributos)?.[1];
      const lugar = referencia ? columna(referencia) : siguiente;
      siguiente = lugar + 1;
      if (lugar >= MAX_COLUMNAS) continue;
      const tipo = /\bt="([^"]+)"/.exec(atributos)?.[1];
      const valor = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(contenido)?.[1];
      let texto = "";
      if (tipo === "s") texto = compartidos[Number(valor)] ?? "";
      else if (tipo === "inlineStr") texto = textoDe(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(contenido)?.[1] ?? "");
      else if (valor !== undefined) texto = desescapar(valor);
      while (celdas.length < lugar) celdas.push("");
      celdas[lugar] = texto.trim();
    }
    while (filas.length < numero - 1) filas.push([]);
    filas[numero - 1] = celdas;
  }
  return filas;
}

// Un CSV guardado por el Excel en castellano viene en Windows-1252 (no UTF-8):
// si no es UTF-8 válido, se lee así (las tildes y la ñ quedan bien).
export function leerTextoDeArchivo(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
