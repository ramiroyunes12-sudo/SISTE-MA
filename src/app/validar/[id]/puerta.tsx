"use client";

// La pantalla de la puerta de un evento: el contador de ingresados arriba y
// dos pestañas, "Escanear QR" (escaner.tsx) y "Buscar DNI o nombre"
// (buscar.tsx). Las dos quedan armadas al cambiar (no se pierde lo buscado).
//
// El contador se pone al día después de cada escaneo o ingreso marcado y cada
// 15 segundos (lo que entra por otras puertas), solo con la pantalla a la
// vista. Si no se pudo, queda el último y lo dice.
import { useCallback, useEffect, useRef, useState } from "react";

import { type Contador, leerContador } from "@/lib/entradas/puerta";

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
  const [desactualizado, setDesactualizado] = useState(false);
  const escaner = useRef<ControlEscaner>(null);
  const turno = useRef(0); // una respuesta vieja que llega tarde no pisa una nueva

  const actualizar = useCallback(async () => {
    const mio = ++turno.current;
    const respuesta = await pedirPuerta("/api/puerta/contador", { eventoId });
    if (mio !== turno.current) return;
    const nuevo = respuesta && leerContador(respuesta.ok, respuesta.cuerpo);
    if (nuevo) setContador(nuevo);
    setDesactualizado(!nuevo);
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
    if (nuevo === modo) return;
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
        {desactualizado && <p className="text-sm text-white/75">Sin conexión: puede no estar al día.</p>}
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
            onClick={() => irA(destino)}
            className={`min-h-12 rounded-xl px-3 font-bold leading-tight ${
              modo === destino ? "bg-white text-tinta" : "border-2 border-white/50 text-white"
            }`}
          >
            {texto}
          </button>
        ))}
      </div>

      <div hidden={modo !== "escanear"}>
        <Escaner ref={escaner} eventoId={eventoId} alResultado={actualizar} />
      </div>
      <div hidden={modo !== "buscar"}>
        <Buscar eventoId={eventoId} puedeMarcar={puedeMarcar} alMarcar={actualizar} />
      </div>
    </div>
  );
}
