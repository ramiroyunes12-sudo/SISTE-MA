// El mail con las entradas: qué lleva, que cada QR del HTML tenga su imagen
// adjunta y que el texto de la gente o del evento no pueda romper el HTML ni
// los encabezados.
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import type { EntradaConQr } from "@/lib/entradas/imprimir";

import { armarMailEntradas, type DatosMailEntradas, escaparHtml } from "./entradas";

const CODIGO = "E1-0123456789ABCDEF0123456789ABCDEF-FEDCBA9876543210FEDCBA9876543210";

function entrada(numero: number, cambios: Partial<EntradaConQr> = {}): EntradaConQr {
  return {
    id: `id-${numero}`,
    numero,
    tipo: "General",
    lote: "Lote 2",
    titular: `Persona ${numero}`,
    dni: "30111222",
    estado: "VALIDA",
    codigoFirmado: CODIGO,
    ...cambios,
  };
}

function datos(cambios: Partial<DatosMailEntradas> = {}): DatosMailEntradas {
  return {
    para: "comprador@ejemplo.com",
    productora: { nombre: "La Productora", emailContacto: "hola@productora.com" },
    compra: 12,
    totalEntradas: 2,
    evento: { nombre: "Fiesta", fecha: new Date("2030-11-21T23:00:00-03:00"), lugar: "Club", direccion: "Junín 1234" },
    entradas: [entrada(1), entrada(2)],
    ...cambios,
  };
}

const paginas = async (contenido: Uint8Array) => (await PDFDocument.load(contenido)).getPageCount();

describe("Mail con las entradas", () => {
  it("lleva un QR por entrada dentro del mail, el PDF con todas y uno por persona", async () => {
    const mail = await armarMailEntradas(datos());
    expect(mail.para).toBe("comprador@ejemplo.com");
    expect(mail.nombreRemitente).toBe("La Productora");
    expect(mail.responderA).toBe("hola@productora.com");
    expect(mail.asunto).toBe("Tus entradas para Fiesta (compra N° 12)");

    const imagenes = mail.adjuntos.filter((a) => a.tipo === "image/png");
    expect(imagenes.map((a) => a.cid)).toEqual(["qr-entrada-1@entradas", "qr-entrada-2@entradas"]);
    // Cada imagen que nombra el HTML está adjunta (y ninguna sobra).
    const nombradas = [...mail.html.matchAll(/src="cid:([^"]+)"/g)].map((m) => m[1]);
    expect(nombradas).toEqual(imagenes.map((a) => a.cid));

    const pdfs = mail.adjuntos.filter((a) => a.tipo === "application/pdf");
    expect(pdfs.map((a) => a.archivo)).toEqual(["entradas-compra-12.pdf", "entrada-1-compra-12.pdf", "entrada-2-compra-12.pdf"]);
    expect(await Promise.all(pdfs.map((a) => paginas(a.contenido)))).toEqual([2, 1, 1]);

    for (const texto of [mail.html, mail.texto]) {
      expect(texto).toContain("Persona 1");
      expect(texto).toContain("DNI 30.111.222 · General · Lote 2");
      expect(texto).toContain(CODIGO);
      expect(texto).toContain("compra N° 12");
    }
    expect(mail.html).toContain("ENTRADA 2 DE 2");
    // Cada entrada dice cuál es su PDF (para mandárselo a esa persona).
    expect(mail.html).toContain("Su PDF: entrada-2-compra-12.pdf");
    expect(mail.texto).toContain("Su PDF: entrada-2-compra-12.pdf");
    expect(mail.texto).toContain("Respondé este mail");
    expect(mail.html).toContain("Acá están tus 2 entradas");
    expect(mail.html).toContain("Respondé este mail");
  });

  it("con una sola entrada: un solo PDF y sin 'Entrada 1 de 1'", async () => {
    const mail = await armarMailEntradas(datos({ totalEntradas: 1, entradas: [entrada(1)] }));
    expect(mail.adjuntos.map((a) => a.archivo)).toEqual(["qr-entrada-1.png", "entradas-compra-12.pdf"]);
    expect(mail.html).toContain("TU ENTRADA");
    expect(mail.texto).toContain("Acá está tu entrada");
    expect(mail.texto).toContain("El QR está en el PDF adjunto");
    expect(mail.html).not.toContain("Su PDF");
    expect(mail.html).not.toContain("DE 1");
  });

  it("el número de cada entrada es su lugar en la compra (contando las anuladas)", async () => {
    const mail = await armarMailEntradas(datos({ totalEntradas: 3, entradas: [entrada(1), entrada(3)] }));
    expect(mail.html).toContain("ENTRADA 3 DE 3");
    expect(mail.adjuntos.map((a) => a.archivo)).toContain("entrada-3-compra-12.pdf");
    expect(mail.html).toContain("tus 2 entradas");
  });

  it("sin mail de contacto de la productora, no cambia a dónde van las respuestas", async () => {
    const mail = await armarMailEntradas(datos({ productora: { nombre: "La Productora", emailContacto: null } }));
    expect(mail.responderA).toBeUndefined();
    expect(mail.html).not.toContain("Respondé este mail");
  });

  it("una entrada sin lote (cortesía) dice solo el tipo; una usada lo dice", async () => {
    const mail = await armarMailEntradas(datos({ entradas: [entrada(1, { lote: "" }), entrada(2, { estado: "USADA" })] }));
    expect(mail.html).toContain("DNI 30.111.222 · General</div>");
    expect(mail.html).toContain("YA USADA");
    expect(mail.texto).toContain("· YA USADA");
  });

  it("el texto del evento y de la gente no rompe el HTML ni los encabezados", async () => {
    const mail = await armarMailEntradas(
      datos({
        productora: { nombre: "Prod\r\nBcc: otro@ejemplo.com", emailContacto: null },
        evento: { nombre: 'Fiesta <script>alert("x")</script>\nBcc: x@y.com', fecha: new Date(), lugar: "Club & Bar", direccion: null },
        entradas: [entrada(1, { titular: "Ana <b>O'Connor</b>" })],
      }),
    );
    expect(mail.html).not.toMatch(/<script|<b>/);
    expect(mail.html).toContain("Fiesta &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(mail.html).toContain("Ana &lt;b&gt;O&#39;Connor&lt;/b&gt;");
    expect(mail.html).toContain("Club &amp; Bar");
    expect(mail.asunto).not.toMatch(/[\r\n]/);
    expect(mail.asunto).toMatch(/\(compra N° 12\)$/);
    expect(mail.nombreRemitente).toBe("Prod Bcc: otro@ejemplo.com");
  });

  it("un nombre que termina en punto no deja '..' al final de una oración", async () => {
    const mail = await armarMailEntradas(datos({ productora: { nombre: "Noche S.R.L.", emailContacto: "hola@noche.com" } }));
    expect(mail.html).toContain("le llega a Noche S.R.L.");
    expect(mail.html).not.toContain("S.R.L..");
    expect(mail.texto).not.toContain("S.R.L..");
  });

  it("Outlook de escritorio: el texto de vista previa va oculto y el ancho, fijo", async () => {
    const mail = await armarMailEntradas(datos());
    expect(mail.html).toMatch(/display:none;mso-hide:all;/);
    expect(mail.html).toContain('<!--[if mso]><table role="presentation" width="480"');
  });

  it("sin entradas no arma nada", async () => {
    await expect(armarMailEntradas(datos({ entradas: [] }))).rejects.toThrow();
  });

  it("escaparHtml", () => {
    expect(escaparHtml(`<a href="x" title='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  });
});
