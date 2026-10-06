// Mover entradas en los lotes: reservar (al tocar "Continuar"), liberar (la
// reserva venció o se canceló) y confirmar (se aprobó el pago). Siempre dentro
// de una transacción, junto con la orden.
//
// Cómo se evita vender de más cuando compran muchos a la vez:
// 1. Primero se toma el turno del evento (ver turno.ts): las compras y las
//    ediciones de un mismo evento pasan de a una, en orden de llegada. Así
//    nadie trabaja con números viejos y nada se traba.
// 2. Por las dudas, también se bloquean las filas de los lotes que se tocan
//    (FOR UPDATE, siempre en orden por id).
// 3. Con los números ya bloqueados se reparte y se suma.
// Y aunque algo de esto fallara, la base no deja que vendidas + reservadas
// pasen el cupo (regla lotes_numeros_validos).
//
// Ojo, para quien llame a liberar y confirmar (pasos 10 y 12): estas funciones
// solo mueven números; no saben de qué orden son. Cada orden se libera o se
// confirma UNA sola vez: primero se cambia su estado con un UPDATE
// condicionado (de PENDIENTE a VENCIDA o PAGADA) y, solo si cambió, se mueven
// las porciones armadas con las entradas de esa orden.
import type { EstadoEvento, Prisma } from "@/generated/prisma/client";

import { type PlanCompra, planearCompra, type Rechazo, type TipoConLotes, validarPedido } from "./pedido";
import { tomarTurnoDelEvento } from "./turno";

type Tx = Prisma.TransactionClient;
export type Porcion = { loteId: string; cantidad: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Cuánto puede esperar su turno cada cosa antes de dar error.
export const ESPERA_COMPRA_MS = 8_000;
const ESPERA_LIBERAR_CONFIRMAR_MS = 15_000; // lo hace el sistema solo: puede esperar más

// Toma el turno del evento y lo lee (null si no existe).
async function tomarTurnoYLeer(tx: Tx, eventoId: string, esperaMaximaMs: number) {
  if (!UUID.test(eventoId)) return null;
  await tomarTurnoDelEvento(tx, eventoId, esperaMaximaMs);
  const [evento] = await tx.$queryRaw<{ estado: EstadoEvento; maxPorCompra: number; productoraActiva: boolean }[]>`
    SELECT e.estado, e.max_por_compra AS "maxPorCompra", p.activa AS "productoraActiva"
    FROM entradas.eventos e JOIN entradas.productoras p ON p.id = e.productora_id
    WHERE e.id = ${eventoId}::uuid`;
  return evento ?? null;
}

// Reserva lo pedido: lo reparte en los lotes (si en uno no entra todo, sigue
// en el próximo) y lo suma a "reservadas". O todo o nada. Si hay tanta gente
// que espera su turno más de ESPERA_COMPRA_MS, tira un error que reconoce
// esperoDemasiado() (para decir "probá de nuevo").
export async function reservarEntradas(tx: Tx, eventoId: string, entrada: unknown): Promise<PlanCompra | Rechazo> {
  const validado = validarPedido(entrada);
  if (!validado.ok) return validado;

  const evento = await tomarTurnoYLeer(tx, eventoId, ESPERA_COMPRA_MS);
  if (!evento || evento.estado !== "PUBLICADO" || !evento.productoraActiva) {
    return { ok: false, error: "Este evento no está a la venta." };
  }

  const tipoIds = validado.pedido.map((item) => item.tipoId);
  const lotes = await tx.$queryRaw<(TipoConLotes["lotes"][number] & { tipoId: string })[]>`
    SELECT l.id, l.tipo_entrada_id AS "tipoId", l.numero, l.nombre, l.precio_centavos AS "precioCentavos",
           l.cupo, l.vendidas, l.reservadas
    FROM entradas.lotes l JOIN entradas.tipos_entrada t ON t.id = l.tipo_entrada_id
    WHERE t.evento_id = ${eventoId}::uuid AND t.id = ANY(${tipoIds}::uuid[])
    ORDER BY l.id
    FOR UPDATE OF l`;
  const tipos = await tx.tipoEntrada.findMany({
    where: { eventoId, id: { in: tipoIds } },
    orderBy: [{ orden: "asc" }, { nombre: "asc" }],
    select: { id: true, nombre: true },
  });

  const plan = planearCompra(
    tipos.map((tipo) => ({ ...tipo, lotes: lotes.filter((lote) => lote.tipoId === tipo.id) })),
    validado.pedido,
    evento.maxPorCompra,
  );
  if (!plan.ok) return plan;

  for (const linea of plan.lineas) {
    await tx.lote.update({ where: { id: linea.loteId }, data: { reservadas: { increment: linea.cantidad } } });
  }
  return plan;
}

// Devuelve al lote entradas reservadas (la reserva venció o se canceló).
export function liberarReservas(tx: Tx, eventoId: string, porciones: Porcion[]) {
  return moverReservadas(tx, eventoId, porciones, "liberar");
}

// Pasa entradas reservadas a vendidas (se aprobó el pago).
export function confirmarReservas(tx: Tx, eventoId: string, porciones: Porcion[]) {
  return moverReservadas(tx, eventoId, porciones, "confirmar");
}

// Si los números no cierran (más de lo que hay reservado, un lote de otro
// evento) es un error del sistema: tira una excepción y la transacción entera
// se deshace.
async function moverReservadas(tx: Tx, eventoId: string, porciones: Porcion[], accion: "liberar" | "confirmar") {
  const porLote = new Map<string, number>();
  for (const { loteId, cantidad } of porciones) {
    if (!UUID.test(loteId) || !Number.isSafeInteger(cantidad) || cantidad < 1) {
      throw new Error(`No se puede ${accion}: porción inválida (${loteId}: ${cantidad})`);
    }
    porLote.set(loteId, (porLote.get(loteId) ?? 0) + cantidad);
  }
  if (porLote.size === 0) return;

  if (!(await tomarTurnoYLeer(tx, eventoId, ESPERA_LIBERAR_CONFIRMAR_MS))) {
    throw new Error(`No se puede ${accion}: el evento ${eventoId} no existe`);
  }
  const ids = [...porLote.keys()];
  const lotes = await tx.$queryRaw<{ id: string; reservadas: number }[]>`
    SELECT l.id, l.reservadas
    FROM entradas.lotes l JOIN entradas.tipos_entrada t ON t.id = l.tipo_entrada_id
    WHERE t.evento_id = ${eventoId}::uuid AND l.id = ANY(${ids}::uuid[])
    ORDER BY l.id
    FOR UPDATE OF l`;
  if (lotes.length !== ids.length) throw new Error(`No se puede ${accion}: hay lotes que no son de este evento`);

  for (const lote of lotes) {
    const cantidad = porLote.get(lote.id)!;
    if (lote.reservadas < cantidad) {
      throw new Error(`No se puede ${accion} ${cantidad} en el lote ${lote.id}: tiene ${lote.reservadas} reservadas`);
    }
    await tx.lote.update({
      where: { id: lote.id },
      data:
        accion === "liberar"
          ? { reservadas: { decrement: cantidad } }
          : { reservadas: { decrement: cantidad }, vendidas: { increment: cantidad } },
    });
  }
}
