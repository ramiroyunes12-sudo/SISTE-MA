import type { Metadata } from "next";
import Link from "next/link";

import { BotonSalir } from "@/components/boton-salir";
import { requerirUsuario } from "@/lib/auth/actual";
import { alcanceDeLaPuerta } from "@/lib/auth/alcance";
import { obtenerDb } from "@/lib/db";
import { eventosDeLaPuerta } from "@/lib/entradas/escanear";
import { formatearFecha } from "@/lib/fechas";

export const metadata: Metadata = {
  title: "Escáner",
  robots: { index: false, follow: false },
};

// Puerta: elegir el evento y abrir su pantalla (/validar/<evento>: el
// contador, el escáner y la búsqueda por DNI o nombre).
export default async function PaginaValidar({ searchParams }: PageProps<"/validar">) {
  const usuario = await requerirUsuario(["ADMIN", "ORGANIZADOR", "VALIDADOR"]);
  const { contrasena } = await searchParams;
  const eventos = await eventosDeLaPuerta(obtenerDb(), alcanceDeLaPuerta(usuario));

  return (
    <div className="flex flex-1 flex-col font-sans">
      <header className="flex items-center justify-between gap-3 bg-tinta px-4 py-3 text-white">
        <span className="font-display font-extrabold">[TU MARCA] · Puerta</span>
        <div className="flex items-center gap-4 text-sm">
          {usuario.rol !== "VALIDADOR" && (
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
        {eventos.length === 0 ? (
          <p className="text-tenue">
            {usuario.rol === "VALIDADOR"
              ? "Todavía no hay eventos para escanear. Cada evento aparece acá 12 horas antes de que empiece."
              : "No hay eventos para hoy ni próximos. Cuando haya uno, va a aparecer acá para escanear."}
          </p>
        ) : (
          <>
            <p className="text-tenue">Elegí el evento en el que estás para abrir el escáner:</p>
            <ul className="flex flex-col gap-3">
              {eventos.map((evento) => (
                <li key={evento.id}>
                  <Link
                    href={`/validar/${evento.id}`}
                    className="flex min-h-16 flex-col justify-center gap-0.5 rounded-2xl border-2 border-tinta bg-superficie px-4 py-3 no-underline hover:bg-tinta/5"
                  >
                    <span className="text-lg font-bold [overflow-wrap:anywhere]">{evento.nombre}</span>
                    <span className="text-sm text-tenue">
                      {formatearFecha(evento.fecha)} · {evento.lugar}
                      {usuario.rol === "ADMIN" && ` · ${evento.productora.nombre}`}
                      {evento.estado === "BORRADOR" && " · borrador"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        <Link href="/cuenta/contrasena" className="mt-4 text-sm font-semibold text-acento hover:text-acento-hover">
          Cambiar mi contraseña
        </Link>
      </main>
    </div>
  );
}
