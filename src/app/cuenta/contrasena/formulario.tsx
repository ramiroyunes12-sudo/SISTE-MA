"use client";

import { useActionState } from "react";

import { BotonPrincipal, Campo, MensajeError } from "@/components/formulario";
import { cambiarMiContrasena } from "@/lib/auth/acciones";
import { LARGO_MINIMO } from "@/lib/auth/reglas";

export function FormularioContrasena({ obligatoria }: { obligatoria: boolean }) {
  const [estado, accion, enviando] = useActionState(cambiarMiContrasena, {});

  return (
    <form action={accion} className="flex flex-col gap-4">
      <Campo
        etiqueta={obligatoria ? "Contraseña temporal" : "Contraseña actual"}
        id="actual"
        name="actual"
        type="password"
        autoComplete="current-password"
        required
      />
      <Campo
        etiqueta="Contraseña nueva"
        id="nueva"
        name="nueva"
        type="password"
        autoComplete="new-password"
        minLength={LARGO_MINIMO}
        ayuda={`Al menos ${LARGO_MINIMO} caracteres. Una frase es más fácil de recordar: "mate amargo en la costanera".`}
        required
      />
      <Campo
        etiqueta="Repetí la contraseña nueva"
        id="repetida"
        name="repetida"
        type="password"
        autoComplete="new-password"
        minLength={LARGO_MINIMO}
        required
      />
      <MensajeError>{estado.error}</MensajeError>
      <BotonPrincipal type="submit" disabled={enviando}>
        {enviando ? "Guardando…" : "Guardar contraseña"}
      </BotonPrincipal>
    </form>
  );
}
