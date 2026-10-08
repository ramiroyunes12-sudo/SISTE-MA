"use client";

// Cobros de la productora: alias para transferencias, cargo por servicio de
// Mercado Pago y la cuenta de Mercado Pago conectada.
import { useActionState } from "react";

import { BotonPrincipal, Campo, MensajeError } from "@/components/formulario";

import type { EstadoCobros } from "./acciones";

type Accion = (anterior: EstadoCobros, datos: FormData) => Promise<EstadoCobros>;

export function FormularioCobros({
  guardar,
  conectar,
  desconectar,
  alias,
  titular,
  recargo,
  cuentaMp,
  conectadaEl,
}: {
  guardar: Accion;
  conectar: Accion;
  desconectar: () => Promise<EstadoCobros>;
  alias: string;
  titular: string;
  recargo: string;
  cuentaMp: string | null;
  conectadaEl: string | null;
}) {
  const [estado, accion, guardando] = useActionState(guardar, {});
  const [estadoMp, accionMp, conectando] = useActionState(conectar, {});
  const [estadoDesconectar, accionDesconectar, desconectando] = useActionState(desconectar, {});
  const errores = estado.errores ?? {};

  return (
    <section className="flex flex-col gap-5 rounded-2xl border border-borde bg-superficie p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-bold">Cobros</h2>
        <p className="text-sm text-tenue">
          Quien compra elige: transferencia al alias (sin recargo) o Mercado Pago (con cargo por servicio). Los dos se
          confirman solos revisando la cuenta de Mercado Pago conectada abajo: el alias tiene que ser de esa misma cuenta.
        </p>
      </div>

      <form action={accion} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            etiqueta="Alias (o CVU) para transferencias"
            id="alias"
            name="alias"
            defaultValue={alias}
            maxLength={30}
            autoComplete="off"
            error={errores.alias}
            ayuda="Vacío: no se ofrece transferencia."
          />
          <Campo
            etiqueta="A nombre de"
            id="titular"
            name="titular"
            defaultValue={titular}
            maxLength={80}
            error={errores.titular}
            ayuda="Como lo ve quien transfiere."
          />
          <Campo
            etiqueta="Cargo por servicio de Mercado Pago (%)"
            id="recargo"
            name="recargo"
            inputMode="decimal"
            defaultValue={recargo}
            maxLength={6}
            error={errores.recargo}
            ayuda="Lo paga quien compra con Mercado Pago. 4,4% cubre la comisión de 4,21%."
          />
        </div>
        {!guardando && <MensajeError>{errores.general}</MensajeError>}
        {!guardando && estado.guardado && (
          <p role="status" className="font-semibold text-ok-oscuro">
            Guardado.
          </p>
        )}
        <BotonPrincipal type="submit" disabled={guardando} className="self-start">
          {guardando ? "Guardando…" : "Guardar"}
        </BotonPrincipal>
      </form>

      <div className="flex flex-col gap-3 border-t border-borde pt-4">
        <h3 className="font-bold">Cuenta de Mercado Pago</h3>
        {cuentaMp ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              Conectada: <strong>{cuentaMp}</strong>
              {conectadaEl && <span className="text-tenue"> · desde {conectadaEl}</span>}
            </p>
            <form action={accionDesconectar}>
              <button type="submit" disabled={desconectando} className="h-11 text-sm font-semibold text-error underline">
                {desconectando ? "Desconectando…" : "Desconectar"}
              </button>
            </form>
          </div>
        ) : (
          <p className="text-sm text-tenue">Sin cuenta conectada: no se ofrece Mercado Pago y las transferencias se confirman a mano.</p>
        )}
        {!desconectando && <MensajeError>{estadoDesconectar.errores?.general}</MensajeError>}
        <form action={accionMp} className="flex flex-col gap-3">
          <Campo
            etiqueta={cuentaMp ? "Cambiar por otro Access Token" : "Access Token de producción"}
            id="token"
            name="token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="APP_USR-…"
            error={estadoMp.errores?.token}
            ayuda="Mercado Pago → Tus integraciones → tu aplicación → Credenciales de producción. Se guarda cifrado y no se vuelve a mostrar."
          />
          {!conectando && <MensajeError>{estadoMp.errores?.general}</MensajeError>}
          {!conectando && estadoMp.conectada && (
            <p role="status" className="font-semibold text-ok-oscuro">
              Listo: conectada la cuenta {estadoMp.conectada}.
            </p>
          )}
          <BotonPrincipal type="submit" disabled={conectando} className="self-start">
            {conectando ? "Revisando con Mercado Pago…" : "Conectar"}
          </BotonPrincipal>
        </form>
      </div>
    </section>
  );
}
