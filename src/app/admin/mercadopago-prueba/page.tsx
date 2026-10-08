import type { Metadata } from "next";
import { connection } from "next/server";

import { requerirUsuario } from "@/lib/auth/actual";
import { formatearPesos } from "@/lib/dinero";
import { formatearFecha } from "@/lib/fechas";
import { leerUltimosMovimientos } from "@/lib/pagos/movimientos-mp";

import { probarCobroAccion } from "./acciones";

export const metadata: Metadata = { title: "Prueba Mercado Pago", robots: { index: false } };

// Página de prueba, solo para el ADMIN (no está en el menú): muestra los
// últimos movimientos de la cuenta de Mercado Pago para ver si las
// transferencias aparecen y si les descuentan comisión.
export default async function PaginaPruebaMercadoPago({ searchParams }: PageProps<"/admin/mercadopago-prueba">) {
  await requerirUsuario(["ADMIN"]);
  const { error, volvio, status } = await searchParams;
  await connection();
  const resultado = await leerUltimosMovimientos(process.env.MERCADOPAGO_ACCESS_TOKEN);

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-extrabold">Prueba Mercado Pago</h1>
        <p className="text-tenue">
          Últimos 50 movimientos que Mercado Pago informa como pagos, leídos recién. Ojo: esta lista no es igual a la actividad de la app (ver abajo de cada uno los datos crudos).
        </p>
      </div>

      <section className="flex flex-col gap-3 rounded-2xl border border-borde bg-superficie p-5">
        <h2 className="text-lg font-bold">Probar un cobro de $100 (Checkout Pro)</h2>
        <p className="text-sm text-tenue">
          Abre Mercado Pago con el monto ya puesto, como lo vería un comprador. Hay que pagarlo desde{" "}
          <strong>otra cuenta de Mercado Pago</strong> (no se puede pagar a uno mismo), con dinero en cuenta. Después
          aparece acá abajo con la comisión que te descontaron.
        </p>
        <form action={probarCobroAccion}>
          <button type="submit" className="h-11 rounded-xl bg-acento px-5 font-bold text-white">
            Probar cobro de $100
          </button>
        </form>
        {typeof error === "string" && (
          <p role="alert" className="rounded-xl bg-error/10 px-4 py-3 font-semibold text-error">
            {error}
          </p>
        )}
        {volvio && (
          <p role="status" className="rounded-xl bg-ok/10 px-4 py-3 font-semibold text-ok-oscuro">
            Volviste de Mercado Pago{typeof status === "string" && ` (estado: ${status})`}. Si pagaste, el cobro aparece
            primero en la lista.
          </p>
        )}
      </section>

      {!resultado.ok ? (
        <p role="alert" className="rounded-xl bg-error/10 px-4 py-3 font-semibold text-error">
          {resultado.error}
        </p>
      ) : (
        <>
          <p className="text-sm text-tenue">
            Cuenta: <strong className="text-tinta">{resultado.cuenta}</strong>
          </p>
          {resultado.movimientos.length === 0 ? (
            <p className="rounded-2xl border border-borde bg-superficie p-6 text-tenue">
              Mercado Pago no devolvió ningún movimiento.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {resultado.movimientos.map((m) => (
                <li key={m.id} className="flex flex-col gap-1 rounded-2xl border border-borde bg-superficie p-4 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-lg font-bold">
                      {m.entra ? "Entró" : "Salió"} {formatearPesos(m.montoCentavos)}
                      {m.moneda && m.moneda !== "ARS" && <> ({m.moneda})</>}
                    </span>
                    <span className="text-tenue">{m.fecha ? formatearFecha(m.fecha) : "sin fecha"}</span>
                  </div>
                  {m.estado === "authorized" && (
                    <span className="font-semibold text-error">Reservado: todavía no se cobró (el monto final puede cambiar).</span>
                  )}
                  <span>
                    Comisión: <strong>{formatearPesos(m.comisionCentavos)}</strong>
                    {m.netoCentavos !== null && <> · Te quedó: {formatearPesos(m.netoCentavos)}</>}
                    {m.totalPagadoCentavos !== null && m.totalPagadoCentavos !== m.montoCentavos && (
                      <> · Total pagado: {formatearPesos(m.totalPagadoCentavos)}</>
                    )}
                    {m.impuestosCentavos > 0 && <> · Impuestos: {formatearPesos(m.impuestosCentavos)}</>}
                  </span>
                  {m.entra && m.liberacion && <span>Plata disponible: {formatearFecha(m.liberacion)}</span>}
                  {m.quien && <span>De/para: {m.quien}</span>}
                  {m.remitente && <span>Datos del banco de quien mandó: {m.remitente}</span>}
                  {m.detalle && <span>Detalle: {m.detalle}</span>}
                  <span className="text-xs text-tenue">
                    {m.estado}
                    {m.estadoDetalle && ` (${m.estadoDetalle})`} · {m.tipo || "sin tipo"} · {m.medio || "sin medio"} · id {m.id}
                  </span>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs font-semibold text-acento">Ver datos crudos</summary>
                    <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-[#1B1D22] p-3 text-xs whitespace-pre-wrap break-all text-[#D6D7DB]">
                      {m.crudo}
                    </pre>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
