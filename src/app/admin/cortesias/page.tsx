import Link from "next/link";

import { requerirUsuario } from "@/lib/auth/actual";
import { alcanceDe, filtroDeEventos } from "@/lib/auth/alcance";
import { obtenerDb } from "@/lib/db";
import { formatearFecha } from "@/lib/fechas";

// "Cortesías": elegir el evento. El organizador ve los de su productora; el
// ADMIN, todos.
export default async function PaginaCortesias() {
  const usuario = await requerirUsuario(["ADMIN", "ORGANIZADOR"]);
  const esAdmin = usuario.rol === "ADMIN";
  const eventos = await obtenerDb().evento.findMany({
    where: filtroDeEventos(alcanceDe(usuario)),
    orderBy: { fecha: "desc" },
    select: {
      id: true,
      nombre: true,
      fecha: true,
      lugar: true,
      cupoCortesias: true,
      cortesiasEmitidas: true,
      productora: { select: { nombre: true } },
    },
  });

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-extrabold">Cortesías</h1>
        <p className="text-tenue">
          Entradas gratis, con un cupo aparte de la venta (se pone en Evento y lotes). Elegí el evento.
        </p>
      </div>

      {eventos.length === 0 ? (
        <p className="rounded-2xl border border-borde bg-superficie p-6 text-tenue">Todavía no hay eventos.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {eventos.map((evento) => (
            <li key={evento.id}>
              <Link
                href={`/admin/cortesias/${evento.id}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-borde bg-superficie p-5 text-tinta no-underline hover:border-acento"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-lg font-bold [overflow-wrap:anywhere]">{evento.nombre}</span>
                  <span className="text-sm text-tenue">
                    {formatearFecha(evento.fecha)} · {evento.lugar}
                    {esAdmin && ` · ${evento.productora.nombre}`}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-tenue">
                    {evento.cupoCortesias === 0
                      ? "Sin cupo de cortesías"
                      : `${evento.cortesiasEmitidas} de ${evento.cupoCortesias} dadas`}
                  </span>
                  <span className="font-semibold text-acento">Abrir</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
