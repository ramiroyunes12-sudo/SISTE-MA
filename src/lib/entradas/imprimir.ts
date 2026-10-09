// Las entradas de una compra listas para mostrar o imprimir: cuáles tienen QR
// y el PDF para descargar desde el link de la compra.
import type { PrismaClient } from "@/generated/prisma/client";
import { buscarCompra, type Compra } from "@/lib/ventas/ordenes";

import { firmarCodigo } from "./codigo";
import { armarPdfEntradas } from "./pdf";

export type EntradaConQr = {
  id: string;
  numero: number; // la posición en la compra: "Entrada 2"
  tipo: string;
  titular: string;
  dni: string;
  estado: "VALIDA" | "USADA";
  codigoFirmado: string;
};

// Solo una compra paga tiene QR, y solo en sus entradas válidas o usadas (una
// anulada no). Sin CLAVE_CODIGOS tira error: nunca arma un QR que no sirva.
export function entradasConQr(compra: Compra): EntradaConQr[] {
  if (compra.estado !== "PAGADA") return [];
  const lista: EntradaConQr[] = [];
  for (const [i, entrada] of compra.entradas.entries()) {
    if (entrada.estado !== "VALIDA" && entrada.estado !== "USADA") continue;
    if (!entrada.titular || !entrada.dni) continue; // la base no lo deja, pero por las dudas
    lista.push({
      id: entrada.id,
      numero: i + 1,
      tipo: entrada.tipo,
      titular: entrada.titular,
      dni: entrada.dni,
      estado: entrada.estado,
      codigoFirmado: firmarCodigo(entrada.codigo),
    });
  }
  return lista;
}

export type PdfDeCompra =
  | { ok: true; pdf: Uint8Array; archivo: string }
  | { ok: false; motivo: "no_encontrada" | "sin_entradas" };

// El PDF de la compra del link: todas sus entradas con QR o solo la número
// `numero`. Se arma en el momento; no se guarda en ningún lado.
export async function pdfDeCompra(db: PrismaClient, llave: string, numero: number | null): Promise<PdfDeCompra> {
  const compra = await buscarCompra(db, llave);
  if (!compra) return { ok: false, motivo: "no_encontrada" };
  const entradas = entradasConQr(compra).filter((entrada) => numero === null || entrada.numero === numero);
  if (entradas.length === 0) return { ok: false, motivo: "sin_entradas" };
  const pdf = await armarPdfEntradas({
    evento: compra.evento,
    compra: compra.numero,
    totalEntradas: compra.entradas.length,
    entradas,
  });
  const archivo = numero === null ? `entradas-compra-${compra.numero}.pdf` : `entrada-${numero}-compra-${compra.numero}.pdf`;
  return { ok: true, pdf, archivo };
}
