"use client";

import { useActionState } from "react";

import { BotonPrincipal, Campo, MensajeError } from "@/components/formulario";
import { ingresar } from "@/lib/auth/acciones";

export function FormularioIngreso() {
  const [estado, accion, enviando] = useActionState(ingresar, {});

  return (
    <form action={accion} className="flex flex-col gap-4">
      <Campo
        etiqueta="Email"
        id="email"
        name="email"
        type="email"
        autoComplete="username"
        required
        defaultValue={estado.email}
      />
      <Campo
        etiqueta="Contraseña"
        id="contrasena"
        name="contrasena"
        type="password"
        autoComplete="current-password"
        required
      />
      <MensajeError>{estado.error}</MensajeError>
      <BotonPrincipal type="submit" disabled={enviando}>
        {enviando ? "Ingresando…" : "Ingresar"}
      </BotonPrincipal>
    </form>
  );
}
