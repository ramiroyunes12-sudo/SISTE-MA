"use client";

// "Elegí tus entradas": el lote en venta de cada tipo, con + y −, y abajo el
// total. Acá solo llega lo que puede ver el público (nombre y precio del lote
// en venta): ni cantidades ni los lotes que siguen.
import { useState } from "react";

import { formatearPesos } from "@/lib/dinero";
import type { TipoPublico } from "@/lib/eventos/publico";

export function ElegirEntradas({ tipos, maxPorCompra }: { tipos: TipoPublico[]; maxPorCompra: number }) {
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const enVenta = tipos.filter((tipo) => tipo.lote);
  const total = enVenta.reduce((suma, tipo) => suma + (cantidades[tipo.id] ?? 0), 0);
  const totalCentavos = enVenta.reduce((suma, tipo) => suma + (cantidades[tipo.id] ?? 0) * tipo.lote!.precioCentavos, 0);

  function sumar(tipoId: string, cuanto: 1 | -1) {
    setCantidades((antes) => ({ ...antes, [tipoId]: Math.max(0, (antes[tipoId] ?? 0) + cuanto) }));
  }

  if (tipos.length === 0) {
    return <p className="rounded-2xl border border-borde bg-superficie p-5 text-tenue">Todavía no hay entradas a la venta.</p>;
  }

  return (
    <section aria-labelledby="titulo-entradas" className="flex flex-col gap-4">
      <h2 id="titulo-entradas" className="font-display text-xl font-bold">
        {enVenta.length ? "Elegí tus entradas" : "Entradas"}
      </h2>

      {tipos.map((tipo) => (
        <div key={tipo.id} className="overflow-hidden rounded-2xl border border-borde bg-superficie">
          <h3 className="border-b border-borde px-4 py-3.5 text-[17px] font-bold">{tipo.nombre}</h3>
          {tipo.lote ? (
            <div className="flex items-center justify-between gap-3 bg-[#F3F3FE] px-4 py-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[13px] font-bold uppercase text-acento [overflow-wrap:anywhere]">
                  {tipo.lote.nombre} · En venta
                </span>
                <span className="text-xl font-bold">{formatearPesos(tipo.lote.precioCentavos)}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => sumar(tipo.id, -1)}
                  disabled={!cantidades[tipo.id]}
                  aria-label={`Quitar una entrada ${tipo.nombre}`}
                  className="size-11 rounded-[10px] border border-[#D5D5CE] bg-superficie text-[22px] text-tinta disabled:text-[#9A9DA4]"
                >
                  −
                </button>
                <span aria-live="polite" className="min-w-6 text-center text-lg font-bold">
                  {cantidades[tipo.id] ?? 0}
                </span>
                <button
                  type="button"
                  onClick={() => sumar(tipo.id, 1)}
                  disabled={total >= maxPorCompra}
                  aria-label={`Agregar una entrada ${tipo.nombre}`}
                  className="size-11 rounded-[10px] border border-acento bg-acento text-[22px] text-white hover:bg-acento-hover disabled:border-[#D5D5CE] disabled:bg-[#EDEDE8] disabled:text-[#9A9DA4]"
                >
                  +
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 px-4 py-3 text-tenue">
              <span className="text-[15px]">No quedan entradas de este tipo.</span>
              <span className="rounded-full bg-[#EDEDE8] px-2.5 py-1 text-[13px] font-bold">AGOTADO</span>
            </div>
          )}
        </div>
      ))}

      {enVenta.length > 0 ? (
        <>
          <p className="text-sm leading-relaxed text-tenue">
            Máximo {maxPorCompra} {maxPorCompra === 1 ? "entrada" : "entradas"} por compra. Las entradas son nominativas: en
            el próximo paso te pedimos nombre y DNI de cada persona.
          </p>
          <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-borde bg-superficie px-4 py-4 lg:mx-0 lg:rounded-2xl lg:border">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-[13px] text-tenue">
                  {total} {total === 1 ? "entrada" : "entradas"}
                </span>
                <span className="text-[22px] font-bold">{formatearPesos(totalCentavos)}</span>
              </div>
              <button
                type="button"
                disabled
                aria-describedby="compra-pronto"
                className="h-[52px] rounded-xl bg-acento px-7 text-[17px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Continuar
              </button>
            </div>
            <p id="compra-pronto" className="text-[13px] text-tenue">
              La compra online se habilita muy pronto.
            </p>
          </div>
        </>
      ) : (
        <p className="font-display text-2xl font-extrabold">Agotado</p>
      )}
    </section>
  );
}
