// Página pública del evento: /e/<slug>. Flyer, datos y, de cada tipo de
// entrada, solo el lote en venta (ver src/lib/eventos/publico.ts).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { cache } from "react";

import { obtenerSesionActual } from "@/lib/auth/actual";
import { obtenerDb } from "@/lib/db";
import { SLUG } from "@/lib/eventos/editor";
import { buscarEventoPublico, loVeElPublico, puedeVerVistaPrevia } from "@/lib/eventos/publico";
import { formatearFechaLarga } from "@/lib/fechas";

import { ElegirEntradas } from "./elegir-entradas";

// Una vez por pedido (la usan la página y los metadatos).
const cargar = cache(async (slug: string) => {
  // Siempre al momento: el lote en venta cambia con cada compra.
  await connection();
  if (!SLUG.test(slug) || slug.length > 100) return null;
  const evento = await buscarEventoPublico(obtenerDb(), slug);
  if (!evento) return null;
  if (loVeElPublico(evento)) return { evento, vistaPrevia: false };
  // Borrador, o productora desactivada: solo su gente lo ve, como vista previa.
  const sesion = await obtenerSesionActual();
  return puedeVerVistaPrevia(sesion?.usuario ?? null, evento) ? { evento, vistaPrevia: true } : null;
});

export async function generateMetadata({ params }: PageProps<"/e/[slug]">): Promise<Metadata> {
  const datos = await cargar((await params).slug);
  if (!datos) return { title: "Evento no encontrado" };
  const { evento, vistaPrevia } = datos;
  const descripcion = `${formatearFechaLarga(evento.fecha)} · ${evento.lugar}`;
  return {
    title: vistaPrevia ? `Vista previa · ${evento.nombre}` : evento.nombre,
    description: descripcion,
    robots: vistaPrevia ? { index: false, follow: false } : undefined,
    openGraph: { title: evento.nombre, description: descripcion, type: "website", locale: "es_AR" },
  };
}

export default async function PaginaEvento({ params }: PageProps<"/e/[slug]">) {
  const datos = await cargar((await params).slug);
  if (!datos) notFound();
  const { evento, vistaPrevia } = datos;
  const mapa = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    [evento.lugar, evento.direccion].filter(Boolean).join(", "),
  )}`;

  return (
    <div className="flex flex-1 flex-col font-sans">
      <header className="border-b border-borde bg-superficie">
        <div className="mx-auto flex h-14 max-w-5xl items-center px-4">
          <span className="font-display text-lg font-extrabold">[TU MARCA]</span>
        </div>
      </header>

      {vistaPrevia && (
        <p role="status" className="bg-alerta px-4 py-2.5 text-center text-sm font-semibold text-white">
          Vista previa: el público todavía no ve este evento
          {evento.estado === "BORRADOR" ? " (está en borrador)." : " (la productora está desactivada)."}
        </p>
      )}

      <main className="mx-auto grid w-full max-w-5xl gap-6 px-4 pt-6 lg:grid-cols-[360px_minmax(0,1fr)] lg:gap-10 lg:py-10">
        <EspacioFlyer />

        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex flex-col gap-2.5">
            <h1 className="font-display text-[28px] font-extrabold leading-tight [overflow-wrap:anywhere] lg:text-4xl">
              {evento.nombre}
            </h1>
            <Dato icono={<IconoCalendario />}>{formatearFechaLarga(evento.fecha)}</Dato>
            <Dato icono={<IconoLugar />}>
              <a href={mapa} target="_blank" rel="noopener noreferrer" className="text-tinta underline-offset-2 hover:underline">
                {evento.lugar}
                {evento.direccion && <span className="text-tenue"> · {evento.direccion}</span>}
              </a>
            </Dato>
            <p className="text-sm text-tenue">Organiza {evento.productora.nombre}</p>
          </div>

          {evento.estado === "FINALIZADO" ? (
            <p className="rounded-2xl border border-borde bg-superficie p-5 font-semibold">
              Este evento ya pasó: la venta está cerrada.
            </p>
          ) : (
            <ElegirEntradas tipos={evento.tipos} maxPorCompra={evento.maxPorCompra} />
          )}

          {evento.descripcion && (
            <section className="flex flex-col gap-2 pb-6">
              <h2 className="font-display text-xl font-bold">Sobre el evento</h2>
              <p className="whitespace-pre-line leading-relaxed [overflow-wrap:anywhere]">{evento.descripcion}</p>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

// El flyer se sube más adelante: por ahora, el espacio marcado (formato publicación, 4:5).
function EspacioFlyer() {
  return (
    <div className="mx-auto flex aspect-[4/5] w-full max-w-[300px] flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-borde-campo bg-superficie text-center text-sm text-tenue lg:sticky lg:top-10 lg:max-w-none lg:self-start">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="m21 15-5-5L5 21" />
      </svg>
      <span className="font-semibold">Flyer del evento</span>
    </div>
  );
}

function Dato({ icono, children }: { icono: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 text-[15px]">
      <span className="mt-px shrink-0 text-tenue">{icono}</span>
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </div>
  );
}

function IconoCalendario() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function IconoLugar() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}
