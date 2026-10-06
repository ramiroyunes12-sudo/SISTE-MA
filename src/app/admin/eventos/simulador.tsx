"use client";

// "Probar una compra": cuántas de cada tipo, y muestra cómo se repartirían en
// los lotes y cuánto saldría, si alguien comprara ahora. No reserva nada.
import { type FormEvent, startTransition, useActionState } from "react";

import { BotonPrincipal, ESTILO_CAMPO, MensajeError } from "@/components/formulario";
import { formatearPesos } from "@/lib/dinero";

import type { EstadoSimulacion } from "./acciones";

export function SimuladorCompra({
  accion: simular,
  tipos,
  maxPorCompra,
}: {
  accion: (anterior: EstadoSimulacion, datos: FormData) => Promise<EstadoSimulacion>;
  tipos: { id: string; nombre: string }[];
  maxPorCompra: number;
}) {
  const [estado, accion, probando] = useActionState(simular, {});
  if (tipos.length === 0) return null;

  // Se manda "a mano" para que las cantidades queden escritas después de probar.
  function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const datos = new FormData(evento.currentTarget);
    startTransition(() => accion(datos));
  }

  return (
    <form action={accion} onSubmit={alEnviar} className="flex flex-col gap-4 rounded-2xl border border-borde bg-superficie p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-bold">Probar una compra</h2>
        <p className="text-sm text-tenue">
          Cómo se cobraría un pedido si alguien comprara ahora (máximo {maxPorCompra} por compra). Si en un lote no
          entra todo, el resto va al siguiente. Es solo una prueba: no reserva ni vende nada.
        </p>
      </div>
      <div className="flex flex-wrap gap-4">
        {tipos.map((tipo) => (
          <div key={tipo.id} className="flex flex-col gap-1.5">
            <label htmlFor={`simular-${tipo.id}`} className="text-sm font-semibold">
              {tipo.nombre}
            </label>
            <input
              id={`simular-${tipo.id}`}
              name={`cantidad-${tipo.id}`}
              type="number"
              inputMode="numeric"
              min={0}
              max={20}
              step={1}
              defaultValue={0}
              className={`h-12 w-24 ${ESTILO_CAMPO}`}
            />
          </div>
        ))}
      </div>
      <BotonPrincipal type="submit" disabled={probando} className="self-start">
        {probando ? "Calculando…" : "Probar"}
      </BotonPrincipal>

      {!probando && estado.aviso && <p className="text-sm font-semibold text-alerta">{estado.aviso}</p>}
      {!probando && <MensajeError>{estado.error}</MensajeError>}
      {!probando && estado.plan && (
        <div role="status" className="flex flex-col gap-2 rounded-xl bg-fondo p-4">
          <ul className="flex flex-col gap-1">
            {estado.plan.lineas.map((linea) => (
              <li key={linea.loteId} className="flex flex-wrap justify-between gap-x-4">
                <span>
                  {linea.cantidad} × {linea.tipoNombre} · {linea.loteNombre} · {formatearPesos(linea.precioCentavos)}
                </span>
                <span className="font-semibold">{formatearPesos(linea.cantidad * linea.precioCentavos)}</span>
              </li>
            ))}
          </ul>
          <p className="flex justify-between gap-4 border-t border-borde pt-2 font-bold">
            <span>
              Total ({estado.plan.cantidad} {estado.plan.cantidad === 1 ? "entrada" : "entradas"})
            </span>
            <span>{formatearPesos(estado.plan.totalCentavos)}</span>
          </p>
        </div>
      )}
    </form>
  );
}
