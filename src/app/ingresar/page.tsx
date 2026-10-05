import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { obtenerSesionActual } from "@/lib/auth/actual";
import { inicioSegunRol } from "@/lib/auth/cuentas";

import { FormularioIngreso } from "./formulario";

export const metadata: Metadata = {
  title: "Ingresar",
  robots: { index: false, follow: false },
};

export default async function PaginaIngresar() {
  // Si ya tiene la sesión abierta, directo a su inicio.
  const sesion = await obtenerSesionActual();
  if (sesion) {
    redirect(sesion.usuario.debeCambiarContrasena ? "/cuenta/contrasena" : inicioSegunRol(sesion.usuario.rol));
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16 font-sans">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-2xl border border-borde bg-superficie p-8">
        <div className="flex flex-col gap-1">
          <span className="font-display text-lg font-extrabold">[TU MARCA]</span>
          <h1 className="font-display text-3xl font-extrabold leading-tight">Ingresar</h1>
          <p className="text-base text-tenue">Para organizadores y personal de la puerta.</p>
        </div>
        <FormularioIngreso />
      </div>
    </main>
  );
}
