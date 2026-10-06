// El checkout de la página pública: cómo queda repartido el pedido en los
// lotes, con los números de este momento. Solo lee (todavía no reserva: eso
// llega con el paso 10). Lo que sale de acá es el detalle que ve quien compra
// ("2 × General · Lote 1"), nunca las cantidades de los lotes.
import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";

import { type PlanCompra, pedidoDesdeTexto, planearCompra, type Rechazo, validarPedido } from "./pedido";

export async function planearCompraDelEvento(
  db: PrismaClient,
  evento: { id: string; maxPorCompra: number },
  textoPedido: unknown,
): Promise<PlanCompra | Rechazo> {
  const pedido = validarPedido(pedidoDesdeTexto(textoPedido));
  if (!pedido.ok) return pedido;
  const tipos = await db.tipoEntrada.findMany({
    where: { eventoId: evento.id },
    orderBy: [{ orden: "asc" }, { nombre: "asc" }],
    select: {
      id: true,
      nombre: true,
      lotes: { select: { id: true, numero: true, nombre: true, precioCentavos: true, cupo: true, vendidas: true, reservadas: true } },
    },
  });
  return planearCompra(tipos, pedido.pedido, evento.maxPorCompra);
}
