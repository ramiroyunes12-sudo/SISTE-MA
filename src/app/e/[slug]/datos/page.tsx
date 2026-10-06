// Checkout: /e/<slug>/datos?p=<pedido>. Muestra cómo queda el pedido repartido
// en los lotes y pide nombre y DNI de cada entrada y a dónde mandarlas.
// Todavía no reserva (paso 10) ni cobra (pasos 11 y 12).
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { obtenerDb } from "@/lib/db";
import { formatearPesos } from "@/lib/dinero";
import { planearCompraDelEvento } from "@/lib/ventas/compra";

import { cargarEventoParaMostrar } from "../cargar";
import { enviarDatosAccion } from "./acciones";
import { FormularioDatos } from "./formulario-datos";

export async function generateMetadata({ params }: PageProps<"/e/[slug]/datos">): Promise<Metadata> {
  const cargado = await cargarEventoParaMostrar((await params).slug);
  return {
    title: cargado ? `Completá tus datos · ${cargado.evento.nombre}` : "Evento no encontrado",
    robots: { index: false, follow: false },
  };
}

export default async function PaginaDatos({ params, searchParams }: PageProps<"/e/[slug]/datos">) {
  const cargado = await cargarEventoParaMostrar((await params).slug);
  if (!cargado) notFound();
  const { evento, vistaPrevia } = cargado;
  const { p } = await searchParams;
  const textoPedido = typeof p === "string" ? p : "";
  const plan =
    evento.estado === "FINALIZADO"
      ? { ok: false as const, error: "La venta de este evento está cerrada." }
      : await planearCompraDelEvento(obtenerDb(), evento, textoPedido);
  const volver = `/e/${evento.slug}`;

  return (
    <div className="flex flex-1 flex-col font-sans">
      <header className="border-b border-borde bg-superficie">
        <div className="mx-auto flex h-14 max-w-xl items-center gap-2 px-2">
          <Link href={volver} aria-label="Volver al evento" className="flex size-11 items-center justify-center text-tinta">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Link>
          <div className="flex min-w-0 flex-col">
            <h1 className="text-[17px] font-bold leading-tight">Completá tus datos</h1>
            <span className="truncate text-[13px] text-tenue">{evento.nombre}</span>
          </div>
        </div>
      </header>

      {vistaPrevia && (
        <p role="status" className="bg-alerta px-4 py-2.5 text-center text-sm font-semibold text-white">
          Vista previa: el público todavía no ve este evento.
        </p>
      )}

      <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pt-4">
        {plan.ok ? (
          <>
            <section aria-labelledby="titulo-resumen" className="flex flex-col gap-1.5 rounded-2xl border border-borde bg-superficie p-4">
              <h2 id="titulo-resumen" className="text-[13px] font-bold text-tenue">
                RESUMEN
              </h2>
              <ul className="flex flex-col gap-1 text-[15px]">
                {plan.lineas.map((linea) => (
                  <li key={linea.loteId} className="flex justify-between gap-3">
                    <span>
                      {linea.cantidad} × {linea.tipoNombre} · {linea.loteNombre}
                    </span>
                    <span>{formatearPesos(linea.cantidad * linea.precioCentavos)}</span>
                  </li>
                ))}
              </ul>
              {new Set(plan.lineas.map((linea) => linea.tipoId)).size < plan.lineas.length && (
                <p className="text-[13px] text-tenue">
                  En el lote en venta no quedaban todas las que pediste: las demás son del lote siguiente.
                </p>
              )}
            </section>
            <FormularioDatos
              entradas={plan.lineas.flatMap((linea) => Array<string>(linea.cantidad).fill(linea.tipoNombre))}
              totalCentavos={plan.totalCentavos}
              accion={enviarDatosAccion.bind(null, evento.slug, textoPedido)}
            />
          </>
        ) : (
          <div className="flex flex-col gap-3 rounded-2xl border border-borde bg-superficie p-5">
            <p role="alert" className="font-semibold">
              {plan.error}
            </p>
            <Link href={volver} className="font-semibold text-acento hover:text-acento-hover">
              ← Volver a elegir entradas
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
