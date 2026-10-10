"use client";

// La pantalla de la puerta de un evento: el contador de ingresados arriba y
// dos pestañas, "Escanear QR" (escaner.tsx) y "Buscar DNI o nombre"
// (buscar.tsx). Las dos quedan armadas al cambiar (no se pierde lo buscado).
//
// El contador se pone al día después de cada escaneo o ingreso marcado y cada
// 15 segundos (lo que entra por otras puertas), solo con la pantalla a la
// vista. Si no se pudo, queda el último y lo dice.
//
// Mientras se verifica un QR o se marca un ingreso, las pestañas no se pueden
// cambiar: si no, el resultado aparecía en la otra pestaña (o encima de otro).
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { type Contador, leerContador, leerRespuestaPuerta } from "@/lib/entradas/puerta";

import { Buscar } from "./buscar";
import { type ControlEscaner, Escaner } from "./escaner";
import { pedirPuerta } from "./pedir";

const CADA_MS = 15_000;
const numero = new Intl.NumberFormat("es-AR");

export function Puerta({
  eventoId,
  puedeMarcar,
  contadorInicial,
}: {
  eventoId: string;
  puedeMarcar: boolean;
  contadorInicial: Contador;
}) {
  const [modo, setModo] = useState<"escanear" | "buscar">("escanear");
  const [contador, setContador] = useState(contadorInicial);
  const [problema, setProblema] = useState<"conexion" | "sesion" | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const escaner = useRef<ControlEscaner>(null);
  const turno = useRef(0); // una respuesta vieja que llega tarde no pisa una nueva

  const actualizar = useCallback(async () => {
    const mio = ++turno.current;
    const respuesta = await pedirPuerta("/api/puerta/contador", { eventoId });
    if (mio !== turno.current) return;
    const nuevo = respuesta && leerContador(respuesta.ok, respuesta.cuerpo);
    if (nuevo) setContador(nuevo);
    const error = respuesta && !respuesta.ok ? leerRespuestaPuerta(false, respuesta.cuerpo) : null;
    setProblema(nuevo ? null : error && "error" in error && error.error === "sesion" ? "sesion" : "conexion");
  }, [eventoId]);

  useEffect(() => {
    const cada = setInterval(() => {
      if (document.visibilityState === "visible") actualizar();
    }, CADA_MS);
    function alVolver() {
      if (document.visibilityState === "visible") actualizar();
    }
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      clearInterval(cada);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [actualizar]);

  function irA(nuevo: "escanear" | "buscar") {
    if (nuevo === modo || ocupado) return;
    setModo(nuevo);
    if (nuevo === "buscar") escaner.current?.pausar();
    else escaner.current?.seguir();
  }

  const { ingresaron, total } = contador;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-2xl bg-white/10 px-4 py-3">
        <p className="flex items-baseline justify-between gap-3">
          <span className="text-white/80">Ingresaron</span>
          <span className="text-2xl font-bold tabular-nums">
            {numero.format(ingresaron)} <span className="text-base font-medium text-white/75">de {numero.format(total)}</span>
          </span>
        </p>
        <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-white/20">
          <div className="h-full rounded-full bg-white" style={{ width: `${total ? (100 * ingresaron) / total : 0}%` }} />
        </div>
        <p role="status" className="flex flex-wrap items-center gap-x-3 text-sm text-white/75 empty:hidden">
          {problema === "conexion" && "Sin conexión: puede no estar al día."}
          {problema === "sesion" && (
            <>
              Se cerró tu sesión.
              <Link href="/ingresar" className="flex min-h-11 items-center font-semibold text-white underline">
                Ingresar
              </Link>
            </>
          )}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ["escanear", "Escanear QR"],
            ["buscar", "Buscar DNI o nombre"],
          ] as const
        ).map(([destino, texto]) => (
          <button
            key={destino}
            type="button"
            aria-pressed={modo === destino}
            disabled={ocupado && modo !== destino}
            onClick={() => irA(destino)}
            className={`min-h-12 rounded-xl px-3 font-bold leading-tight disabled:opacity-50 ${
              modo === destino ? "bg-white text-tinta" : "border-2 border-white/50 text-white"
            }`}
          >
            {texto}
          </button>
        ))}
      </div>

      <div hidden={modo !== "escanear"}>
        <Escaner ref={escaner} eventoId={eventoId} alResultado={actualizar} alOcupado={setOcupado} />
      </div>
      <div hidden={modo !== "buscar"}>
        <Buscar eventoId={eventoId} puedeMarcar={puedeMarcar} alMarcar={actualizar} alOcupado={setOcupado} />
      </div>
    </div>
  );
}
