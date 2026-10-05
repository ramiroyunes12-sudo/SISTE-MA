"use client";

// Pantalla "Evento y lotes": datos del evento, tipos de entrada y sus lotes.
// Todo se edita acá y se guarda junto con "Guardar cambios".
import { type FormEvent, startTransition, useActionState, useEffect, useState } from "react";

import { BotonPrincipal, Campo, ErrorDeCampo, ESTILO_CAMPO, MensajeError } from "@/components/formulario";
import { type Errores, type EventoEditado, MAX_LOTES, MAX_TIPOS, type LoteEditado } from "@/lib/eventos/editor";
import type { EstadoLote } from "@/lib/eventos/lotes";

import { guardarEventoDesdeEditor } from "./acciones";

// En pantalla cada fila lleva una "clave" propia (las nuevas todavía no tienen id).
type LoteEnPantalla = LoteEditado & { clave: string };
type TipoEnPantalla = { id?: string; clave: string; nombre: string; lotes: LoteEnPantalla[] };
type EventoEnPantalla = Omit<EventoEditado, "tipos"> & { tipos: TipoEnPantalla[] };

export type InfoLote = { vendidas: number; reservadas: number; estado: EstadoLote };

let contador = 0;
const nuevaClave = () => `nuevo-${++contador}`;

function conClaves(evento: EventoEditado): EventoEnPantalla {
  return {
    ...evento,
    tipos: evento.tipos.map((tipo) => ({
      ...tipo,
      clave: tipo.id ?? nuevaClave(),
      lotes: tipo.lotes.map((lote) => ({ ...lote, clave: lote.id ?? nuevaClave() })),
    })),
  };
}

const ETIQUETA_ESTADO: Record<EstadoLote | "NUEVO", { texto: string; clase: string }> = {
  AGOTADO: { texto: "Agotado", clase: "bg-[#EDEDE8] text-[#3A3D44]" },
  EN_VENTA: { texto: "En venta", clase: "bg-[#E7F4EC] text-ok-oscuro" },
  EN_ESPERA: { texto: "En espera", clase: "bg-[#F3F3FE] text-acento-hover" },
  NUEVO: { texto: "Sin guardar", clase: "border border-borde-campo text-tenue" },
};

export function EditorEvento({
  eventoId,
  inicial,
  infoLotes,
  cortesiasEmitidas,
  guardado,
}: {
  eventoId: string | null;
  inicial: EventoEditado;
  infoLotes: Record<string, InfoLote>;
  cortesiasEmitidas: number;
  guardado: boolean;
}) {
  const [original] = useState(() => conClaves(inicial));
  const [evento, setEvento] = useState(original);
  const [estado, accion, enviando] = useActionState(guardarEventoDesdeEditor, {});

  // Los errores que devolvió el servidor; se van borrando a medida que se corrigen.
  const [errores, setErrores] = useState<Errores>({});
  const [estadoVisto, setEstadoVisto] = useState(estado);
  if (estado !== estadoVisto) {
    setEstadoVisto(estado);
    setErrores(estado.errores ?? {});
  }
  const hayErrores = Object.keys(errores).length > 0;

  // Si hay cambios sin guardar y cierra la pestaña, el navegador pregunta.
  const sucio = JSON.stringify(evento) !== JSON.stringify(original);
  useEffect(() => {
    if (!sucio || enviando) return;
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [sucio, enviando]);

  function olvidarError(clave: string) {
    if (!errores[clave]) return;
    setErrores((anteriores) => {
      const resto = { ...anteriores };
      delete resto[clave];
      return resto;
    });
  }

  function cambiar(campo: keyof Omit<EventoEnPantalla, "tipos">, valor: string) {
    setEvento((e) => ({ ...e, [campo]: valor }));
    olvidarError(campo);
  }

  function cambiarTipo(t: number, cambio: (tipo: TipoEnPantalla) => TipoEnPantalla) {
    setEvento((e) => ({ ...e, tipos: e.tipos.map((tipo, i) => (i === t ? cambio(tipo) : tipo)) }));
  }

  function cambiarLote(t: number, l: number, campo: "nombre" | "precio" | "cupo", valor: string) {
    cambiarTipo(t, (tipo) => ({
      ...tipo,
      lotes: tipo.lotes.map((lote, i) => (i === l ? { ...lote, [campo]: valor } : lote)),
    }));
    olvidarError(`tipos.${t}.lotes.${l}.${campo}`);
  }

  function agregarLote(t: number) {
    cambiarTipo(t, (tipo) => {
      const ultimo = tipo.lotes.at(-1);
      const numero = tipo.lotes.length + 1;
      return {
        ...tipo,
        lotes: [
          ...tipo.lotes,
          { clave: nuevaClave(), nombre: `Lote ${numero}`, precio: ultimo?.precio ?? "", cupo: ultimo?.cupo ?? "" },
        ],
      };
    });
  }

  // Al quitar filas cambian las posiciones: los errores viejos ya no corresponden.
  function quitarLote(t: number, l: number) {
    cambiarTipo(t, (tipo) => ({ ...tipo, lotes: tipo.lotes.filter((_, i) => i !== l) }));
    setErrores({});
  }

  function agregarTipo() {
    setEvento((e) => ({
      ...e,
      tipos: [
        ...e.tipos,
        { clave: nuevaClave(), nombre: "", lotes: [{ clave: nuevaClave(), nombre: "Lote 1", precio: "", cupo: "" }] },
      ],
    }));
  }

  function quitarTipo(t: number) {
    setEvento((e) => ({ ...e, tipos: e.tipos.filter((_, i) => i !== t) }));
    setErrores({});
  }

  function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(() => accion({ eventoId, evento }));
  }

  const ocupadas = (lote: LoteEnPantalla) => {
    const info = lote.id ? infoLotes[lote.id] : undefined;
    return info ? info.vendidas + info.reservadas : 0;
  };

  const botonGuardar = (
    <BotonPrincipal type="submit" disabled={enviando}>
      {enviando ? "Guardando…" : eventoId ? "Guardar cambios" : "Crear evento"}
    </BotonPrincipal>
  );

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-extrabold">{eventoId ? "Evento y lotes" : "Nuevo evento"}</h1>
        {botonGuardar}
      </div>

      {guardado && !sucio && (
        <p role="status" className="rounded-xl bg-ok/10 px-4 py-3 font-semibold text-ok-oscuro">
          Listo, los cambios quedaron guardados.
        </p>
      )}
      {!enviando && <MensajeError>{errores.general}</MensajeError>}
      {!enviando && hayErrores && !errores.general && (
        <MensajeError>Hay datos para corregir: están marcados en rojo.</MensajeError>
      )}

      {/* ─── Datos del evento ─── */}
      <section className="flex flex-col gap-4 rounded-2xl border border-borde bg-superficie p-5">
        <h2 className="text-lg font-bold">Datos del evento</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            etiqueta="Nombre"
            id="nombre"
            value={evento.nombre}
            onChange={(e) => cambiar("nombre", e.target.value)}
            error={errores.nombre}
            maxLength={120}
          />
          <Campo
            etiqueta="Día y hora (de Argentina)"
            id="fecha"
            type="datetime-local"
            value={evento.fecha}
            onChange={(e) => cambiar("fecha", e.target.value)}
            error={errores.fecha}
          />
          <Campo
            etiqueta="Lugar"
            id="lugar"
            value={evento.lugar}
            onChange={(e) => cambiar("lugar", e.target.value)}
            error={errores.lugar}
            maxLength={120}
          />
          <Campo
            etiqueta="Dirección (opcional)"
            id="direccion"
            value={evento.direccion}
            onChange={(e) => cambiar("direccion", e.target.value)}
            error={errores.direccion}
            maxLength={200}
          />
          <Campo
            etiqueta="Máximo de entradas por compra"
            id="maxPorCompra"
            inputMode="numeric"
            value={evento.maxPorCompra}
            onChange={(e) => cambiar("maxPorCompra", e.target.value)}
            error={errores.maxPorCompra}
          />
          <Campo
            etiqueta="Cupo de cortesías (aparte de la venta)"
            id="cupoCortesias"
            inputMode="numeric"
            value={evento.cupoCortesias}
            onChange={(e) => cambiar("cupoCortesias", e.target.value)}
            error={errores.cupoCortesias}
            ayuda={cortesiasEmitidas > 0 ? `Ya se dieron ${cortesiasEmitidas}.` : undefined}
          />
          <Campo
            etiqueta="Dirección de la página"
            id="slug"
            value={evento.slug}
            onChange={(e) => cambiar("slug", e.target.value.toLowerCase())}
            error={errores.slug}
            maxLength={60}
            placeholder="se arma sola con el nombre"
            ayuda={
              eventoId
                ? `Queda como …/e/${evento.slug || "…"}. Si ya compartiste el link, no la cambies.`
                : "Queda como …/e/fiesta-primavera. Si la dejás vacía, se arma sola con el nombre."
            }
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="estado" className="text-sm font-semibold">
              Estado
            </label>
            <select
              id="estado"
              value={evento.estado}
              onChange={(e) => cambiar("estado", e.target.value)}
              aria-invalid={errores.estado ? true : undefined}
              aria-describedby={errores.estado ? "estado-error" : undefined}
              className={`h-12 ${ESTILO_CAMPO}`}
            >
              <option value="BORRADOR">Borrador (no se ve en la página)</option>
              <option value="PUBLICADO">Publicado (a la venta)</option>
              <option value="FINALIZADO">Finalizado (no se vende más)</option>
            </select>
            <ErrorDeCampo id="estado-error">{errores.estado}</ErrorDeCampo>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="descripcion" className="text-sm font-semibold">
            Descripción (opcional)
          </label>
          <textarea
            id="descripcion"
            rows={4}
            value={evento.descripcion}
            onChange={(e) => cambiar("descripcion", e.target.value)}
            maxLength={5000}
            aria-invalid={errores.descripcion ? true : undefined}
            aria-describedby={errores.descripcion ? "descripcion-error" : undefined}
            className={`py-3 ${ESTILO_CAMPO}`}
          />
          <ErrorDeCampo id="descripcion-error">{errores.descripcion}</ErrorDeCampo>
        </div>
        <p className="text-sm text-tenue">El flyer (la imagen del evento) se sube en el próximo paso.</p>
      </section>

      {/* ─── Tipos de entrada y lotes ─── */}
      {evento.tipos.map((tipo, t) => {
        const conVentas = tipo.lotes.some((lote) => ocupadas(lote) > 0);
        return (
          <section key={tipo.clave} className="overflow-hidden rounded-2xl border border-borde bg-superficie">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-borde p-5">
              <Campo
                etiqueta="Tipo de entrada"
                id={`tipo-${t}`}
                value={tipo.nombre}
                placeholder="General, VIP…"
                onChange={(e) => {
                  cambiarTipo(t, (x) => ({ ...x, nombre: e.target.value }));
                  olvidarError(`tipos.${t}.nombre`);
                }}
                error={errores[`tipos.${t}.nombre`]}
                maxLength={60}
                className="min-w-0 flex-1 sm:max-w-xs"
              />
              <button
                type="button"
                onClick={() => quitarTipo(t)}
                disabled={conVentas}
                title={conVentas ? "Ya tiene entradas vendidas o reservadas" : undefined}
                className="h-11 rounded-xl px-3 text-sm font-semibold text-error underline disabled:cursor-not-allowed disabled:text-tenue disabled:no-underline"
              >
                Quitar este tipo
              </button>
            </div>
            <p className="px-5 pt-3 text-sm text-tenue">Cuando un lote se agota, se abre el siguiente solo.</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-[15px]">
                <thead>
                  <tr className="text-left text-[13px] text-tenue">
                    <th className="px-5 py-2.5 font-semibold">Nombre</th>
                    <th className="px-3 py-2.5 font-semibold">Precio ($)</th>
                    <th className="px-3 py-2.5 font-semibold">Cupo</th>
                    <th className="px-3 py-2.5 font-semibold">Vendidas</th>
                    <th className="px-3 py-2.5 font-semibold">Estado</th>
                    <th className="px-5 py-2.5">
                      <span className="sr-only">Quitar</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tipo.lotes.map((lote, l) => {
                    const info = lote.id ? infoLotes[lote.id] : undefined;
                    const etiqueta = ETIQUETA_ESTADO[info?.estado ?? "NUEVO"];
                    const base = `tipos.${t}.lotes.${l}`;
                    const nombreFila = `${lote.nombre || `lote ${l + 1}`} de ${tipo.nombre || "este tipo"}`;
                    return (
                      <tr key={lote.clave} className="border-t border-[#EDEDE8] align-top">
                        <td className="px-5 py-2.5">
                          <CeldaEditable
                            id={`${base}.nombre`}
                            etiqueta={`Nombre del ${nombreFila}`}
                            valor={lote.nombre}
                            onChange={(v) => cambiarLote(t, l, "nombre", v)}
                            error={errores[`${base}.nombre`]}
                            ancho="w-32"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <CeldaEditable
                            id={`${base}.precio`}
                            etiqueta={`Precio del ${nombreFila}`}
                            valor={lote.precio}
                            onChange={(v) => cambiarLote(t, l, "precio", v)}
                            error={errores[`${base}.precio`]}
                            ancho="w-32"
                            inputMode="decimal"
                            placeholder="8.000"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <CeldaEditable
                            id={`${base}.cupo`}
                            etiqueta={`Cupo del ${nombreFila}`}
                            valor={lote.cupo}
                            onChange={(v) => cambiarLote(t, l, "cupo", v)}
                            error={errores[`${base}.cupo`]}
                            ancho="w-24"
                            inputMode="numeric"
                          />
                        </td>
                        <td className="px-3 py-4">
                          {info ? info.vendidas : 0}
                          {info && info.reservadas > 0 && (
                            <span className="block text-xs text-tenue">+ {info.reservadas} reservadas</span>
                          )}
                        </td>
                        <td className="px-3 py-4">
                          <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${etiqueta.clase}`}>
                            {etiqueta.texto}
                          </span>
                        </td>
                        <td className="px-5 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => quitarLote(t, l)}
                            disabled={ocupadas(lote) > 0}
                            title={ocupadas(lote) > 0 ? "Ya tiene entradas vendidas o reservadas" : undefined}
                            aria-label={`Quitar ${nombreFila}`}
                            className="h-11 rounded-lg px-2 text-sm font-semibold text-error underline disabled:cursor-not-allowed disabled:text-tenue disabled:no-underline"
                          >
                            Quitar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t border-[#EDEDE8] px-5 py-3">
              <button
                type="button"
                onClick={() => agregarLote(t)}
                disabled={tipo.lotes.length >= MAX_LOTES}
                className="h-11 rounded-xl border-[1.5px] border-dashed border-acento px-4 font-bold text-acento disabled:opacity-50"
              >
                + Agregar lote
              </button>
            </div>
          </section>
        );
      })}

      <button
        type="button"
        onClick={agregarTipo}
        disabled={evento.tipos.length >= MAX_TIPOS}
        className="h-12 self-start rounded-xl border-[1.5px] border-dashed border-acento px-5 font-bold text-acento disabled:opacity-50"
      >
        + Agregar tipo de entrada
      </button>

      <div className="flex flex-wrap items-center gap-3 border-t border-borde pt-5">
        {botonGuardar}
        {sucio && !enviando && <span className="text-sm text-tenue">Tenés cambios sin guardar.</span>}
      </div>
    </form>
  );
}

function CeldaEditable({
  id,
  etiqueta,
  valor,
  onChange,
  error,
  ancho,
  inputMode,
  placeholder,
}: {
  id: string;
  etiqueta: string;
  valor: string;
  onChange: (valor: string) => void;
  error?: string;
  ancho: string;
  inputMode?: "decimal" | "numeric";
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <input
        id={id}
        aria-label={etiqueta}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        inputMode={inputMode}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`h-10 ${ancho} rounded-lg border border-borde-campo px-2.5 outline-acento focus:outline-2 aria-[invalid=true]:border-error`}
      />
      <ErrorDeCampo id={`${id}-error`}>{error}</ErrorDeCampo>
    </div>
  );
}
