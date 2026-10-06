// "Probar una compra" del panel: cómo se cobraría un pedido si alguien
// comprara ahora, con las mismas reglas que la compra de verdad. Solo lee: no
// reserva ni vende nada.
import type { PrismaClient } from "@/generated/prisma/client";
import { type Alcance, filtroDeEventos } from "@/lib/auth/alcance";

import { type PlanCompra, planearCompra, validarPedido } from "./pedido";

export type ResultadoSimulacion = { plan?: PlanCompra; error?: string; aviso?: string };

// `cantidadDe` devuelve lo que se escribió para cada tipo ("" = 0).
export async function simularCompra(
  db: PrismaClient,
  eventoId: string,
  alcance: Alcance,
  cantidadDe: (tipoId: string) => string,
): Promise<ResultadoSimulacion> {
  // Si es de otra productora, para este organizador "no existe".
  const evento = await db.evento.findFirst({
    where: { id: eventoId, ...filtroDeEventos(alcance) },
    select: {
      estado: true,
      maxPorCompra: true,
      productora: { select: { activa: true } },
      tipos: {
        orderBy: [{ orden: "asc" }, { nombre: "asc" }],
        select: {
          id: true,
          nombre: true,
          lotes: {
            select: { id: true, numero: true, nombre: true, precioCentavos: true, cupo: true, vendidas: true, reservadas: true },
          },
        },
      },
    },
  });
  if (!evento) return { error: "Ese evento ya no existe." };

  // La misma condición que pone la compra de verdad (reservarEntradas).
  const aviso =
    evento.estado === "BORRADOR"
      ? "Ojo: el evento está en borrador, así que el público todavía no puede comprar."
      : evento.estado === "FINALIZADO"
        ? "Ojo: el evento está finalizado, ya no se vende."
        : !evento.productora.activa
          ? "Ojo: la productora está desactivada, así que el público no puede comprar."
          : undefined;

  const cantidades = evento.tipos.map((tipo) => {
    const texto = cantidadDe(tipo.id).trim();
    return { tipoId: tipo.id, cantidad: texto === "" ? 0 : Number(texto) };
  });
  if (cantidades.some(({ cantidad }) => !Number.isInteger(cantidad) || cantidad < 0 || cantidad > 20)) {
    return { error: "Poné cantidades enteras, de 0 a 20.", aviso };
  }
  const pedido = validarPedido(cantidades);
  if (!pedido.ok) return { error: pedido.error, aviso };

  const plan = planearCompra(evento.tipos, pedido.pedido, evento.maxPorCompra);
  return plan.ok ? { plan, aviso } : { error: plan.error, aviso };
}
