import type { Metadata } from "next";
import Link from "next/link";

import { BotonSalir } from "@/components/boton-salir";
import { requerirUsuario } from "@/lib/auth/actual";

import { MenuAdmin } from "./menu";

export const metadata: Metadata = {
  title: "Panel",
  robots: { index: false, follow: false },
};

// Marco del panel: menú a la izquierda (arriba en el celu) y la sección a la derecha.
// Ojo: cada página del panel igual tiene que llamar a requerirUsuario().
export default async function LayoutAdmin({ children }: LayoutProps<"/admin">) {
  const usuario = await requerirUsuario(["ADMIN", "ORGANIZADOR"]);
  // El dueño ve "Admin"; un organizador, el nombre de su productora.
  const titulo = usuario.productora?.nombre ?? "Admin";

  return (
    <div className="flex flex-1 flex-col font-sans md:flex-row">
      <nav aria-label="Menú del panel" className="flex flex-col gap-4 bg-tinta px-3 py-5 text-white md:w-60 md:shrink-0">
        <span className="px-3 font-display text-lg font-extrabold [overflow-wrap:anywhere]">[TU MARCA] · {titulo}</span>
        <MenuAdmin esAdmin={usuario.rol === "ADMIN"} />
        <div className="flex flex-col gap-1 border-t border-white/15 px-3 pt-4 text-sm md:mt-auto">
          <span className="font-semibold">{usuario.nombre}</span>
          <span className="truncate text-white/60">{usuario.email}</span>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <Link href="/cuenta/contrasena" className="text-white/80 underline hover:text-white">
              Cambiar contraseña
            </Link>
            <BotonSalir className="text-white/80 underline hover:text-white" />
          </div>
        </div>
      </nav>
      <main className="flex min-w-0 max-w-[1180px] flex-1 flex-col gap-6 p-4 sm:p-8">{children}</main>
    </div>
  );
}
