// La compra: /compra/<llave>. El link es secreto (solo lo tiene quien
// reservó). Mientras la reserva está vigente: reloj, resumen, los datos de
// cada entrada y, con los datos completos, elegir cómo pagar (transferencia
// o Mercado Pago). Si venció o se canceló, lo dice y lleva de vuelta al
// evento; si ya está paga, lo confirma.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { obtenerDb } from "@/lib/db";
import { formatearPesos } from "@/lib/dinero";
import { opcionesDePago, revisarPagoDeCompra } from "@/lib/pagos/cobros";
import { apiMercadoPago } from "@/lib/pagos/mercadopago";
import { formatearDni } from "@/lib/ventas/datos";
import { buscarCompra, type Compra, liberarVencidas } from "@/lib/ventas/ordenes";

import { cancelarAccion, guardarDatosAccion, mercadoPagoAccion, revisarPagoAccion, transferenciaAccion } from "./acciones";
import { FormularioDatos } from "./formulario-datos";
import { DatosTransferencia, ElegirPago, EsperarPago } from "./pago";
import { Reloj } from "./reloj";

export const metadata: Metadata = {
  title: "Tu compra",
  robots: { index: false, follow: false },
  // Que el link (con la llave) no viaje a otras páginas.
  referrer: "no-referrer",
};

export default async function PaginaCompra({ params, searchParams }: PageProps<"/compra/[llave]">) {
  await connection();
  const { llave } = await params;
  const { editar, payment_id: pagoId } = await searchParams;
  const db = obtenerDb();

  // Volvió de Mercado Pago con el número del pago: se mira ese pago primero.
  if (typeof pagoId === "string") {
    await revisarPagoDeCompra(db, llave, apiMercadoPago, pagoId).catch((error: unknown) =>
      console.warn("[revisarPagoDeCompra] No se pudo:", error),
    );
  }

  const ahora = new Date();
  const compra = await buscarCompra(db, llave, ahora);
  if (!compra) notFound();
  const volver = `/e/${compra.evento.slug}`;
  const opciones = await opcionesDePago(db, llave);
  const esperando = opciones?.metodo === "TRANSFERENCIA" || opciones?.metodo === "MERCADOPAGO";

  if (compra.estado === "PAGADA") {
    return (
      <Marco titulo="Tu compra" evento={compra.evento.nombre} volver={volver}>
        <section role="status" className="flex flex-col gap-3 rounded-2xl border-2 border-ok bg-superficie p-5">
          <h2 className="font-display text-2xl font-bold text-ok-oscuro">¡Pago confirmado!</h2>
          <p>
            Compra N° <strong>{compra.numero}</strong> · {compra.evento.nombre}
          </p>
          <ul className="flex flex-col gap-0.5 text-[15px]">
            {compra.entradas.map((entrada, i) => (
              <li key={entrada.id}>
                Entrada {i + 1} · {entrada.tipo}: {entrada.titular} · DNI {formatearDni(entrada.dni ?? "")}
              </li>
            ))}
          </ul>
          <p className="text-tenue">
            Las entradas, cada una con su QR, van a llegar a <strong>{compra.email}</strong>. Guardá este link por las dudas.
          </p>
        </section>
      </Marco>
    );
  }

  if (compra.vencida) {
    // De paso, devuelve los lugares (si no lo hizo ya otra visita).
    await liberarVencidas(db, compra.evento.id, ahora).catch((error: unknown) =>
      console.warn("[liberarVencidas] No se pudo:", error),
    );
  }

  if (compra.estado !== "PENDIENTE" || compra.vencida) {
    const cancelada = compra.estado === "CANCELADA";
    return (
      <Marco titulo="Tu compra" evento={compra.evento.nombre} volver={volver}>
        <div className="flex flex-col gap-3 rounded-2xl border border-borde bg-superficie p-5">
          <h2 className="font-display text-xl font-bold">{cancelada ? "Cancelaste esta reserva" : "Se venció tu reserva"}</h2>
          <p className="text-tenue">
            {cancelada
              ? "Las entradas volvieron a estar a la venta."
              : "Pasaron los 15 minutos y las entradas volvieron a estar a la venta. Podés elegir de nuevo."}
          </p>
          {esperando && (
            <p className="text-[15px]">
              <strong>¿Ya pagaste?</strong> Si la plata entra y todavía hay lugar, te confirmamos la compra igual (esta
              página se actualiza sola). Si ya no queda lugar, te devolvemos la plata.
            </p>
          )}
          <Link href={volver} className="font-semibold text-acento hover:text-acento-hover">
            ← Volver a elegir entradas
          </Link>
        </div>
        {esperando && <EsperarPago revisar={revisarPagoAccion.bind(null, llave)} mensaje="Revisando si entró tu pago…" />}
      </Marco>
    );
  }

  const cancelar = cancelarAccion.bind(null, llave);
  const reloj = <Reloj venceEnMs={compra.venceEn!.getTime()} ahoraServidorMs={ahora.getTime()} />;

  // Primero, los datos de cada entrada (o corregirlos).
  if (!opciones?.datosCompletos || editar === "1") {
    return (
      <Marco titulo="Completá tus datos" evento={compra.evento.nombre} volver={volver} cancelar={cancelar}>
        {reloj}
        <Resumen compra={compra} />
        <FormularioDatos
          entradas={compra.entradas}
          email={compra.email}
          telefono={compra.telefono}
          totalCentavos={compra.totalCentavos}
          accion={guardarDatosAccion.bind(null, llave)}
        />
      </Marco>
    );
  }

  // Después, pagar.
  const transferencia = opciones.transferencia;
  return (
    <Marco titulo="Pagá tu compra" evento={compra.evento.nombre} volver={volver} cancelar={cancelar}>
      {reloj}
      <Resumen compra={compra} />
      <section className="flex flex-col gap-1.5 rounded-2xl border border-borde bg-superficie p-4 text-[15px]">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[13px] font-bold text-tenue">TUS DATOS</h2>
          <Link href={`/compra/${llave}?editar=1`} className="text-sm font-semibold text-acento hover:text-acento-hover">
            Corregir
          </Link>
        </div>
        <ul className="flex flex-col gap-0.5">
          {compra.entradas.map((entrada, i) => (
            <li key={entrada.id}>
              Entrada {i + 1} · {entrada.tipo}: {entrada.titular} · DNI {formatearDni(entrada.dni ?? "")}
            </li>
          ))}
        </ul>
        <p className="text-tenue">Las entradas llegan a {compra.email}</p>
      </section>

      {opciones.metodo === "TRANSFERENCIA" && transferencia?.montoCentavos && (
        <>
          <DatosTransferencia alias={transferencia.alias} titular={transferencia.titular} montoCentavos={transferencia.montoCentavos} />
          <EsperarPago revisar={revisarPagoAccion.bind(null, llave)} mensaje="Esperando tu transferencia…" />
        </>
      )}
      {opciones.metodo === "MERCADOPAGO" && (
        <EsperarPago revisar={revisarPagoAccion.bind(null, llave)} mensaje="Esperando la confirmación de Mercado Pago…" />
      )}

      <ElegirPago
        totalCentavos={compra.totalCentavos}
        transferencia={Boolean(transferencia)}
        mercadoPago={opciones.mercadoPago}
        elegido={opciones.metodo === "TRANSFERENCIA" || opciones.metodo === "MERCADOPAGO" ? opciones.metodo : null}
        transferir={transferenciaAccion.bind(null, llave)}
        pagarConMercadoPago={mercadoPagoAccion.bind(null, llave)}
      />
      <div className="h-6" />
    </Marco>
  );
}

// Cuántas de cada tipo y lote.
function Resumen({ compra }: { compra: Compra }) {
  const resumen = new Map<string, { texto: string; cantidad: number; precioCentavos: number }>();
  for (const entrada of compra.entradas) {
    const clave = `${entrada.tipo}·${entrada.lote}·${entrada.precioCentavos}`;
    const linea = resumen.get(clave) ?? { texto: `${entrada.tipo} · ${entrada.lote}`, cantidad: 0, precioCentavos: entrada.precioCentavos };
    linea.cantidad++;
    resumen.set(clave, linea);
  }
  const variosLotes = new Set(compra.entradas.map((e) => e.tipo)).size < resumen.size;
  return (
    <section aria-labelledby="titulo-resumen" className="flex flex-col gap-1.5 rounded-2xl border border-borde bg-superficie p-4">
      <h2 id="titulo-resumen" className="text-[13px] font-bold text-tenue">
        RESUMEN
      </h2>
      <ul className="flex flex-col gap-1 text-[15px]">
        {[...resumen.values()].map((linea) => (
          <li key={linea.texto + linea.precioCentavos} className="flex justify-between gap-3">
            <span>
              {linea.cantidad} × {linea.texto}
            </span>
            <span>{formatearPesos(linea.cantidad * linea.precioCentavos)}</span>
          </li>
        ))}
      </ul>
      {variosLotes && (
        <p className="text-[13px] text-tenue">
          En el lote en venta no quedaban todas las que pediste: las demás son del lote siguiente.
        </p>
      )}
    </section>
  );
}

function Marco({
  titulo,
  evento,
  volver,
  cancelar,
  children,
}: {
  titulo: string;
  evento: string;
  volver: string;
  cancelar?: () => Promise<void>;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col font-sans">
      <header className="border-b border-borde bg-superficie">
        <div className="mx-auto flex h-14 max-w-xl items-center justify-between gap-2 px-4">
          <div className="flex min-w-0 flex-col">
            <h1 className="text-[17px] font-bold leading-tight">{titulo}</h1>
            <span className="truncate text-[13px] text-tenue">{evento}</span>
          </div>
          {cancelar ? (
            <form action={cancelar}>
              <button type="submit" className="h-11 shrink-0 text-sm font-semibold text-acento underline hover:text-acento-hover">
                Cambiar entradas
              </button>
            </form>
          ) : (
            <Link href={volver} className="shrink-0 text-sm font-semibold text-acento hover:text-acento-hover">
              Ir al evento
            </Link>
          )}
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pt-4">{children}</main>
    </div>
  );
}
