"use client"; // las pantallas de error de Next.js corren en el navegador

import Link from "next/link";
import { useEffect } from "react";

// Se muestra si una página falla (por ejemplo, si la base de datos no contesta).
export default function PantallaDeError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16 font-sans">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-borde bg-superficie p-8">
        <h1 className="font-display text-2xl font-extrabold leading-tight">Algo salió mal</h1>
        <p className="text-tenue">
          No pudimos cargar esta pantalla. Puede ser un problema de conexión con el sistema: probá de nuevo en
          unos segundos.
        </p>
        <button
          type="button"
          onClick={() => retry()}
          className="h-12 rounded-xl bg-acento px-5 text-base font-bold text-white transition-colors hover:bg-acento-hover"
        >
          Probar de nuevo
        </button>
        <Link href="/" className="text-center text-sm font-semibold text-acento hover:text-acento-hover">
          Ir al inicio
        </Link>
        {error.digest && <p className="text-center text-xs text-tenue">Código del error: {error.digest}</p>}
      </div>
    </main>
  );
}
