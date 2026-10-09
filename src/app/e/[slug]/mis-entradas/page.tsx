// "Reenviar mis entradas": /e/<slug>/mis-entradas. Para quien perdió el
// mail y el link de la compra: pone el email y un DNI de la compra y le
// volvemos a mandar el mail, solo a ese email y con un límite por día
// (src/lib/mails/reenviar.ts). Se ve igual que la página del evento: si el
// público no la ve, no existe.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { whatsappDeAyuda } from "@/lib/ayuda";
import { MAX_REENVIOS_POR_DIA } from "@/lib/mails/reenviar";

import { cargarEventoParaMostrar as cargar } from "../cargar";
import { reenviarEntradasAccion } from "./acciones";
import { FormularioMisEntradas } from "./formulario";

export async function generateMetadata({ params }: PageProps<"/e/[slug]/mis-entradas">): Promise<Metadata> {
  const datos = await cargar((await params).slug);
  return {
    title: datos ? `Reenviar mis entradas · ${datos.evento.nombre}` : "Evento no encontrado",
    robots: { index: false, follow: false },
  };
}

export default async function PaginaMisEntradas({ params }: PageProps<"/e/[slug]/mis-entradas">) {
  const datos = await cargar((await params).slug);
  if (!datos) notFound();
  const { evento } = datos;
  const whatsapp = whatsappDeAyuda();

  return (
    <div className="flex flex-1 flex-col font-sans">
      <header className="border-b border-borde bg-superficie">
        <div className="mx-auto flex h-14 max-w-xl items-center gap-1 px-2">
          <Link
            href={`/e/${evento.slug}`}
            aria-label="Volver al evento"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl text-tinta hover:bg-fondo"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Link>
          <div className="flex min-w-0 flex-col">
            <span className="text-[17px] font-bold leading-tight">Mis entradas</span>
            <span className="truncate text-[13px] text-tenue">{evento.nombre}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pt-7 pb-8">
        <h1 className="font-display text-[26px] font-extrabold leading-tight">¿No encontrás tus entradas?</h1>
        <p className="leading-normal text-tenue">
          Poné el email y el DNI con los que compraste y te las volvemos a mandar a ese email.
        </p>
        <FormularioMisEntradas accion={reenviarEntradasAccion.bind(null, evento.slug)} />
        <p className="text-sm leading-normal text-tenue">
          Se pueden reenviar hasta {MAX_REENVIOS_POR_DIA} veces por día.
          {whatsapp ? (
            <>
              {" "}
              ¿Pusiste mal el email al comprar? Escribinos por{" "}
              <a
                href={whatsapp.link()}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold whitespace-nowrap text-acento hover:text-acento-hover"
              >
                WhatsApp ({whatsapp.numero})
              </a>
              .
            </>
          ) : null}
        </p>
      </main>
    </div>
  );
}
