// Estado de cada lote de un tipo de entrada. Se vende de a un lote por vez,
// en orden: el primero que tiene lugar está EN_VENTA; los anteriores están
// AGOTADOS y los siguientes EN_ESPERA (se abren solos cuando se agota).
export type EstadoLote = "AGOTADO" | "EN_VENTA" | "EN_ESPERA";

type LoteParaEstado = { id: string; numero: number; cupo: number; vendidas: number; reservadas: number };

export function disponibles(lote: Omit<LoteParaEstado, "id" | "numero">) {
  return Math.max(0, lote.cupo - lote.vendidas - lote.reservadas);
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
