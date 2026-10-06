// Estado de cada lote de un tipo de entrada. Se vende de a un lote por vez,
// en orden: el primero que tiene lugar está EN_VENTA; los anteriores están
// AGOTADOS y los siguientes EN_ESPERA (se abren solos cuando se agota).
export type EstadoLote = "AGOTADO" | "EN_VENTA" | "EN_ESPERA";

type LoteParaEstado = { id: string; numero: number; cupo: number; vendidas: number; reservadas: number };

export function disponibles(lote: Omit<LoteParaEstado, "id" | "numero">) {
  return Math.max(0, lote.cupo - lote.vendidas - lote.reservadas);
}

export type LoteParaRepartir = LoteParaEstado & { precioCentavos: number };
export type Porcion = { loteId: string; cantidad: number; precioCentavos: number };

// Reparte un pedido de `cantidad` entradas entre los lotes de un tipo: primero
// el de menor número que tenga lugar, y lo que no entra ahí, en los que siguen.
// Ej.: piden 4 y al Lote 1 le quedan 2 → 2 del Lote 1 y 2 del Lote 2.
// null si no hay lugar para todas (no se reserva una parte).
export function repartirEnLotes(lotes: LoteParaRepartir[], cantidad: number): Porcion[] | null {
  if (!Number.isSafeInteger(cantidad) || cantidad < 1) return null;
  const porciones: Porcion[] = [];
  let faltan = cantidad;
  for (const lote of [...lotes].sort((a, b) => a.numero - b.numero)) {
    if (faltan === 0) break;
    const toma = Math.min(disponibles(lote), faltan);
    if (toma === 0) continue;
    porciones.push({ loteId: lote.id, cantidad: toma, precioCentavos: lote.precioCentavos });
    faltan -= toma;
  }
  return faltan === 0 ? porciones : null;
}

export function estadosDeLotes(lotes: LoteParaEstado[]): Map<string, EstadoLote> {
  const ordenados = [...lotes].sort((a, b) => a.numero - b.numero);
  const enVenta = ordenados.find((lote) => disponibles(lote) > 0);
  const estados = new Map<string, EstadoLote>();
  let pasoElQueVende = false;
  for (const lote of ordenados) {
    if (lote === enVenta) {
      estados.set(lote.id, "EN_VENTA");
      pasoElQueVende = true;
    } else {
      estados.set(lote.id, pasoElQueVende ? "EN_ESPERA" : "AGOTADO");
    }
  }
  return estados;
}
