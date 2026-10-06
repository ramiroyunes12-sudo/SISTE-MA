"use client";

// "Te guardamos las entradas por 9:45 minutos". Cuenta para atrás con la hora
// del servidor (no la del celu, que puede estar mal) y, al llegar a cero,
// recarga la página para mostrar que la reserva venció.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function Reloj({ venceEnMs, ahoraServidorMs }: { venceEnMs: number; ahoraServidorMs: number }) {
  const router = useRouter();
  const [restante, setRestante] = useState(Math.max(0, venceEnMs - ahoraServidorMs));

  useEffect(() => {
    // Diferencia entre el reloj del celu y el del servidor.
    const desfase = ahoraServidorMs - Date.now();
    const intervalo = setInterval(() => {
      const quedan = Math.max(0, venceEnMs - (Date.now() + desfase));
      setRestante(quedan);
      if (quedan === 0) {
        clearInterval(intervalo);
        router.refresh();
      }
    }, 1_000);
    return () => clearInterval(intervalo);
  }, [venceEnMs, ahoraServidorMs, router]);

  const segundos = Math.ceil(restante / 1_000);
  const texto = `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}`;
  const poco = segundos <= 60;
  return (
    <div
      className={`flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm ${poco ? "bg-error/10 text-error" : "bg-[#FFF4E5] text-[#7A3E06]"}`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      {segundos > 0 ? (
        <span>
          Te guardamos las entradas por <strong className="tabular-nums">{texto}</strong> minutos
        </span>
      ) : (
        <span>Se terminó el tiempo…</span>
      )}
    </div>
  );
}
