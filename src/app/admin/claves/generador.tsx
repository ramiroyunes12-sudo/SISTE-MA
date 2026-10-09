"use client";

// Una clave de 256 bits al azar (crypto.getRandomValues del navegador), en
// base64url: 43 caracteres. No sale de esta pantalla salvo que la copies.
import { useState } from "react";

import { BotonPrincipal } from "@/components/formulario";

function claveAlAzar() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function GeneradorDeClave() {
  const [clave, setClave] = useState<string | null>(null);
  const [copiada, setCopiada] = useState(false);

  async function copiar() {
    if (!clave) return;
    try {
      await navigator.clipboard.writeText(clave);
      setCopiada(true);
      setTimeout(() => setCopiada(false), 2_000);
    } catch {
      window.prompt("Copiá la clave:", clave);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-borde bg-superficie p-5">
      <h2 className="text-lg font-bold">Generar una clave</h2>
      <p className="text-sm text-tenue">
        Se arma en tu navegador con un generador seguro: no pasa por el servidor ni se guarda. Cada vez que tocás
        &quot;Generar&quot; sale otra.
      </p>
      <BotonPrincipal
        type="button"
        className="self-start"
        onClick={() => {
          setClave(claveAlAzar());
          setCopiada(false);
        }}
      >
        {clave ? "Generar otra" : "Generar"}
      </BotonPrincipal>
      {clave && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-fondo p-3">
          <code className="min-w-0 flex-1 break-all font-mono text-sm" data-clave>
            {clave}
          </code>
          <button
            type="button"
            onClick={copiar}
            className="h-11 shrink-0 rounded-xl bg-acento px-4 text-sm font-bold text-white hover:bg-acento-hover"
          >
            <span aria-live="polite">{copiada ? "¡Copiada!" : "Copiar"}</span>
          </button>
        </div>
      )}
    </section>
  );
}
