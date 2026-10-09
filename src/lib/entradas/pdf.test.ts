// El PDF de las entradas: una página por entrada y nunca se rompe por un
// nombre o un evento con letras raras.
import { inflateSync } from "node:zlib";

import jsQR from "jsqr";
import { PDFArray, PDFDocument, type PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { armarPdfEntradas, type DatosPdf } from "./pdf";
import { aTextoPdf } from "./texto-pdf";

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

// Las letras 0x80-0x9F de WinAnsi (las demás son iguales a Latin-1).
const WINANSI_80_9F = "€?‚ƒ„…†‡ˆ‰Š‹Œ?Ž??‘’“”•–—˜™š›œ?žŸ";

// Lee una página del PDF ya armado: los textos que escribe y, pintando sus
// rectángulos negros en una imagen, lo que dice su QR (con un lector real).
async function leerPagina(bytes: Uint8Array, numero: number) {
  const pdf = await PDFDocument.load(bytes);
  const pagina = pdf.getPage(numero);
  const contenido = pdf.context.lookup(pagina.node.Contents());
  const flujos = (contenido instanceof PDFArray ? contenido.asArray().map((r) => pdf.context.lookup(r)) : [contenido]) as PDFRawStream[];
  const ops = flujos.map((f) => inflateSync(Buffer.from(f.contents)).toString("latin1")).join("\n");

  const textos = [...ops.matchAll(/<([0-9A-F]*)> Tj/g)].map((m) =>
    [...Buffer.from(m[1], "hex")].map((b) => (b >= 0x80 && b <= 0x9f ? WINANSI_80_9F[b - 0x80] : String.fromCharCode(b))).join(""),
  );

  const escala = 4;
  const { width, height } = pagina.getSize();
  const ancho = Math.ceil(width * escala);
  const alto = Math.ceil(height * escala);
  const pixeles = new Uint8ClampedArray(ancho * alto * 4).fill(255);
  for (const bloque of ops.split(/\nQ\n?/)) {
    if (!/^0 0 0 rg$/m.test(bloque)) continue;
    const mover = /^1 0 0 1 ([\d.-]+) ([\d.-]+) cm$/m.exec(bloque);
    const lado = /^([\d.]+) ([\d.]+) l\n[\d.]+ 0 l\nh\nf$/m.exec(bloque);
    if (!mover || !lado) continue;
    const [x, y, w, h] = [mover[1], mover[2], lado[1], lado[2]].map(Number);
    // En el PDF la y crece hacia arriba; en la imagen, hacia abajo.
    for (let py = Math.round((height - y - h) * escala); py < Math.round((height - y) * escala); py++) {
      for (let px = Math.round(x * escala); px < Math.round((x + w) * escala); px++) {
        pixeles.fill(0, (py * ancho + px) * 4, (py * ancho + px) * 4 + 3);
      }
    }
  }
  return { textos, qr: jsQR(pixeles, ancho, alto)?.data ?? null };
}

describe("texto para el PDF", () => {
  it("deja igual el castellano (acentos, ñ, ü, ’, °, ·)", () => {
    expect(aTextoPdf("Núñez Güemes O’Brien N° 1 · ¡Sí!")).toBe("Núñez Güemes O’Brien N° 1 · ¡Sí!");
  });

  it("lo que no entra en la fuente: sin acento si se puede, si no ?", () => {
    expect(aTextoPdf("Łukasz Dvořák Erdős")).toBe("?ukasz Dvorák Erdos");
    expect(aTextoPdf("Иван 李")).toBe("???? ?");
  });

  it("junta espacios y saltos de línea", () => {
    expect(aTextoPdf("  Fiesta\n\tde   noche ")).toBe("Fiesta de noche");
  });

  it("saca los emojis y las banderas (no se pueden imprimir), pero no © ni ®", () => {
    expect(aTextoPdf("Noche ❤️ Retro 🇦🇷 🎃👻 Fest")).toBe("Noche Retro Fest");
    expect(aTextoPdf("Fiesta 👨‍👩‍👧 1️⃣ © ®")).toBe("Fiesta 1 © ®");
  });

  it("saca caracteres invisibles (de control y guion opcional)", () => {
    expect(aTextoPdf("Ana\u00ADbel O\u0007Connor\u0085 \u009F")).toBe("Anabel OConnor");
  });
});

describe("PDF de las entradas", () => {
  it("una página por entrada, con título", async () => {
    const pdf = await PDFDocument.load(await armarPdfEntradas(datos()));
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getTitle()).toBe("Entradas · Fiesta de Primavera");
  });

  it("cada página lleva su QR (se lee y da el código), el nombre y el DNI", async () => {
    const otro = "E1-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
    const base = datos();
    const pdf = await armarPdfEntradas({ ...base, entradas: [base.entradas[0], { ...base.entradas[1], codigoFirmado: otro }] });
    const primera = await leerPagina(pdf, 0);
    expect(primera.qr).toBe(CODIGO);
    expect(primera.textos).toEqual(expect.arrayContaining(["María José Núñez", "DNI 30.111.222", "GENERAL", "Entrada 1 de 2 · Compra N° 12"]));
    const segunda = await leerPagina(pdf, 1);
    expect(segunda.qr).toBe(otro);
    expect(segunda.textos).toEqual(expect.arrayContaining(["Ana O’Connor", "DNI 4.555.666", "VIP"]));
    expect(segunda.textos.join(" ")).not.toContain("30.111.222");
  });

  it("el nombre largo sale completo (en dos renglones), sin cortar", async () => {
    const base = datos();
    const largo = "María de los Ángeles Florencia Rodríguez Etcheverry";
    const pdf = await armarPdfEntradas({ ...base, entradas: [{ ...base.entradas[0], titular: largo, usada: true }] });
    const { textos, qr } = await leerPagina(pdf, 0);
    expect(textos.join(" ")).toContain(largo);
    expect(textos.join(" ")).not.toContain("…");
    expect(qr).toBe(CODIGO);
  });

  it("una entrada usada lo dice", async () => {
    const base = datos();
    const pdf = await armarPdfEntradas({ ...base, entradas: [{ ...base.entradas[0], usada: true }, base.entradas[1]] });
    expect((await leerPagina(pdf, 0)).textos.join(" ")).toContain("YA USADA");
    expect((await leerPagina(pdf, 1)).textos.join(" ")).not.toContain("USADA");
  });

  it("el tipo en mayúsculas no saca letras de la fuente (µ no pasa a la griega)", async () => {
    const base = datos();
    const pdf = await armarPdfEntradas({ ...base, entradas: [{ ...base.entradas[0], tipo: "Pista µ ñ" }] });
    expect((await leerPagina(pdf, 0)).textos).toContain("PISTA µ Ñ");
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
