// El PDF que se baja desde el link de la compra (/compra/<llave>/pdf).
import type { PrismaClient } from "@/generated/prisma/client";
import { whatsappDeAyuda } from "@/lib/ayuda";
import { buscarCompra } from "@/lib/ventas/ordenes";

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
  const entradas = entradasConQr(compra).filter((entrada) => numero === null || entrada.numero === numero);
  if (entradas.length === 0) return { ok: false, motivo: "sin_entradas" };
  const pdf = await armarPdfEntradas({
    evento: compra.evento,
    compra: compra.numero,
    totalEntradas: compra.entradas.length,
    whatsapp: whatsappDeAyuda()?.numero,
    entradas: entradas.map((entrada) => ({ ...entrada, usada: entrada.estado === "USADA" })),
  });
  const archivo = numero === null ? `entradas-compra-${compra.numero}.pdf` : `entrada-${numero}-compra-${compra.numero}.pdf`;
  return { ok: true, pdf, archivo };
}
