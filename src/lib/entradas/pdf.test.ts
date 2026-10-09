// El PDF de las entradas: una página por entrada y nunca se rompe por un
// nombre o un evento con letras raras.
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { aTextoPdf, armarPdfEntradas, type DatosPdf } from "./pdf";

const CODIGO = "E1-0123456789ABCDEF0123456789ABCDEF-FEDCBA9876543210FEDCBA9876543210";

function datos(cambios: Partial<DatosPdf> = {}): DatosPdf {
  return {
    evento: { nombre: "Fiesta de Primavera", fecha: new Date("2030-11-21T23:00:00-03:00"), lugar: "Club Social", direccion: "Junín 1234" },
    compra: 12,
    totalEntradas: 2,
    entradas: [
      { numero: 1, tipo: "General", titular: "María José Núñez", dni: "30111222", codigoFirmado: CODIGO },
      { numero: 2, tipo: "VIP", titular: "Ana O’Connor", dni: "4555666", codigoFirmado: CODIGO },
    ],
    ...cambios,
  };
}

describe("texto para el PDF", () => {
  it("deja igual el castellano (acentos, ñ, ü, ’, °, ·)", () => {
    expect(aTextoPdf("Núñez Güemes O’Brien N° 1 · ¡Sí!")).toBe("Núñez Güemes O’Brien N° 1 · ¡Sí!");
  });

  it("lo que no entra en la fuente: sin acento si se puede, si no ?", () => {
    expect(aTextoPdf("Łukasz Dvořák Erdős")).toBe("?ukasz Dvorák Erdos");
    expect(aTextoPdf("Иван 🎉 李")).toBe("???? ? ?");
  });

  it("junta espacios y saltos de línea", () => {
    expect(aTextoPdf("  Fiesta\n\tde   noche ")).toBe("Fiesta de noche");
  });
});

describe("PDF de las entradas", () => {
  it("una página por entrada, con título", async () => {
    const pdf = await PDFDocument.load(await armarPdfEntradas(datos()));
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getTitle()).toBe("Entradas · Fiesta de Primavera");
  });

  it("no se rompe con nombres raros ni textos muy largos", async () => {
    const largo = "Supercalifragilisticoespialidoso".repeat(6);
    const pdf = await armarPdfEntradas(
      datos({
        evento: { nombre: `🎉 Fiesta Иван ${largo} `.repeat(3), fecha: new Date(), lugar: largo, direccion: null },
        entradas: [{ numero: 1, tipo: largo, titular: `Łukasz 李 ${largo}`, dni: "1234567", codigoFirmado: CODIGO }],
      }),
    );
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
  });

  it("sin entradas no arma nada", async () => {
    await expect(armarPdfEntradas(datos({ entradas: [] }))).rejects.toThrow();
  });
});
