// Las entradas de una compra listas para mostrar o imprimir: cuáles tienen QR
// y con qué código. (Sin pdf-lib: lo usa también la página de la compra.)
import type { Compra } from "@/lib/ventas/ordenes";

import { firmarCodigo } from "./codigo";

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
