// Piezas comunes de los formularios (campos, botón, mensaje de error).
import type { ComponentProps } from "react";

export function Campo({ etiqueta, ayuda, id, ...input }: ComponentProps<"input"> & { etiqueta: string; ayuda?: string; id: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {etiqueta}
      </label>
      <input
        id={id}
        aria-describedby={ayuda ? `${id}-ayuda` : undefined}
        className="h-12 rounded-xl border border-borde bg-superficie px-4 text-base outline-acento focus:outline-2 focus:outline-offset-1"
        {...input}
      />
      {ayuda && (
        <p id={`${id}-ayuda`} className="text-sm text-tenue">
          {ayuda}
        </p>
      )}
    </div>
  );
}

export function BotonPrincipal({ children, ...boton }: ComponentProps<"button">) {
  return (
    <button
      className="h-12 rounded-xl bg-acento px-5 text-base font-bold text-white transition-colors hover:bg-acento-hover disabled:cursor-wait disabled:opacity-60"
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
