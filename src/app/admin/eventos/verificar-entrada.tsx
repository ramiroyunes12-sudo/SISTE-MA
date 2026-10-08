"use client";

// "Verificar una entrada": se pega el código (el del QR) y dice si es válida y
// de quién es. Solo mira: no la marca usada (eso lo hace el escáner, paso 17).
import { type FormEvent, startTransition, useActionState } from "react";

import { BotonPrincipal, ESTILO_CAMPO, MensajeError } from "@/components/formulario";

import type { EntradaVerificada, EstadoVerificacion } from "./acciones";

const MOTIVOS: Record<NonNullable<EntradaVerificada["motivo"]>, string> = {
  formato: "Eso no es un código de entrada.",
  firma: "La firma no coincide: el código fue modificado o es trucho.",
  no_existe: "El código está bien armado, pero no es de ninguna entrada.",
  otro_evento: "Es una entrada de otro evento.",
};

export function VerificarEntrada({
  accion: verificar,
}: {
  accion: (anterior: EstadoVerificacion, datos: FormData) => Promise<EstadoVerificacion>;
}) {
  const [estado, accion, verificando] = useActionState(verificar, {});

  // Se manda "a mano" para que el código quede escrito después de verificar.
  function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const datos = new FormData(evento.currentTarget);
    startTransition(() => accion(datos));
  }

  return (
    <form action={accion} onSubmit={alEnviar} className="flex flex-col gap-4 rounded-2xl border border-borde bg-superficie p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-bold">Verificar una entrada</h2>
        <p className="text-sm text-tenue">
          Pegá el código de una entrada (el que va en el QR) para ver si es válida y de quién es. Solo mira: no la marca
          como usada.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="verificar-codigo" className="text-sm font-semibold">
          Código
        </label>
        <input
          id="verificar-codigo"
          name="codigo"
          type="text"
          required
          maxLength={120}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="E1-…"
          className={`h-12 font-mono text-sm ${ESTILO_CAMPO}`}
        />
      </div>
      <BotonPrincipal type="submit" disabled={verificando} className="self-start">
        {verificando ? "Verificando…" : "Verificar"}
      </BotonPrincipal>

      {!verificando && <MensajeError>{estado.error}</MensajeError>}
      {!verificando && estado.verificada && <Resultado verificada={estado.verificada} />}
    </form>
  );
}

function Resultado({ verificada: v }: { verificada: EntradaVerificada }) {
  const titulo = { valida: "VÁLIDA", usada: "YA USADA", sin_pagar: "SIN PAGAR", anulada: "ANULADA", no_valida: "NO VÁLIDA" }[
    v.resultado
  ];
  const color =
    v.resultado === "valida"
      ? "border-ok bg-ok/10 text-ok-oscuro"
      : v.resultado === "sin_pagar"
        ? "border-alerta bg-alerta/10 text-alerta"
        : "border-error bg-error/10 text-error";
  return (
    <div role="status" className={`flex flex-col gap-1.5 rounded-xl border-2 p-4 ${color}`}>
      <p className="font-display text-2xl font-bold">{titulo}</p>
      {v.resultado === "no_valida" ? (
        <p className="text-tinta">{v.motivo ? MOTIVOS[v.motivo] : ""}</p>
      ) : (
        <div className="flex flex-col gap-0.5 text-tinta">
          <p className="[overflow-wrap:anywhere]">
            <strong>{v.titular ?? "Sin nombre todavía"}</strong>
            {v.dni && <> · DNI {v.dni}</>}
          </p>
          <p>
            {v.tipo} · Compra N° {v.compra}
          </p>
          {v.resultado === "usada" && v.usadaEn && <p>Entró: {v.usadaEn}</p>}
          {v.resultado === "sin_pagar" && <p>La compra no está paga (está pendiente, venció o se canceló).</p>}
          {v.resultado === "anulada" && <p>La entrada se anuló o la compra se devolvió.</p>}
        </div>
      )}
    </div>
  );
}
