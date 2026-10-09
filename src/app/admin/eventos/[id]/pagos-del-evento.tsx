// Sección "Pagos" del evento: lo cobrado, las compras esperando la plata (con
// "Confirmar pago" para los casos raros), los pagos que hay que devolver y
// los que Mercado Pago revirtió (devolución o contracargo). Abajo, los mails
// con las entradas.
import { obtenerDb } from "@/lib/db";
import { formatearPesos } from "@/lib/dinero";
import { formatearFecha } from "@/lib/fechas";

import { buscarPagosAccion, confirmarPagoAccion } from "../acciones";
import { BotonBuscarPagos, BotonConfirmarPago } from "../pagos";
import { MailsDelEvento } from "./mails-del-evento";

const ESTADO = { PENDIENTE: "Esperando el pago", VENCIDA: "Venció la reserva", CANCELADA: "La canceló" } as const;
const METODO = { TRANSFERENCIA: "Transferencia", MERCADOPAGO: "Mercado Pago", MANUAL: "A mano" } as const;

export async function PagosDelEvento({ eventoId, pagada }: { eventoId: string; pagada?: number }) {
  const db = obtenerDb();
  const [esperando, aDevolver, validos, pagadas] = await Promise.all([
    db.orden.findMany({
      where: {
        eventoId,
        tipo: "VENTA",
        // Las que ya recibieron un pago (que quedó para devolver) van en esa lista.
        pagos: { none: {} },
        OR: [
          { estado: "PENDIENTE", metodoPago: { not: null } },
          // Las vencidas o canceladas que eligieron transferencia: la plata puede llegar tarde.
          { estado: { in: ["VENCIDA", "CANCELADA"] }, montoTransferencia: { isNot: null } },
        ],
      },
      orderBy: { creadoEn: "desc" },
      take: 100,
      select: {
        id: true,
        numero: true,
        estado: true,
        venceEn: true,
        totalCentavos: true,
        recargoCentavos: true,
        metodoPago: true,
        email: true,
        montoTransferencia: { select: { montoCentavos: true } },
        entradas: { select: { titular: true } },
      },
    }),
    db.pago.findMany({
      where: { aDevolver: true, orden: { eventoId } },
      orderBy: { creadoEn: "desc" },
      take: 100,
      select: {
        id: true,
        montoCentavos: true,
        metodo: true,
        nota: true,
        creadoEn: true,
        mpPagoId: true,
        orden: { select: { id: true, numero: true, email: true, estado: true } },
      },
    }),
    // Los pagos que dieron entradas, de compras pagas.
    db.pago.findMany({
      where: { aDevolver: false, orden: { eventoId, estado: "PAGADA" } },
      select: { ordenId: true, metodo: true, estadoMp: true, montoCentavos: true, comisionCentavos: true, mpPagoId: true, creadoEn: true, orden: { select: { numero: true, email: true } } },
    }),
    db.orden.count({ where: { eventoId, tipo: "VENTA", estado: "PAGADA" } }),
  ]);
  // Cobrado: los pagos de verdad aprobados, más los confirmados a mano que
  // todavía no tienen un pago de verdad (así no se cuenta dos veces).
  const conPagoReal = new Set(validos.filter((pago) => pago.metodo !== "MANUAL").map((pago) => pago.ordenId));
  let cobradoCentavos = 0;
  let comisionesCentavos = 0;
  for (const pago of validos) {
    if (pago.metodo === "MANUAL" ? conPagoReal.has(pago.ordenId) : pago.estadoMp !== "approved") continue;
    cobradoCentavos += pago.montoCentavos;
    comisionesCentavos += pago.comisionCentavos;
  }
  const revertidos = validos.filter((pago) => pago.metodo !== "MANUAL" && pago.estadoMp !== "approved");
  const ahora = new Date();

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-borde bg-superficie p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-bold">Pagos</h2>
          <p className="text-sm text-tenue">
            {pagadas} {pagadas === 1 ? "compra paga" : "compras pagas"} · Cobrado: {formatearPesos(cobradoCentavos)}
            {comisionesCentavos > 0 && ` · Comisiones de Mercado Pago: ${formatearPesos(comisionesCentavos)}`}
          </p>
        </div>
        <BotonBuscarPagos accion={buscarPagosAccion.bind(null, eventoId)} />
      </div>
      {pagada !== undefined && (
        <p role="status" className="rounded-xl bg-ok/10 px-4 py-3 font-semibold text-ok-oscuro">
          Listo: la compra N° {pagada} quedó paga.
        </p>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="font-bold">Esperando la plata</h3>
        {esperando.length === 0 ? (
          <p className="text-sm text-tenue">Nadie está pagando en este momento.</p>
        ) : (
          <>
            <p className="text-sm text-tenue">
              Se confirman solas. Si alguien transfirió un monto distinto (por ejemplo, sin los centavos) y lo ves en tu
              Mercado Pago, confirmalo a mano.
            </p>
            <ul className="flex flex-col">
              {esperando.map((orden) => {
                const monto =
                  orden.metodoPago === "TRANSFERENCIA" && orden.montoTransferencia
                    ? orden.montoTransferencia.montoCentavos
                    : orden.totalCentavos + (orden.metodoPago === "MERCADOPAGO" ? orden.recargoCentavos : 0);
                const nombres = orden.entradas.map((entrada) => entrada.titular).filter(Boolean);
                const vencida = orden.estado === "PENDIENTE" && orden.venceEn !== null && orden.venceEn <= ahora;
                return (
                  <li key={orden.id} className="flex flex-wrap items-start justify-between gap-3 border-t border-[#EDEDE8] py-3">
                    <div className="flex min-w-0 flex-col gap-0.5 text-sm">
                      <span className="font-semibold">
                        N° {orden.numero} · {nombres[0] ?? "Sin nombre"}
                        {nombres.length > 1 && ` (+${nombres.length - 1})`}
                      </span>
                      <span className="text-tenue [overflow-wrap:anywhere]">{orden.email ?? "sin email"}</span>
                      <span>
                        {orden.metodoPago ? METODO[orden.metodoPago] : "—"}: <strong>{formatearPesos(monto)}</strong>
                      </span>
                      <span className="text-xs text-tenue">
                        {vencida ? "Venció la reserva" : ESTADO[orden.estado as keyof typeof ESTADO]}
                        {orden.estado === "PENDIENTE" && orden.venceEn && !vencida && ` · vence ${formatearFecha(orden.venceEn)}`}
                        {orden.estado !== "PENDIENTE" && " · si paga y hay lugar, se confirma igual"}
                      </span>
                    </div>
                    <BotonConfirmarPago
                      accion={confirmarPagoAccion.bind(null, eventoId, orden.id)}
                      numero={orden.numero}
                      monto={formatearPesos(monto)}
                    />
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {aDevolver.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl bg-error/10 p-4">
          <h3 className="font-bold text-error">Para devolver</h3>
          <p className="text-sm">
            Estos pagos entraron pero no dieron entradas. Devolvé la plata desde tu Mercado Pago. Si una compra vencida
            pagó tarde y ahora hay lugar, podés darle las entradas con ese mismo pago.
          </p>
          <ul className="flex flex-col">
            {aDevolver.map((pago) => (
              <li key={pago.id} className="flex flex-wrap items-start justify-between gap-3 border-t border-error/20 py-2 text-sm">
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  <strong>{formatearPesos(pago.montoCentavos)}</strong> · {METODO[pago.metodo]} · compra N° {pago.orden.numero} (
                  {pago.orden.email ?? "sin email"}) · {formatearFecha(pago.creadoEn)} · pago {pago.mpPagoId}
                  {pago.nota && <span className="block text-tenue">{pago.nota}</span>}
                </span>
                {(pago.orden.estado === "VENCIDA" || pago.orden.estado === "CANCELADA") && (
                  <BotonConfirmarPago
                    accion={confirmarPagoAccion.bind(null, eventoId, pago.orden.id)}
                    numero={pago.orden.numero}
                    monto={formatearPesos(pago.montoCentavos)}
                    texto="Dar las entradas igual"
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {revertidos.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl bg-alerta/10 p-4">
          <h3 className="font-bold">Pagos revertidos</h3>
          <p className="text-sm">
            Mercado Pago devolvió o desconoció estos pagos (por ejemplo, un contracargo de la tarjeta), pero las entradas
            siguen válidas. No suman en lo cobrado.
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {revertidos.map((pago) => (
              <li key={pago.mpPagoId} className="[overflow-wrap:anywhere]">
                <strong>{formatearPesos(pago.montoCentavos)}</strong> · compra N° {pago.orden.numero} ({pago.orden.email ?? "sin email"}) ·
                estado en Mercado Pago: {pago.estadoMp} · pago {pago.mpPagoId}
              </li>
            ))}
          </ul>
        </div>
      )}

      <MailsDelEvento eventoId={eventoId} />
    </section>
  );
}
