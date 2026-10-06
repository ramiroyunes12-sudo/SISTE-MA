"use client";

// Los datos de la compra: un bloque por entrada ("Entrada 1 · General") con
// nombre y DNI de quien la usa, y a dónde mandar las entradas. Arranca con lo
// que ya se guardó (se puede corregir hasta pagar).
import { type FormEvent, startTransition, useActionState, useState } from "react";

import { BotonPrincipal, Campo, MensajeError } from "@/components/formulario";
import { formatearPesos } from "@/lib/dinero";
import { type ErroresDatos, formatearDni, validarDatosCompra } from "@/lib/ventas/datos";

import type { EstadoDatos } from "./acciones";

export function FormularioDatos({
  entradas,
  email,
  telefono,
  totalCentavos,
  accion: enviarDatos,
}: {
  entradas: { tipo: string; titular: string | null; dni: string | null }[]; // en orden: Entrada 1, 2, 3…
  email: string | null;
  telefono: string | null;
  totalCentavos: number;
  accion: (anterior: EstadoDatos, formulario: FormData) => Promise<EstadoDatos>;
}) {
  const [estado, accion, enviando] = useActionState(enviarDatos, {});
  // Los errores que encontró el navegador antes de mandar (si no hay, los del servidor).
  const [erroresLocales, setErroresLocales] = useState<ErroresDatos | null>(null);
  const errores = erroresLocales ?? estado.errores ?? {};

  // Revisa acá mismo antes de mandar y manda "a mano", así un error no borra lo escrito.
  function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const formulario = new FormData(evento.currentTarget);
    const revision = validarDatosCompra((campo) => formulario.get(campo), entradas.length);
    if (!revision.ok) {
      setErroresLocales(revision.errores);
      const orden = [...entradas.flatMap((_, i) => [`nombre-${i}`, `dni-${i}`]), "email", "email2", "telefono"];
      document.getElementById(orden.find((campo) => revision.errores[campo]) ?? "")?.focus();
      return;
    }
    setErroresLocales(null);
    startTransition(() => accion(formulario));
  }

  // Al corregir un campo, su error se va.
  function olvidarError(campo: string) {
    if (errores[campo]) setErroresLocales({ ...errores, [campo]: "" });
  }

  return (
    <form onSubmit={alEnviar} noValidate className="flex flex-col gap-4">
      {entradas.map(({ tipo, titular, dni }, i) => (
        <fieldset key={i} className="flex flex-col gap-3 rounded-2xl border border-borde bg-superficie p-4">
          <legend className="sr-only">
            Entrada {i + 1} · {tipo}
          </legend>
          <h2 aria-hidden="true" className="text-[17px] font-bold">
            Entrada {i + 1} <span className="font-semibold text-tenue">· {tipo}</span>
          </h2>
          <Campo
            etiqueta="Nombre y apellido"
            id={`nombre-${i}`}
            name={`nombre-${i}`}
            placeholder="Como figura en el DNI"
            autoComplete={i === 0 ? "name" : "off"}
            defaultValue={titular ?? ""}
            maxLength={80}
            error={errores[`nombre-${i}`] || undefined}
            onChange={() => olvidarError(`nombre-${i}`)}
          />
          <Campo
            etiqueta="DNI"
            id={`dni-${i}`}
            name={`dni-${i}`}
            inputMode="numeric"
            placeholder="Ej.: 40123456"
            autoComplete="off"
            defaultValue={dni ? formatearDni(dni) : ""}
            maxLength={12}
            error={errores[`dni-${i}`] || undefined}
            onChange={() => olvidarError(`dni-${i}`)}
          />
        </fieldset>
      ))}

      <section className="flex flex-col gap-3 rounded-2xl border border-borde bg-superficie p-4">
        <h2 className="text-[17px] font-bold">¿A dónde te mandamos las entradas?</h2>
        <Campo
          etiqueta="Email"
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={email ?? ""}
          maxLength={200}
          error={errores.email || undefined}
          onChange={() => olvidarError("email")}
        />
        <Campo
          etiqueta="Repetí el email"
          id="email2"
          name="email2"
          type="email"
          autoComplete="email"
          defaultValue={email ?? ""}
          maxLength={200}
          error={errores.email2 || undefined}
          onChange={() => olvidarError("email2")}
        />
        <Campo
          etiqueta="Celular (opcional)"
          id="telefono"
          name="telefono"
          type="tel"
          autoComplete="tel"
          placeholder="379 412 3456"
          defaultValue={telefono ?? ""}
          maxLength={25}
          ayuda="Por si hay algún problema con tu compra."
          error={errores.telefono || undefined}
          onChange={() => olvidarError("telefono")}
        />
        <p className="text-[13px] text-tenue">Todas las entradas llegan a este email, cada una con su QR.</p>
      </section>

      {!enviando && estado.listo && !Object.values(errores).some(Boolean) && (
        <div role="status" className="flex flex-col gap-1.5 rounded-xl bg-ok/10 p-3 text-sm text-ok-oscuro">
          <p className="font-bold">¡Listo, guardamos tus datos!</p>
          <ul className="flex flex-col gap-0.5">
            {estado.listo.datos.entradas.map((persona, i) => (
              <li key={i}>
                Entrada {i + 1} · {entradas[i].tipo}: {persona.nombre} · DNI {formatearDni(persona.dni)}
              </li>
            ))}
          </ul>
          <p>Van a llegar a {estado.listo.datos.email}. El pago con Mercado Pago se habilita en el próximo paso.</p>
        </div>
      )}
      <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-borde bg-superficie px-4 py-3 sm:mx-0 sm:rounded-2xl sm:border">
        {!enviando && <MensajeError>{estado.general}</MensajeError>}
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[15px] text-tenue">Total a pagar</span>
          <span className="text-2xl font-bold">{formatearPesos(totalCentavos)}</span>
        </div>
        <BotonPrincipal type="submit" disabled={enviando} className="h-[52px] text-[17px]">
          {enviando ? "Guardando…" : "Continuar al pago"}
        </BotonPrincipal>
        <p className="text-center text-xs text-tenue">
          Todavía no se cobra nada: el pago con Mercado Pago llega en el próximo paso.
        </p>
      </div>
    </form>
  );
}
