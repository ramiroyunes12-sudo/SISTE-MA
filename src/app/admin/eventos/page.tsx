import Link from "next/link";

import { requerirUsuario } from "@/lib/auth/actual";
import { alcanceDe, filtroDeEventos } from "@/lib/auth/alcance";
import { obtenerDb } from "@/lib/db";
import { formatearFecha } from "@/lib/fechas";

const ESTADO = {
  BORRADOR: { texto: "Borrador", clase: "bg-[#EDEDE8] text-[#3A3D44]" },
  PUBLICADO: { texto: "Publicado", clase: "bg-[#E7F4EC] text-ok-oscuro" },
  FINALIZADO: { texto: "Finalizado", clase: "bg-[#F3F3FE] text-acento-hover" },
} as const;

export default async function PaginaEventos() {
  const usuario = await requerirUsuario(["ADMIN", "ORGANIZADOR"]);
  const esAdmin = usuario.rol === "ADMIN";
  const eventos = await obtenerDb().evento.findMany({
    where: filtroDeEventos(alcanceDe(usuario)),
    orderBy: { fecha: "desc" },
    include: {
      productora: { select: { nombre: true } },
      tipos: { include: { lotes: { select: { cupo: true, vendidas: true } } } },
    },
  });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-extrabold">Eventos</h1>
        <Link
          href="/admin/eventos/nuevo"
          className="flex h-12 items-center rounded-xl bg-acento px-5 font-bold text-white no-underline hover:bg-acento-hover"
        >
          + Nuevo evento
        </Link>
      </div>

      {eventos.length === 0 ? (
        <p className="rounded-2xl border border-borde bg-superficie p-6 text-tenue">
          Todavía no hay eventos. Tocá &quot;Nuevo evento&quot; para crear el primero.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {eventos.map((evento) => {
            const lotes = evento.tipos.flatMap((tipo) => tipo.lotes);
            const vendidas = lotes.reduce((total, lote) => total + lote.vendidas, 0);
            const cupo = lotes.reduce((total, lote) => total + lote.cupo, 0);
            const estado = ESTADO[evento.estado];
            return (
              <li key={evento.id}>
                <Link
                  href={`/admin/eventos/${evento.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-borde bg-superficie p-5 text-tinta no-underline hover:border-acento"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-lg font-bold">{evento.nombre}</span>
                    <span className="text-sm text-tenue">
                      {formatearFecha(evento.fecha)} · {evento.lugar}
                      {esAdmin && ` · ${evento.productora.nombre}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-tenue">
                      {vendidas} de {cupo} vendidas
                    </span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${estado.clase}`}>{estado.texto}</span>
                    <span className="font-semibold text-acento">Editar</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
