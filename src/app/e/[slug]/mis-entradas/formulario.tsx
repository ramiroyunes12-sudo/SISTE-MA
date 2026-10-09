"use client";

// Email y DNI para que le volvamos a mandar las entradas. Se revisa acá
// antes de mandar (y de nuevo en el servidor); un error no borra lo escrito.
import { type FormEvent, startTransition, useActionState, useState } from "react";

import { BotonPrincipal, Campo, MensajeError } from "@/components/formulario";
import type { ErroresReenvio } from "@/lib/mails/reenviar";
import { errorDeDni, errorDeEmail } from "@/lib/ventas/datos";

import type { EstadoMisEntradas } from "./acciones";

export function FormularioMisEntradas({
  accion: reenviar,
}: {
  accion: (anterior: EstadoMisEntradas, formulario: FormData) => Promise<EstadoMisEntradas>;
}) {
  const [estado, accion, enviando] = useActionState(reenviar, {});
  // Los errores que encontró el navegador antes de mandar (si no hay, los del servidor).
  const [erroresLocales, setErroresLocales] = useState<ErroresReenvio | null>(null);
  const errores = erroresLocales ?? estado.errores ?? {};

  function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const formulario = new FormData(evento.currentTarget);
    const revision: ErroresReenvio = {
      email: errorDeEmail(String(formulario.get("email") ?? "")),
      dni: errorDeDni(String(formulario.get("dni") ?? "")),
    };
    if (revision.email || revision.dni) {
      setErroresLocales(revision);
      document.getElementById(revision.email ? "email" : "dni")?.focus();
      return;
    }
    setErroresLocales(null);
    startTransition(() => accion(formulario));
  }

  // Al corregir un campo, su error se va.
  function olvidarError(campo: keyof ErroresReenvio) {
    if (errores[campo]) setErroresLocales({ ...errores, [campo]: undefined });
  }

  return (
    <form onSubmit={alEnviar} noValidate className="flex flex-col gap-4">
      <Campo
        etiqueta="Email"
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        maxLength={200}
        error={errores.email}
        onChange={() => olvidarError("email")}
      />
      <Campo
        etiqueta="DNI"
        id="dni"
        name="dni"
        inputMode="numeric"
        placeholder="Ej.: 40123456"
        autoComplete="off"
        maxLength={12}
        ayuda="El de cualquiera de las entradas de la compra."
        error={errores.dni}
        onChange={() => olvidarError("dni")}
      />
      {!enviando && <MensajeError>{estado.general}</MensajeError>}
      <BotonPrincipal type="submit" disabled={enviando} className="h-[52px] text-[17px]">
        {enviando ? "Un momento…" : "Reenviar entradas"}
      </BotonPrincipal>
      {!enviando && estado.listo && !erroresLocales && (
        <div role="status" className="flex items-start gap-2.5 rounded-xl bg-ok/10 p-3.5 text-[15px] leading-normal text-ok-oscuro">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
          <span>
            <strong>Listo.</strong> Si hay una compra paga para este evento con ese email y ese DNI, te mandamos las entradas a
            ese email. Puede tardar unos minutos: si no lo ves, revisá en spam o promociones.
          </span>
        </div>
      )}
    </form>
  );
}
