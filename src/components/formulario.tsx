// Piezas comunes de los formularios (campos, botón, mensaje de error).
import type { ComponentProps } from "react";

// Clases de los campos de texto, para usarlas también en <select> y <textarea>.
export const ESTILO_CAMPO =
  "rounded-xl border border-borde-campo bg-superficie px-4 text-base outline-acento focus:outline-2 focus:outline-offset-1 aria-[invalid=true]:border-error";

export function Campo({
  etiqueta,
  ayuda,
  error,
  id,
  className,
  ...input
}: ComponentProps<"input"> & { etiqueta: string; ayuda?: string; error?: string; id: string }) {
  const describe = [ayuda && `${id}-ayuda`, error && `${id}-error`].filter(Boolean).join(" ");
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <label htmlFor={id} className="text-sm font-semibold">
        {etiqueta}
      </label>
      <input
        id={id}
        aria-describedby={describe || undefined}
        aria-invalid={error ? true : undefined}
        className={`h-12 ${ESTILO_CAMPO}`}
        {...input}
      />
      <ErrorDeCampo id={`${id}-error`}>{error}</ErrorDeCampo>
      {ayuda && (
        <p id={`${id}-ayuda`} className="text-sm text-tenue">
          {ayuda}
        </p>
      )}
    </div>
  );
}

// El error de un campo, debajo de él.
export function ErrorDeCampo({ id, children }: { id: string; children?: string }) {
  if (!children) return null;
  return (
    <p id={id} className="text-sm font-semibold text-error">
      {children}
    </p>
  );
}

export function BotonPrincipal({ children, className, ...boton }: ComponentProps<"button">) {
  return (
    <button
      className={`h-12 rounded-xl bg-acento px-5 text-base font-bold text-white transition-colors hover:bg-acento-hover disabled:cursor-wait disabled:opacity-60 ${className ?? ""}`}
      {...boton}
    >
      {children}
    </button>
  );
}

export function MensajeError({ children }: { children?: string }) {
  if (!children) return null;
  // role="alert": los lectores de pantalla lo leen apenas aparece.
  return (
    <p role="alert" className="rounded-xl bg-error/10 px-4 py-3 text-sm font-semibold text-error">
      {children}
    </p>
  );
}
