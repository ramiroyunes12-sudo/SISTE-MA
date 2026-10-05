import type { Metadata } from "next";
import Link from "next/link";

import { BotonSalir } from "@/components/boton-salir";
import { requerirUsuario } from "@/lib/auth/actual";

export const metadata: Metadata = {
  title: "Escáner",
  robots: { index: false, follow: false },
};

// Puerta: acá va a ir el escáner de QR (paso 17) y la búsqueda por DNI (paso 18).
export default async function PaginaValidar({ searchParams }: PageProps<"/validar">) {
  const usuario = await requerirUsuario(["ADMIN", "VALIDADOR"]);
  const { contrasena } = await searchParams;

  return (
    <div className="flex flex-1 flex-col font-sans">
      <header className="flex items-center justify-between gap-3 bg-tinta px-4 py-3 text-white">
        <span className="font-display font-extrabold">[TU MARCA] · Puerta</span>
        <div className="flex items-center gap-4 text-sm">
          {usuario.rol === "ADMIN" && (
            <Link href="/admin" className="text-white/80 underline hover:text-white">
              Panel
            </Link>
          )}
          <BotonSalir className="text-white/80 underline hover:text-white" />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-8">
        {contrasena === "cambiada" && (
          <p role="status" className="rounded-xl bg-ok/10 px-4 py-3 font-semibold text-ok-oscuro">
            Listo, tu contraseña quedó cambiada.
          </p>
        )}
        <h1 className="font-display text-3xl font-extrabold">Hola, {usuario.nombre}</h1>
        <p className="text-tenue">
          Acá va a estar el escáner para leer los QR en la puerta y la búsqueda por DNI. Todavía no está listo.
        </p>
        <Link href="/cuenta/contrasena" className="text-sm font-semibold text-acento hover:text-acento-hover">
          Cambiar mi contraseña
        </Link>
      </main>
    </div>
  );
}
