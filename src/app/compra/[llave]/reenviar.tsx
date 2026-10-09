"use client";

// "¿No te llegó el mail?": pedirlo de nuevo desde el link de la compra paga.
// Sale al email de la compra, con un límite por día (src/lib/mails/reenviar.ts).
import { useActionState } from "react";

import type { EstadoReenvio } from "./acciones";

const ESTILO_MENSAJE = {
  ok: "bg-ok/10 text-ok-oscuro",
  aviso: "bg-alerta/10",
  error: "bg-error/10 text-error",
};

export function ReenviarMail({ reenviar }: { reenviar: (anterior: EstadoReenvio) => Promise<EstadoReenvio> }) {
  const [estado, accion, enviando] = useActionState(reenviar, {});
  return (
    <form action={accion} className="flex flex-col gap-2.5 text-center">
      <p className="text-sm text-tenue">¿No te llegó el mail? Revisá en spam o promociones, o pedilo de nuevo.</p>
      <button
        type="submit"
        disabled={enviando}
        className="min-h-12 rounded-xl border-[1.5px] border-acento px-5 py-2 font-bold text-acento transition-colors hover:bg-acento/5 disabled:cursor-wait disabled:opacity-60"
      >
        {enviando ? "Un momento…" : "Reenviar el mail"}
      </button>
      {!enviando && estado.tipo && estado.mensaje && (
        <p
          role={estado.tipo === "error" ? "alert" : "status"}
          className={`rounded-xl px-4 py-3 text-left text-[15px] font-semibold [overflow-wrap:anywhere] ${ESTILO_MENSAJE[estado.tipo]}`}
        >
          {estado.mensaje}
        </p>
      )}
    </form>
  );
}
