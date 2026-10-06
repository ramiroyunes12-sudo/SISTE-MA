import Link from "next/link";

import { requerirUsuario } from "@/lib/auth/actual";
import { obtenerDb } from "@/lib/db";

import { FormularioNuevaProductora } from "./formularios";

// Solo el dueño de la plataforma: las productoras que usan el sistema.
export default async function PaginaProductoras() {
  await requerirUsuario(["ADMIN"]);
  const productoras = await obtenerDb().productora.findMany({
    orderBy: [{ activa: "desc" }, { nombre: "asc" }],
    include: { _count: { select: { eventos: true, usuarios: true } } },
  });

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-extrabold">Productoras</h1>
        <p className="text-tenue">
          Cada productora tiene su propio panel: ve y maneja solo sus eventos y sus números.
        </p>
      </div>

      {productoras.length === 0 ? (
        <p className="rounded-2xl border border-borde bg-superficie p-6 text-tenue">Todavía no hay productoras.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {productoras.map((productora) => (
            <li key={productora.id}>
              <Link
                href={`/admin/productoras/${productora.id}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-borde bg-superficie p-5 text-tinta no-underline hover:border-acento"
              >
                <span className="text-lg font-bold">{productora.nombre}</span>
                <span className="flex items-center gap-4 text-sm">
                  <span className="text-tenue">
                    {productora._count.eventos} {productora._count.eventos === 1 ? "evento" : "eventos"} ·{" "}
                    {productora._count.usuarios} {productora._count.usuarios === 1 ? "persona" : "personas"}
                  </span>
                  {!productora.activa && (
                    <span className="rounded-full bg-[#EDEDE8] px-2.5 py-1 text-xs font-bold text-[#3A3D44]">
                      Desactivada
                    </span>
                  )}
                  <span className="font-semibold text-acento">Ver</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <FormularioNuevaProductora />
    </>
  );
}
