// La compra: /compra/<llave>. El link es secreto (solo lo tiene quien
// reservó). Mientras la reserva está vigente: reloj, resumen y los datos de
// cada entrada. Si venció o se canceló, lo dice y lleva de vuelta al evento.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { obtenerDb } from "@/lib/db";
import { formatearPesos } from "@/lib/dinero";
import { buscarCompra, liberarVencidas } from "@/lib/ventas/ordenes";

import { cancelarAccion, guardarDatosAccion } from "./acciones";
import { FormularioDatos } from "./formulario-datos";
import { Reloj } from "./reloj";

export const metadata: Metadata = {
  title: "Tu compra",
  robots: { index: false, follow: false },
  // Que el link (con la llave) no viaje a otras páginas.
  referrer: "no-referrer",
};

export default async function PaginaCompra({ params }: PageProps<"/compra/[llave]">) {
  await connection();
  const { llave } = await params;
  const ahora = new Date();
  const compra = await buscarCompra(obtenerDb(), llave, ahora);
  if (!compra) notFound();
  const volver = `/e/${compra.evento.slug}`;

  if (compra.vencida) {
    // De paso, devuelve los lugares (si no lo hizo ya otra visita).
    await liberarVencidas(obtenerDb(), compra.evento.id, ahora).catch((error: unknown) =>
      console.warn("[liberarVencidas] No se pudo:", error),
    );
  }

  if (compra.estado !== "PENDIENTE" || compra.vencida) {
    const cancelada = compra.estado === "CANCELADA";
    const pagada = compra.estado === "PAGADA";
    return (
      <Marco evento={compra.evento.nombre} volver={volver}>
        <div className="flex flex-col gap-3 rounded-2xl border border-borde bg-superficie p-5">
          <h2 className="font-display text-xl font-bold">
            {pagada ? "¡Compra confirmada!" : cancelada ? "Cancelaste esta reserva" : "Se venció tu reserva"}
          </h2>
          <p className="text-tenue">
            {pagada
              ? "Las entradas te llegan por email."
              : cancelada
                ? "Las entradas volvieron a estar a la venta."
                : "Pasaron los 10 minutos y las entradas volvieron a estar a la venta. Podés elegir de nuevo."}
          </p>
          {!pagada && (
            <Link href={volver} className="font-semibold text-acento hover:text-acento-hover">
              ← Volver a elegir entradas
            </Link>
          )}
        </div>
      </Marco>
    );
  }

  // Resumen: cuántas de cada tipo y lote.
  const resumen = new Map<string, { texto: string; cantidad: number; precioCentavos: number }>();
  for (const entrada of compra.entradas) {
    const clave = `${entrada.tipo}·${entrada.lote}·${entrada.precioCentavos}`;
    const linea = resumen.get(clave) ?? { texto: `${entrada.tipo} · ${entrada.lote}`, cantidad: 0, precioCentavos: entrada.precioCentavos };
    linea.cantidad++;
    resumen.set(clave, linea);
  }
  const variosLotes = new Set(compra.entradas.map((e) => e.tipo)).size < resumen.size;

  return (
    <Marco evento={compra.evento.nombre} volver={volver} cancelar={cancelarAccion.bind(null, llave)}>
      <Reloj venceEnMs={compra.venceEn!.getTime()} ahoraServidorMs={ahora.getTime()} />
      <section aria-labelledby="titulo-resumen" className="flex flex-col gap-1.5 rounded-2xl border border-borde bg-superficie p-4">
        <h2 id="titulo-resumen" className="text-[13px] font-bold text-tenue">
          RESUMEN
        </h2>
        <ul className="flex flex-col gap-1 text-[15px]">
          {[...resumen.values()].map((linea) => (
            <li key={linea.texto + linea.precioCentavos} className="flex justify-between gap-3">
              <span>
                {linea.cantidad} × {linea.texto}
              </span>
              <span>{formatearPesos(linea.cantidad * linea.precioCentavos)}</span>
            </li>
          ))}
        </ul>
        {variosLotes && (
          <p className="text-[13px] text-tenue">
            En el lote en venta no quedaban todas las que pediste: las demás son del lote siguiente.
          </p>
        )}
      </section>
      <FormularioDatos
        entradas={compra.entradas}
        email={compra.email}
        telefono={compra.telefono}
        totalCentavos={compra.totalCentavos}
        accion={guardarDatosAccion.bind(null, llave)}
      />
    </Marco>
  );
}

function Marco({
  evento,
  volver,
  cancelar,
  children,
}: {
  evento: string;
  volver: string;
  cancelar?: () => Promise<void>;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col font-sans">
      <header className="border-b border-borde bg-superficie">
        <div className="mx-auto flex h-14 max-w-xl items-center justify-between gap-2 px-4">
          <div className="flex min-w-0 flex-col">
            <h1 className="text-[17px] font-bold leading-tight">Completá tus datos</h1>
            <span className="truncate text-[13px] text-tenue">{evento}</span>
          </div>
          {cancelar ? (
            <form action={cancelar}>
              <button type="submit" className="h-11 shrink-0 text-sm font-semibold text-acento underline hover:text-acento-hover">
                Cambiar entradas
              </button>
            </form>
          ) : (
            <Link href={volver} className="shrink-0 text-sm font-semibold text-acento hover:text-acento-hover">
              Ir al evento
            </Link>
          )}
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pt-4">{children}</main>
    </div>
  );
}
