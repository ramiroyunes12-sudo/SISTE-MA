"use client";

// El resultado en la puerta, en toda la pantalla: verde si pasa, rojo si no.
// Lo usan el escáner y la búsqueda por DNI o nombre (al marcar el ingreso).
// Va directo en el <body> (portal): se ve aunque, mientras se verificaba,
// hayan cambiado de "Escanear" a "Buscar".
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { deDonde, type ErrorPuerta, type IngresoPuerta, type PersonaPuerta, type RespuestaPuerta } from "@/lib/entradas/puerta";

export type Resultado = RespuestaPuerta | ErrorPuerta;

const MOTIVOS: Record<Extract<RespuestaPuerta, { resultado: "no_valida" }>["motivo"], string> = {
  formato: "Este QR no es una entrada.",
  firma: "El código fue modificado: es trucho.",
  no_existe: "No encontramos esta entrada.",
  otro_evento: "Es una entrada de otro evento.",
  sin_pagar: "La compra no está paga.",
  anulada: "La entrada se anuló o la compra se devolvió.",
};

const ERRORES: Record<ErrorPuerta["error"], string> = {
  conexion: "No se pudo verificar: falló la conexión. Escaneala de nuevo.",
  sesion: "Se cerró tu sesión. Volvé a ingresar para seguir escaneando.",
  evento: "Este evento ya no está disponible.",
  pedido: "No se pudo verificar. Recargá la página y probá de nuevo.",
  permiso: "Solo el organizador puede marcar el ingreso sin el QR.",
  limite: "Esperá un minuto y probá de nuevo.",
};

// Después de marcar el ingreso desde la búsqueda (sin el QR). Con un error
// el título es NO SE PUDO MARCAR, no NO VÁLIDA: la entrada puede estar en
// regla, y si se cortó la respuesta, hasta pudo quedar marcada.
const ERRORES_AL_MARCAR: Partial<Record<ErrorPuerta["error"], string>> = {
  conexion:
    "Falló la conexión: puede que haya quedado marcada. Volvé a la búsqueda: si dice «la marcaste vos, hace menos de un minuto», pasa; si dice NO INGRESÓ, marcala de nuevo.",
  sesion: "Se cerró tu sesión. Volvé a ingresar para seguir.",
};

// "Entró a las 23:41, hace 3 minutos · la escaneó Ana" (o "la marcó Ana por
// DNI", si entró sin el QR).
export function textoIngreso({ entro, por, porDni }: IngresoPuerta) {
  let quien: string | null = null;
  if (por === "vos") quien = porDni ? "la marcaste vos por DNI" : "la escaneaste vos";
  else if (por) quien = porDni ? `la marcó ${por} por DNI` : `la escaneó ${por}`;
  else if (porDni) quien = "por DNI";
  return ["Entró", entro].filter(Boolean).join(" ") + (quien ? ` · ${quien}` : "") + ".";
}

export function PantallaResultado({
  resultado,
  alSeguir,
  desde = "escaner",
}: {
  resultado: Resultado;
  alSeguir: () => void;
  desde?: "escaner" | "busqueda";
}) {
  const boton = useRef<HTMLButtonElement>(null);
  const raiz = useRef<HTMLDivElement>(null);
  // Un toque justo cuando aparece (que era para otra cosa) no lo cierra.
  const [listo, setListo] = useState(false);
  useEffect(() => {
    const espera = setTimeout(() => setListo(true), 600);
    return () => clearTimeout(espera);
  }, []);
  useEffect(() => {
    if (listo) boton.current?.focus();
  }, [listo]);
  // Mientras está a la vista, lo de atrás no se puede tocar ni recorrer con
  // el teclado o el lector de pantalla.
  useEffect(() => {
    const trabados = Array.from(document.body.children).filter((hijo) => hijo !== raiz.current && !hijo.hasAttribute("inert"));
    trabados.forEach((hijo) => hijo.setAttribute("inert", ""));
    return () => trabados.forEach((hijo) => hijo.removeAttribute("inert"));
  }, []);

  const pasa = "resultado" in resultado && resultado.resultado === "pasa";
  const titulo =
    "error" in resultado
      ? desde === "busqueda"
        ? "NO SE PUDO MARCAR"
        : "NO VÁLIDA"
      : { pasa: "PASA", ya_ingreso: "YA INGRESÓ", no_valida: "NO VÁLIDA" }[resultado.resultado];

  let detalle: string | null = null;
  if ("error" in resultado) detalle = (desde === "busqueda" && ERRORES_AL_MARCAR[resultado.error]) || ERRORES[resultado.error];
  else if (resultado.resultado === "no_valida") detalle = MOTIVOS[resultado.motivo];
  else if (resultado.resultado === "ya_ingreso") detalle = textoIngreso(resultado);
  const persona = "resultado" in resultado ? resultado.persona : undefined;

  return createPortal(
    <div
      ref={raiz}
      role="alert"
      className={`fixed inset-0 z-50 flex flex-col overflow-y-auto font-sans text-white ${pasa ? "bg-ok" : "bg-error"}`}
    >
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-5 pt-6 pb-4 min-[400px]:gap-5 min-[400px]:pt-10">
        {/* Más chico en celulares angostos: "YA INGRESÓ" no entraba en 320 px. */}
        <p className="flex items-center gap-3 font-display text-[2.75rem] leading-tight font-extrabold min-[340px]:text-5xl min-[400px]:text-6xl">
          <span aria-hidden="true">{pasa ? "✓" : "✕"}</span>
          <span className="min-w-0 [overflow-wrap:anywhere]">{titulo}</span>
        </p>
        {detalle && <p className="text-2xl font-semibold">{detalle}</p>}
        {persona && <DatosPersona persona={persona} grande={pasa} />}
      </div>
      <div className="sticky bottom-0 mx-auto w-full max-w-md px-5 pt-2 pb-6">
        {"error" in resultado && resultado.error === "sesion" ? (
          <Link href="/ingresar" className="flex min-h-16 items-center justify-center rounded-2xl bg-white text-xl font-bold text-tinta">
            Ingresar
          </Link>
        ) : "error" in resultado && resultado.error === "evento" ? (
          <Link href="/validar" className="flex min-h-16 items-center justify-center rounded-2xl bg-white text-xl font-bold text-tinta">
            Elegir otro evento
          </Link>
        ) : (
          <button
            ref={boton}
            type="button"
            onClick={() => listo && alSeguir()}
            className="min-h-16 w-full rounded-2xl bg-white text-xl font-bold text-tinta"
          >
            {desde === "busqueda" ? "Volver a la búsqueda" : "Escanear otra entrada"}
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

function DatosPersona({ persona, grande }: { persona: PersonaPuerta; grande: boolean }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-black/20 p-4">
      <p className={`font-bold [overflow-wrap:anywhere] ${grande ? "text-3xl" : "text-2xl"}`}>
        {persona.titular ?? "Sin nombre todavía"}
      </p>
      {persona.dni && <p className={grande ? "text-3xl" : "text-2xl"}>DNI {persona.dni}</p>}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xl">
        <span className="rounded-lg bg-white px-3 py-0.5 font-extrabold text-tinta uppercase">{persona.tipo}</span>
        <span className="text-white/90">{deDonde(persona)}</span>
      </p>
    </div>
  );
}
