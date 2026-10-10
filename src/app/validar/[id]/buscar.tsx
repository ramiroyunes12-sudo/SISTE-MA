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
import { type FormEvent, useEffect, useRef, useState } from "react";

import {
  type EncontradaPuerta,
  type ErrorPuerta,
  leerRespuestaBusqueda,
  leerRespuestaPuerta,
  type RespuestaBusqueda,
} from "@/lib/entradas/puerta";

import { pedirPuerta } from "./pedir";
import { PantallaResultado, type Resultado, textoIngreso } from "./resultado";

type Lista = { texto: string; respuesta: RespuestaBusqueda };

const ERRORES: Record<ErrorPuerta["error"], string> = {
  conexion: "No se pudo buscar: falló la conexión. Probá de nuevo.",
  sesion: "Se cerró tu sesión. Volvé a ingresar para seguir.",
  evento: "Este evento ya no está disponible.",
  pedido: "No se pudo buscar. Recargá la página y probá de nuevo.",
  permiso: "No tenés permiso para esto.",
  limite: "Llegaste al tope de 5 búsquedas por minuto. Esperá un minuto y probá de nuevo.",
};

// alMarcar: después de marcar (para poner al día el contador); alOcupado:
// mientras se marca (las pestañas no se pueden cambiar).
export function Buscar({
  eventoId,
  puedeMarcar,
  alMarcar,
  alOcupado,
}: {
  eventoId: string;
  puedeMarcar: boolean;
  alMarcar: () => void;
  alOcupado: (ocupado: boolean) => void;
}) {
  const [lista, setLista] = useState<Lista | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<ErrorPuerta | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null); // id de la entrada
  const [marcando, setMarcando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const estado = useRef<HTMLDivElement>(null);
  const ultima = useRef(""); // lo último buscado: al volver de marcar se busca de nuevo (ya dice que entró)
  const turno = useRef(0); // una búsqueda vieja que contesta tarde no pisa la nueva

  async function buscar(texto: string) {
    const mio = ++turno.current;
    ultima.current = texto;
    setConfirmando(null);
    setBuscando(true);
    setError(null);
    // Si se busca otra cosa, la lista de antes se va. Si es la misma (al volver
    // de marcar), queda: sin señal, no se pierde a la persona que estaba.
    if (lista?.texto !== texto) setLista(null);
    const respuesta = await pedirPuerta("/api/puerta/buscar", { eventoId, texto });
    if (mio !== turno.current) return;
    const leida = respuesta ? leerRespuestaBusqueda(respuesta.ok, respuesta.cuerpo) : { error: "conexion" as const };
    setBuscando(false);
    if ("error" in leida) setError(leida);
    else setLista({ texto, respuesta: leida });
  }

  function alBuscar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const campo = evento.currentTarget.elements.namedItem("busqueda") as HTMLInputElement;
    const texto = campo.value.trim();
    if (!texto) return;
    campo.blur(); // que el teclado no tape los resultados
    buscar(texto);
  }

  async function marcar(entradaId: string) {
    setMarcando(true);
    alOcupado(true);
    const respuesta = await pedirPuerta("/api/puerta/marcar", { eventoId, entradaId });
    setMarcando(false);
    alOcupado(false);
    setConfirmando(null);
    setResultado(respuesta ? leerRespuestaPuerta(respuesta.ok, respuesta.cuerpo) : { error: "conexion" });
    alMarcar();
  }

  function volver() {
    setResultado(null);
    estado.current?.focus();
    if (ultima.current) buscar(ultima.current);
  }

  const encontradas = lista && "encontradas" in lista.respuesta ? lista.respuesta.encontradas : null;

  return (
    <div className="flex flex-col gap-4">
      <form method="post" onSubmit={alBuscar} role="search" className="flex flex-col gap-2">
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
            disabled={buscando}
            className="min-h-14 shrink-0 rounded-xl bg-white px-5 text-lg font-bold text-tinta disabled:opacity-60"
          >
            Buscar
          </button>
        </div>
      </form>

      <div ref={estado} tabIndex={-1} role="status" className="flex flex-col gap-3 text-lg outline-none">
        {buscando && <p>Buscando…</p>}
        {error && <Problema error={error} />}
        {!buscando && lista && <Resumen texto={lista.texto} respuesta={lista.respuesta} />}
        {!puedeMarcar && encontradas?.some((encontrada) => !encontrada.ingreso) && (
          <p className="rounded-2xl border border-white/30 p-4">
            Para dejar pasar a alguien sin el QR, llamá al organizador: el ingreso sin QR se marca desde su cuenta.
          </p>
        )}
      </div>

      {encontradas && (
        <ul className="flex flex-col gap-3">
          {encontradas.map((encontrada) => (
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
      )}

      {resultado && <PantallaResultado resultado={resultado} alSeguir={volver} desde="busqueda" />}
    </div>
  );
}

function Problema({ error }: { error: ErrorPuerta }) {
  return (
    <>
      <p>{ERRORES[error.error]}</p>
      {error.error === "sesion" && (
        <Link href="/ingresar" className="flex min-h-12 items-center justify-center rounded-xl bg-white font-bold text-tinta">
          Ingresar
        </Link>
      )}
      {error.error === "evento" && (
        <Link href="/validar" className="flex min-h-12 items-center justify-center rounded-xl bg-white font-bold text-tinta">
          Elegir otro evento
        </Link>
      )}
    </>
  );
}

function Resumen({ texto, respuesta }: { texto: string; respuesta: RespuestaBusqueda }) {
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
        {/\d/.test(texto)
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
  const pregunta = useRef<HTMLParagraphElement>(null);
  const botonMarcar = useRef<HTMLButtonElement>(null);
  const volverAlBoton = useRef(false);

  // El foco va a la pregunta (el lector de pantalla la lee) y, al cancelar,
  // vuelve a "Marcar ingreso".
  useEffect(() => {
    if (confirmando) pregunta.current?.focus();
    else if (volverAlBoton.current) {
      volverAlBoton.current = false;
      botonMarcar.current?.focus();
    }
  }, [confirmando]);

  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-white/25 bg-white/5 p-4">
      {/* En celulares angostos el cartel pasa abajo del nombre (si no, lo apretaba). */}
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-40 flex-1 flex-col gap-1">
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
            <p ref={pregunta} tabIndex={-1} className="font-semibold outline-none">
              ¿El nombre y el DNI coinciden con el documento que te mostró?
            </p>
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
                onClick={() => {
                  volverAlBoton.current = true;
                  alCancelar();
                }}
                disabled={marcando}
                className="min-h-12 rounded-xl border-2 border-white/70 px-4 font-semibold disabled:opacity-60"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            ref={botonMarcar}
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
