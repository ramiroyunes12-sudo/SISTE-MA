"use client";

import { useActionState, useState } from "react";

import { BotonPrincipal, Campo, ESTILO_CAMPO, MensajeError } from "@/components/formulario";
import { formatearFecha } from "@/lib/fechas";
import type { CuentaNueva } from "@/lib/productoras";

import { crearProductoraAccion, type EstadoProductora } from "./acciones";

type Accion = (anterior: EstadoProductora, datos: FormData) => Promise<EstadoProductora>;
type AccionSinDatos = (anterior: EstadoProductora) => Promise<EstadoProductora>;

// Cartel con la contraseña temporal de una cuenta nueva (o reseteada), y un
// mensaje listo para mandarle a la persona por WhatsApp.
export function CuentaCreada({ cuenta }: { cuenta: CuentaNueva }) {
  const [copiado, setCopiado] = useState(false);
  const vence = formatearFecha(new Date(cuenta.venceEn));
  const mensaje =
    `¡Hola! Ya tenés tu cuenta para el panel de entradas.\n` +
    `Entrá en ${typeof window === "undefined" ? "" : window.location.origin}/ingresar con tu email (${cuenta.email}) ` +
    `y esta contraseña temporal: ${cuenta.temporal}\n` +
    `Vence el ${vence}. Al entrar te pide que elijas una propia.`;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(mensaje);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  }

  if (!cuenta.sirve) {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-xl bg-error/10 p-4 text-error">
        <p className="font-semibold">Contraseña temporal para {cuenta.email}: {cuenta.temporal}</p>
        <p className="text-sm">
          OJO: la persona o su productora están desactivadas. Esta contraseña no va a servir hasta reactivarlas (vence el{" "}
          {vence}).
        </p>
      </div>
    );
  }

  return (
    <div role="status" className="flex flex-col gap-2 rounded-xl border border-ok/30 bg-ok/10 p-4 text-ok-oscuro">
      <p className="font-semibold">Cuenta lista para {cuenta.email}</p>
      <p>
        Contraseña temporal: <code className="rounded bg-superficie px-2 py-0.5 font-mono text-base text-tinta">{cuenta.temporal}</code>
      </p>
      <p className="text-sm">
        Vence el {vence}. Pasásela a la persona (por ejemplo, por WhatsApp): al entrar le va a pedir que elija una propia.
        Esta contraseña no se vuelve a mostrar.
      </p>
      <button
        type="button"
        onClick={copiar}
        className="h-10 self-start rounded-lg border-[1.5px] border-ok-oscuro px-3 text-sm font-bold"
      >
        {copiado ? "¡Copiado!" : "Copiar mensaje para mandar"}
      </button>
    </div>
  );
}

export function FormularioNuevaProductora() {
  const [estado, accion, enviando] = useActionState(crearProductoraAccion, {});
  const errores = estado.errores ?? {};
  return (
    <form action={accion} className="flex flex-col gap-4 rounded-2xl border border-borde bg-superficie p-5">
      <h2 className="text-lg font-bold">Nueva productora</h2>
      <p className="text-sm text-tenue">
        Se crea con su primer organizador: la persona a cargo, que entra con su email. Después podés sumar más gente.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Campo etiqueta="Nombre de la productora" id="nombre" name="nombre" maxLength={80} error={errores.nombre} required />
        <Campo
          etiqueta="Persona a cargo"
          id="nombrePersona"
          name="nombrePersona"
          maxLength={80}
          placeholder="Nombre y apellido"
          error={errores.nombrePersona}
          required
        />
        <Campo etiqueta="Su email" id="email" name="email" type="email" error={errores.email} required />
      </div>
      {!enviando && <MensajeError>{errores.general}</MensajeError>}
      {!enviando && estado.cuenta && <CuentaCreada cuenta={estado.cuenta} />}
      <BotonPrincipal type="submit" disabled={enviando} className="self-start">
        {enviando ? "Creando…" : "Crear productora"}
      </BotonPrincipal>
    </form>
  );
}

export function FormularioEditarProductora({
  accion: accionEditar,
  nombre,
  activa,
}: {
  accion: Accion;
  nombre: string;
  activa: boolean;
}) {
  const [estado, accion, enviando] = useActionState(accionEditar, {});
  const errores = estado.errores ?? {};
  return (
    <form action={accion} className="flex flex-col gap-4 rounded-2xl border border-borde bg-superficie p-5">
      <h2 className="text-lg font-bold">Datos</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Nombre" id="nombre" name="nombre" defaultValue={nombre} maxLength={80} error={errores.nombre} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="activa" className="text-sm font-semibold">
            Estado
          </label>
          <select id="activa" name="activa" defaultValue={activa ? "si" : "no"} className={`h-12 ${ESTILO_CAMPO}`}>
            <option value="si">Activa</option>
            <option value="no">Desactivada (su gente no puede entrar)</option>
          </select>
        </div>
      </div>
      {!enviando && <MensajeError>{errores.general}</MensajeError>}
      {!enviando && estado.guardado && (
        <p role="status" className="font-semibold text-ok-oscuro">
          Guardado.
        </p>
      )}
      <BotonPrincipal type="submit" disabled={enviando} className="self-start">
        {enviando ? "Guardando…" : "Guardar"}
      </BotonPrincipal>
    </form>
  );
}

// soloValidadores: la pantalla "Validadores" de un organizador (sin elegir qué puede hacer).
// prefijo: para que los campos no repitan id si hay varios formularios en la página.
export function FormularioAgregarPersona({
  accion: accionAgregar,
  soloValidadores = false,
  prefijo = "",
}: {
  accion: Accion;
  soloValidadores?: boolean;
  prefijo?: string;
}) {
  const [estado, accion, enviando] = useActionState(accionAgregar, {});
  const errores = estado.errores ?? {};
  return (
    <form action={accion} className="flex flex-col gap-4 border-t border-borde p-5">
      <h3 className="font-bold">{soloValidadores ? "Sumar un validador" : "Sumar una persona"}</h3>
      <div className={`grid gap-4 ${soloValidadores ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
        <Campo
          etiqueta="Nombre y apellido"
          id={`${prefijo}nombrePersona`}
          name="nombrePersona"
          maxLength={80}
          error={errores.nombrePersona}
          required
        />
        <Campo etiqueta="Email" id={`${prefijo}email-persona`} name="email" type="email" error={errores.email} required />
        {!soloValidadores && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rol" className="text-sm font-semibold">
              Qué puede hacer
            </label>
            <select id="rol" name="rol" defaultValue="ORGANIZADOR" className={`h-12 ${ESTILO_CAMPO}`}>
              <option value="ORGANIZADOR">Organizador (eventos y números)</option>
              <option value="VALIDADOR">Validador (solo la puerta)</option>
            </select>
          </div>
        )}
      </div>
      {!enviando && <MensajeError>{errores.general}</MensajeError>}
      {!enviando && estado.cuenta && <CuentaCreada cuenta={estado.cuenta} />}
      <BotonPrincipal type="submit" disabled={enviando} className="self-start">
        {enviando ? "Creando cuenta…" : "Crear cuenta"}
      </BotonPrincipal>
    </form>
  );
}

// Botones de cada persona: contraseña temporal nueva y activar/desactivar.
export function AccionesPersona({
  nombre,
  activo,
  nuevaTemporal,
  cambiarActivo,
}: {
  nombre: string;
  activo: boolean;
  nuevaTemporal: AccionSinDatos;
  cambiarActivo: AccionSinDatos;
}) {
  const [temporal, pedirTemporal, generando] = useActionState(nuevaTemporal, {});
  const [cambio, pedirCambio, cambiando] = useActionState(cambiarActivo, {});
  const error = temporal.errores?.general ?? cambio.errores?.general;
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-x-4">
        <form action={pedirTemporal}>
          <button
            type="submit"
            disabled={generando}
            aria-label={`Nueva contraseña temporal para ${nombre}`}
            className="h-10 text-sm font-semibold text-acento underline disabled:opacity-50"
          >
            {generando ? "Generando…" : "Nueva contraseña"}
          </button>
        </form>
        <form action={pedirCambio}>
          <button
            type="submit"
            disabled={cambiando}
            aria-label={`${activo ? "Desactivar" : "Activar"} a ${nombre}`}
            className={`h-10 text-sm font-semibold underline disabled:opacity-50 ${activo ? "text-error" : "text-ok-oscuro"}`}
          >
            {activo ? "Desactivar" : "Activar"}
          </button>
        </form>
      </div>
      {error && <MensajeError>{error}</MensajeError>}
      {!generando && temporal.cuenta && <CuentaCreada cuenta={temporal.cuenta} />}
    </div>
  );
}
