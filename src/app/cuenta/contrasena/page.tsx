import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BotonSalir } from "@/components/boton-salir";
import { obtenerSesionActual } from "@/lib/auth/actual";
import { inicioSegunRol } from "@/lib/auth/cuentas";

import { FormularioContrasena } from "./formulario";

export const metadata: Metadata = {
  title: "Cambiar contraseña",
  robots: { index: false, follow: false },
};

export default async function PaginaContrasena() {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/ingresar");
  const { usuario } = sesion;
  const obligatoria = usuario.debeCambiarContrasena;

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16 font-sans">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-2xl border border-borde bg-superficie p-8">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-3xl font-extrabold leading-tight">
            {obligatoria ? "Elegí tu contraseña" : "Cambiar contraseña"}
          </h1>
          <p className="text-base text-tenue [overflow-wrap:anywhere]">
            {obligatoria
              ? `Hola, ${usuario.nombre}. Entraste con una contraseña temporal: antes de seguir, elegí una propia.`
              : usuario.email}
          </p>
        </div>
        <FormularioContrasena obligatoria={obligatoria} email={usuario.email} />
        <div className="flex items-center justify-between text-sm">
          {obligatoria ? (
            <span />
          ) : (
            <Link href={inicioSegunRol(usuario.rol)} className="font-semibold text-acento hover:text-acento-hover">
              Volver
            </Link>
          )}
          <BotonSalir className="font-semibold text-tenue underline hover:text-tinta" />
        </div>
      </div>
    </main>
  );
}
