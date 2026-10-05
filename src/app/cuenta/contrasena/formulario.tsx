"use client";

import { type FormEvent, startTransition, useActionState, useState } from "react";

import { BotonPrincipal, Campo, MensajeError } from "@/components/formulario";
import { cambiarMiContrasena } from "@/lib/auth/acciones";
import { LARGO_MINIMO, problemaConContrasenaNueva } from "@/lib/auth/reglas";

export function FormularioContrasena({ obligatoria, email }: { obligatoria: boolean; email: string }) {
  const [estado, accion, enviando] = useActionState(cambiarMiContrasena, {});
  const [errorLocal, setErrorLocal] = useState<string>();

  // Revisa las reglas acá mismo antes de mandar, y manda "a mano" para que un
  // error no borre lo que ya escribió (el servidor igual vuelve a revisar todo).
  function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const datos = new FormData(evento.currentTarget);
    const nueva = String(datos.get("nueva") ?? "");
    const problema = problemaConContrasenaNueva(nueva, email);
    if (problema) return setErrorLocal(`La contraseña nueva no sirve: ${problema}`);
    if (nueva !== datos.get("repetida")) return setErrorLocal("Las dos contraseñas nuevas no coinciden.");
    setErrorLocal(undefined);
    startTransition(() => accion(datos));
  }

  const error = errorLocal ?? estado.error;

  return (
    <form action={accion} onSubmit={alEnviar} className="flex flex-col gap-4">
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
        ayuda={`Al menos ${LARGO_MINIMO} caracteres. Lo más fácil de recordar es una frase de 3 o 4 palabras que solo vos sepas.`}
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
      {!enviando && <MensajeError>{error}</MensajeError>}
      <BotonPrincipal type="submit" disabled={enviando}>
        {enviando ? "Guardando…" : "Guardar contraseña"}
      </BotonPrincipal>
    </form>
  );
}
