"use client";

// Abajo de "¡Compra confirmada!": pedir el mail con las entradas (de nuevo)
// desde el link de la compra paga. Sale al email de la compra, con un límite
// (src/lib/mails/reenviar.ts). El texto depende de qué pasó con el mail.
import { useActionState, useEffect, useRef } from "react";

import type { EstadoDelMail } from "@/lib/mails/pendientes";

import type { EstadoReenvio } from "./acciones";

const TEXTOS: Record<EstadoDelMail, { ayuda: string; boton: string }> = {
  enviado: { ayuda: "¿No te llegó el mail? Revisá en spam o promociones, o pedilo de nuevo.", boton: "Reenviar el mail" },
  enviando: { ayuda: "Si en unos minutos no te llegó, revisá en spam o promociones, o pedilo de nuevo.", boton: "Reenviar el mail" },
  no_salio: { ayuda: "Podemos intentar mandarlo otra vez.", boton: "Mandar el mail de nuevo" },
  // Compras de antes de los mails: nunca se mandó.
  nada: { ayuda: "¿Querés tus entradas también por mail?", boton: "Mandármelas por mail" },
};

const ESTILO_MENSAJE = {
  ok: "bg-ok/10 text-ok-oscuro",
  aviso: "bg-alerta/10",
  error: "bg-error/10 text-error",
};

export function ReenviarMail({
  mail,
  reenviar,
}: {
  mail: EstadoDelMail;
  reenviar: (anterior: EstadoReenvio) => Promise<EstadoReenvio>;
}) {
  const [estado, accion, enviando] = useActionState(reenviar, {});
  const mensaje = useRef<HTMLParagraphElement>(null);
  // Al llegar la respuesta, el foco va al mensaje: se ve aunque el botón
  // estuviera abajo de todo (si no, parece que no pasó nada y se toca otra vez)
  // y el lector de pantalla lo lee.
  useEffect(() => {
    if (!enviando && estado.mensaje) mensaje.current?.focus();
  }, [estado, enviando]);
  const textos = TEXTOS[mail];
  return (
    <form action={accion} className="flex flex-col gap-2.5 text-center">
      <p className="text-sm text-tenue">{textos.ayuda}</p>
      <button
        type="submit"
        disabled={enviando}
        className="min-h-12 rounded-xl border-[1.5px] border-acento px-5 py-2 font-bold text-acento transition-colors hover:bg-acento/5 disabled:cursor-wait disabled:opacity-60"
      >
        {enviando ? "Un momento…" : textos.boton}
      </button>
      {/* Siempre en la página (vacío al principio): así se anuncia lo que aparece adentro. */}
      <div role="status">
        {!enviando && estado.tipo && estado.mensaje && (
          <p
            ref={mensaje}
            tabIndex={-1}
            className={`rounded-xl px-4 py-3 text-left text-[15px] font-semibold outline-none [overflow-wrap:anywhere] ${ESTILO_MENSAJE[estado.tipo]}`}
          >
            {estado.mensaje}
          </p>
        )}
      </div>
    </form>
  );
}
