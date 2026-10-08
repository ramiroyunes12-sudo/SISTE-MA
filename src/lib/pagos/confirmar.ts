// Registrar un pago recibido y, si corresponde, dar las entradas.
//
// Cada pago se registra UNA sola vez (mpPagoId es único) y cada orden se
// confirma una sola vez: todo pasa con el turno del evento (ver
// src/lib/ventas/turno.ts) y el cambio de estado es condicionado.
//
// Qué pasa según cómo está la orden cuando llega la plata:
// - PENDIENTE (aunque se le haya pasado la hora, si sus lugares siguen
//   apartados): pasa a PAGADA y sus reservadas, a vendidas.
// - VENCIDA o CANCELADA (sus lugares ya volvieron al lote): si en esos mismos
//   lotes todavía hay lugar, se venden y pasa a PAGADA. Si no, el pago queda
//   "a devolver".
// - PAGADA: un pago repetido queda "a devolver". Salvo que la orden se haya
//   confirmado a mano y este sea el pago de verdad: ese lo respalda.
// - Faltan los datos de la compra (no debería pasar: se piden antes de
//   pagar): "a devolver", porque la base no deja pagar sin ellos.
import type { MetodoPago, PrismaClient } from "@/generated/prisma/client";
import { confirmarReservas, type Porcion, venderSinReserva } from "@/lib/ventas/reservas";
import { tomarTurnoDelEvento } from "@/lib/ventas/turno";

export type PagoRecibido = {
  mpPagoId: string; // número del pago en Mercado Pago, o "manual:<id de la orden>"
  metodo: MetodoPago;
  estadoMp: string;
  montoCentavos: number;
  comisionCentavos?: number;
  registradoPorId?: string | null;
};

export type ResultadoPago =
  | "confirmada" // la orden pasó a PAGADA con este pago
  | "confirmada_tarde" // la reserva había vencido, pero había lugar
  | "respalda_manual" // la orden se había confirmado a mano: este es su pago
  | "ya_registrado" // este mismo pago ya se había procesado antes
  | "a_devolver"; // no dio entradas: hay que devolver la plata

const ESPERA_MS = 15_000; // lo hace el sistema: puede esperar su turno más que una compra

// Una confirmación a mano que no se puede hacer (la transacción se deshace).
export class NoSePuedeConfirmar extends Error {}

function porciones(entradas: { loteId: string | null }[]): Porcion[] {
  const porLote = new Map<string, number>();
  for (const { loteId } of entradas) if (loteId) porLote.set(loteId, (porLote.get(loteId) ?? 0) + 1);
  return [...porLote].map(([loteId, cantidad]) => ({ loteId, cantidad }));
}

// `aDevolverPor`: quien llama ya sabe que este pago no puede dar entradas
// (por ejemplo, el monto no coincide): se registra directo "a devolver".
export async function registrarPago(
  db: PrismaClient,
  ordenId: string,
  pago: PagoRecibido,
  opciones: { ahora?: Date; aDevolverPor?: string } = {},
): Promise<ResultadoPago> {
  const ahora = opciones.ahora ?? new Date();
  const orden = await db.orden.findUnique({ where: { id: ordenId }, select: { eventoId: true, tipo: true } });
  if (!orden || orden.tipo !== "VENTA") throw new Error(`No existe la orden de venta ${ordenId}`);
  const { eventoId } = orden;

  return db.$transaction(
    async (tx): Promise<ResultadoPago> => {
      await tomarTurnoDelEvento(tx, eventoId, ESPERA_MS);

      const ya = await tx.pago.findUnique({ where: { mpPagoId: pago.mpPagoId }, select: { id: true, estadoMp: true } });
      if (ya) {
        // Mercado Pago avisa cambios (por ejemplo, si después se devolvió): se anota el estado nuevo.
        if (ya.estadoMp !== pago.estadoMp) await tx.pago.update({ where: { id: ya.id }, data: { estadoMp: pago.estadoMp } });
        return "ya_registrado";
      }

      const actual = await tx.orden.findUniqueOrThrow({
        where: { id: ordenId },
        select: {
          estado: true,
          email: true,
          entradas: { select: { loteId: true, titular: true, dni: true } },
          pagos: { select: { metodo: true, aDevolver: true } },
        },
      });
      const base = {
        ordenId,
        mpPagoId: pago.mpPagoId,
        metodo: pago.metodo,
        estadoMp: pago.estadoMp,
        montoCentavos: pago.montoCentavos,
        comisionCentavos: pago.comisionCentavos ?? 0,
        registradoPorId: pago.registradoPorId ?? null,
      };
      const aDevolver = async (nota: string) => {
        // Una confirmación a mano no es plata que entró: si no puede dar las
        // entradas, no se registra nada (y quien la pidió ve el motivo).
        if (pago.metodo === "MANUAL") throw new NoSePuedeConfirmar(nota);
        await tx.pago.create({ data: { ...base, aDevolver: true, nota } });
        return "a_devolver" as const;
      };

      if (opciones.aDevolverPor) return aDevolver(opciones.aDevolverPor);
      const faltanDatos = !actual.email || actual.entradas.some((entrada) => !entrada.titular || !entrada.dni);

      if (actual.estado === "PENDIENTE") {
        if (faltanDatos) return aDevolver("Faltaban los datos de la compra (email, nombre o DNI).");
        const { count } = await tx.orden.updateMany({
          where: { id: ordenId, estado: "PENDIENTE" },
          data: { estado: "PAGADA", pagadaEn: ahora, metodoPago: pago.metodo },
        });
        if (count !== 1) throw new Error(`La orden ${ordenId} cambió de estado en el medio`);
        await confirmarReservas(tx, eventoId, porciones(actual.entradas));
        await tx.entrada.updateMany({ where: { ordenId }, data: { estado: "VALIDA" } });
        await tx.pago.create({ data: base });
        return "confirmada";
      }

      if (actual.estado === "VENCIDA" || actual.estado === "CANCELADA") {
        if (faltanDatos) return aDevolver("Faltaban los datos de la compra (email, nombre o DNI).");
        if (!(await venderSinReserva(tx, eventoId, porciones(actual.entradas)))) {
          return aDevolver("Pagó con la reserva vencida y ya no quedaba lugar.");
        }
        const { count } = await tx.orden.updateMany({
          where: { id: ordenId, estado: actual.estado },
          data: { estado: "PAGADA", pagadaEn: ahora, metodoPago: pago.metodo },
        });
        if (count !== 1) throw new Error(`La orden ${ordenId} cambió de estado en el medio`);
        await tx.entrada.updateMany({ where: { ordenId }, data: { estado: "VALIDA" } });
        await tx.pago.create({ data: { ...base, nota: "Pagó con la reserva vencida; todavía había lugar." } });
        return "confirmada_tarde";
      }

      if (actual.estado === "PAGADA") {
        const validos = actual.pagos.filter((p) => !p.aDevolver);
        const soloAMano = validos.length > 0 && validos.every((p) => p.metodo === "MANUAL");
        if (pago.metodo !== "MANUAL" && soloAMano) {
          await tx.pago.create({ data: { ...base, nota: "Es el pago de esta orden, que se había confirmado a mano." } });
          return "respalda_manual";
        }
        return aDevolver("La orden ya estaba paga (pago repetido).");
      }

      return aDevolver("La orden ya fue reembolsada.");
    },
    { maxWait: 5_000, timeout: 30_000 },
  );
}
