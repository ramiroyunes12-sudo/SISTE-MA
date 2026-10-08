"use client";

// Pagar: elegir transferencia o Mercado Pago, los datos para transferir (con
// botones para copiar) y la espera hasta que entra la plata.
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { BotonPrincipal, MensajeError } from "@/components/formulario";
import { formatearPesos } from "@/lib/dinero";

import type { EstadoPago } from "./acciones";

type Accion = (anterior: EstadoPago) => Promise<EstadoPago>;

export function ElegirPago({
  totalCentavos,
  transferencia,
  mercadoPago,
  elegido,
  transferir,
  pagarConMercadoPago,
}: {
  totalCentavos: number;
  transferencia: boolean;
  mercadoPago: { totalCentavos: number; recargoCentavos: number } | null;
  elegido: "TRANSFERENCIA" | "MERCADOPAGO" | null;
  transferir: Accion;
  pagarConMercadoPago: Accion;
}) {
  const [estadoTransferencia, accionTransferencia, transfiriendo] = useActionState(transferir, {});
  const [estadoMp, accionMp, yendoAMp] = useActionState(pagarConMercadoPago, {});
  const ocupado = transfiriendo || yendoAMp;

  if (!transferencia && !mercadoPago) {
    return (
      <p className="rounded-2xl border border-borde bg-superficie p-4 text-tenue">
        Este evento todavía no tiene medios de pago habilitados. Probá de nuevo más tarde.
      </p>
    );
  }

  // Ya eligió transferencia y no hay otra forma: no hay nada más que ofrecer.
  if (elegido === "TRANSFERENCIA" && !mercadoPago) return null;

  return (
    <section aria-labelledby="titulo-pago" className="flex flex-col gap-3">
      <h2 id="titulo-pago" className="text-[17px] font-bold">
        {elegido ? "¿Querés pagar de otra forma?" : "¿Cómo querés pagar?"}
      </h2>
      {transferencia && elegido !== "TRANSFERENCIA" && (
        <form action={accionTransferencia} className="flex flex-col gap-2 rounded-2xl border border-borde bg-superficie p-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-bold">Transferencia</span>
            <span className="text-lg font-bold">{formatearPesos(totalCentavos)}</span>
          </div>
          <p className="text-sm text-tenue">
            Sin recargo. Desde Mercado Pago o cualquier banco, al alias que te mostramos. Se confirma sola.
          </p>
          {!transfiriendo && <MensajeError>{estadoTransferencia.error}</MensajeError>}
          <BotonPrincipal type="submit" disabled={ocupado}>
            {transfiriendo ? "Un momento…" : "Pagar por transferencia"}
          </BotonPrincipal>
        </form>
      )}
      {mercadoPago && (
        <form action={accionMp} className="flex flex-col gap-2 rounded-2xl border border-borde bg-superficie p-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-bold">Mercado Pago</span>
            <span className="text-lg font-bold">{formatearPesos(mercadoPago.totalCentavos)}</span>
          </div>
          <p className="text-sm text-tenue">
            Se abre Mercado Pago con todo cargado (dinero en cuenta o tarjeta, en 1 pago).
            {mercadoPago.recargoCentavos > 0 && (
              <>
                {" "}
                Incluye <span className="whitespace-nowrap">{formatearPesos(mercadoPago.recargoCentavos)}</span> de cargo por
                servicio.
              </>
            )}
          </p>
          {!yendoAMp && <MensajeError>{estadoMp.error}</MensajeError>}
          <button
            type="submit"
            disabled={ocupado}
            className="h-12 rounded-xl border-2 border-acento px-5 text-base font-bold text-acento transition-colors hover:bg-acento/5 disabled:cursor-wait disabled:opacity-60"
          >
            {yendoAMp ? "Abriendo Mercado Pago…" : elegido === "MERCADOPAGO" ? "Volver a Mercado Pago" : "Pagar con Mercado Pago"}
          </button>
        </form>
      )}
    </section>
  );
}

// Los datos para transferir, con botones para copiar.
export function DatosTransferencia({ alias, titular, montoCentavos }: { alias: string; titular: string; montoCentavos: number }) {
  // Para pegar en la app: sin "$" ni puntos de miles, con coma y centavos ("16000,37").
  const montoParaCopiar = `${Math.trunc(montoCentavos / 100)},${String(montoCentavos % 100).padStart(2, "0")}`;
  return (
    <section aria-labelledby="titulo-transferir" className="flex flex-col gap-3 rounded-2xl border-2 border-acento bg-superficie p-4">
      <h2 id="titulo-transferir" className="text-[17px] font-bold">
        Transferí este monto exacto
      </h2>
      <div className="flex items-center justify-between gap-3 rounded-xl bg-fondo p-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-xs font-bold text-tenue">MONTO (con los centavos)</span>
          <span className="text-2xl font-extrabold">{formatearPesos(montoCentavos)}</span>
        </div>
        <BotonCopiar texto={montoParaCopiar} etiqueta="monto" />
      </div>
      <div className="flex items-center justify-between gap-3 rounded-xl bg-fondo p-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-xs font-bold text-tenue">ALIAS</span>
          <span className="text-lg font-bold [overflow-wrap:anywhere]">{alias}</span>
          <span className="text-sm text-tenue">A nombre de {titular}</span>
        </div>
        <BotonCopiar texto={alias} etiqueta="alias" />
      </div>
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
        <li>Copiá el alias y abrí Mercado Pago o la app de tu banco.</li>
        <li>Transferir → pegá el alias → fijate que diga {titular}.</li>
        <li>
          Pegá el monto <strong>con los centavos</strong>: así sabemos que es tu pago.
        </li>
        <li>Volvé a esta página: se confirma sola en unos segundos.</li>
      </ol>
    </section>
  );
}

function BotonCopiar({ texto, etiqueta }: { texto: string; etiqueta: string }) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2_000);
    } catch {
      window.prompt(`Copiá el ${etiqueta}:`, texto);
    }
  }
  return (
    <button
      type="button"
      onClick={copiar}
      aria-label={`Copiar ${etiqueta}`}
      className="h-11 shrink-0 rounded-xl bg-acento px-4 text-sm font-bold text-white hover:bg-acento-hover"
    >
      <span aria-live="polite">{copiado ? "¡Copiado!" : "Copiar"}</span>
    </button>
  );
}

// Pregunta cada 5 segundos si ya entró la plata (solo con la página a la
// vista) y, cuando cambia el estado de la compra, recarga. Deja de preguntar
// a los 40 minutos.
export function EsperarPago({ revisar, mensaje }: { revisar: () => Promise<{ estado: string } | null>; mensaje: string }) {
  const router = useRouter();
  const [revisando, setRevisando] = useState(false);
  const ocupado = useRef(false);

  async function revisarAhora() {
    if (ocupado.current) return;
    ocupado.current = true;
    setRevisando(true);
    try {
      const resultado = await revisar();
      if (resultado && resultado.estado !== "PENDIENTE") router.refresh();
    } finally {
      ocupado.current = false;
      setRevisando(false);
    }
  }

  useEffect(() => {
    const inicio = Date.now();
    const intervalo = setInterval(() => {
      if (Date.now() - inicio > 40 * 60_000) return clearInterval(intervalo);
      if (document.visibilityState === "visible") void revisarAhora();
    }, 5_000);
    return () => clearInterval(intervalo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div role="status" className="flex flex-col items-center gap-2 rounded-2xl bg-superficie p-4 text-center">
      <span className="flex items-center gap-2 font-semibold">
        <span aria-hidden="true" className="inline-block size-3 animate-pulse rounded-full bg-acento" />
        {mensaje}
      </span>
      <button
        type="button"
        onClick={() => void revisarAhora()}
        disabled={revisando}
        className="h-11 text-sm font-semibold text-acento underline disabled:opacity-60"
      >
        {revisando ? "Revisando…" : "Ya pagué: revisar ahora"}
      </button>
    </div>
  );
}
