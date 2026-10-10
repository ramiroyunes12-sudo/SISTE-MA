import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { celdasATexto, leerPlanilla } from "./planilla";
import { ArchivoIlegible, leerTextoDeArchivo, leerXlsx } from "./xlsx";

// Un .xlsx mínimo como los que guardan Excel y Google Sheets: el libro, sus
// relaciones, los textos compartidos y una hoja (con otro nombre que sheet1).
function xlsx(hoja: string, compartidos: string[]) {
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "xl/workbook.xml": strToU8(
      '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Invitados" sheetId="1" r:id="rId3"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<Relationships><Relationship Id="rId1" Target="styles.xml"/><Relationship Id="rId3" Target="worksheets/hoja-invitados.xml"/></Relationships>',
    ),
    "xl/sharedStrings.xml": strToU8(`<sst>${compartidos.map((s) => `<si>${s}</si>`).join("")}</sst>`),
    "xl/worksheets/hoja-invitados.xml": strToU8(`<worksheet><sheetData>${hoja}</sheetData></worksheet>`),
  });
}

describe("leer un .xlsx en el navegador", () => {
  it("las celdas de la primera hoja: textos compartidos (con formato y entidades), números, texto en la celda y huecos", () => {
    const bytes = xlsx(
      [
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="s"><v>2</v></c></row>',
        '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>40123456</v></c><c r="D2" t="inlineStr"><is><t>juana@mail.com</t></is></c></row>',
        // La fila 3 no existe en el archivo (vacía); la 4 tiene una fórmula de texto.
        '<row r="4"><c r="A4" t="s"><v>4</v></c><c r="B4" t="str"><f>A1</f><v>30111222</v></c></row>',
      ].join(""),
      [
        "<t>Nombre</t>",
        "<t>DNI</t>",
        "<t>Email</t>",
        '<r><t>Juana</t></r><r><rPr><b/></rPr><t xml:space="preserve"> Pérez &amp; Cía</t></r><rPh><t>ふりがな</t></rPh>',
        "<t>O&apos;Connor Ana</t>",
      ],
    );
    const filas = leerXlsx(bytes);
    expect(filas).toEqual([["Nombre", "DNI", "", "Email"], ["Juana Pérez & Cía", "40123456", "", "juana@mail.com"], [], ["O'Connor Ana", "30111222"]]);
    // Y sigue como si se hubiera pegado: las filas con los números del Excel.
    const { filas: leidas } = leerPlanilla(celdasATexto(filas), ["General"]);
    expect(leidas.map((f) => [f.fila, f.nombre, f.dni, f.email])).toEqual([
      [2, "Juana Pérez & Cía", "40123456", "juana@mail.com"],
      [4, "O'Connor Ana", "30111222", ""],
    ]);
  });

  it("algo que no es un .xlsx: ArchivoIlegible", () => {
    expect(() => leerXlsx(strToU8("Nombre;DNI"))).toThrow(ArchivoIlegible);
    expect(() => leerXlsx(zipSync({ "otra.txt": strToU8("hola") }))).toThrow(ArchivoIlegible);
  });

  it("un CSV en UTF-8 (con BOM) o en Windows-1252 (el del Excel en castellano) se lee con sus tildes", () => {
    expect(leerTextoDeArchivo(strToU8("﻿Nombre;DNI\nJosé Muñoz;40123456"))).toBe("Nombre;DNI\nJosé Muñoz;40123456");
    const windows1252 = Uint8Array.from([0x4a, 0x6f, 0x73, 0xe9, 0x20, 0x4d, 0x75, 0xf1, 0x6f, 0x7a]); // "José Muñoz"
    expect(leerTextoDeArchivo(windows1252)).toBe("José Muñoz");
  });
});
