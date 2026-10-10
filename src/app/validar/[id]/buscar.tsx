"use client";

// Buscar por DNI o nombre, para quien llega sin el QR (se le murió el celu).
// Muestra sus entradas pagas de este evento y si ya entraron. El organizador y
// el ADMIN pueden marcar el ingreso (con un "¿coincide?" antes): da el mismo
// PASA que el escáner y queda anotado como "DNI". El validador ve si entró,
// pero para dejarlo pasar sin el QR tiene que llamar al organizador (decidido
// por Ramiro, 10/10/2026).
//
// Lo buscado y lo encontrado viven solo en la pantalla (nada en la dirección
// ni en el almacenamiento del navegador).
import Link from "next/link";
import { type FormEvent, useRef, useState } from "react";

import {
  type EncontradaPuerta,
  type ErrorPuerta,
  leerRespuestaBusqueda,
  leerRespuestaPuerta,
  type RespuestaBusqueda,
} from "@/lib/entradas/puerta";

import { pedirPuerta } from "./pedir";
import { PantallaResultado, type Resultado, textoIngreso } from "./resultado";

type Busqueda =
  | { tipo: "inicio" }
  | { tipo: "buscando" }
  | { tipo: "lista"; porDni: boolean; respuesta: RespuestaBusqueda | ErrorPuerta };

const ERRORES: Record<ErrorPuerta["error"], string> = {
  conexion: "No se pudo buscar: falló la conexión. Probá de nuevo.",
  sesion: "Se cerró tu sesión. Volvé a ingresar para seguir.",
  evento: "Este evento ya no está disponible.",
  pedido: "No se pudo buscar. Recargá la página y probá de nuevo.",
  permiso: "No tenés permiso para esto.",
};

export function Buscar({ eventoId, puedeMarcar, alMarcar }: { eventoId: string; puedeMarcar: boolean; alMarcar: () => void }) {
  const [busqueda, setBusqueda] = useState<Busqueda>({ tipo: "inicio" });
  const [confirmando, setConfirmando] = useState<string | null>(null); // id de la entrada
  const [marcando, setMarcando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const ultima = useRef(""); // lo último buscado: al volver de marcar se busca de nuevo (ya dice que entró)
  const turno = useRef(0); // una búsqueda vieja que contesta tarde no pisa la nueva

  async function buscar(texto: string) {
    const mio = ++turno.current;
    ultima.current = texto;
    setConfirmando(null);
    setBusqueda({ tipo: "buscando" });
    const respuesta = await pedirPuerta("/api/puerta/buscar", { eventoId, texto });
    if (mio !== turno.current) return;
    setBusqueda({
      tipo: "lista",
      porDni: /\d/.test(texto),
      respuesta: respuesta ? leerRespuestaBusqueda(respuesta.ok, respuesta.cuerpo) : { error: "conexion" },
    });
  }

  function alBuscar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const campo = evento.currentTarget.elements.namedItem("busqueda") as HTMLInputElement;
    const texto = campo.value.trim();
    if (texto) buscar(texto);
  }

  async function marcar(entradaId: string) {
    setMarcando(true);
    const respuesta = await pedirPuerta("/api/puerta/marcar", { eventoId, entradaId });
    setMarcando(false);
    setConfirmando(null);
    setResultado(respuesta ? leerRespuestaPuerta(respuesta.ok, respuesta.cuerpo) : { error: "conexion" });
    alMarcar();
  }

  function volver() {
    setResultado(null);
    if (ultima.current) buscar(ultima.current);
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={alBuscar} role="search" className="flex flex-col gap-2">
        <label htmlFor="busqueda" className="text-lg font-semibold">
          DNI o nombre
        </label>
        <p id="ayuda-busqueda" className="text-sm text-white/75">
          El DNI completo, o el nombre o el apellido (desde 3 letras).
        </p>
        <div className="flex gap-2">
          <input
            id="busqueda"
            name="busqueda"
            type="search"
            maxLength={80}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            aria-describedby="ayuda-busqueda"
            className="h-14 min-w-0 flex-1 rounded-xl border border-white/40 bg-white px-4 text-lg text-tinta"
          />
          <button
            type="submit"
            disabled={busqueda.tipo === "buscando"}
            className="min-h-14 shrink-0 rounded-xl bg-white px-5 text-lg font-bold text-tinta disabled:opacity-60"
          >
            Buscar
          </button>
        </div>
      </form>

      <div role="status" className="text-lg">
        {busqueda.tipo === "buscando" && <p>Buscando…</p>}
        {busqueda.tipo === "lista" && <Resumen porDni={busqueda.porDni} respuesta={busqueda.respuesta} />}
      </div>

      {busqueda.tipo === "lista" && "encontradas" in busqueda.respuesta && (
        <>
          <ul className="flex flex-col gap-3">
            {busqueda.respuesta.encontradas.map((encontrada) => (
              <Tarjeta
                key={encontrada.id}
                encontrada={encontrada}
                puedeMarcar={puedeMarcar}
                confirmando={confirmando === encontrada.id}
                marcando={marcando}
                alQuererMarcar={() => setConfirmando(encontrada.id)}
                alCancelar={() => setConfirmando(null)}
                alMarcar={() => marcar(encontrada.id)}
              />
            ))}
          </ul>
          {!puedeMarcar && busqueda.respuesta.encontradas.some((encontrada) => !encontrada.ingreso) && (
            <p className="rounded-2xl border border-white/30 p-4 text-lg">
              Para dejar pasar a alguien sin el QR, llamá al organizador: el ingreso sin QR se marca desde su cuenta.
            </p>
          )}
        </>
      )}

      {resultado && <PantallaResultado resultado={resultado} alSeguir={volver} desde="busqueda" />}
    </div>
  );
}

function Resumen({ porDni, respuesta }: { porDni: boolean; respuesta: RespuestaBusqueda | ErrorPuerta }) {
  if ("error" in respuesta) {
    return (
      <div className="flex flex-col gap-3">
        <p>{ERRORES[respuesta.error]}</p>
        {respuesta.error === "sesion" && (
          <Link href="/ingresar" className="flex min-h-12 items-center justify-center rounded-xl bg-white font-bold text-tinta">
            Ingresar
          </Link>
        )}
        {respuesta.error === "evento" && (
          <Link href="/validar" className="flex min-h-12 items-center justify-center rounded-xl bg-white font-bold text-tinta">
            Elegir otro evento
          </Link>
        )}
      </div>
    );
  }
  if ("falta" in respuesta) {
    return (
      <p>
        {respuesta.falta === "dni"
          ? "Escribí el DNI completo: 7 u 8 números (o buscá por el nombre)."
          : "Escribí al menos 3 letras del nombre o del apellido."}
      </p>
    );
  }
  const cuantas = respuesta.encontradas.length;
  if (cuantas === 0) {
    return (
      <p>
        {porDni
          ? "No hay entradas pagas con ese DNI en este evento. Probá con el nombre: quizás lo escribieron mal al comprar."
          : "No hay entradas pagas con ese nombre en este evento. Probá con el apellido solo o con el DNI."}
      </p>
    );
  }
  return (
    <p>
      {cuantas === 1 ? "1 entrada" : `${cuantas} entradas`}
      {respuesta.hayMas && ". Hay más: escribí el nombre completo o el DNI."}
    </p>
  );
}

function Tarjeta({
  encontrada,
  puedeMarcar,
  confirmando,
  marcando,
  alQuererMarcar,
  alCancelar,
  alMarcar,
}: {
  encontrada: EncontradaPuerta;
  puedeMarcar: boolean;
  confirmando: boolean;
  marcando: boolean;
  alQuererMarcar: () => void;
  alCancelar: () => void;
  alMarcar: () => void;
}) {
  const { persona, ingreso } = encontrada;
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-white/25 bg-white/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xl font-bold [overflow-wrap:anywhere]">{persona.titular ?? "Sin nombre"}</p>
          <p className="text-white/80">
            {persona.dni && <>DNI {persona.dni} · </>}
            {persona.tipo} · Compra N° {persona.compra}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-sm font-bold whitespace-nowrap ${
            ingreso ? "bg-[#fbebd9] text-[#7a3e06]" : "bg-[#e7f4ec] text-ok-oscuro"
          }`}
        >
          {ingreso ? "YA INGRESÓ" : "NO INGRESÓ"}
        </span>
      </div>
      {ingreso && <p className="text-white/80">{textoIngreso(ingreso)}</p>}
      {!ingreso &&
        puedeMarcar &&
        (confirmando ? (
          <div className="flex flex-col gap-3 rounded-xl bg-white/10 p-3">
            <p className="font-semibold">¿El nombre y el DNI coinciden con el documento que te mostró?</p>
            <div className="flex flex-col gap-2 min-[400px]:flex-row">
              <button
                type="button"
                onClick={alMarcar}
                disabled={marcando}
                className="min-h-12 flex-1 rounded-xl bg-ok px-4 text-lg font-bold text-white disabled:opacity-60"
              >
                {marcando ? "Marcando…" : "Sí, marcar ingreso"}
              </button>
              <button
                type="button"
                onClick={alCancelar}
                disabled={marcando}
                className="min-h-12 rounded-xl border-2 border-white/70 px-4 font-semibold disabled:opacity-60"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={alQuererMarcar}
            disabled={marcando}
            className="min-h-12 rounded-xl bg-white text-lg font-bold text-tinta disabled:opacity-60"
          >
            Marcar ingreso
          </button>
        ))}
    </li>
  );
}
