// El PDF que se baja desde el link de la compra (/compra/<llave>/pdf).
import type { PrismaClient } from "@/generated/prisma/client";
import { whatsappDeAyuda } from "@/lib/ayuda";
import { buscarCompra, type Compra } from "@/lib/ventas/ordenes";

import { entradasConQr } from "./imprimir";
import { armarPdfEntradas } from "./pdf";

// El ?entrada=N del link: null si no vino (todas), el número (1 a 999) o
// "invalido" si vino cualquier otra cosa.
export function leerNumeroDeEntrada(texto: string | null): number | null | "invalido" {
  if (texto === null) return null;
  return /^[1-9]\d{0,2}$/.test(texto) ? Number(texto) : "invalido";
}

export type PdfDeCompra =
  | { ok: true; pdf: Uint8Array; archivo: string }
  | { ok: false; motivo: "no_encontrada" | "sin_entradas" };

// Todas las entradas con QR de la compra del link, o solo la número `numero`
// (su lugar en la compra, igual que en la página). Se arma en el momento; no
// se guarda en ningún lado.
export async function pdfDeCompra(db: PrismaClient, llave: string, numero: number | null): Promise<PdfDeCompra> {
  const compra = await buscarCompra(db, llave);
  if (!compra) return { ok: false, motivo: "no_encontrada" };
  return armarPdfDeCompra(compra, numero);
}

// Lo mismo con la compra (o la cortesía) ya leída: quien la leyó tiene que
// saber que le corresponde.
export async function armarPdfDeCompra(compra: Compra, numero: number | null): Promise<PdfDeCompra> {
  const entradas = entradasConQr(compra).filter((entrada) => numero === null || entrada.numero === numero);
  if (entradas.length === 0) return { ok: false, motivo: "sin_entradas" };
  const cortesia = compra.tipo === "CORTESIA";
  const pdf = await armarPdfEntradas({
    evento: compra.evento,
    compra: compra.numero,
    cortesia,
    totalEntradas: compra.entradas.length,
    whatsapp: whatsappDeAyuda()?.numero,
    entradas: entradas.map((entrada) => ({ ...entrada, usada: entrada.estado === "USADA" })),
  });
  return { ok: true, pdf, archivo: nombreDelPdf(compra.numero, numero, cortesia) };
}

// "entradas-compra-12.pdf", "entrada-2-compra-12.pdf" o "cortesia-12.pdf"
// (una cortesía tiene una sola entrada). Solo números: nada de la persona.
export function nombreDelPdf(compra: number, entrada: number | null, cortesia = false) {
  if (cortesia) return entrada === null || entrada === 1 ? `cortesia-${compra}.pdf` : `cortesia-${compra}-entrada-${entrada}.pdf`;
  return entrada === null ? `entradas-compra-${compra}.pdf` : `entrada-${entrada}-compra-${compra}.pdf`;
}
