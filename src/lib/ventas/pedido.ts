// Lo que pide alguien en la página del evento ("2 General y 1 VIP") y cómo
// queda repartido en los lotes, con el precio de cada parte. Sin base de
// datos: lo usan la reserva de verdad (reservas.ts, con los lotes bloqueados)
// y el simulador del panel.
import { disponibles, type LoteParaRepartir, repartirEnLotes } from "@/lib/eventos/lotes";

export type Pedido = { tipoId: string; cantidad: number }[];

export type TipoConLotes = { id: string; nombre: string; lotes: (LoteParaRepartir & { nombre: string })[] };

// Una línea del detalle: "2 × General · Lote 1 · $ 6.000".
export type LineaCompra = {
  tipoId: string;
  tipoNombre: string;
  loteId: string;
  loteNombre: string;
  cantidad: number;
  precioCentavos: number;
};

export type PlanCompra = { ok: true; lineas: LineaCompra[]; cantidad: number; totalCentavos: number };
export type Rechazo = { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// El máximo por compra de un evento llega hasta 20 (lo controla la base).
const MAX_POR_TIPO = 20;
const MAX_TIPOS_POR_PEDIDO = 50;

// Lo que llega del navegador no es confiable: se revisa todo. Los tipos con
// cantidad 0 se ignoran.
export function validarPedido(entrada: unknown): { ok: true; pedido: Pedido } | Rechazo {
  const invalido: Rechazo = { ok: false, error: "No entendimos el pedido. Recargá la página y probá de nuevo." };
  if (!Array.isArray(entrada) || entrada.length > MAX_TIPOS_POR_PEDIDO) return invalido;
  const pedido: Pedido = [];
  const vistos = new Set<string>();
  for (const item of entrada) {
    if (typeof item !== "object" || item === null) return invalido;
    const { tipoId, cantidad } = item as Record<string, unknown>;
    if (typeof tipoId !== "string" || !UUID.test(tipoId) || vistos.has(tipoId)) return invalido;
    if (typeof cantidad !== "number" || !Number.isInteger(cantidad) || cantidad < 0 || cantidad > MAX_POR_TIPO) {
      return invalido;
    }
    vistos.add(tipoId);
    if (cantidad > 0) pedido.push({ tipoId, cantidad });
  }
  if (pedido.length === 0) return { ok: false, error: "Elegí al menos una entrada." };
  return { ok: true, pedido };
}

// Reparte el pedido en los lotes. `tipos` va en el orden de la página: el
// detalle sale en ese orden. Si algo no entra, no se reparte nada.
export function planearCompra(tipos: TipoConLotes[], pedido: Pedido, maxPorCompra: number): PlanCompra | Rechazo {
  const cantidad = pedido.reduce((suma, item) => suma + item.cantidad, 0);
  if (cantidad > maxPorCompra) {
    return { ok: false, error: `Se pueden comprar hasta ${maxPorCompra} entradas por vez.` };
  }
  const pedidas = new Map(pedido.map((item) => [item.tipoId, item.cantidad]));
  if (pedido.some((item) => !tipos.some((tipo) => tipo.id === item.tipoId))) {
    return { ok: false, error: "Alguna de las entradas que elegiste ya no está a la venta. Recargá la página." };
  }

  const lineas: LineaCompra[] = [];
  for (const tipo of tipos) {
    const cuantas = pedidas.get(tipo.id);
    if (!cuantas) continue;
    const porciones = repartirEnLotes(tipo.lotes, cuantas);
    if (!porciones) {
      const quedan = tipo.lotes.reduce((suma, lote) => suma + disponibles(lote), 0);
      // Sin decir cuántas quedan: eso solo lo ve la productora.
      return {
        ok: false,
        error: quedan === 0 ? `"${tipo.nombre}" está agotado.` : `No quedan ${cuantas} entradas "${tipo.nombre}". Probá con menos.`,
      };
    }
    for (const porcion of porciones) {
      const lote = tipo.lotes.find((l) => l.id === porcion.loteId)!;
      lineas.push({
        tipoId: tipo.id,
        tipoNombre: tipo.nombre,
        loteId: lote.id,
        loteNombre: lote.nombre,
        cantidad: porcion.cantidad,
        precioCentavos: porcion.precioCentavos,
      });
    }
  }
  const totalCentavos = lineas.reduce((suma, linea) => suma + linea.cantidad * linea.precioCentavos, 0);
  return { ok: true, lineas, cantidad, totalCentavos };
}
