"use client";
// "Dar una cortesía" y "Cargar varias" (pegar la lista o elegir el Excel o
// CSV). El archivo se lee acá, en el navegador: no se sube, se pasa a texto y
// sigue igual que si lo hubieran pegado. Nada de esto se guarda en el
// navegador (son datos personales).
import { type FormEvent, startTransition, useActionState, useEffect, useRef, useState } from "react";

import { BotonPrincipal, Campo, ESTILO_CAMPO, ErrorDeCampo, MensajeError } from "@/components/formulario";
import { celdasATexto } from "@/lib/cortesias/planilla";
import type { TipoCortesia } from "@/lib/cortesias/revision";

import type { EstadoLista, EstadoUna, VistaPrevia } from "../acciones";

type AccionUna = (anterior: EstadoUna, datos: FormData) => Promise<EstadoUna>;

export function DarUna({ accion: dar, tipos }: { accion: AccionUna; tipos: TipoCortesia[] }) {
  const [estado, despachar, enviando] = useActionState(dar, {});
  const [tipoId, setTipoId] = useState(tipos.length === 1 ? tipos[0].id : "");
  const formulario = useRef<HTMLFormElement>(null);
  const errores = estado.errores ?? {};

  // Sin borrar lo escrito si algo está mal (un form con action lo vacía
  // solo); si salió bien, se vacía para la próxima.
  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const datos = new FormData(evento.currentTarget);
    startTransition(() => despachar(datos));
  }
  useEffect(() => {
    if (estado.dada) formulario.current?.reset();
  }, [estado]);

  const ultima = estado.dada;
  return (
    <form ref={formulario} onSubmit={enviar} noValidate className="flex flex-col gap-4 rounded-2xl border border-borde bg-superficie p-5">
      <h2 className="text-lg font-bold">Dar una cortesía</h2>
      <Campo
        etiqueta="Nombre y apellido"
        id="cortesia-nombre"
        name="nombre"
        autoComplete="off"
        maxLength={80}
        error={errores.nombre}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          etiqueta="DNI"
          id="cortesia-dni"
          name="dni"
          inputMode="numeric"
          autoComplete="off"
          maxLength={12}
          error={errores.dni}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="cortesia-tipo" className="text-sm font-semibold">
            Tipo
          </label>
          <select
            id="cortesia-tipo"
            name="tipoId"
            value={tipoId}
            onChange={(e) => setTipoId(e.target.value)}
            aria-invalid={errores.tipoId ? true : undefined}
            aria-describedby={errores.tipoId ? "cortesia-tipo-error" : undefined}
            className={`h-12 ${ESTILO_CAMPO}`}
          >
            {tipos.length > 1 && <option value="">Elegí…</option>}
            {tipos.map((tipo) => (
              <option key={tipo.id} value={tipo.id}>
                {tipo.nombre}
              </option>
            ))}
          </select>
          <ErrorDeCampo id="cortesia-tipo-error">{errores.tipoId}</ErrorDeCampo>
        </div>
      </div>
      <Campo
        etiqueta="Email (opcional)"
        id="cortesia-email"
        name="email"
        type="email"
        autoComplete="off"
        maxLength={200}
        error={errores.email}
        ayuda="Con email, le llega el QR por mail. Sin email, bajás el PDF desde la lista de abajo y se lo pasás."
      />
      {!enviando && <MensajeError>{errores.general}</MensajeError>}
      {!enviando && ultima && !estado.errores && (
        <p role="status" className="rounded-xl bg-ok/10 px-4 py-3 text-sm font-semibold text-ok-oscuro">
          Listo: cortesía para {ultima.nombre}. {ultima.email ? `El mail con el QR sale a ${ultima.email}.` : "Bajá su PDF desde la lista."}
        </p>
      )}
      <BotonPrincipal type="submit" disabled={enviando} className="self-start">
        {enviando ? "Dando…" : "Dar cortesía"}
      </BotonPrincipal>
    </form>
  );
}

type AccionRevisar = (pedido: { texto: string; tipoId: string }) => Promise<EstadoLista>;
type AccionDar = (pedido: { texto: string; tipoId: string; esperadas: number }) => Promise<EstadoLista>;

const ACEPTA = ".xlsx,.csv,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function CargarVarias({
  revisar,
  dar,
  tipos,
}: {
  revisar: AccionRevisar;
  dar: AccionDar;
  tipos: TipoCortesia[];
}) {
  const [texto, setTexto] = useState("");
  const [tipoId, setTipoId] = useState(tipos.length === 1 ? tipos[0].id : "");
  const [estado, setEstado] = useState<EstadoLista>({});
  const [trabajando, setTrabajando] = useState<"" | "leyendo" | "revisando" | "dando">("");
  const archivo = useRef<HTMLInputElement>(null);

  async function correr(paso: "revisando" | "dando", hacer: () => Promise<EstadoLista>) {
    setTrabajando(paso);
    try {
      setEstado(await hacer());
    } catch {
      setEstado({ error: "Falló la conexión. Probá de nuevo." });
    } finally {
      setTrabajando("");
    }
  }

  function revisarTexto(contenido = texto) {
    return correr("revisando", () => revisar({ texto: contenido, tipoId }));
  }

  async function confirmar(vista: VistaPrevia) {
    await correr("dando", async () => {
      const resultado = await dar({ texto, tipoId, esperadas: vista.validas });
      if (resultado.dadas) setTexto(resultado.dadas.restante);
      return resultado;
    });
  }

  async function elegirArchivo(elegido: File | undefined) {
    if (archivo.current) archivo.current.value = ""; // para poder elegir el mismo de nuevo
    if (!elegido) return;
    setTrabajando("leyendo");
    setEstado({});
    try {
      const { leerTextoDeArchivo, leerXlsx, MAX_BYTES_ARCHIVO } = await import("@/lib/cortesias/xlsx");
      if (elegido.size > MAX_BYTES_ARCHIVO) {
        setEstado({ error: "El archivo es muy grande (hasta 5 MB). ¿Seguro que es la lista?" });
        return;
      }
      const bytes = new Uint8Array(await elegido.arrayBuffer());
      const esZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK": un .xlsx
      const esXlsViejo = bytes[0] === 0xd0 && bytes[1] === 0xcf; // Excel 97-2003
      if (esXlsViejo || /\.xls$/i.test(elegido.name)) {
        setEstado({ error: "Ese es un Excel viejo (.xls). Abrilo y guardalo como .xlsx o .csv (Archivo → Guardar como)." });
        return;
      }
      const contenido = esZip ? celdasATexto(leerXlsx(bytes)) : leerTextoDeArchivo(bytes);
      setTexto(contenido);
      setTrabajando("");
      await revisarTexto(contenido);
    } catch {
      setEstado({ error: "No pudimos leer el archivo. Probá guardándolo como .xlsx o .csv, o copiá las filas y pegalas acá." });
    } finally {
      setTrabajando((actual) => (actual === "leyendo" ? "" : actual));
    }
  }

  const { vista, dadas, error } = estado;
  const ocupado = trabajando !== "";
  const conError = vista ? vista.filas.length - vista.validas : 0;
  const noAlcanza = vista ? vista.validas > vista.quedan : false;

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-borde bg-superficie p-5">
      <h2 className="text-lg font-bold">Cargar varias</h2>
      <p className="text-sm text-tenue">
        Copiá las filas del Excel o de Google Sheets y pegalas acá (con los títulos si los tiene: <strong>Nombre</strong>,{" "}
        <strong>DNI</strong>, <strong>Email</strong> y <strong>Tipo</strong>; el email y el tipo son opcionales). También
        podés elegir el archivo .xlsx o .csv. Hasta 200 por vez.
      </p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="cortesias-lista" className="text-sm font-semibold">
          La lista
        </label>
        <textarea
          id="cortesias-lista"
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            if (estado.vista || estado.dadas) setEstado({});
          }}
          rows={6}
          spellCheck={false}
          autoComplete="off"
          placeholder={"Nombre\tDNI\tEmail\nJuana Pérez\t40.123.456\tjuana@mail.com\nCarlos Gómez\t38999111"}
          className={`min-h-36 py-3 font-mono text-sm ${ESTILO_CAMPO}`}
        />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="cortesias-tipo" className="text-sm font-semibold">
            Tipo para las que no lo dicen
          </label>
          <select
            id="cortesias-tipo"
            value={tipoId}
            onChange={(e) => {
              setTipoId(e.target.value);
              if (estado.vista) setEstado({});
            }}
            className={`h-12 min-w-40 ${ESTILO_CAMPO}`}
          >
            {tipos.length > 1 && <option value="">Elegí…</option>}
            {tipos.map((tipo) => (
              <option key={tipo.id} value={tipo.id}>
                {tipo.nombre}
              </option>
            ))}
          </select>
        </div>
        <input ref={archivo} type="file" accept={ACEPTA} className="sr-only" id="cortesias-archivo" onChange={(e) => elegirArchivo(e.target.files?.[0])} />
        <label
          htmlFor="cortesias-archivo"
          className="flex h-12 cursor-pointer items-center rounded-xl border-[1.5px] border-borde-campo px-4 font-semibold hover:bg-fondo has-[:focus-visible]:outline-2"
        >
          {trabajando === "leyendo" ? "Leyendo…" : "Elegir archivo"}
        </label>
        <button
          type="button"
          disabled={ocupado || !texto.trim()}
          onClick={() => revisarTexto()}
          className="h-12 rounded-xl border-[1.5px] border-tinta px-4 font-bold hover:bg-fondo disabled:opacity-50"
        >
          {trabajando === "revisando" ? "Revisando…" : "Revisar la lista"}
        </button>
      </div>

      {!ocupado && <MensajeError>{error}</MensajeError>}

      {!ocupado && dadas && (
        <div role="status" className="flex flex-col gap-1 rounded-xl bg-ok/10 px-4 py-3 text-sm text-ok-oscuro">
          <p className="font-semibold">
            Listo: {dadas.cantidad === 1 ? "se dio 1 cortesía" : `se dieron ${dadas.cantidad} cortesías`}.
            {dadas.conEmail > 0 && ` Los mails con el QR salen en un rato (${dadas.conEmail === 1 ? "1 con email" : `${dadas.conEmail} con email`}).`}
          </p>
          {dadas.restante && <p>En el cuadro quedaron las filas con error: corregilas y revisá de nuevo.</p>}
        </div>
      )}

      {vista && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold" role="status">
            {vista.validas === 1 ? "1 lista para dar" : `${vista.validas} listas para dar`}
            {conError > 0 && ` · ${conError === 1 ? "1 con error (no se da)" : `${conError} con error (no se dan)`}`}
            {` · quedan ${vista.quedan} en el cupo`}
          </p>
          <div className="max-h-96 overflow-auto rounded-xl border border-borde">
            <table className="w-full min-w-[380px] border-collapse text-sm">
              <thead className="sticky top-0 bg-[#FAFAF8] text-left text-xs text-tenue">
                <tr>
                  <th className="px-3 py-2 font-semibold">Fila</th>
                  <th className="px-3 py-2 font-semibold">Persona</th>
                  <th className="px-3 py-2 font-semibold">DNI</th>
                  <th className="px-3 py-2 font-semibold">Tipo</th>
                </tr>
              </thead>
              <tbody>
                {vista.filas.map((fila) => (
                  <tr key={fila.fila} className="border-t border-[#EDEDE8] align-top">
                    <td className="px-3 py-2 text-tenue">{fila.fila}</td>
                    <td className="px-3 py-2 [overflow-wrap:anywhere]">
                      {fila.nombre || <span className="text-tenue">—</span>}
                      <span className="block text-xs text-tenue">{fila.email ?? "sin email"}</span>
                      {fila.errores.length > 0 && (
                        <ul className="mt-1 flex flex-col gap-0.5 text-xs font-semibold text-error">
                          {fila.errores.map((e) => (
                            <li key={e}>{e}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{fila.dni || <span className="text-tenue">—</span>}</td>
                    <td className="px-3 py-2">{fila.tipo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {noAlcanza && (
            <MensajeError>{`No alcanza el cupo: quedan ${vista.quedan} y la lista tiene ${vista.validas}. Subí el cupo en Evento y lotes o sacá filas.`}</MensajeError>
          )}
          {vista.validas > 0 && !noAlcanza && (
            <BotonPrincipal type="button" disabled={ocupado} onClick={() => confirmar(vista)} className="self-start">
              {trabajando === "dando"
                ? "Dando…"
                : vista.validas === 1
                  ? "Dar 1 cortesía"
                  : `Dar ${vista.validas} cortesías`}
            </BotonPrincipal>
          )}
        </div>
      )}
    </section>
  );
}
