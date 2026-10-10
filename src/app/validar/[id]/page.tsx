import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requerirUsuario } from "@/lib/auth/actual";
import { alcanceDeLaPuerta, filtroDeEventos } from "@/lib/auth/alcance";
import { obtenerDb } from "@/lib/db";
import { contarIngresos } from "@/lib/entradas/buscar";
import { puedeMarcarSinQr } from "@/lib/entradas/puerta";
import { formatearFecha } from "@/lib/fechas";

import { Puerta } from "./puerta";

export const metadata: Metadata = {
  title: "Escáner",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// La puerta de un evento: el contador, el escáner y la búsqueda por DNI o
// nombre. Fondo oscuro, para no encandilar de noche.
export default async function PaginaEscaner({ params }: PageProps<"/validar/[id]">) {
  const usuario = await requerirUsuario(["ADMIN", "ORGANIZADOR", "VALIDADOR"]);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const alcance = alcanceDeLaPuerta(usuario);
  const evento = await obtenerDb().evento.findFirst({
    where: { id, ...filtroDeEventos(alcance) },
    select: { id: true, nombre: true, fecha: true, lugar: true },
  });
  if (!evento) notFound();
  const contador = await contarIngresos(obtenerDb(), { eventoId: evento.id, alcance });
  if (!contador) notFound();

  return (
    <div className="flex flex-1 flex-col bg-tinta font-sans text-white">
      <header className="flex items-start justify-between gap-3 border-b border-white/15 px-4 py-3">
        <div className="flex min-w-0 flex-col">
          <h1 className="font-display text-lg font-extrabold [overflow-wrap:anywhere]">{evento.nombre}</h1>
          <span className="text-sm text-white/70">
            {formatearFecha(evento.fecha)} · {evento.lugar}
          </span>
        </div>
        <Link href="/validar" className="flex min-h-11 shrink-0 items-center text-sm text-white/80 underline hover:text-white">
          Cambiar de evento
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-4">
        <Puerta eventoId={evento.id} puedeMarcar={puedeMarcarSinQr(usuario.rol)} contadorInicial={contador} />
      </main>
    </div>
  );
}
