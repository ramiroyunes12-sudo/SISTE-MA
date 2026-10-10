"use client";
// La lista de cortesías dadas en el evento: quién, si ya entró, si le llegó el
// mail, y para cada una: bajar el PDF, reenviar el mail y anular. Con un
// filtro por nombre, DNI o email (se filtra acá: no viaja a ningún lado).
import { useActionState, useState } from "react";

import { ESTILO_CAMPO } from "@/components/formulario";
import { comparable } from "@/lib/cortesias/planilla";

import type { EstadoFila } from "../acciones";

export type FilaCortesia = {
  id: string;
  numero: number;
  titular: string;
  dni: string; // con puntos
  tipo: string;
  email: string | null;
  estado: "sin_usar" | "ingreso" | "anulada";
  ingreso: string | null; // "sáb 21/11 00:12"
  mail: string; // "Enviado", "No salió: …", "Sin email"…
  mailMal: boolean; // el mail no salió
  dadaPor: string; // "Ramiro · vie 10/10 18:30"
};

type AccionFila = (ordenId: string) => Promise<EstadoFila>;

const ESTADO = {
  sin_usar: { texto: "SIN USAR", clase: "bg-[#EDEDE8] text-[#3A3D44]" },
  ingreso: { texto: "INGRESÓ", clase: "bg-[#E7F4EC] text-ok-oscuro" },
  anulada: { texto: "ANULADA", clase: "bg-error/10 text-error" },
} as const;

export function ListaCortesias({
  eventoId,
  filas,
  anular,
  reenviar,
  hayMas,
}: {
  eventoId: string;
  filas: FilaCortesia[];
  anular: AccionFila;
  reenviar: AccionFila;
  hayMas: boolean;
}) {
  const [filtro, setFiltro] = useState("");
  const buscado = comparable(filtro).replace(/[.\s]/g, "");
  const visibles = buscado
    ? filas.filter((fila) =>
        [fila.titular, fila.dni, fila.email ?? ""].some((dato) => comparable(dato).replace(/[.\s]/g, "").includes(buscado)),
      )
    : filas;
  const validas = filas.filter((fila) => fila.estado !== "anulada").length;

  return (
    <section className="overflow-hidden rounded-2xl border border-borde bg-superficie">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-borde px-5 py-4">
        <h2 className="text-lg font-bold">
          Cortesías dadas <span className="text-base font-normal text-tenue">({validas})</span>
        </h2>
        {filas.length > 5 && (
          <div className="flex flex-col gap-1">
            <label htmlFor="cortesias-filtro" className="sr-only">
              Buscar en la lista
            </label>
            <input
              id="cortesias-filtro"
              type="search"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder="Buscar por nombre, DNI o email"
              autoComplete="off"
              className={`h-10 w-72 max-w-full text-sm ${ESTILO_CAMPO}`}
            />
          </div>
        )}
      </div>
      {filas.length === 0 ? (
        <p className="p-5 text-sm text-tenue">Todavía no se dio ninguna.</p>
      ) : visibles.length === 0 ? (
        <p className="p-5 text-sm text-tenue">Ninguna coincide con la búsqueda.</p>
      ) : (
        <ul>
          {visibles.map((fila) => (
            <Fila key={fila.id} eventoId={eventoId} fila={fila} anular={anular} reenviar={reenviar} />
          ))}
        </ul>
      )}
      {hayMas && <p className="border-t border-borde px-5 py-3 text-sm text-tenue">Se muestran las últimas 1000.</p>}
    </section>
  );
}

function Fila({ eventoId, fila, anular, reenviar }: { eventoId: string; fila: FilaCortesia; anular: AccionFila; reenviar: AccionFila }) {
  const [preguntando, setPreguntando] = useState(false);
  const [anulado, pedirAnular, anulando] = useActionState(() => anular(fila.id), {});
  const [reenvio, pedirReenvio, reenviando] = useActionState(() => reenviar(fila.id), {});
  const estado = ESTADO[fila.estado];
  const mensaje = anulado.error ?? reenvio.error ?? anulado.listo ?? reenvio.listo;
  const esError = Boolean(anulado.error ?? reenvio.error);

  return (
    <li className="flex flex-col gap-2 border-t border-[#EDEDE8] px-5 py-4 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className={`font-semibold [overflow-wrap:anywhere] ${fila.estado === "anulada" ? "text-tenue line-through" : ""}`}>
            {fila.titular}
          </span>
          <span className="text-sm text-tenue">
            DNI {fila.dni} · {fila.tipo} · Cortesía N° {fila.numero}
          </span>
          <span className="text-sm text-tenue [overflow-wrap:anywhere]">
            {fila.email ?? "Sin email"}
            {fila.email && fila.estado !== "anulada" && (
              <span className={fila.mailMal ? "font-semibold text-error" : ""}> · {fila.mail}</span>
            )}
          </span>
          <span className="text-xs text-tenue">
            {fila.ingreso ? `Entró ${fila.ingreso} · ` : ""}La dio {fila.dadaPor}
          </span>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${estado.clase}`}>{estado.texto}</span>
      </div>

      {fila.estado !== "anulada" && !preguntando && (
        <div className="flex flex-wrap gap-x-5">
          <a
            href={`/admin/cortesias/${eventoId}/pdf/${fila.id}`}
            target="_blank"
            rel="noopener"
            className="flex h-10 items-center text-sm font-semibold text-acento underline"
            aria-label={`Bajar el PDF de la cortesía de ${fila.titular}`}
          >
            Bajar PDF
          </a>
          {fila.email && (
            <form action={pedirReenvio}>
              <button
                type="submit"
                disabled={reenviando}
                className="h-10 text-sm font-semibold text-acento underline disabled:opacity-50"
                aria-label={`Reenviar el mail a ${fila.titular}`}
              >
                {reenviando ? "Reenviando…" : "Reenviar mail"}
              </button>
            </form>
          )}
          {fila.estado === "sin_usar" && (
            <button
              type="button"
              onClick={() => setPreguntando(true)}
              className="h-10 text-sm font-semibold text-error underline"
              aria-label={`Anular la cortesía de ${fila.titular}`}
            >
              Anular
            </button>
          )}
        </div>
      )}

      {preguntando && fila.estado === "sin_usar" && (
        <form action={pedirAnular} className="flex flex-col gap-2 rounded-xl bg-error/10 p-3">
          <p className="text-sm font-semibold text-error">
            ¿Anular la cortesía de {fila.titular}? Su QR deja de entrar (aunque ya le haya llegado el mail) y el lugar vuelve
            al cupo.
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={anulando} className="h-10 rounded-lg bg-error px-4 text-sm font-bold text-white disabled:opacity-60">
              {anulando ? "Anulando…" : "Sí, anular"}
            </button>
            <button
              type="button"
              onClick={() => setPreguntando(false)}
              className="h-10 rounded-lg border-[1.5px] border-borde-campo bg-superficie px-4 text-sm font-bold"
            >
              No
            </button>
          </div>
        </form>
      )}

      {!anulando && !reenviando && mensaje && (
        <p role="status" className={`text-sm font-semibold ${esError ? "text-error" : "text-ok-oscuro"}`}>
          {mensaje}
        </p>
      )}
    </li>
  );
}
