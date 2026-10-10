import Link from "next/link";
import { notFound } from "next/navigation";

import { requerirUsuario } from "@/lib/auth/actual";
import { alcanceDe } from "@/lib/auth/alcance";
import { eventoParaCortesias, listarCortesias, MAX_LISTA } from "@/lib/cortesias/cortesias";
import { obtenerDb } from "@/lib/db";
import { formatearFecha } from "@/lib/fechas";
import { mandarMailsDespues } from "@/lib/mails/despues";
import { estadoDeLosMails, hayEnvioConfigurado } from "@/lib/mails/pendientes";
import { formatearDni } from "@/lib/ventas/datos";

import { BotonReintentarMails } from "../../eventos/pagos";
import {
  anularAccion,
  darListaAccion,
  darUnaAccion,
  reenviarAccion,
  reintentarMailsCortesiasAccion,
  revisarListaAccion,
} from "../acciones";
import { CargarVarias, DarUna } from "./formularios";
import { type FilaCortesia, ListaCortesias } from "./lista";

// Las cortesías de un evento: el cupo, dar una, cargar varias y la lista de
// las que se dieron (con su PDF, reenviar el mail y anular).
export default async function PaginaCortesiasDelEvento({ params }: PageProps<"/admin/cortesias/[id]">) {
  const usuario = await requerirUsuario(["ADMIN", "ORGANIZADOR"]);
  const { id } = await params;
  const db = obtenerDb();
  // Si es de otra productora, para este organizador "no existe".
  const evento = await eventoParaCortesias(db, id, alcanceDe(usuario));
  if (!evento) notFound();

  const ahora = new Date();
  const [cortesias, mails] = await Promise.all([listarCortesias(db, evento.id, ahora), estadoDeLosMails(db, evento.id, ahora, "CORTESIA")]);
  const configurado = hayEnvioConfigurado();
  // Lo que no salió y todavía se reintenta solo, se manda después de responder.
  if (configurado && mails.sinEnviar.some((mail) => mail.reintentaSolo && !mail.enCurso)) mandarMailsDespues({ eventoId: evento.id });

  const quedan = Math.max(0, evento.cupo - evento.dadas);
  const porcentaje = evento.cupo > 0 ? Math.min(100, Math.round((evento.dadas / evento.cupo) * 100)) : 0;
  const filas: FilaCortesia[] = cortesias.map((cortesia) => ({
    id: cortesia.id,
    numero: cortesia.numero,
    titular: cortesia.titular,
    dni: formatearDni(cortesia.dni),
    tipo: cortesia.tipo,
    email: cortesia.email,
    estado: cortesia.estado,
    ingreso: cortesia.usadaEn ? formatearFecha(cortesia.usadaEn) : null,
    mail:
      cortesia.mail === "enviado"
        ? "mail enviado"
        : cortesia.mail === "enviando"
          ? configurado
            ? "el mail está saliendo"
            : "el mail no sale (falta configurar)"
          : `el mail no salió${cortesia.mailError ? `: ${cortesia.mailError.replace(/\.$/, "")}` : ""}${cortesia.mailReintentaSolo ? " (se reintenta solo)" : ""}`,
    mailMal: cortesia.mail === "no_salio",
    dadaPor: [cortesia.dadaPor ?? "alguien que ya no está", formatearFecha(cortesia.dadaEn)].join(" · "),
  }));

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href="/admin/cortesias" className="text-sm font-semibold text-acento hover:text-acento-hover">
          ← Cortesías
        </Link>
        <h1 className="font-display text-3xl font-extrabold [overflow-wrap:anywhere]">{evento.nombre}</h1>
        <p className="text-tenue">
          {formatearFecha(evento.fecha)}
          {usuario.rol === "ADMIN" && ` · ${evento.productora}`} · Entradas gratis, con un cupo aparte de la venta.
        </p>
      </div>

      <section className="flex flex-col gap-2 rounded-2xl border border-borde bg-superficie p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold">Cupo de cortesías</h2>
          <span className="text-sm">
            <strong>
              {evento.dadas} de {evento.cupo}
            </strong>{" "}
            dadas · {quedan === 1 ? "queda 1" : `quedan ${quedan}`}
          </span>
        </div>
        <div
          role="meter"
          aria-label={`Cortesías dadas: ${evento.dadas} de ${evento.cupo}`}
          aria-valuemin={0}
          aria-valuemax={evento.cupo}
          aria-valuenow={evento.dadas}
          className="h-2 overflow-hidden rounded-full bg-[#E2E2DC]"
        >
          <div className="h-full rounded-full bg-acento" style={{ width: `${porcentaje}%` }} />
        </div>
        <p className="text-sm text-tenue">
          {evento.cupo === 0 ? "Este evento todavía no tiene cupo de cortesías. " : ""}
          El cupo se cambia en{" "}
          <Link href={`/admin/eventos/${evento.id}`} className="font-semibold text-acento hover:text-acento-hover">
            Evento y lotes
          </Link>
          . Una cortesía anulada vuelve al cupo.
        </p>
      </section>

      {evento.terminado ? (
        <p className="rounded-2xl border border-borde bg-superficie p-5 text-tenue">El evento ya pasó: no se pueden dar más cortesías.</p>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <DarUna accion={darUnaAccion.bind(null, evento.id)} tipos={evento.tipos} />
          <CargarVarias
            revisar={revisarListaAccion.bind(null, evento.id)}
            dar={darListaAccion.bind(null, evento.id)}
            tipos={evento.tipos}
          />
        </div>
      )}

      {(mails.cuantosSinEnviar > 0 || (!configurado && cortesias.some((c) => c.email))) && (
        <section className="flex flex-col gap-2 rounded-2xl border border-borde bg-superficie p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <h2 className="font-bold">Mails de las cortesías</h2>
              <p className="text-sm text-tenue">
                {mails.enviados === 1 ? "1 enviado" : `${mails.enviados} enviados`} ·{" "}
                {mails.cuantosSinEnviar === 1 ? "1 sin enviar" : `${mails.cuantosSinEnviar} sin enviar`} (en la lista, cuál y por qué)
              </p>
            </div>
            {mails.cuantosSinEnviar > 0 && <BotonReintentarMails accion={reintentarMailsCortesiasAccion.bind(null, evento.id)} />}
          </div>
          {!configurado && (
            <p role="alert" className="rounded-xl bg-alerta/10 px-4 py-3 text-sm">
              <strong>Los mails no salen:</strong> falta configurar el servidor de mail o CLAVE_CODIGOS. Mientras tanto, bajá el PDF
              de cada una desde la lista. Cuando se configure, los que faltan salen solos.
            </p>
          )}
        </section>
      )}

      <ListaCortesias
        eventoId={evento.id}
        filas={filas}
        anular={anularAccion.bind(null, evento.id)}
        reenviar={reenviarAccion.bind(null, evento.id)}
        hayMas={cortesias.length >= MAX_LISTA}
      />
    </>
  );
}
