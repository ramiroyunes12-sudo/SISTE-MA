"use client";

// Botones de la sección "Pagos" del evento.
import { useActionState } from "react";

import type { EstadoPagoManual } from "./acciones";

export function BotonConfirmarPago({
  accion: confirmar,
  numero,
  monto,
  texto = "Confirmar pago",
}: {
  accion: () => Promise<EstadoPagoManual>;
  numero: number;
  monto: string;
  texto?: string;
}) {
  const [estado, accion, enviando] = useActionState(confirmar, {});
  return (
    <form
      action={accion}
      onSubmit={(evento) => {
        if (!window.confirm(`¿Confirmar el pago de la compra N° ${numero} (${monto})? Hacelo solo si ves la plata en tu Mercado Pago.`)) {
          evento.preventDefault();
        }
      }}
      className="flex flex-col items-end gap-1"
    >
      <button
        type="submit"
        disabled={enviando}
        className="h-10 rounded-lg border-[1.5px] border-acento px-3 text-sm font-bold text-acento hover:bg-acento/5 disabled:opacity-60"
      >
        {enviando ? "Confirmando…" : texto}
      </button>
      {!enviando && estado.error && (
        <span role="alert" className="text-sm font-semibold text-error">
          {estado.error}
        </span>
      )}
      {!enviando && estado.listo && (
        <span role="status" className="text-sm font-semibold text-ok-oscuro">
          {estado.listo}
        </span>
      )}
    </form>
  );
}

export function BotonBuscarPagos({ accion: buscar }: { accion: () => Promise<EstadoPagoManual> }) {
  const [estado, accion, enviando] = useActionState(buscar, {});
  return (
    <form action={accion} className="flex flex-wrap items-center gap-3">
      <button
        type="submit"
        disabled={enviando}
        className="h-10 rounded-lg border-[1.5px] border-borde-campo px-3 text-sm font-bold hover:bg-fondo disabled:opacity-60"
      >
        {enviando ? "Buscando…" : "Buscar pagos ahora"}
      </button>
      {!enviando && (estado.error || estado.listo) && (
        <span role="status" className={`text-sm font-semibold ${estado.error ? "text-error" : "text-ok-oscuro"}`}>
          {estado.error ?? estado.listo}
        </span>
      )}
    </form>
  );
}

export function BotonReintentarMails({ accion: reintentar }: { accion: () => Promise<EstadoPagoManual> }) {
  const [estado, accion, enviando] = useActionState(reintentar, {});
  return (
    <form action={accion} className="flex flex-wrap items-center gap-3">
      <button
        type="submit"
        disabled={enviando}
        className="h-10 rounded-lg border-[1.5px] border-borde-campo px-3 text-sm font-bold hover:bg-fondo disabled:opacity-60"
      >
        {enviando ? "Mandando…" : "Reintentar ahora"}
      </button>
      {!enviando && (estado.error || estado.listo) && (
        <span role="status" className={`text-sm font-semibold ${estado.error ? "text-error" : "text-ok-oscuro"}`}>
          {estado.error ?? estado.listo}
        </span>
      )}
    </form>
  );
}
